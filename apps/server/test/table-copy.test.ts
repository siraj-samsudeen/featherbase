// #772 part 2: copy a warehouse table in, correct it, copy it again.
import { afterAll, beforeAll, describe, expect } from 'vitest'
import { rmSync } from 'node:fs'
import { test } from './pg-test'
import { overrideVariable } from '../src/env'
import { invalidateSources } from '../src/sources/registry'
import { buildStandin, changeStandin, STANDIN_TOKENS } from './motherduck-standin'
import { grantRole } from './fixtures'

let dir: string
beforeAll(async () => { dir = await buildStandin(); overrideVariable('MOTHERDUCK_STANDIN', dir) })
afterAll(() => { invalidateSources(); overrideVariable('MOTHERDUCK_STANDIN', undefined); rmSync(dir, { recursive: true, force: true }) })

const SOURCES = '/api/table/Data%20Source'
const STORES = [
  { source: 'state_code', column_name: 'state_code', label: 'State identifier', description: 'Warehouse state code' },
  { source: 'code', column_name: 'store_code', label: 'Store code', description: 'Stable warehouse store identifier' },
  { source: 'name', column_name: 'display_name', label: 'Store display name', description: 'Name shown to people' },
]

describe('Copy a warehouse table into Featherbase', () => {
  test('a column with repeats cannot be the key; a unique one can', async ({ admin }) => {
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'tc-key', token: STANDIN_TOKENS.reader, databases: ['sales'] })
    const city = await admin.get<{ usable: boolean }>(`${SOURCES}/tc-key:copy_check_key?database=sales&schema=main&table=stores&column=city`)
    const code = await admin.get<{ usable: boolean; rows: number }>(`${SOURCES}/tc-key:copy_check_key?database=sales&schema=main&table=stores&column=code`)
    expect(city.usable).toBe(false)
    expect(code).toMatchObject({ usable: true, rows: 3 })
  })

  test('copy, correct, copy again: the correction is kept, a changed source raises a conflict, a gone row is marked', async ({ admin }) => {
    // Keep warehouse mutations independent of tests that use the original stores.
    await changeStandin(dir, 'sales', ['create table cycle_stores as select * from stores'])
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'tc-cycle', token: STANDIN_TOKENS.reader, databases: ['sales'] })
    await admin.post(`${SOURCES}/tc-cycle:refresh_tables`, { database: 'sales' })
    const made = await admin.post<{ table: string; result: { inserted: number; failed: number } }>(`${SOURCES}/tc-cycle:copy_create`,
      { database: 'sales', schema: 'main', table: 'cycle_stores', name: 'Copied Store', key: 'code', columns: STORES })
    expect(made.table).toBe('Copied Store')
    expect(made.result).toMatchObject({ inserted: 3, failed: 0 })
    const meta = await admin.get<{ data_source?: string | null; columns: { column_name: string; label: string; description?: string; source_column?: string }[] }>('/api/table/Copied%20Store:meta')
    expect(meta.data_source ?? null).toBeNull()
    expect(meta.columns.filter((c) => c.source_column).map((c) => ({
      column_name: c.column_name, label: c.label, description: c.description, source_column: c.source_column,
    }))).toEqual([
      { column_name: 'state_code', label: 'State identifier', description: 'Warehouse state code', source_column: 'state_code' },
      { column_name: 'store_code', label: 'Store code', description: 'Stable warehouse store identifier', source_column: 'code' },
      { column_name: 'display_name', label: 'Store display name', description: 'Name shown to people', source_column: 'name' },
    ])
    expect(meta.columns.map((c) => c.column_name)).not.toContain('city')
    expect(meta.columns.map((c) => c.column_name)).not.toContain('name')
    for (const [id, name, state] of [['S001', 'Harbour Road', '32'], ['S002', 'Hill Street', '33'], ['S003', 'Market Lane', '32']]) {
      const copied = await admin.get(`/api/table/Copied%20Store/${id}`)
      expect(copied).toMatchObject({ row_id: id, store_code: id, display_name: name, state_code: state })
      expect(copied).not.toHaveProperty('city')
    }
    const row = await admin.get<{ row_id: string; store_code: string; state_code: string; updated_at: string }>('/api/table/Copied%20Store/S002')
    expect(row).toMatchObject({ store_code: 'S002', state_code: '33' })

    // A person corrects the state.
    await admin.post('/api/save_row', { table: 'Copied Store', row: { row_id: 'S002', state_code: '32', updated_at: row.updated_at } })
    // Unchanged source: the correction is kept, nothing is raised.
    const same = await admin.post<{ conflicts: number }>('/api/table/Copied%20Store:copy_again', {})
    expect(same.conflicts).toBe(0)
    expect((await admin.get<{ state_code: string }>('/api/table/Copied%20Store/S002')).state_code).toBe('32')

    // Saved mappings follow unedited source values while the correction wins.
    // The source changes the corrected value, drops a store, and adds another.
    await changeStandin(dir, 'sales', [
      `update cycle_stores set state_code = '34', name = 'Hill Street renamed' where code = 'S002'`,
      `delete from cycle_stores where code = 'S003'`,
      `insert into cycle_stores values ('S004', 'New Quay', 'Unused City', '07')`,
    ])
    await admin.post(`${SOURCES}/tc-cycle:refresh_tables`, { database: 'sales' })
    const changed = await admin.post<{ conflicts: number; deleted_at_source: number }>('/api/table/Copied%20Store:copy_again', {})
    expect(changed).toMatchObject({ conflicts: 1, deleted_at_source: 1 })
    expect((await admin.get<{ state_code: string }>('/api/table/Copied%20Store/S002')).state_code).toBe('32')
    expect(await admin.get('/api/table/Copied%20Store/S002')).toMatchObject({ display_name: 'Hill Street renamed', store_code: 'S002' })
    expect(await admin.get('/api/table/Copied%20Store/S004')).toMatchObject({ row_id: 'S004', store_code: 'S004', display_name: 'New Quay', state_code: '07' })
    expect((await admin.get<{ deleted_at_source: boolean }>('/api/table/Copied%20Store/S003')).deleted_at_source).toBe(true)
    const info = await admin.get<{ source_table: string; key_column: string }>('/api/table/Copied%20Store:copy_info')
    expect(info).toMatchObject({ source_table: 'cycle_stores', key_column: 'store_code' })
  })

  test('copy actions require System Manager even with native source and target read/write rights', async ({ admin, createUser }) => {
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'tc-guard', token: STANDIN_TOKENS.reader, databases: ['sales'] })
    await admin.post(`${SOURCES}/tc-guard:copy_create`, { database: 'sales', schema: 'main', table: 'stores', name: 'Guarded Copy', key: 'code', columns: STORES })
    await grantRole(admin, { role: 'Copy Editor', table: ['Data Source', 'Guarded Copy'], can_read: true, can_write: true, can_create: true })
    const user = await createUser({ roles: ['Copy Editor'] })
    expect(await user.get(`${SOURCES}/tc-guard`)).toMatchObject({ row_id: 'tc-guard' })
    const row = await user.get<{ updated_at: string }>('/api/table/Guarded%20Copy/S001')
    await user.post('/api/save_row', { table: 'Guarded Copy', row: { row_id: 'S001', display_name: 'Native correction', updated_at: row.updated_at } })
    expect(await user.get('/api/table/Guarded%20Copy/S001')).toMatchObject({ display_name: 'Native correction' })
    await expect(user.get(`${SOURCES}/tc-guard:copy_check_key?database=sales&schema=main&table=stores&column=code`)).rejects.toMatchObject({ status: 403 })
    await expect(user.post(`${SOURCES}/tc-guard:copy_create`, { database: 'sales', schema: 'main', table: 'stores', name: 'Unauthorized Copy', key: 'code', columns: STORES })).rejects.toMatchObject({ status: 403 })
    await expect(user.get('/api/table/Guarded%20Copy:copy_info')).rejects.toMatchObject({ status: 403 })
    await expect(user.post('/api/table/Guarded%20Copy:copy_again', {})).rejects.toMatchObject({ status: 403 })
    await expect(admin.get('/api/table/Unauthorized%20Copy:meta')).rejects.toMatchObject({ status: 404 })
  })

  test('key checking and creation refuse an unchosen database with a valid copyable table', async ({ admin }) => {
    await changeStandin(dir, 'stock', [
      'create table copy_items (sku varchar, title varchar)',
      `insert into copy_items values ('ITEM-09', 'Blue basket'), ('ITEM-21', 'Red bowl')`,
    ])
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'tc-stock-control', token: STANDIN_TOKENS.reader, databases: ['stock'] })
    await admin.post(`${SOURCES}/tc-stock-control:refresh_tables`, { database: 'stock' })
    const payload = { database: 'stock', schema: 'main', table: 'copy_items', name: 'Unchosen Copy', key: 'sku', columns: [
      { source: 'sku', column_name: 'item_code' }, { source: 'title', column_name: 'item_title' },
    ] }
    const query = 'database=stock&schema=main&table=copy_items&column=sku'
    expect(await admin.get(`${SOURCES}/tc-stock-control:copy_check_key?${query}`)).toMatchObject({ usable: true, rows: 2 })
    await admin.post(`${SOURCES}/tc-stock-control:copy_create`, { ...payload, name: 'Stock Control Copy' })
    expect(await admin.get('/api/table/Stock%20Control%20Copy/ITEM-21')).toMatchObject({ item_code: 'ITEM-21', item_title: 'Red bowl' })
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'tc-fence', token: STANDIN_TOKENS.reader, databases: ['sales'] })
    await expect(admin.get(`${SOURCES}/tc-fence:copy_check_key?${query}`)).rejects.toMatchObject({ status: 403 })
    await expect(admin.post(`${SOURCES}/tc-fence:copy_create`, payload)).rejects.toMatchObject({ status: 403 })
    await expect(admin.get('/api/table/Unchosen%20Copy:meta')).rejects.toMatchObject({ status: 404 })
  })
})

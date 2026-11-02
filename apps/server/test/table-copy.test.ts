// #772 part 2: copy a warehouse table in, correct it, copy it again.
import { afterAll, beforeAll, describe, expect } from 'vitest'
import { rmSync } from 'node:fs'
import { test } from './pg-test'
import { overrideVariable } from '../src/env'
import { invalidateSources } from '../src/sources/registry'
import { buildStandin, changeStandin, STANDIN_TOKENS } from './motherduck-standin'

let dir: string
beforeAll(async () => { dir = await buildStandin(); overrideVariable('MOTHERDUCK_STANDIN', dir) })
afterAll(() => { invalidateSources(); overrideVariable('MOTHERDUCK_STANDIN', undefined); rmSync(dir, { recursive: true, force: true }) })

const SOURCES = '/api/table/Data%20Source'
const STORES = ['code', 'name', 'city', 'state_code'].map((source) => ({ source, column_name: source === 'code' ? 'store_code' : source, label: source === 'code' ? 'Store code' : undefined }))

describe('Copy a warehouse table into Featherbase', () => {
  test('a column with repeats cannot be the key; a unique one can', async ({ admin }) => {
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'tc-key', token: STANDIN_TOKENS.reader, databases: ['sales'] })
    const city = await admin.get<{ usable: boolean }>(`${SOURCES}/tc-key:copy_check_key?database=sales&schema=main&table=stores&column=city`)
    const code = await admin.get<{ usable: boolean; rows: number }>(`${SOURCES}/tc-key:copy_check_key?database=sales&schema=main&table=stores&column=code`)
    expect(city.usable).toBe(false)
    expect(code).toMatchObject({ usable: true, rows: 3 })
  })

  test('copy, correct, copy again: the correction is kept, a changed source raises a conflict, a gone row is marked', async ({ admin }) => {
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'tc-cycle', token: STANDIN_TOKENS.reader, databases: ['sales'] })
    const made = await admin.post<{ table: string; result: { inserted: number; failed: number } }>(`${SOURCES}/tc-cycle:copy_create`,
      { database: 'sales', schema: 'main', table: 'stores', name: 'Copied Store', key: 'code', columns: STORES })
    expect(made.result).toMatchObject({ inserted: 3, failed: 0 })
    const row = await admin.get<{ row_id: string; store_code: string; state_code: string; updated_at: string }>('/api/table/Copied%20Store/S002')
    expect(row).toMatchObject({ store_code: 'S002', state_code: '33' })

    // A person corrects the state.
    await admin.post('/api/save_row', { table: 'Copied Store', row: { row_id: 'S002', state_code: '32', updated_at: row.updated_at } })
    // Unchanged source: the correction is kept, nothing is raised.
    const same = await admin.post<{ conflicts: number }>('/api/table/Copied%20Store:copy_again', {})
    expect(same.conflicts).toBe(0)
    expect((await admin.get<{ state_code: string }>('/api/table/Copied%20Store/S002')).state_code).toBe('32')

    // A renamed column still copies.
    // The source changes the corrected value, and drops a store.
    await changeStandin(dir, 'sales', [`update stores set state_code = '34' where code = 'S002'`, `delete from stores where code = 'S003'`])
    invalidateSources('tc-cycle')
    const changed = await admin.post<{ conflicts: number; deleted_at_source: number }>('/api/table/Copied%20Store:copy_again', {})
    expect(changed).toMatchObject({ conflicts: 1, deleted_at_source: 1 })
    expect((await admin.get<{ state_code: string }>('/api/table/Copied%20Store/S002')).state_code).toBe('32')
    expect((await admin.get<{ deleted_at_source: boolean }>('/api/table/Copied%20Store/S003')).deleted_at_source).toBe(true)
    const info = await admin.get<{ source_table: string; key_column: string }>('/api/table/Copied%20Store:copy_info')
    expect(info).toMatchObject({ source_table: 'stores', key_column: 'store_code' })
  })
})

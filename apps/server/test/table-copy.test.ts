// #772 part 2: copy a warehouse table in, correct it, copy it again.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { DuckDBConnection } from '@duckdb/node-api'
import { rmSync } from 'node:fs'
import { makeClient } from 'feather-testing-postgres'
import { app } from '../src/index'
import { issueSession } from '../src/auth'
import { deleteTable } from '../src/table-engine'
import { sql } from '../src/db'
import { test } from './pg-test'
import { committedTest } from './pg-test-shared'
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
  test('a public copy releases completed row transaction locks', async ({ admin }) => {
    await changeStandin(dir, 'sales', [
      `create table lock_stores as select 'L' || range::varchar as code, 'Store ' || range::varchar as title from range(301)`,
    ])
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'tc-locks', token: STANDIN_TOKENS.reader, databases: ['sales'] })
    const made = await admin.post<{ result: { inserted: number } }>(`${SOURCES}/tc-locks:copy_create`, {
      database: 'sales', schema: 'main', table: 'lock_stores', name: 'Bounded Locks Copy', key: 'code',
      columns: [{ source: 'code', column_name: 'code' }, { source: 'title', column_name: 'title' }],
    })
    expect(made.result.inserted).toBe(301)
    expect(await admin.get('/api/table/Bounded%20Locks%20Copy/L300')).toMatchObject({ code: 'L300', title: 'Store 300' })
    const [locks] = await sql`select count(*)::int as n from pg_locks
      where pid = pg_backend_pid() and locktype = 'transactionid'`
    expect(locks.n).toBeLessThan(8)
  }, 30_000)

  test('a column with repeats cannot be the key; a unique one can', async ({ admin }) => {
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'tc-key', token: STANDIN_TOKENS.reader, databases: ['sales'] })
    const city = await admin.get<{ usable: boolean }>(`${SOURCES}/tc-key:copy_check_key?database=sales&schema=main&table=stores&column=city`)
    const code = await admin.get<{ usable: boolean; rows: number }>(`${SOURCES}/tc-key:copy_check_key?database=sales&schema=main&table=stores&column=code`)
    expect(city.usable).toBe(false)
    expect(code).toMatchObject({ usable: true, rows: 3 })
    await expect(admin.post(`${SOURCES}/tc-key:copy_create`, { database: 'sales', schema: 'main', table: 'stores', name: 'Invalid Key Copy', key: 'city', columns: [{ source: 'city', column_name: 'city' }] })).rejects.toMatchObject({ status: 417 })
    await expect(admin.post(`${SOURCES}/tc-key:copy_create`, { database: 'sales', schema: 'main', table: 'stores', name: 'Missing Key Copy', key: 'code', columns: STORES.slice(0, 1) })).rejects.toMatchObject({ status: 417 })
    await expect(admin.get('/api/table/Data%20Source:copy_info')).rejects.toMatchObject({ status: 404 })
  })

  test('incomplete copy choices refuse before creating a native Table', async ({ admin }) => {
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'tc-incomplete', token: STANDIN_TOKENS.reader, databases: ['sales'] })
    await expect(admin.post(`${SOURCES}/tc-incomplete:copy_create`, { database: 'sales' })).rejects.toMatchObject({ status: 417 })
    // A missing warehouse relation uses the driver's DataSourceError, like
    // any other refused warehouse query; copy creation validates its choices.
    await expect(admin.get(`${SOURCES}/tc-incomplete:copy_check_key?database=sales`)).rejects.toMatchObject({ status: 502 })
    await expect(admin.get('/api/table/Incomplete%20Copy:meta')).rejects.toMatchObject({ status: 404 })
  })

  test('warehouse scalar types retain their values in native rows', async ({ admin }) => {
    await changeStandin(dir, 'sales', [
      `create table typed_copy_rows(code varchar, amount double, opened date, note text, opening_time time)`,
      `insert into typed_copy_rows values ('0007', 12.75, '2024-02-29', '${'Long warehouse note. '.repeat(10)}', '08:37:12')`,
    ])
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'tc-types', token: STANDIN_TOKENS.reader, databases: ['sales'] })
    await admin.post(`${SOURCES}/tc-types:copy_create`, { database: 'sales', schema: 'main', table: 'typed_copy_rows', name: 'Typed Copy', key: 'code', columns: ['code', 'amount', 'opened', 'note', 'opening_time'].map(source => ({ source, column_name: source })) })
    // Native Date columns serialize as midnight UTC, not a DuckDB object.
    expect(await admin.get('/api/table/Typed%20Copy/0007')).toMatchObject({ code: '0007', amount: 12.75, opened: '2024-02-29T00:00:00.000Z', note: 'Long warehouse note. '.repeat(10), opening_time: '08:37:12' })
    // A string longer than Data's 140 characters copies whole; only the key stays bounded.
    const meta = await admin.get<{ columns: { column_name: string; column_type: string }[] }>('/api/table/Typed%20Copy:meta')
    expect(Object.fromEntries(meta.columns.map(c => [c.column_name, c.column_type]))).toMatchObject({ code: 'Data', note: 'Text' })
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

  test('later key and data column renames retain their source mapping on copy again', async ({ admin }) => {
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'tc-rename', token: STANDIN_TOKENS.reader, databases: ['sales'] })
    await admin.post(`${SOURCES}/tc-rename:copy_create`, { database: 'sales', schema: 'main', table: 'stores', name: 'Renamed Copy', key: 'code', columns: STORES })
    await admin.post('/api/table_def/Renamed%20Copy/rename_column', { from: 'store_code', to: 'warehouse_code' })
    await admin.post('/api/table_def/Renamed%20Copy/rename_column', { from: 'display_name', to: 'trading_name' })
    expect(await admin.get('/api/table/Renamed%20Copy:copy_info')).toMatchObject({ key_column: 'warehouse_code' })
    await admin.post('/api/table/Renamed%20Copy:copy_again', {})
    expect(await admin.get('/api/table/Renamed%20Copy/S002')).toMatchObject({ warehouse_code: 'S002', trading_name: 'Hill Street' })
  })

  test('renaming the copied Table keeps its provenance, so Copy again still works', async ({ admin }) => {
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'tc-table-rename', token: STANDIN_TOKENS.reader, databases: ['sales'] })
    await admin.post(`${SOURCES}/tc-table-rename:copy_create`, { database: 'sales', schema: 'main', table: 'stores', name: 'Store Copy Before', key: 'code', columns: STORES })
    await admin.post('/api/table_def/Store%20Copy%20Before/rename', { to: 'Store Copy After' })
    expect(await admin.get('/api/table/Store%20Copy%20After:copy_info')).toMatchObject({ target_table: 'Store Copy After', source_table: 'stores' })
    await admin.post('/api/table/Store%20Copy%20After:copy_again', {})
    expect(await admin.get('/api/table/Store%20Copy%20After/S002')).toMatchObject({ store_code: 'S002', display_name: 'Hill Street' })
  })

  test('removing the matching column refuses refresh without changing rows', async ({ admin }) => {
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'tc-removed-key', token: STANDIN_TOKENS.reader, databases: ['sales'] })
    await admin.post(`${SOURCES}/tc-removed-key:copy_create`, { database: 'sales', schema: 'main', table: 'stores', name: 'Removed Key Copy', key: 'code', columns: STORES })
    const meta = await admin.get<{ columns: { column_name: string }[] }>('/api/table/Removed%20Key%20Copy:meta')
    await admin.put('/api/table_def/Removed%20Key%20Copy', { columns: meta.columns.filter(c => c.column_name !== 'store_code'), remove_columns: ['store_code'] })
    const before = await admin.get('/api/table/Removed%20Key%20Copy/S001')
    const history = await admin.get('/api/import/batches')
    await expect(admin.post('/api/table/Removed%20Key%20Copy:copy_again', {})).rejects.toMatchObject({ status: 417, message: expect.stringContaining('key column store_code') })
    expect(await admin.get('/api/table/Removed%20Key%20Copy/S001')).toEqual(before)
    expect(await admin.get('/api/import/batches')).toEqual(history)
  })

  test('each copy appears in Past imports and its initial rows can be undone', async ({ admin }) => {
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'tc-history', token: STANDIN_TOKENS.reader, databases: ['sales'] })
    const made = await admin.post<{ result: { run_id: string } }>(`${SOURCES}/tc-history:copy_create`, { database: 'sales', schema: 'main', table: 'stores', name: 'History Copy', key: 'code', columns: STORES })
    const history = await admin.get<{ batches: { batch_id: string; targets: { table: string; run_id: string }[] }[] }>('/api/import/batches')
    expect(history.batches.find((b) => b.batch_id === made.result.run_id)?.targets).toEqual(expect.arrayContaining([expect.objectContaining({ table: 'History Copy', run_id: made.result.run_id })]))
    expect(await admin.post('/api/table/History%20Copy:import-revert', { run_id: made.result.run_id })).toMatchObject({ deleted: 3, failed: [], skipped: [] })
    await expect(admin.get('/api/table/History%20Copy/S001')).rejects.toMatchObject({ status: 404 })
    expect(await admin.get('/api/table/History%20Copy:meta')).toMatchObject({ name: 'History Copy' })
  })

  test('deletion markers are managed, restored by the source and undone with the copy', async ({ admin }) => {
    await changeStandin(dir, 'sales', ['create table undo_stores as select * from stores'])
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'tc-undo', token: STANDIN_TOKENS.reader, databases: ['sales'] })
    await admin.post(`${SOURCES}/tc-undo:copy_create`, { database: 'sales', schema: 'main', table: 'undo_stores', name: 'Undo Copy', key: 'code', columns: STORES })
    const row = await admin.get<{ updated_at: string }>('/api/table/Undo%20Copy/S003')
    expect(row).toMatchObject({ deleted_at_source: false })
    await admin.post('/api/save_row', { table: 'Undo Copy', row: { row_id: 'S003', updated_at: row.updated_at, deleted_at_source: true } })
    expect(await admin.get('/api/table/Undo%20Copy/S003')).toMatchObject({ deleted_at_source: false })
    await admin.post('/api/table/Undo%20Copy:import', {
      rows: [{ row_id: 'S003', deleted_at_source: true }], key_column: 'row_id',
      managedColumns: ['deleted_at_source'], managedValues: { deleted_at_source: true },
      context: { managedColumns: ['deleted_at_source'] },
    })
    expect(await admin.get('/api/table/Undo%20Copy/S003')).toMatchObject({ deleted_at_source: false })
    await changeStandin(dir, 'sales', ["update undo_stores set name = 'Harbour renewed' where code = 'S001'", "delete from undo_stores where code = 'S003'", "insert into undo_stores values ('S004', 'New Quay', 'City', '07')"])
    await admin.post(`${SOURCES}/tc-undo:refresh_tables`, { database: 'sales' })
    const copied = await admin.post<{ run_id: string }>('/api/table/Undo%20Copy:copy_again', {})
    expect(await admin.get('/api/table/Undo%20Copy/S003')).toMatchObject({ deleted_at_source: true })
    expect(await admin.post('/api/table/Undo%20Copy:import-revert', { run_id: copied.run_id })).toMatchObject({ restored: 2, deleted: 1, failed: [] })
    expect(await admin.get('/api/table/Undo%20Copy/S001')).toMatchObject({ display_name: 'Harbour Road' })
    expect(await admin.get('/api/table/Undo%20Copy/S003')).toMatchObject({ deleted_at_source: false })
    await admin.post('/api/table/Undo%20Copy:copy_again', {})
    await changeStandin(dir, 'sales', ["insert into undo_stores values ('S003', 'Market Lane restored', 'City', '32')"])
    await admin.post(`${SOURCES}/tc-undo:refresh_tables`, { database: 'sales' })
    expect(await admin.post('/api/table/Undo%20Copy:copy_again', {})).toMatchObject({ back_at_source: 1 })
    expect(await admin.get('/api/table/Undo%20Copy/S003')).toMatchObject({ deleted_at_source: false, display_name: 'Market Lane restored' })
  })

  test('a refused later row rolls back earlier changes, conflicts, import history and provenance', async ({ admin }) => {
    await changeStandin(dir, 'sales', ['create table atomic_stores as select * from stores'])
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'tc-atomic', token: STANDIN_TOKENS.reader, databases: ['sales'] })
    await admin.post(`${SOURCES}/tc-atomic:copy_create`, { database: 'sales', schema: 'main', table: 'atomic_stores', name: 'Atomic Copy', key: 'code', columns: STORES })
    await admin.post('/api/save_row', { table: 'Server Script', row: { row_id: 'refuse-copy-third-row', script_type: 'Document Event', ref_table: 'Atomic Copy', event: 'before_save', script: 'if (doc.store_code === "S003") throw new Error("Third store refused")', enabled: true } })
    const snapshot = () => Promise.all(['S001', 'S002', 'S003'].map(id => admin.get(`/api/table/Atomic%20Copy/${id}`)))
    const before = await snapshot()
    const history = await admin.get('/api/import/batches')
    const provenance = await admin.get('/api/table/Atomic%20Copy:copy_info')
    await changeStandin(dir, 'sales', ["update atomic_stores set name = 'Changed before refusal' where code = 'S001'"])
    await admin.post(`${SOURCES}/tc-atomic:refresh_tables`, { database: 'sales' })
    await expect(admin.post('/api/table/Atomic%20Copy:copy_again', {})).rejects.toMatchObject({ status: 417, message: expect.stringContaining('Third store refused') })
    expect(await snapshot()).toEqual(before)
    expect(await admin.get('/api/import/batches')).toEqual(history)
    expect(await admin.get('/api/table/Atomic%20Copy:copy_info')).toEqual(provenance)
    // The underlying importer remains best-effort for unrelated consumers.
    expect(await admin.post('/api/table/Atomic%20Copy:import', { key_column: 'row_id', rows: [{ row_id: 'S001', display_name: 'Generic success' }, { row_id: 'S003', display_name: 'Generic refusal' }] })).toMatchObject({ updated: 1, failed: [{ index: 1 }] })
    expect(await admin.get('/api/table/Atomic%20Copy/S001')).toMatchObject({ display_name: 'Generic success' })
  })

  test('a deleted native copy can be copied again under the same Table name', async ({ admin }) => {
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'tc-recreate', token: STANDIN_TOKENS.reader, databases: ['sales'] })
    const choices = { database: 'sales', schema: 'main', table: 'stores', name: 'Recreated Copy', key: 'code', columns: STORES }
    const first = await admin.post<{ result: { run_id: string } }>(`${SOURCES}/tc-recreate:copy_create`, choices)
    await admin.delete('/api/table_def/Recreated%20Copy')
    await expect(admin.get('/api/table/Recreated%20Copy:copy_info')).rejects.toMatchObject({ status: 404 })
    const second = await admin.post<{ result: { run_id: string; inserted: number } }>(`${SOURCES}/tc-recreate:copy_create`, choices)
    expect(second.result.inserted).toBe(3)
    expect(second.result.run_id).not.toBe(first.result.run_id)
    expect(await admin.get('/api/table/Recreated%20Copy/S001')).toMatchObject({ store_code: 'S001', display_name: 'Harbour Road' })
    const history = await admin.get<{ batches: { batch_id: string }[] }>('/api/import/batches')
    expect(history.batches.map(b => b.batch_id)).toEqual(expect.arrayContaining([first.result.run_id, second.result.run_id]))
  })

  test('source removal keeps native rows and copy history but withdraws provenance', async ({ admin }) => {
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'tc-remove-source', token: STANDIN_TOKENS.reader, databases: ['sales'] })
    const copied = await admin.post<{ result: { run_id: string } }>(`${SOURCES}/tc-remove-source:copy_create`, { database: 'sales', schema: 'main', table: 'stores', name: 'Source Removed Copy', key: 'code', columns: STORES })
    await admin.delete(`${SOURCES}/tc-remove-source`)
    expect(await admin.get('/api/table/Source%20Removed%20Copy/S001')).toMatchObject({ store_code: 'S001', display_name: 'Harbour Road' })
    const row = await admin.get<{ updated_at: string }>('/api/table/Source%20Removed%20Copy/S001')
    await admin.post('/api/save_row', { table: 'Source Removed Copy', row: { row_id: 'S001', display_name: 'Still editable', updated_at: row.updated_at } })
    expect(await admin.get('/api/table/Source%20Removed%20Copy/S001')).toMatchObject({ display_name: 'Still editable' })
    await expect(admin.get('/api/table/Source%20Removed%20Copy:copy_info')).rejects.toMatchObject({ status: 404 })
    await expect(admin.post('/api/table/Source%20Removed%20Copy:copy_again', {})).rejects.toMatchObject({ status: 404 })
    const history = await admin.get<{ batches: { batch_id: string }[] }>('/api/import/batches')
    expect(history.batches.map(b => b.batch_id)).toContain(copied.result.run_id)
  })

  test('a refused import-history write rolls back the copy', async ({ admin }) => {
    await changeStandin(dir, 'sales', ['create table history_failure_stores as select * from stores'])
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'tc-history-failure', token: STANDIN_TOKENS.reader, databases: ['sales'] })
    await admin.post(`${SOURCES}/tc-history-failure:copy_create`, { database: 'sales', schema: 'main', table: 'history_failure_stores', name: 'History Failure Copy', key: 'code', columns: STORES })
    const before = await admin.get('/api/table/History%20Failure%20Copy/S001')
    const provenance = await admin.get('/api/table/History%20Failure%20Copy:copy_info')
    await sql.unsafe(`create function refuse_copy_history() returns trigger language plpgsql as $$ begin raise exception 'Copy history refused'; end $$;
      create trigger refuse_copy_history before insert on featherbase.import_log for each row execute function refuse_copy_history()`)
    await changeStandin(dir, 'sales', ["update history_failure_stores set name = 'Never committed' where code = 'S001'"])
    await admin.post(`${SOURCES}/tc-history-failure:refresh_tables`, { database: 'sales' })
    // The injected database refusal is an internal error, not bad row input.
    await expect(admin.post('/api/table/History%20Failure%20Copy:copy_again', {})).rejects.toMatchObject({ status: 500 })
    expect(await admin.get('/api/table/History%20Failure%20Copy/S001')).toEqual(before)
    expect(await admin.get('/api/table/History%20Failure%20Copy:copy_info')).toEqual(provenance)
  })

  test('failed copy provenance creation leaves no native Table', async ({ admin }) => {
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'tc-create-failure', token: STANDIN_TOKENS.reader, databases: ['sales'] })
    await sql.unsafe(`create function refuse_copy_provenance() returns trigger language plpgsql as $$ begin raise exception 'Copy provenance refused'; end $$;
      create trigger refuse_copy_provenance before insert on featherbase.table_copy for each row execute function refuse_copy_provenance()`)
    await expect(admin.post(`${SOURCES}/tc-create-failure:copy_create`, { database: 'sales', schema: 'main', table: 'stores', name: 'Atomic Creation Copy', key: 'code', columns: STORES })).rejects.toMatchObject({ status: 500 })
    await expect(admin.get('/api/table/Atomic%20Creation%20Copy:meta')).rejects.toMatchObject({ status: 404 })
  })

  test('a failed source observation leaves the target untouched', async ({ admin }) => {
    await changeStandin(dir, 'sales', ['create table failing_stores as select * from stores'])
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'tc-source-failure', token: STANDIN_TOKENS.reader, databases: ['sales'] })
    await admin.post(`${SOURCES}/tc-source-failure:copy_create`, { database: 'sales', schema: 'main', table: 'failing_stores', name: 'Source Failure Copy', key: 'code', columns: STORES })
    const snapshot = () => Promise.all(['S001', 'S002', 'S003'].map(id => admin.get(`/api/table/Source%20Failure%20Copy/${id}`)))
    const before = await snapshot()
    const history = await admin.get('/api/import/batches')
    const provenance = await admin.get('/api/table/Source%20Failure%20Copy:copy_info')
    await changeStandin(dir, 'sales', ['drop table failing_stores'])
    await admin.post(`${SOURCES}/tc-source-failure:refresh_tables`, { database: 'sales' })
    await expect(admin.post('/api/table/Source%20Failure%20Copy:copy_again', {})).rejects.toMatchObject({ status: 502 })
    expect(await snapshot()).toEqual(before)
    expect(await admin.get('/api/import/batches')).toEqual(history)
    expect(await admin.get('/api/table/Source%20Failure%20Copy:copy_info')).toEqual(provenance)
  })

  test('duplicate source identities refuse the whole refresh', async ({ admin }) => {
    await changeStandin(dir, 'sales', ['create table duplicate_stores as select * from stores'])
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'tc-duplicate', token: STANDIN_TOKENS.reader, databases: ['sales'] })
    await admin.post(`${SOURCES}/tc-duplicate:copy_create`, { database: 'sales', schema: 'main', table: 'duplicate_stores', name: 'Duplicate Copy', key: 'code', columns: STORES })
    const before = await admin.get('/api/table/Duplicate%20Copy/S001')
    const history = await admin.get('/api/import/batches')
    await changeStandin(dir, 'sales', ["insert into duplicate_stores values ('S001', 'Duplicate', 'City', '99')"])
    await admin.post(`${SOURCES}/tc-duplicate:refresh_tables`, { database: 'sales' })
    await expect(admin.post('/api/table/Duplicate%20Copy:copy_again', {})).rejects.toMatchObject({ status: 417, message: expect.stringContaining('Copy key values must be unique') })
    expect(await admin.get('/api/table/Duplicate%20Copy/S001')).toEqual(before)
    expect(await admin.get('/api/import/batches')).toEqual(history)
  })

  test('empty source identities refuse the whole refresh', async ({ admin }) => {
    await changeStandin(dir, 'sales', ['create table empty_key_stores as select * from stores'])
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'tc-empty-key', token: STANDIN_TOKENS.reader, databases: ['sales'] })
    await admin.post(`${SOURCES}/tc-empty-key:copy_create`, { database: 'sales', schema: 'main', table: 'empty_key_stores', name: 'Empty Key Copy', key: 'code', columns: STORES })
    const before = await admin.get('/api/table/Empty%20Key%20Copy/S001')
    const history = await admin.get('/api/import/batches')
    for (const invalid of ["'   '", 'NULL']) {
      await changeStandin(dir, 'sales', [`update empty_key_stores set code = ${invalid} where name = 'Market Lane'`])
      await admin.post(`${SOURCES}/tc-empty-key:refresh_tables`, { database: 'sales' })
      await expect(admin.post('/api/table/Empty%20Key%20Copy:copy_again', {})).rejects.toMatchObject({ status: 417, message: expect.stringContaining('Copy key values must not be empty') })
      expect(await admin.get('/api/table/Empty%20Key%20Copy/S001')).toEqual(before)
      expect(await admin.get('/api/import/batches')).toEqual(history)
    }
  })

  committedTest('a mapping changed during the source read refuses the stale copy', async ({ admin }) => {
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'tc-mapping-race', token: STANDIN_TOKENS.reader, databases: ['sales'] })
    await admin.post(`${SOURCES}/tc-mapping-race:copy_create`, { database: 'sales', schema: 'main', table: 'stores', name: 'Mapping Race Copy', key: 'code', columns: STORES })
    const before = await admin.get('/api/table/Mapping%20Race%20Copy/S001')
    const history = await admin.get('/api/import/batches')
    const provenance = await admin.get('/api/table/Mapping%20Race%20Copy:copy_info')
    let entered!: () => void
    let release!: () => void
    const reading = new Promise<void>(resolve => { entered = resolve })
    const released = new Promise<void>(resolve => { release = resolve })
    const original = DuckDBConnection.prototype.stream
    const gate = vi.spyOn(DuckDBConnection.prototype, 'stream').mockImplementationOnce(async function (this: DuckDBConnection, ...args) {
      entered()
      await released
      return original.apply(this, args)
    })
    const refresh = admin.post('/api/table/Mapping%20Race%20Copy:copy_again', {})
    // Attach the rejection observer before releasing the external SDK read.
    const refused = expect(refresh).rejects.toMatchObject({ status: 409, message: expect.stringContaining('copy changed') })
    try {
      await reading
      await admin.post('/api/table_def/Mapping%20Race%20Copy/rename_column', { from: 'display_name', to: 'trading_name' })
      release()
      await refused
      const { display_name, ...unchanged } = before as Record<string, unknown>
      expect(await admin.get('/api/table/Mapping%20Race%20Copy/S001')).toEqual({ ...unchanged, trading_name: display_name })
      expect(await admin.get('/api/import/batches')).toEqual(history)
      expect(await admin.get('/api/table/Mapping%20Race%20Copy:copy_info')).toEqual(provenance)
    } finally {
      release()
      await Promise.allSettled([refresh, refused])
      gate.mockRestore()
    }
  })

  // Separate committed connections are essential: a sandbox's single session
  // can reacquire its own advisory lock and cannot prove serialization.
  it('overlapping refreshes produce distinct undoable source observations', async () => {
    const session = await issueSession('Administrator')
    const admin = makeClient(app, session.token, 'Administrator')
    try {
    await changeStandin(dir, 'sales', ['create table concurrent_stores as select * from stores'])
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'tc-concurrent', token: STANDIN_TOKENS.reader, databases: ['sales'] })
    await admin.post(`${SOURCES}/tc-concurrent:copy_create`, { database: 'sales', schema: 'main', table: 'concurrent_stores', name: 'Concurrent Copy', key: 'code', columns: STORES })
    await changeStandin(dir, 'sales', ["update concurrent_stores set name = 'Latest source' where code = 'S001'"])
    await admin.post(`${SOURCES}/tc-concurrent:refresh_tables`, { database: 'sales' })
    const results = await Promise.all([1, 2].map(() => admin.post<{ run_id: string; changed: number; unchanged: number; conflicts: number }>('/api/table/Concurrent%20Copy:copy_again', {})))
    expect(new Set(results.map(r => r.run_id)).size).toBe(2)
    expect(results.map(r => r.changed).sort()).toEqual([0, 1])
    expect(results.map(r => r.unchanged).sort()).toEqual([2, 3])
    expect(results.map(r => r.conflicts)).toEqual([0, 0])
    expect(await admin.get('/api/table/Concurrent%20Copy/S001')).toMatchObject({ display_name: 'Latest source' })
    const history = await admin.get<{ batches: { batch_id: string }[] }>('/api/import/batches')
    expect(history.batches.map(b => b.batch_id)).toEqual(expect.arrayContaining(results.map(r => r.run_id)))
    } finally {
      await deleteTable('Concurrent Copy')
      await admin.delete(`${SOURCES}/tc-concurrent`)
      await admin.post('/api/logout', {})
      await sql`delete from featherbase.revoked_session where jti = ${session.user.sign_in!.session_id}`
      await sql`delete from featherbase.import_log where ref_table = 'Concurrent Copy'`
      await sql`delete from featherbase.import_source where ref_table = 'Concurrent Copy'`
      await sql`delete from featherbase.version where ref_table = 'Concurrent Copy'`
    }
  })

  test('an empty source marks every row through the undoable import chain', async ({ admin }) => {
    await changeStandin(dir, 'sales', ['create table empty_stores as select * from stores'])
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'tc-empty', token: STANDIN_TOKENS.reader, databases: ['sales'] })
    await admin.post(`${SOURCES}/tc-empty:copy_create`, { database: 'sales', schema: 'main', table: 'empty_stores', name: 'Empty Copy', key: 'code', columns: STORES })
    expect(await admin.post('/api/table/Empty%20Copy:copy_again', {})).toMatchObject({ updated: 3, changed: 0, unchanged: 3 })
    await changeStandin(dir, 'sales', ['delete from empty_stores'])
    await admin.post(`${SOURCES}/tc-empty:refresh_tables`, { database: 'sales' })
    const copied = await admin.post<{ run_id: string }>('/api/table/Empty%20Copy:copy_again', {})
    expect(copied).toMatchObject({ inserted: 0, updated: 0, deleted_at_source: 3 })
    expect(await admin.get('/api/table/Empty%20Copy/S001')).toMatchObject({ deleted_at_source: true })
    const repeated = await admin.post<{ run_id: string }>('/api/table/Empty%20Copy:copy_again', {})
    expect(repeated).toMatchObject({ inserted: 0, updated: 0, deleted_at_source: 0 })
    const history = await admin.get<{ batches: { batch_id: string }[] }>('/api/import/batches')
    expect(history.batches.map(b => b.batch_id)).toContain(repeated.run_id)
    expect(await admin.post('/api/table/Empty%20Copy:import-revert', { run_id: copied.run_id })).toMatchObject({ restored: 3, deleted: 0, failed: [] })
    expect(await admin.get('/api/table/Empty%20Copy/S001')).toMatchObject({ deleted_at_source: false })
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

  test('wide decimals and integers keep every digit; narrow ones stay numbers', async ({ admin }) => {
    await changeStandin(dir, 'sales', [
      'create table exact_numbers (code varchar, wide decimal(18,2), narrow decimal(10,2), huge hugeint)',
      `insert into exact_numbers values ('N-1', 9999999999999999.99, 12.50, 123456789012345678901234567890)`,
    ])
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'tc-exact', token: STANDIN_TOKENS.reader, databases: ['sales'] })
    await admin.post(`${SOURCES}/tc-exact:copy_create`, { database: 'sales', schema: 'main', table: 'exact_numbers', name: 'Exact Numbers', key: 'code', columns: ['code', 'wide', 'narrow', 'huge'].map(source => ({ source, column_name: source })) })
    const meta = await admin.get<{ columns: { column_name: string; column_type: string }[] }>('/api/table/Exact%20Numbers:meta')
    expect(Object.fromEntries(meta.columns.map(c => [c.column_name, c.column_type]))).toMatchObject({ wide: 'Text', narrow: 'Float', huge: 'Text' })
    expect(await admin.get('/api/table/Exact%20Numbers/N-1')).toMatchObject({ wide: '9999999999999999.99', narrow: 12.5, huge: '123456789012345678901234567890' })
    await admin.post('/api/table/Exact%20Numbers:copy_again', {})
    expect(await admin.get('/api/table/Exact%20Numbers/N-1')).toMatchObject({ wide: '9999999999999999.99' })
  })

  test('a table restriction on the source refuses preview, key checks, copying and Copy again of any other table', async ({ admin }) => {
    await changeStandin(dir, 'stock', [
      'create table fenced_items (sku varchar, title varchar)',
      `insert into fenced_items values ('F-1', 'Kept'), ('F-2', 'Also kept')`,
      'create table open_items (sku varchar, title varchar)',
      `insert into open_items values ('O-1', 'Allowed')`,
    ])
    await admin.post(`${SOURCES}:motherduck_connect`, { name: 'tc-allowlist', token: STANDIN_TOKENS.reader, databases: ['stock'] })
    const columns = [{ source: 'sku', column_name: 'sku' }, { source: 'title', column_name: 'title' }]
    await admin.post(`${SOURCES}/tc-allowlist:copy_create`, { database: 'stock', schema: 'main', table: 'fenced_items', name: 'Fenced Before Restriction', key: 'sku', columns })
    await sql`update featherbase.data_source set table_allowlist = 'stock.main.open_items' where row_id = 'tc-allowlist'`
    invalidateSources('tc-allowlist')
    const fenced = 'database=stock&schema=main&table=fenced_items'
    await expect(admin.get(`${SOURCES}/tc-allowlist:preview?${fenced}`)).rejects.toMatchObject({ status: 403 })
    await expect(admin.get(`${SOURCES}/tc-allowlist:copy_check_key?${fenced}&column=sku`)).rejects.toMatchObject({ status: 403 })
    await expect(admin.post(`${SOURCES}/tc-allowlist:copy_create`, { database: 'stock', schema: 'main', table: 'fenced_items', name: 'Fenced Copy', key: 'sku', columns })).rejects.toMatchObject({ status: 403 })
    await expect(admin.get('/api/table/Fenced%20Copy:meta')).rejects.toMatchObject({ status: 404 })
    await expect(admin.post('/api/table/Fenced%20Before%20Restriction:copy_again', {})).rejects.toMatchObject({ status: 403 })
    // Positive control: the allowed table still previews and copies.
    expect(await admin.get(`${SOURCES}/tc-allowlist:preview?database=stock&schema=main&table=open_items`)).toMatchObject({ rows: 1 })
    await admin.post(`${SOURCES}/tc-allowlist:copy_create`, { database: 'stock', schema: 'main', table: 'open_items', name: 'Open Copy', key: 'sku', columns })
    expect(await admin.get('/api/table/Open%20Copy/O-1')).toMatchObject({ title: 'Allowed' })
  })
})

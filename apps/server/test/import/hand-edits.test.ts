import { describe, expect } from 'vitest'
import { test } from '../pg-test'
import { expectApiError, expectRefused, makeTable, patchDoc } from '../fixtures'

const table = 'Import Corrections'
const path = `/api/table/${encodeURIComponent(table)}`
describe('Import remembers hand edits (#626)', () => {
  test('1 and 4: a correction survives while untouched fields follow the source', async ({ admin }) => {
    await makeTable(admin, { name: table, columns: ['code', 'city', 'phone'] })
    await admin.post(`${path}:import`, { rows: [{ row_id: 'A', code: 'A', city: 'North', phone: '111' }], context: { run_id: 'first' } })
    const old = await admin.get<Record<string, unknown>>(`${path}/A`)
    await patchDoc(admin, `${path}/A`, { city: 'South', updated_at: old.updated_at })
    await admin.post(`${path}:import`, { key_column: 'code', rows: [{ code: 'A', city: 'East', phone: '222' }], context: { run_id: 'second' } })
    const row = await admin.get<Record<string, unknown>>(`${path}/A`)
    expect(row.city).toBe('South')
    expect(row.phone).toBe('222')
    const result = await admin.get<{ conflicts: Record<string, unknown>[] }>(`${path}:import-conflicts`)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]).toMatchObject({ row_id: 'A', field: 'city', kept: 'South', incoming: 'East', editor: 'Administrator', run_id: 'second' })
  })
})

// Each scenario uses the public import and resolution actions, the same seam
// as the wizard and scripted loaders.
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../../src/db'
import { invalidateMeta } from '../../src/meta'
import { registerController, unregisterController, type TableController } from '../../src/controllers'
async function correction(admin: TestClient) {
  await makeTable(admin, { name: table, columns: ['code', 'city', 'phone'] })
  await admin.post(`${path}:import`, { rows: [{ row_id: 'A', code: 'A', city: 'North', phone: '111' }], context: { run_id: 'first' } })
  const row = await admin.get<Record<string, unknown>>(`${path}/A`)
  await patchDoc(admin, `${path}/A`, { city: 'South', updated_at: row.updated_at })
}
const load = (admin: TestClient, city: string, run_id: string, extra = {}) => admin.post(`${path}:import`, { key_column: 'code', rows: [{ code: 'A', city, ...extra }], context: { run_id } })
const conflicts = (admin: TestClient) => admin.get<{ conflicts: { id: string; field: string; incoming: unknown; can_resolve: boolean }[] }>(`${path}:import-conflicts`)
test('2 and 10: untouched fields follow API imports and history attributes the change to the import', async ({ admin }) => {
  await makeTable(admin, { name: table, columns: ['code', 'city'] })
  await admin.post(`${path}:import`, { rows: [{ row_id: 'A', code: 'A', city: 'North' }] })
  await load(admin, 'East', 'api-second')
  expect((await admin.get<Record<string, unknown>>(`${path}/A`)).city).toBe('East')
  expect((await conflicts(admin)).conflicts).toEqual([])
  const activity = await admin.get<{ versions: { data: Record<string, unknown> }[] }>(`/api/activity/${encodeURIComponent(table)}/A`)
  expect(activity.versions.at(-1)?.data).toMatchObject({ import_run: 'api-second', changed: [['city', 'North', 'East']] })
})
test('3: matching the current or previous source value changes nothing and raises no conflict', async ({ admin }) => {
  await correction(admin)
  await load(admin, 'North', 'unchanged-source')
  expect((await admin.get<Record<string, unknown>>(`${path}/A`)).city).toBe('South')
  expect((await conflicts(admin)).conflicts).toEqual([])
  await load(admin, 'South', 'unchanged-person')
  expect((await conflicts(admin)).conflicts).toEqual([])
})
test('5: keep mine records the decision and suppresses the same source, but a new source raises one conflict', async ({ admin }) => {
  await correction(admin)
  await load(admin, 'East', 'second')
  const [conflict] = (await conflicts(admin)).conflicts
  await admin.post(`${path}:resolve-import-conflict`, { conflict_id: conflict.id, decision: 'keep' })
  await load(admin, 'East', 'same')
  expect((await conflicts(admin)).conflicts).toEqual([])
  await load(admin, 'West', 'different')
  const raised = (await conflicts(admin)).conflicts
  expect(raised).toHaveLength(1)
  await load(admin, 'West', 'same-again')
  expect((await conflicts(admin)).conflicts.map(c => c.id)).toEqual(raised.map(c => c.id))
  const activity = await admin.get<{ versions: { data: Record<string, unknown> }[] }>(`/api/activity/${encodeURIComponent(table)}/A`)
  expect(activity.versions.some(v => (v.data.resolution as Record<string, unknown> | undefined)?.decision === 'keep')).toBe(true)
})
test('6: adopting the source gives future imports ownership while recording the resolver', async ({ admin }) => {
  await correction(admin)
  await load(admin, 'East', 'second')
  const [conflict] = (await conflicts(admin)).conflicts
  await admin.post(`${path}:resolve-import-conflict`, { conflict_id: conflict.id, decision: 'source' })
  expect((await admin.get<Record<string, unknown>>(`${path}/A`)).city).toBe('East')
  await load(admin, 'West', 'third')
  expect((await admin.get<Record<string, unknown>>(`${path}/A`)).city).toBe('West')
  expect((await conflicts(admin)).conflicts).toEqual([])
})

for (const { decision, retry, city } of [
  { decision: 'keep', retry: 'source', city: 'South' },
  { decision: 'source', retry: 'keep', city: 'East' },
]) {
  test(`a resolved ${decision} decision cannot be replaced using its closed conflict ID`, async ({ admin }) => {
    await correction(admin)
    await load(admin, 'East', 'second')
    const [conflict] = (await conflicts(admin)).conflicts
    expect(await admin.post(`${path}:resolve-import-conflict`, { conflict_id: conflict.id, decision }))
      .toEqual({ resolved: true })
    const before = await admin.get(`${path}/A`)
    expect(before).toMatchObject({ city })
    const historyPath = `/api/activity/${encodeURIComponent(table)}/A`
    const history = await admin.get(historyPath)
    await expectApiError(admin.post(`${path}:resolve-import-conflict`, { conflict_id: conflict.id, decision: retry }), {
      status: 409, type: 'ConflictError', message: '409 ConflictError: This import conflict is already closed',
    })
    expect(await admin.get(`${path}/A`)).toEqual(before)
    expect(await admin.get(historyPath)).toEqual(history)
    expect((await conflicts(admin)).conflicts).toEqual([])
  })
}

test('invalid resolution arguments leave the current conflict unchanged', async ({ admin }) => {
  await correction(admin)
  await load(admin, 'East', 'second')
  const before = await admin.get(`${path}/A`)
  const open = await conflicts(admin)
  const [conflict] = open.conflicts
  for (const args of [
    { conflict_id: conflict.id, decision: 'SOURCE' },
    { conflict_id: conflict.id, decision: 1 },
    { conflict_id: 1, decision: 'source' },
    { decision: 'source' },
  ]) {
    await expectApiError(admin.post(`${path}:resolve-import-conflict`, args), {
      status: 417, type: 'ValidationError', message: '417 ValidationError: Choose keep or source for an import conflict',
    })
    expect(await admin.get(`${path}/A`)).toEqual(before)
    expect(await conflicts(admin)).toEqual(open)
  }
})

test('an import without any match keys cannot overwrite a correction', async ({ admin }) => {
  await correction(admin)
  const listPath = `${path}?fields=${encodeURIComponent('["row_id","code","city","phone","updated_at"]')}`
  const before = await admin.get(listPath)
  expect(before).toMatchObject({ total: 1, data: [{ row_id: 'A', code: 'A', city: 'South', phone: '111' }] })
  for (const dry_run of [true, false]) {
    const result = await admin.post(`${path}:import`, {
      key_column: 'code', dry_run, rows: [{ code: ' \t ', city: 'East' }, { city: 'West' }],
    })
    expect(result).toMatchObject({
      inserted: 0, updated: 0,
      failed: [
        { index: 0, message: 'row has no value in the match key column code' },
        { index: 1, message: 'row has no value in the match key column code' },
      ],
    })
    expect(await admin.get(listPath)).toEqual(before)
    expect((await conflicts(admin)).conflicts).toEqual([])
  }
})

test('7: preview counts protected and updated fields without writing', async ({ admin }) => {
  await correction(admin)
  const before = await admin.get<Record<string, unknown>>(`${path}/A`)
  const result = await admin.post(`${path}:import`, { key_column: 'code', rows: [{ code: 'A', city: 'East', phone: '222' }], dry_run: true })
  expect(result).toMatchObject({ fields_updated: 1, fields_kept: 1, tracks_changes: true })
  expect(await admin.get(`${path}/A`)).toEqual(before)
  expect((await conflicts(admin)).conflicts).toEqual([])
})

for (const scenario of [
  { name: 'current values are unchanged', city: 'South', phone: '111', changed: 0, rows_kept: 0, fields_kept: 0, conflicts: 0 },
  { name: 'previous source retains the correction', city: 'North', phone: '111', changed: 0, rows_kept: 1, fields_kept: 1, conflicts: 0 },
  { name: 'new source raises a retained-value conflict', city: 'East', phone: '111', changed: 0, rows_kept: 1, fields_kept: 1, conflicts: 1 },
  { name: 'a changed row can retain a correction', city: 'East', phone: '222', changed: 1, rows_kept: 1, fields_kept: 1, conflicts: 1 },
]) {
  test(`#851 preview: ${scenario.name}`, async ({ admin }) => {
    await correction(admin)
    await admin.post(`${path}:import`, { rows: [{ row_id: 'B', code: 'B', city: 'West', phone: '333' }] })
    const before = await admin.get(`${path}?fields=${encodeURIComponent('["row_id","city","phone","updated_at"]')}`)
    expect(await admin.post(`${path}:import`, {
      key_column: 'code', dry_run: true,
      rows: [
        { code: 'A', city: scenario.city, phone: scenario.phone },
        { code: 'B', city: 'West', phone: '333' },
        { code: 'C', city: 'New', phone: '444' },
      ],
    })).toMatchObject({
      valid: 3, updated: 2, inserted: 1, failed: [],
      changed: scenario.changed, unchanged: 2 - scenario.changed,
      fields_updated: scenario.changed, rows_kept: scenario.rows_kept,
      fields_kept: scenario.fields_kept, conflicts: scenario.conflicts,
    })
    expect(await admin.get(`${path}?fields=${encodeURIComponent('["row_id","city","phone","updated_at"]')}`)).toEqual(before)
    expect((await conflicts(admin)).conflicts).toEqual([])
  })
}

test('7: a Table without history warns in preview and keeps overwrite semantics', async ({ admin }) => {
  await correction(admin)
  await sql`update table_def set track_changes = false where name = ${table}`
  invalidateMeta(table)
  expect(await admin.post(`${path}:import`, { key_column: 'code', rows: [{ code: 'A', city: 'East' }], dry_run: true })).toMatchObject({ fields_updated: 1, fields_kept: 0, tracks_changes: false })
  await load(admin, 'East', 'no-history')
  expect((await admin.get<Record<string, unknown>>(`${path}/A`)).city).toBe('East')
  expect((await conflicts(admin)).conflicts).toEqual([])
})

test('turning history on after the first import preserves corrections without inventing source conflicts', async ({ admin }) => {
  await makeTable(admin, { name: table, columns: ['code', 'city'] })
  await sql`update table_def set track_changes = false where name = ${table}`
  invalidateMeta(table)
  await admin.post(`${path}:import`, { rows: [{ row_id: 'A', code: 'A', city: 'North' }] })
  await sql`update table_def set track_changes = true where name = ${table}`
  invalidateMeta(table)
  const original = await admin.get<Record<string, unknown>>(`${path}/A`)
  await patchDoc(admin, `${path}/A`, { city: 'South', updated_at: original.updated_at })
  await load(admin, 'North', 'unchanged-after-history')
  expect(await admin.get(`${path}/A`)).toMatchObject({ city: 'South' })
  expect((await conflicts(admin)).conflicts).toEqual([])
  await load(admin, 'East', 'changed-after-history')
  expect((await conflicts(admin)).conflicts).toMatchObject([{ field: 'city', incoming: 'East' }])
})

test('8: undo restores only changed fields and closes that import’s conflicts', async ({ admin }) => {
  await correction(admin)
  await load(admin, 'East', 'second', { phone: '222' })
  expect(await admin.post(`${path}:import-revert`, { run_id: 'second' })).toMatchObject({ restored: 1, failed: [] })
  expect(await admin.get(`${path}/A`)).toMatchObject({ city: 'South', phone: '111' })
  expect((await conflicts(admin)).conflicts).toEqual([])
})
test('8: an import that only kept corrections can be undone without changing them', async ({ admin }) => {
  await correction(admin)
  await load(admin, 'East', 'second')
  expect(await admin.post(`${path}:import-revert`, { run_id: 'second' })).toMatchObject({ restored: 0, failed: [] })
  expect(await admin.get(`${path}/A`)).toMatchObject({ city: 'South' })
  expect((await conflicts(admin)).conflicts).toEqual([])
})
import { createUserWithRole, grantRole } from '../fixtures'
test('9: conflicts hide unreadable rows and restricted fields and refuse read-only resolution', async ({ admin, createUser }) => {
  await correction(admin)
  await load(admin, 'East', 'second')
  const [conflict] = (await conflicts(admin)).conflicts
  const reader = await createUserWithRole(admin, createUser, { role: 'Correction Reader', table, can_read: true })
  expect((await conflicts(reader)).conflicts).toMatchObject([{ id: conflict.id, can_resolve: false }])
  await expectRefused(reader.post(`${path}:resolve-import-conflict`, { conflict_id: conflict.id, decision: 'keep' }), 403)
  const own = await createUserWithRole(admin, createUser, { role: 'Correction Own', table, can_read: true, can_write: true, own_rows_only: true })
  expect((await conflicts(own)).conflicts).toEqual([])
  await sql`update column_def set tier = 'restricted' where parent = ${table} and column_name = 'city'`
  invalidateMeta(table)
  const editor = await createUserWithRole(admin, createUser, { role: 'Correction Basic', table, can_read: true, can_write: true })
  expect((await conflicts(editor)).conflicts).toEqual([])
  await expectRefused(editor.post(`${path}:resolve-import-conflict`, { conflict_id: conflict.id, decision: 'source' }), 403)
  // Even a grant on the generic storage cannot expose the parent's secret.
  await grantRole(admin, { role: 'Correction Basic', table: ['Import Conflict', 'Import Source'], can_read: true })
  expect(await editor.get('/api/table/Import%20Conflict?fields=["row_id","kept","incoming"]')).toMatchObject({ data: [] })
  expect(await editor.get('/api/table/Import%20Source?fields=["row_id","values"]')).toMatchObject({ data: [] })
  const activity = await editor.get<{ versions: { data: unknown }[] }>(`/api/activity/${encodeURIComponent(table)}/A`)
  expect(JSON.stringify(activity)).not.toContain('South')
  expect(JSON.stringify(activity)).not.toContain('East')
})
test('a later manual edit after adoption owns the field again; stale conflict resolution refuses', async ({ admin }) => {
  await correction(admin)
  await load(admin, 'East', 'second')
  const [conflict] = (await conflicts(admin)).conflicts
  let row = await admin.get<Record<string, unknown>>(`${path}/A`)
  await patchDoc(admin, `${path}/A`, { city: 'New correction', updated_at: row.updated_at })
  await expectRefused(admin.post(`${path}:resolve-import-conflict`, { conflict_id: conflict.id, decision: 'source' }), 409)
  await load(admin, 'West', 'third')
  const [replacement] = (await conflicts(admin)).conflicts
  await admin.post(`${path}:resolve-import-conflict`, { conflict_id: replacement.id, decision: 'source' })
  row = await admin.get<Record<string, unknown>>(`${path}/A`)
  await patchDoc(admin, `${path}/A`, { city: 'Final correction', updated_at: row.updated_at })
  await load(admin, 'Next source', 'fourth')
  expect(await admin.get(`${path}/A`)).toMatchObject({ city: 'Final correction' })
  expect((await conflicts(admin)).conflicts).toHaveLength(1)
})
test('equal typed JSON and Date values are unchanged and an empty clear remains a protected incoming value', async ({ admin }) => {
  await makeTable(admin, { name: table, columns: ['code', 'city', 'details:JSON', 'day:Date'] })
  await admin.post(`${path}:import`, { rows: [{ row_id: 'A', code: 'A', city: 'North', details: { a: 1, b: 2 }, day: '2026-10-28' }] })
  const row = await admin.get<Record<string, unknown>>(`${path}/A`)
  await patchDoc(admin, `${path}/A`, { city: 'South', updated_at: row.updated_at })
  expect(await admin.post(`${path}:import`, { rows: [{ code: 'A', details: { b: 2, a: 1 }, day: '2026-10-28' }], key_column: 'code', columns: ['code', 'city', 'details', 'day'], empty_cells: 'clear', dry_run: true })).toMatchObject({ fields_updated: 0, fields_kept: 1 })
})
test('an unchanged-only import cannot close conflicts through undo without row edit permission', async ({ admin, createUser }) => {
  await correction(admin)
  await load(admin, 'East', 'second')
  const reader = await createUserWithRole(admin, createUser, { role: 'Undo Correction Reader', table, can_read: true })
  await expectRefused(reader.post(`${path}:import-revert`, { run_id: 'second' }), 403)
  expect((await conflicts(admin)).conflicts).toHaveLength(1)
})
test('a source that comes into agreement closes an old conflict', async ({ admin }) => {
  await correction(admin)
  await load(admin, 'East', 'second')
  await load(admin, 'South', 'agrees')
  expect((await conflicts(admin)).conflicts).toEqual([])
  expect(await admin.get(`${path}/A`)).toMatchObject({ city: 'South' })
})
test('timestamp milliseconds survive source comparison and conflict evidence', async ({ admin }) => {
  await makeTable(admin, { name: table, columns: ['code', 'at:Datetime'] })
  await admin.post(`${path}:import`, { rows: [{ row_id: 'A', code: 'A', at: '2026-10-28T01:02:03.123Z' }] })
  const row = await admin.get<Record<string, unknown>>(`${path}/A`)
  await patchDoc(admin, `${path}/A`, { at: '2026-10-28T01:02:03.456Z', updated_at: row.updated_at })
  expect(await admin.post(`${path}:import`, { key_column: 'code', rows: [{ code: 'A', at: '2026-10-28T01:02:03.456Z' }], dry_run: true })).toMatchObject({ fields_updated: 0, fields_kept: 0 })
  await admin.post(`${path}:import`, { key_column: 'code', rows: [{ code: 'A', at: '2026-10-28T01:02:03.789Z' }] })
  expect((await conflicts(admin)).conflicts).toMatchObject([{ kept: '2026-10-28T01:02:03.456Z', incoming: '2026-10-28T01:02:03.789Z' }])
})
test('an unchanged source cannot let an automation overwrite a protected correction', async ({ admin }) => {
  await correction(admin)
  await admin.post('/api/save_row', { table: 'Server Script', row: { row_id: 'correction-automation', script_type: 'Document Event', ref_table: table, event: 'before_save', script: 'doc.city = "Automation"', enabled: true } })
  expect(await load(admin, 'North', 'unchanged')).toMatchObject({ updated: 0, failed: [{ index: 0, message: 'An automation changed a protected import field' }] })
  expect(await admin.get(`${path}/A`)).toMatchObject({ city: 'South' })
  expect((await conflicts(admin)).conflicts).toEqual([])
})
test('insert-mode preview also warns when history is off', async ({ admin }) => {
  await makeTable(admin, { name: table, columns: ['code'] })
  await sql`update table_def set track_changes = false where name = ${table}`
  invalidateMeta(table)
  expect(await admin.post(`${path}:import`, { rows: [{ code: 'A' }], dry_run: true })).toMatchObject({ tracks_changes: false, fields_updated: 0, fields_kept: 0 })
})
test('a recreated Table never adopts or rewrites the old Table’s history', async ({ admin }) => {
  await correction(admin)
  const [old] = await sql`select row_id, data from version where ref_table = ${table} and ref_name = 'A'`
  await admin.delete(`/api/table_def/${encodeURIComponent(table)}`)
  await makeTable(admin, { name: table, columns: ['code', 'city', 'phone'] })
  // A new real transaction has a later birth; sandbox now() is fixed.
  await sql`update table_def set created_at = clock_timestamp() where name = ${table}`
  await admin.post(`${path}:import`, { rows: [{ row_id: 'A', code: 'A', city: 'New North' }], context: { run_id: 'reborn' } })
  await load(admin, 'New East', 'reborn-second')
  expect(await admin.get(`${path}/A`)).toMatchObject({ city: 'New East' })
  expect((await conflicts(admin)).conflicts).toEqual([])
  const [after] = await sql`select data from version where row_id = ${old.row_id}`
  expect(after.data).toEqual(old.data)
})
test('invalid incoming values are refused before protection in preview and commit alike', async ({ admin }) => {
  await makeTable(admin, { name: table, columns: ['code', 'amount:Int'] })
  await admin.post(`${path}:import`, { rows: [{ row_id: 'A', code: 'A', amount: 1 }] })
  const row = await admin.get<Record<string, unknown>>(`${path}/A`)
  await patchDoc(admin, `${path}/A`, { amount: 2, updated_at: row.updated_at })
  const args = { key_column: 'code', rows: [{ code: 'A', amount: 'invalid-number' }] }
  const preview = await admin.post<{ failed: unknown[] }>(`${path}:import`, { ...args, dry_run: true })
  const committed = await admin.post<{ failed: unknown[]; updated: number }>(`${path}:import`, args)
  expect(preview.failed).toHaveLength(1)
  expect(committed.failed).toEqual(preview.failed)
  expect(committed.updated).toBe(0)
  expect((await conflicts(admin)).conflicts).toEqual([])
  expect(await admin.get(`${path}/A`)).toMatchObject({ amount: 2 })
})
test('an old conflict ID cannot change a new Table with the same name and row ID', async ({ admin }) => {
  await correction(admin)
  await load(admin, 'East', 'old-conflict')
  const [old] = (await conflicts(admin)).conflicts
  await admin.delete(`/api/table_def/${encodeURIComponent(table)}`)
  await makeTable(admin, { name: table, columns: ['code', 'city'] })
  // Model the real new transaction's later Table birth inside the sandbox.
  await sql`update table_def set created_at = clock_timestamp() where name = ${table}`
  await admin.post(`${path}`, { row_id: 'A', code: 'A', city: 'South' })
  expect((await conflicts(admin)).conflicts).toEqual([])
  await expectRefused(admin.post(`${path}:resolve-import-conflict`, { conflict_id: old.id, decision: 'source' }), 404)
  expect(await admin.get(`${path}/A`)).toMatchObject({ city: 'South' })
})
test('the remembered source is the supplied value even when an insert automation transforms it', async ({ admin }) => {
  await makeTable(admin, { name: table, columns: ['code', 'city'] })
  await admin.post('/api/save_row', { table: 'Server Script', row: { row_id: 'source-normalization', script_type: 'Document Event', ref_table: table, event: 'before_save', script: 'if (doc.city === "North") doc.city = "NORTH"', enabled: true } })
  await admin.post(`${path}:import`, { rows: [{ row_id: 'A', code: 'A', city: 'North' }] })
  const row = await admin.get<Record<string, unknown>>(`${path}/A`)
  expect(row.city).toBe('NORTH')
  await patchDoc(admin, `${path}/A`, { city: 'South', updated_at: row.updated_at })
  await load(admin, 'North', 'same-source')
  expect((await conflicts(admin)).conflicts).toEqual([])
  expect(await admin.get(`${path}/A`)).toMatchObject({ city: 'South' })
})
test('a row refused for changing a protected field runs none of its after-commit effects', async ({ admin }) => {
  await correction(admin)
  await admin.post('/api/save_row', { table: 'Server Script', row: { row_id: 'correction-automation', script_type: 'Document Event', ref_table: table, event: 'before_save', script: 'doc.city = "Automation"', enabled: true } })
  const committed: unknown[] = []
  const controller: TableController = { table, hooks: { after_commit: async ({ row }) => { committed.push(row.city) } } }
  registerController(controller)
  try {
    expect(await load(admin, 'North', 'refused')).toMatchObject({ updated: 0, failed: [{ index: 0 }] })
    expect(committed).toEqual([])
  } finally { unregisterController(controller) }
})
test('an empty optional Datetime or number is no value, as a save treats it', async ({ admin }) => {
  await makeTable(admin, { name: table, columns: ['code', 'at:Datetime', 'amount:Int'] })
  expect(await admin.post(`${path}:import`, { rows: [{ row_id: 'A', code: 'A', at: '', amount: '' }] })).toMatchObject({ inserted: 1, failed: [] })
  const row = await admin.get<Record<string, unknown>>(`${path}/A`)
  expect(row).toMatchObject({ at: null, amount: null })
  await patchDoc(admin, `${path}/A`, { at: '2026-10-28T01:02:03.000Z', amount: 0, updated_at: row.updated_at })
  const args = { key_column: 'code', rows: [{ code: 'A', at: '', amount: '' }], columns: ['code', 'at', 'amount'], empty_cells: 'clear' }
  // The previous source raises no new conflict, but both differing corrections survive.
  expect(await admin.post(`${path}:import`, { ...args, dry_run: true })).toMatchObject({ failed: [], fields_kept: 2, rows_kept: 1, conflicts: 0, changed: 0, unchanged: 1 })
  expect(await admin.post(`${path}:import`, args)).toMatchObject({ updated: 1, failed: [] })
  expect(await admin.get(`${path}/A`)).toMatchObject({ at: '2026-10-28T01:02:03.000Z', amount: 0 })
  expect((await conflicts(admin)).conflicts).toEqual([])
})
test('an undone import is not a hand edit: importing the same value again updates the field', async ({ admin }) => {
  await makeTable(admin, { name: table, columns: ['code', 'city'] })
  await admin.post(`${path}:import`, { rows: [{ row_id: 'A', code: 'A', city: 'North' }], context: { run_id: 'first' } })
  await load(admin, 'East', 'second')
  await admin.post(`${path}:import-revert`, { run_id: 'second' })
  expect(await admin.get(`${path}/A`)).toMatchObject({ city: 'North' })
  expect(await admin.post(`${path}:import`, { key_column: 'code', rows: [{ code: 'A', city: 'East' }], dry_run: true })).toMatchObject({ fields_updated: 1, fields_kept: 0 })
  await load(admin, 'East', 'third')
  expect(await admin.get(`${path}/A`)).toMatchObject({ city: 'East' })
  expect((await conflicts(admin)).conflicts).toEqual([])
})
test('a correction after an undo is not suppressed by the undone import’s source', async ({ admin }) => {
  await makeTable(admin, { name: table, columns: ['code', 'city'] })
  await admin.post(`${path}:import`, { rows: [{ row_id: 'A', code: 'A', city: 'North' }], context: { run_id: 'first' } })
  await load(admin, 'East', 'second')
  await admin.post(`${path}:import-revert`, { run_id: 'second' })
  const row = await admin.get<Record<string, unknown>>(`${path}/A`)
  await patchDoc(admin, `${path}/A`, { city: 'South', updated_at: row.updated_at })
  await load(admin, 'East', 'third')
  expect(await admin.get(`${path}/A`)).toMatchObject({ city: 'South' })
  expect((await conflicts(admin)).conflicts).toMatchObject([{ field: 'city', incoming: 'East' }])
})
test('a scripted import without a run_id is told the run ID that undoes it (#687)', async ({ admin }) => {
  await makeTable(admin, { name: table, columns: ['code', 'city'] })
  const inserted = await admin.post<{ run_id: string }>(`${path}:import`, { rows: [{ row_id: 'A', code: 'A', city: 'North' }] })
  const updated = await admin.post<{ run_id: string }>(`${path}:import`, { key_column: 'code', rows: [{ code: 'A', city: 'East' }] })
  expect(updated.run_id).toEqual(expect.any(String))
  expect(updated.run_id).not.toBe(inserted.run_id)
  expect(await admin.post(`${path}:import-revert`, { run_id: updated.run_id })).toMatchObject({ restored: 1 })
  expect(await admin.get(`${path}/A`)).toMatchObject({ city: 'North' })
})
test('an unnamed scripted insert can be undone by its returned run ID (#687)', async ({ admin }) => {
  await makeTable(admin, { name: table, columns: ['code'] })
  const result = await admin.post<{ run_id: string }>(`${path}:import`, { rows: [{ row_id: 'A', code: 'A' }] })
  expect(await admin.post(`${path}:import-revert`, { run_id: result.run_id })).toMatchObject({ deleted: 1 })
})
test('a script that names its run gets that run ID back', async ({ admin }) => {
  await makeTable(admin, { name: table, columns: ['code'] })
  expect(await admin.post(`${path}:import`, { rows: [{ code: 'A' }], context: { run_id: 'nightly-load' } })).toMatchObject({ run_id: 'nightly-load' })
})

// #865: renaming a column is a normal clean-up right after a first import. The
// correction, its history, the remembered source and any open conflict must
// all follow the new name, or the next import silently overwrites the person.
describe('#865: a renamed column keeps its corrections', () => {
  const renameCity = (admin: TestClient) =>
    admin.post(`/api/table_def/${encodeURIComponent(table)}/rename_column`, { from: 'city', to: 'town' })
  const loadTown = (admin: TestClient, town: string, run_id: string) =>
    admin.post(`${path}:import`, { key_column: 'code', rows: [{ code: 'A', town }], context: { run_id } })

  test('re-importing the unchanged source keeps the correction, and the preview says nothing will change', async ({ admin }) => {
    await correction(admin)
    await renameCity(admin)
    // Before #865 this preview read fields_updated: 1: the correction would be overwritten.
    const preview = await admin.post(`${path}:import`, { key_column: 'code', rows: [{ code: 'A', town: 'North' }], dry_run: true })
    // #851 counts the retained South correction separately from changes and new conflicts.
    expect(preview).toMatchObject({ changed: 0, unchanged: 1, rows_kept: 1, fields_updated: 0, fields_kept: 1, conflicts: 0 })
    await loadTown(admin, 'North', 'after-rename')
    expect((await admin.get<Record<string, unknown>>(`${path}/A`)).town).toBe('South')
    expect((await conflicts(admin)).conflicts).toEqual([])
  })

  test('a different source value raises a conflict under the new name instead of overwriting', async ({ admin }) => {
    await correction(admin)
    await renameCity(admin)
    await loadTown(admin, 'East', 'after-rename')
    expect((await admin.get<Record<string, unknown>>(`${path}/A`)).town).toBe('South')
    const raised = (await conflicts(admin)).conflicts
    expect(raised).toHaveLength(1)
    expect(raised[0]).toMatchObject({ field: 'town', incoming: 'East' })
  })

  test('the history, the remembered source and an open conflict all name the new column', async ({ admin }) => {
    await correction(admin)
    await load(admin, 'East', 'before-rename')
    await renameCity(admin)
    const activity = await admin.get<{ versions: { data: { changed?: unknown[][] } }[] }>(`/api/activity/${encodeURIComponent(table)}/A`)
    const named = activity.versions.flatMap((v) => (v.data.changed ?? []).map((c) => c[0]))
    expect(named).toContain('town')
    expect(named).not.toContain('city')
    const [source] = await sql`select values from featherbase.import_source where ref_table = ${table} and ref_name = 'A' order by created_at desc limit 1`
    expect(Object.keys(source.values as object)).toContain('town')
    expect(Object.keys(source.values as object)).not.toContain('city')
    const open = (await conflicts(admin)).conflicts
    expect(open.map((c) => c.field)).toEqual(['town'])
    // Keeping mine on the renamed conflict is recorded under the new name, and
    // the same source after it raises nothing new.
    await admin.post(`${path}:resolve-import-conflict`, { conflict_id: open[0].id, decision: 'keep' })
    await loadTown(admin, 'East', 'same-after-rename')
    expect((await conflicts(admin)).conflicts).toEqual([])
    expect((await admin.get<Record<string, unknown>>(`${path}/A`)).town).toBe('South')
  })

  test('a resolution recorded before the rename follows the new name', async ({ admin }) => {
    await correction(admin)
    await load(admin, 'East', 'second')
    const [conflict] = (await conflicts(admin)).conflicts
    await admin.post(`${path}:resolve-import-conflict`, { conflict_id: conflict.id, decision: 'source' })
    await renameCity(admin)
    const activity = await admin.get<{ versions: { data: { resolution?: { field: string } } }[] }>(`/api/activity/${encodeURIComponent(table)}/A`)
    expect(activity.versions.flatMap((v) => (v.data.resolution ? [v.data.resolution.field] : []))).toEqual(['town'])
    // The source owns the field after "use the import's value", so it still follows the source.
    await loadTown(admin, 'West', 'third')
    expect((await admin.get<Record<string, unknown>>(`${path}/A`)).town).toBe('West')
    expect((await conflicts(admin)).conflicts).toEqual([])
  })

  test('undoing an import made before the rename restores the renamed column', async ({ admin }) => {
    await makeTable(admin, { name: table, columns: ['code', 'city'] })
    await admin.post(`${path}:import`, { rows: [{ row_id: 'A', code: 'A', city: 'North' }], context: { run_id: 'first' } })
    await load(admin, 'East', 'second')
    await renameCity(admin)
    expect(await admin.post(`${path}:import-revert`, { run_id: 'second' })).toMatchObject({ restored: 1, failed: [] })
    expect((await admin.get<Record<string, unknown>>(`${path}/A`)).town).toBe('North')
  })

  test('another Table with the same column name keeps its own history', async ({ admin }) => {
    const other = 'Import Corrections Other'
    await makeTable(admin, { name: other, columns: ['code', 'city'] })
    await admin.post(`/api/table/${encodeURIComponent(other)}:import`, { rows: [{ row_id: 'B', code: 'B', city: 'North' }], context: { run_id: 'other' } })
    await correction(admin)
    await renameCity(admin)
    const [source] = await sql`select values from featherbase.import_source where ref_table = ${other} and ref_name = 'B'`
    expect(Object.keys(source.values as object)).toContain('city')
  })
})

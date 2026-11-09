// #626 / #865: a re-import keeps a person's correction. The edges of deciding
// who owns a field, who may resolve a held value, and listing what is held.
import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { createUserWithRole, expectRefused, makeTable, patchDoc } from './fixtures'
import { sql } from '../src/db'
import { getMeta } from '../src/meta'
import { mayResolve, planImport, saveImportedRow } from '../src/import-corrections'
import { registerController, unregisterController, type TableController } from '../src/controllers'

const T = 'Ic Plant'
const url = `/api/table/${encodeURIComponent(T)}`

async function plants(admin: TestClient) {
  await makeTable(admin, { name: T, id_pattern: 'PLANT-{plant_code}', track_changes: true, columns: ['plant_code', 'city', { column_name: 'note', column_type: 'Data', read_only: true }] })
  await admin.post(`${url}:import`, { key_column: 'plant_code', rows: [{ plant_code: '8151', city: 'Chenai' }], context: { run_id: 'sap-1' } })
  return admin.get<Record<string, unknown>>(`${url}/PLANT-8151`)
}

describe('listing held import values', () => {
  test('a held value on a row that no longer exists is left out', async ({ admin }) => {
    await plants(admin)
    await sql`insert into featherbase.import_conflict (row_id, ref_table, ref_name, field, kept, incoming, created_by, updated_by)
      values ('ic-gone', ${T}, 'PLANT-0000', 'city', ${sql.json('a')}, ${sql.json('b')}, 'Administrator', 'Administrator')`
    expect((await admin.get<{ conflicts: unknown[] }>(`${url}:import-conflicts`)).conflicts).toEqual([])
  })
})

describe('listing held values when the rows cannot be read', () => {
  test('is a server error, not an empty list', async ({ admin }) => {
    const row = await plants(admin)
    await sql`insert into featherbase.import_conflict (row_id, ref_table, ref_name, field, kept, incoming, created_by, updated_by)
      values ('ic-held', ${T}, ${row.row_id}, 'city', ${sql.json('a')}, ${sql.json('b')}, 'Administrator', 'Administrator')`
    await sql.unsafe('alter table featherbase.ic_plant rename to ic_plant_gone')
    await expectRefused(admin.get(`${url}:import-conflicts`), 500)
  })
})

describe('who may resolve a held value', () => {
  test('nobody resolves a column the Table does not have, or one that is read-only', async ({ admin }) => {
    const row = await plants(admin)
    const meta = await getMeta(T)
    expect(await mayResolve(meta, row, 'no_such_column', 'Administrator')).toBe(false)
    expect(await mayResolve(meta, row, 'note', 'Administrator')).toBe(false)
  })

  test('a person the row is shared with for writing may resolve it', async ({ admin, createUser }) => {
    const row = await plants(admin)
    const reader = await createUser({ email: 'ic.shared@example.com' })
    await admin.post('/api/save_row', { table: 'Share', row: { share_table: T, share_name: row.row_id, person: reader.user, read: true, write: true } })
    expect(await mayResolve(await getMeta(T), row, 'city', reader.user!)).toBe(true)
  })

  test('a person who may not write the row may not resolve it', async ({ admin, createUser }) => {
    const row = await plants(admin)
    const reader = await createUserWithRole(admin, createUser, { role: 'Ic Reader', table: T, can_read: true })
    expect(await mayResolve(await getMeta(T), row, 'city', reader.user!)).toBe(false)
  })
})

describe('deciding who owns a field', () => {
  test('a field an import changed before imports recorded their source still counts that import\'s value as the source', async ({ admin }) => {
    const row = await plants(admin)
    await patchDoc(admin, `${url}/PLANT-8151`, { city: 'Chennai', updated_at: row.updated_at })
    // The import's own version, linked from its log the way imports were
    // before they recorded what they supplied.
    await sql`delete from featherbase.import_source where ref_table = ${T}`
    const [imported] = await sql`insert into version (row_id, ref_table, ref_name, data, created_by, updated_by, created_at, updated_at)
      values ('0-ic-old-import', ${T}, 'PLANT-8151', ${sql.json({ changed: [['city', 'Chenai', 'Madras']] })}, 'Administrator', 'Administrator', now(), now())
      returning row_id`
    await sql`update import_log set touched = ${sql.json([{ row_id: 'PLANT-8151', version: imported.row_id, action: 'updated' }])} where ref_table = ${T}`
    const current = await admin.get<Record<string, unknown>>(`${url}/PLANT-8151`)
    const plan = await planImport(await getMeta(T), current, { row_id: 'PLANT-8151', city: 'Madras' }, 'Administrator')
    expect(plan).toMatchObject({ fields_kept: 1, conflicts: [] })
  })
})

describe('saving an imported row', () => {
  test('a row deleted just before it is locked is not found', async ({ admin }) => {
    const row = await plants(admin)
    const controller: TableController = { table: T, hooks: { async before_lock({ tx }) { await tx`delete from featherbase.ic_plant where row_id = 'PLANT-8151'` } } }
    registerController(controller)
    try {
      await expect(saveImportedRow(await getMeta(T), { row_id: row.row_id, city: 'Madras' }, 'Administrator', 'sap-9', true))
        .rejects.toMatchObject({ type: 'NotFoundError', message: 'The imported row no longer exists' })
    } finally {
      unregisterController(controller)
    }
  })
})

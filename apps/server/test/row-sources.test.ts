// #1273 (relational navigation C6/C7): where a link row came from. A row a feed
// wrote reads "from <its source>"; any other row was given by hand. A Table can
// also name where a feed row is corrected (its correction path).
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { createUserWithRole, expectRefused } from './fixtures'
import { sql } from '../src/db'
import { tableRelation } from '../src/table-engine'
import { sourceLabel } from '../src/actions/row-sources'

const ROLE = 'Rs Business Role'
const GIVEN = 'Rs Role Given'

async function seed(admin: TestClient) {
  await admin.post('/api/table_def', { name: ROLE, id_pattern: 'prompt', title_column: 'role_name',
    columns: [{ column_name: 'role_name', column_type: 'Data', label: 'Role name' }] })
  await admin.post('/api/table_def', { name: GIVEN, id_pattern: 'prompt',
    columns: [
      { column_name: 'person_ref', column_type: 'Data', label: 'Person' },
      { column_name: 'role', column_type: 'Reference', reference_table: ROLE, label: 'Role' },
    ] })
  await admin.post('/api/save_row', { table: ROLE, row: { row_id: 'R1', role_name: 'Floor Lead' } })
  for (const id of ['G1', 'G2', 'G3', 'G4'])
    await admin.post('/api/save_row', { table: GIVEN, row: { row_id: id, person_ref: 'Asha', role: 'R1' } })
  const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-people-feed', roles: [] })
  await admin.fetch(`/api/service_accounts/${account.row_id}`, {
    method: 'PATCH', body: JSON.stringify({ display_name: 'HR feed' }), headers: { 'content-type': 'application/json' } })
  const relation = sql(await tableRelation(GIVEN))
  await sql`update ${relation} set created_by = ${account.row_id} where row_id = 'G2'`
  await sql`update ${relation} set created_by = 'roster-link' where row_id = 'G3'`
  // G4 came in from a spreadsheet import.
  await sql`insert into featherbase.import_log (row_id, ref_table, file_name, run_id) values ('rs-log', ${GIVEN}, 'Store roles.xlsx', 'rs-run')`
  await sql`insert into featherbase.import_source (row_id, ref_table, ref_name, run_id) values ('rs-src', ${GIVEN}, 'G4', 'rs-run')`
}

const sourcesOf = (client: { get: <T>(path: string) => Promise<T> }, ids: string[]) =>
  client.get<{ sources: Record<string, string | null> }>(`/api/table/${encodeURIComponent(GIVEN)}:row_sources?ids=${encodeURIComponent(JSON.stringify(ids))}`)

describe('#1273: where a link row came from', () => {
  test('a row a person gave reads as by hand; a feed, a platform step and an import by their names', async ({ admin }) => {
    await seed(admin)
    const { sources } = await sourcesOf(admin, ['G1', 'G2', 'G3', 'G4'])
    expect(sources).toEqual({ G1: null, G2: 'HR', G3: 'Staff roster', G4: 'Store roles' })
  })

  test("a row imported into a Table that keeps no import observations reads by the run's file", async ({ admin }) => {
    await seed(admin)
    await sql`insert into featherbase.import_log (row_id, ref_table, file_name, run_id, touched)
      values ('rs-log-2', ${GIVEN}, 'Area roles.csv', 'rs-run-2', ${sql.json([{ row_id: 'G1', action: 'updated' }])})`
    expect((await sourcesOf(admin, ['G1'])).sources).toEqual({ G1: 'Area roles' })
  })

  test('an import before the row was made says nothing about it: an id can be used again', async ({ admin }) => {
    await seed(admin)
    await sql`insert into featherbase.import_log (row_id, ref_table, file_name, run_id, touched, created_at)
      values ('rs-log-old', ${GIVEN}, 'Old roles.csv', 'rs-run-old', ${sql.json([{ row_id: 'G1', action: 'inserted' }])}, now() - interval '1 day')`
    await sql`insert into featherbase.import_source (row_id, ref_table, ref_name, run_id, created_at)
      values ('rs-src-old', ${GIVEN}, 'G1', 'rs-run-old', now() - interval '1 day')`
    expect((await sourcesOf(admin, ['G1'])).sources).toEqual({ G1: null })
  })

  test('a row the caller may not read is left out, never named', async ({ admin, createUser }) => {
    await seed(admin)
    const reader = await createUserWithRole(admin, createUser, { role: 'Rs Own Rows', table: GIVEN, can_read: true, can_create: true, own_rows_only: true })
    await reader.post('/api/save_row', { table: GIVEN, row: { row_id: 'G9', person_ref: 'Asha', role: 'R1' } })
    expect((await sourcesOf(reader, ['G1', 'G2', 'G9'])).sources).toEqual({ G9: null })
  })

  test('a Table the caller may not read is refused; ids must be a list', async ({ admin, createUser }) => {
    await seed(admin)
    const stranger = await createUser({ email: 'rs.stranger@example.com' })
    await expectRefused(stranger.fetch(`/api/table/${encodeURIComponent(GIVEN)}:row_sources?ids=${encodeURIComponent('["G1"]')}`), 403)
    await expectRefused(stranger.fetch(`/api/table/${encodeURIComponent(GIVEN)}:row_sources?ids=${encodeURIComponent('[]')}`), 403)
    const bad = await admin.fetch(`/api/table/${encodeURIComponent(GIVEN)}:row_sources?ids=G1`)
    expect(bad.status).toBe(417)
  })

  test('a source reads by its own name, without the words that only say it is a feed', () => {
    expect(sourceLabel('HR feed')).toBe('HR')
    expect(sourceLabel('Automation (people feed)')).toBe('people')
    expect(sourceLabel('Staff roster sync')).toBe('Staff roster')
    expect(sourceLabel('Store roles.xlsx')).toBe('Store roles')
    expect(sourceLabel('Feed')).toBe('Feed')
  })
})

describe('#1273: a Table names where a feed row is corrected', () => {
  test('a correction path is kept, kept again by an update that leaves it out, and cleared by an empty one', async ({ admin }) => {
    await seed(admin)
    const columns = [{ column_name: 'person_ref', column_type: 'Data' }, { column_name: 'role', column_type: 'Reference', reference_table: ROLE }]
    const meta = () => admin.get<{ correction_path?: string | null }>(`/api/table/${encodeURIComponent(GIVEN)}:meta`)
    expect((await meta()).correction_path ?? null).toBeNull()
    await admin.put(`/api/table_def/${encodeURIComponent(GIVEN)}`, { correction_path: '/dash?view=explain&person={person_ref}', columns })
    expect((await meta()).correction_path).toBe('/dash?view=explain&person={person_ref}')
    await admin.put(`/api/table_def/${encodeURIComponent(GIVEN)}`, { columns })
    expect((await meta()).correction_path).toBe('/dash?view=explain&person={person_ref}')
    await admin.put(`/api/table_def/${encodeURIComponent(GIVEN)}`, { correction_path: '', columns })
    expect((await meta()).correction_path ?? null).toBeNull()
  })

  test('a correction path leads only inside the instance, and names only its own columns', async ({ admin }) => {
    await seed(admin)
    const columns = [{ column_name: 'person_ref', column_type: 'Data' }]
    for (const correction_path of ['https://elsewhere.example/fix', '//elsewhere.example/fix', '/fix\\x', 'javascript:alert(1)', '/fix?who={nobody}']) {
      const res = await admin.fetch('/api/table_def', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Rs Bad Path', correction_path, columns }) })
      expect(res.status, correction_path).toBe(417)
    }
    const made = await admin.post<{ name?: string }>('/api/table_def', { name: 'Rs Good Path', correction_path: '/fix?who={person_ref}&row={row_id}', columns })
    expect(made).toBeTruthy()
  })
})

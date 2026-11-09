import { expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { resolve } from 'node:path'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { expectRefused, grantRole } from './fixtures'
import { discoverPackages } from '../src/runtime-packages'

// #628: "What can this person see, and why". One page per person lists their
// roles, the Tables those roles reach, the Data Scope rows that limit them and
// the rows shared with them, each with its reason. It shows that access exists
// and why, never the data.

interface Explanation {
  person: string
  every_table: boolean
  roles: { role: string; app: string | null; through: string | null; given_by: string | null; given_at: string | null }[]
  read: { table: string; own_rows: boolean; roles: string[] }[]
  change: { table: string; own_rows: boolean; roles: string[] }[]
  limits: { table: string; value: string; title: string | null; set_by: string; set_at: string }[]
  shares: { table: string; row_id: string; title: string | null; write: boolean; reshare: boolean; shared_by: string; shared_at: string }[]
  scope: { app: string; title: string; problem: string | null; places: { label: string; reasons: { text: string; since: string | null; until: string | null }[] }[] } | null
}

const pageOf = (person: string) => `/api/access_explanation/${encodeURIComponent(person)}`

test('roles say who gave them, and the Tables they reach name the roles that grant them', async ({ admin, createUser }) => {
  await admin.post('/api/table_def', { name: 'Ae Plant', columns: [{ column_name: 'code', column_type: 'Data' }] })
  await grantRole(admin, { role: 'Ae Plant Reader', table: 'Ae Plant', can_read: true })
  await grantRole(admin, { role: 'Ae Plant Writer', table: 'Ae Plant', can_read: true, can_write: true, own_rows_only: true })
  const person = await createUser({ roles: ['Ae Plant Reader', 'Ae Plant Writer'] })

  const page = await admin.get<Explanation>(pageOf(person.user!))
  expect(page.person).toBe(person.user)
  expect(page.every_table).toBe(false)
  expect(page.roles.map((r) => r.role)).toEqual(expect.arrayContaining(['Ae Plant Reader', 'Ae Plant Writer']))
  const reader = page.roles.find((r) => r.role === 'Ae Plant Reader')!
  expect(reader).toMatchObject({ app: null, through: null, given_by: 'Administrator' })
  expect(Number.isNaN(Date.parse(reader.given_at!))).toBe(false)
  // The built-in All role is every account's, not this person's: it is not listed.
  expect(page.roles.map((r) => r.role)).not.toContain('All')

  expect(page.read.find((t) => t.table === 'Ae Plant')).toEqual({
    table: 'Ae Plant', own_rows: false, roles: ['Ae Plant Reader', 'Ae Plant Writer'],
  })
  // Only the own-rows grant changes it, so the change is own rows only.
  expect(page.change.find((t) => t.table === 'Ae Plant')).toEqual({ table: 'Ae Plant', own_rows: true, roles: ['Ae Plant Writer'] })
})

test('a role given later says who gave it then; the roles held before keep theirs', async ({ admin, createUser }) => {
  await grantRole(admin, { role: 'Ae Early Role', table: [] })
  await grantRole(admin, { role: 'Ae Late Role', table: [] })
  const manager = await createUser({ roles: ['System Manager'] })
  const person = await createUser({ roles: ['Ae Early Role'] })
  const doc = await admin.get<{ updated_at: string; roles: { role: string }[] }>(`/api/table/Person/${person.user}`)
  await manager.post('/api/save_row', { table: 'Person', row: {
    row_id: person.user, updated_at: doc.updated_at, roles: [...doc.roles, { role: 'Ae Late Role' }],
  } })

  const page = await admin.get<Explanation>(pageOf(person.user!))
  expect(page.roles.find((r) => r.role === 'Ae Late Role')).toMatchObject({ given_by: manager.user })
  expect(page.roles.find((r) => r.role === 'Ae Early Role')).toMatchObject({ given_by: 'Administrator' })
})

test('a service account\'s roles, and an app role held through one of them', async ({ admin }) => {
  // Fixture app setupproof binds its role "Setup Reader" to the instance's "Setup Staff" (#620).
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Setup Staff' } })
  expect(await discoverPackages([resolve('../..', 'test-apps/fixtures/setup-proof-v1')])).toEqual([])
  await admin.post('/api/install_app', { name: 'setupproof' })
  const account = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'ae-importer', roles: ['Setup Staff'] })

  const page = await admin.get<Explanation>(pageOf(account.row_id))
  expect(page.roles).toEqual([
    expect.objectContaining({ role: 'Setup Staff', app: null, through: null, given_by: 'Administrator' }),
    { role: 'Setup Reader', app: 'setupproof', through: 'Setup Staff', everyone: false, given_by: null, given_at: null },
  ])
})

test('a System Manager reaches every Table', async ({ admin, createUser }) => {
  const manager = await createUser({ roles: ['System Manager'] })
  const page = await admin.get<Explanation>(pageOf(manager.user!))
  expect(page).toMatchObject({ every_table: true, read: [], change: [] })
  expect(page.roles.map((r) => r.role)).toContain('System Manager')
})

test('Data Scope limits and shared rows say who set them, and when', async ({ admin, createUser }) => {
  await admin.post('/api/table_def', { name: 'Ae Site', title_column: 'site_name', columns: [{ column_name: 'site_name', column_type: 'Data' }] })
  const north = await admin.post<{ row_id: string }>(`/api/table/${encodeURIComponent('Ae Site')}`, { site_name: 'North' })
  const person = await createUser({ roles: [] })
  await admin.post('/api/save_row', { table: 'Data Scope', row: { person: person.user, allow_table: 'Ae Site', for_value: north.row_id } })
  await admin.post('/api/save_row', { table: 'Share', row: { share_table: 'Ae Site', share_name: north.row_id, person: person.user, read: true, write: true } })

  // A System Manager reads Ae Site, so the rows show their titles.
  const page = await admin.get<Explanation>(pageOf(person.user!))
  expect(page.limits).toEqual([expect.objectContaining({ table: 'Ae Site', value: north.row_id, title: 'North', set_by: 'Administrator' })])
  expect(page.shares).toEqual([expect.objectContaining({ table: 'Ae Site', row_id: north.row_id, title: 'North', write: true, reshare: false, shared_by: 'Administrator' })])
  expect(Number.isNaN(Date.parse(page.limits[0].set_at))).toBe(false)
  expect(Number.isNaN(Date.parse(page.shares[0].shared_at))).toBe(false)
})

test('a row the viewer cannot read shows its Table and id, never its title', async ({ admin, createUser }) => {
  await admin.post('/api/table_def', { name: 'Ae Store', title_column: 'store_name', columns: [{ column_name: 'store_name', column_type: 'Data' }] })
  const store = await admin.post<{ row_id: string }>(`/api/table/${encodeURIComponent('Ae Store')}`, { store_name: 'Lakeside' })
  const person = await createUser({ roles: [] })
  await admin.post('/api/save_row', { table: 'Data Scope', row: { person: person.user, allow_table: 'Ae Store', for_value: store.row_id } })

  const own = await person.get<Explanation>(pageOf(person.user!))
  expect(own.limits).toEqual([expect.objectContaining({ table: 'Ae Store', value: store.row_id, title: null })])
  expect(JSON.stringify(own)).not.toContain('Lakeside')
})

test('only the person and System Managers may open the page', async ({ admin, createUser }) => {
  const person = await createUser({ roles: [] })
  const colleague = await createUser({ roles: [] })
  expect((await person.get<Explanation>(pageOf(person.user!))).person).toBe(person.user)
  await expectRefused(colleague.get(pageOf(person.user!)), 403)
  expect((await admin.get<Explanation>(pageOf(person.user!))).person).toBe(person.user)
  await expectRefused(admin.get(pageOf('psn_nobody_here')), 404)
})

test('a history entry that records no changed fields is passed over', async ({ admin, createUser }) => {
  await grantRole(admin, { role: 'Ae Kept Role', table: [] })
  const person = await createUser({ roles: ['Ae Kept Role'] })
  const { sql } = await import('../src/db')
  await sql`insert into version (row_id, ref_table, ref_name, data) values ('ae-annotation', 'Person', ${person.user!}, '{"import_run":"r-1"}'::jsonb)`
  const page = await admin.get<Explanation>(pageOf(person.user!))
  expect(page.roles.find((r) => r.role === 'Ae Kept Role')).toMatchObject({ given_by: 'Administrator' })
})

test('an Access Auditor may open anyone\'s page', async ({ createUser }) => {
  const person = await createUser({ roles: [] })
  const auditor = await createUser({ roles: ['Access Auditor'] })
  expect((await auditor.get<Explanation>(pageOf(person.user!))).person).toBe(person.user)
})

// C1 (owner, 4 Nov): a viewer whose places cover every place of a person may
// open that person's page. Fixture app placeroster provides each person's
// places from its own roster Table (#559).
async function withPlaces(admin: TestClient) {
  expect(await discoverPackages([resolve('../..', 'test-apps/fixtures/place-roster')])).toEqual([])
  await admin.post('/api/install_app', { name: 'placeroster' })
  return (person: string, place: string, store: string, section: string) =>
    admin.post('/api/save_row', { table: 'placeroster.position', row: { row_id: `${person}-${place}-${section}`, person, place, store, section } })
}

test('a manager whose places cover every place of a person may open their page', async ({ admin, createUser }) => {
  const position = await withPlaces(admin)
  const manager = await createUser({ roles: [] })
  const kids = await createUser({ roles: [] })
  const both = await createUser({ roles: [] })
  await position(manager.user!, 'North', 'N1', 'kids')
  await position(manager.user!, 'North', 'N1', 'mens')
  await position(kids.user!, 'North / Kids', 'N1', 'kids')
  await position(both.user!, 'North / Kids', 'N1', 'kids')
  await position(both.user!, 'South / Kids', 'S1', 'kids')

  expect((await manager.get<Explanation>(pageOf(kids.user!))).person).toBe(kids.user)
  // One of their places is outside the manager's: refused.
  await expectRefused(manager.get(pageOf(both.user!)), 403)
  // Covering is one way: the person does not cover their manager.
  await expectRefused(kids.get(pageOf(manager.user!)), 403)
})

test('a person with no places is never covered, and a viewer with none covers no one', async ({ admin, createUser }) => {
  const position = await withPlaces(admin)
  const manager = await createUser({ roles: [] })
  const unplaced = await createUser({ roles: [] })
  const other = await createUser({ roles: [] })
  await position(manager.user!, 'North', 'N1', 'kids')
  await expectRefused(manager.get(pageOf(unplaced.user!)), 403)
  await expectRefused(other.get(pageOf(unplaced.user!)), 403)
})

// Q1 C (owner, 4 Nov): the app's scope explains itself. Each place the scope
// provider gives a person carries its own reasons, with dates where the app
// knows them. Labels and reasons only: never a filter value.
test('the places an app\'s scope gives a person, each with its reasons', async ({ admin, createUser }) => {
  const position = await withPlaces(admin)
  const person = await createUser({ roles: [] })
  await position(person.user!, 'North / Kids', 'N1', 'kids')
  await admin.post('/api/save_row', { table: 'placeroster.position', row: {
    row_id: `${person.user}-south`, person: person.user, place: 'South / Mens', store: 'S1', section: 'mens',
    reason: 'Team Leader job assignment', since: '2026-08-06', until: '2026-12-31',
  } })

  const page = await person.get<Explanation>(pageOf(person.user!))
  expect(page.scope).toEqual({
    app: 'placeroster', title: 'Place roster proof', problem: null,
    places: [
      { label: 'North / Kids', reasons: [] },
      { label: 'South / Mens', reasons: [{ text: 'Team Leader job assignment', since: '2026-08-06', until: '2026-12-31' }] },
    ],
  })
  expect(JSON.stringify(page.scope)).not.toContain('S1')
})

test('a person with no places says so, and an instance with no scope provider shows none', async ({ admin, createUser }) => {
  const person = await createUser({ roles: [] })
  expect((await admin.get<Explanation>(pageOf(person.user!))).scope).toBeNull()
  await withPlaces(admin)
  expect((await admin.get<Explanation>(pageOf(person.user!))).scope)
    .toEqual({ app: 'placeroster', title: 'Place roster proof', problem: 'scope', places: [] })
})

test('a scope provider that is not set up yet says so, and the rest of the page still shows', async ({ admin, createUser }) => {
  // The place-roster fixture, declaring an identifier system the instance lacks.
  const copy = await mkdtemp(resolve('test/.access-provider-'))
  try {
    await cp(resolve('../..', 'test-apps/fixtures/place-roster'), copy, { recursive: true })
    const manifest = JSON.parse(await readFile(resolve(copy, 'featherbase.json'), 'utf8'))
    await writeFile(resolve(copy, 'featherbase.json'), JSON.stringify({ ...manifest, scopeProvider: { ...manifest.scopeProvider, identifiers: ['ae-missing-code'] } }))
    expect(await discoverPackages([copy])).toEqual([])
    await admin.post('/api/install_app', { name: 'placeroster' })
    const person = await createUser({ roles: [] })
    const page = await admin.get<Explanation>(pageOf(person.user!))
    expect(page.scope).toEqual({ app: 'placeroster', title: 'Place roster proof', problem: 'configuration', places: [] })
    expect(page.person).toBe(person.user)
  } finally { await rm(copy, { recursive: true, force: true }) }
})

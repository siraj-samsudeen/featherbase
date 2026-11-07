// #919 (piece B of #683): store administration. A job gives reach over
// stores (the app's reach provider), a Permission row with scope_mode 'reach'
// covers only rows of those stores, and a store administrator gives narrower
// roles to their own staff. Fixture: test-apps/fixtures/store-admin.
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { availableRuntimeVersions, discoverPackages } from '../src/runtime-packages'
import { sql } from '../src/db'
import { reachGrants, reachOnlyWrite, reachWhere } from '../src/permissions'
import { expectApiError, patchDoc, tableRef } from './fixtures'

const fixture = resolve('../..', 'test-apps/fixtures/store-admin')
const SHELF = tableRef('storeadmin.shelf')
const JOB = tableRef('storeadmin.job')
const STAFF = tableRef('storeadmin.staff')
const CONTRACT = tableRef('storeadmin.contract')
const GIVEN = '/api/apps/storeadmin/given_roles'

const istDay = (offset = 0) => new Date(Date.now() + 330 * 60_000 + offset * 86_400_000).toISOString().slice(0, 10)

async function fixtureModule() {
  const digest = availableRuntimeVersions().find(p => p.name === 'storeadmin')!.digest
  return import(`${pathToFileURL(resolve(fixture, 'server.mjs')).href}?artifact=${digest}`)
}

type Row = Record<string, unknown>

async function setup(admin: TestClient, createUser: CreateUserFn, roles: { meera?: string[]; arun?: string[] } = {}) {
  expect(await discoverPackages([fixture])).toEqual([])
  await admin.post('/api/install_app', { name: 'storeadmin' })
  const module = await fixtureModule()
  for (const key of Object.keys(module.faults)) delete module.faults[key]
  module.calls.provider = 0
  const save = (table: string, row: Row) => admin.post<Row>('/api/save_row', { table, row })
  const job = (person: string, job: string, store: string, extra: Row = {}) =>
    save(JOB.name, { person, job, store, starts_on: istDay(-30), ...extra })
  const meera = await createUser({ email: 'meera@example.test', roles: roles.meera ?? [] })
  const arun = await createUser({ email: 'arun@example.test', roles: roles.arun ?? [] })
  const priya = await createUser({ email: 'priya@example.test', roles: [] })
  const managerJob = await job(meera.user!, 'Manager', 'A')
  await job(arun.user!, 'Staff', 'A')
  await job(priya.user!, 'Staff', 'B')
  const a1 = await save(SHELF.name, { store: 'A', shelf_name: 'Sarees', note: 'front' })
  const b1 = await save(SHELF.name, { store: 'B', shelf_name: 'Kids', note: 'back' })
  return { module, save, job, meera, arun, priya, managerJob, a1, b1 }
}

const list = async (client: TestClient, ref = SHELF) =>
  ((await client.get<{ data: Row[] }>(ref.listUrl({ fields: ref === SHELF ? ['row_id', 'store', 'shelf_name', 'note'] : ['row_id', 'store'] }))).data)

describe('a job gives reach over stores', () => {
  test('a manager lists, opens and counts only their store\'s rows', async ({ admin, createUser }) => {
    const { meera, a1, b1 } = await setup(admin, createUser)
    expect((await list(meera)).map(row => row.store)).toEqual(['A'])
    expect(await meera.get<Row>(SHELF.rowUrl(String(a1.row_id)))).toMatchObject({ store: 'A', note: 'front' })
    await expectApiError(meera.get(SHELF.rowUrl(String(b1.row_id))), { status: 403 })
    expect(await meera.get(`${SHELF.url}:count`)).toEqual({ count: 1 })
    expect((await meera.get<{ readable_columns: string[] }>(SHELF.metaUrl)).readable_columns).toContain('note')
  })

  test('the role held any other way reaches nothing', async ({ admin, createUser }) => {
    const { arun } = await setup(admin, createUser, { arun: ['Shelf Manager'] })
    await expectApiError(arun.get(SHELF.url), { status: 403 })
  })

  test('a transfer moves the reach on the next request', async ({ admin, createUser }) => {
    const { meera, managerJob, job } = await setup(admin, createUser)
    expect((await list(meera)).map(row => row.store)).toEqual(['A'])
    await sql`update storeadmin.job set ends_on = ${istDay()} where row_id = ${String(managerJob.row_id)}`
    await job(meera.user!, 'Manager', 'B')
    expect((await list(meera)).map(row => row.store)).toEqual(['B'])
  })

  test('an every-store job reaches every store', async ({ admin, createUser }) => {
    const { priya, job } = await setup(admin, createUser)
    await job(priya.user!, 'Head', 'HQ')
    expect((await list(priya)).map(row => row.store).sort()).toEqual(['A', 'B'])
  })

  test('a provider that fails, or answers a role it may not, reaches nothing', async ({ admin, createUser }) => {
    const { module, meera } = await setup(admin, createUser)
    module.faults.provider = new Error('roster unavailable')
    await expectApiError(meera.get(SHELF.url), { status: 403 })
    delete module.faults.provider
    module.faults.result = [{ role: 'Shelf Helper', stores: ['A'] }]
    await expectApiError(meera.get(SHELF.url), { status: 403 })
  })
})

describe('a grant limited to reach', () => {
  test('creates, changes and deletes only in reach, and never moves a row out', async ({ admin, createUser }) => {
    const { meera, a1, b1 } = await setup(admin, createUser)
    const made = await meera.post<Row>(SHELF.url, { store: 'A', shelf_name: 'Silks' })
    expect(made).toMatchObject({ store: 'A', shelf_name: 'Silks' })
    await expectApiError(meera.post(SHELF.url, { store: 'B', shelf_name: 'Silks' }), { status: 403 })
    const current = await meera.get<Row>(SHELF.rowUrl(String(a1.row_id)))
    await patchDoc(meera, SHELF.rowUrl(String(a1.row_id)), { note: 'window', updated_at: current.updated_at })
    await expectApiError(patchDoc(meera, SHELF.rowUrl(String(a1.row_id)), { store: 'B', updated_at: (await meera.get<Row>(SHELF.rowUrl(String(a1.row_id)))).updated_at }), { status: 403 })
    const [stored] = await sql`select store, note from storeadmin.shelf where row_id = ${String(a1.row_id)}`
    expect(stored).toEqual({ store: 'A', note: 'window' })
    const b = await admin.get<Row>(SHELF.rowUrl(String(b1.row_id)))
    await expectApiError(meera.delete(`${SHELF.rowUrl(String(b1.row_id))}?updated_at=${encodeURIComponent(String(b.updated_at))}`), { status: 403 })
    const mine = await meera.get<Row>(SHELF.rowUrl(String(made.row_id)))
    await meera.delete(`${SHELF.rowUrl(String(made.row_id))}?updated_at=${encodeURIComponent(String(mine.updated_at))}`)
    expect(await sql`select 1 from storeadmin.shelf where row_id = ${String(made.row_id)}`).toHaveLength(0)
  })

  test('protected rows are never written through reach, though they are read', async ({ admin, createUser }) => {
    const { meera, arun } = await setup(admin, createUser)
    await expectApiError(meera.post(JOB.url, { person: arun.user!, job: 'Manager', store: 'A', starts_on: istDay() }), { status: 403 })
    const staff = await meera.post<Row>(JOB.url, { person: arun.user!, job: 'Cashier', store: 'A', starts_on: istDay() })
    await expectApiError(patchDoc(meera, JOB.rowUrl(String(staff.row_id)), { job: 'Head', updated_at: staff.updated_at }), { status: 403 })
    expect((await list(meera, JOB)).map(row => row.store)).toEqual(['A', 'A', 'A'])
  })

  test('another grant\'s Columns read only where that grant reaches', async ({ admin, createUser }) => {
    const { meera } = await setup(admin, createUser, { meera: ['Shelf Viewer'] })
    const rows = await list(meera)
    // Store B is out of reach, so its store reads as empty too: the Viewer grant reads shelf_name only.
    expect(rows.map(row => [row.store ?? null, row.shelf_name, row.note ?? null]).sort((a, b) => String(a[1]).localeCompare(String(b[1]))))
      .toEqual([[null, 'Kids', null], ['A', 'Sarees', 'front']])
    expect(await meera.get(SHELF.listUrl({ filters: [['note', '=', 'back']] }))).toMatchObject({ data: [] })
  })

  test('a person target reads the staff who work in reach, directly or through a link', async ({ admin, createUser, }) => {
    const { save, meera, arun, priya } = await setup(admin, createUser)
    const arunStaff = await save(STAFF.name, { person: arun.user!, phone: '1' })
    const priyaStaff = await save(STAFF.name, { person: priya.user!, phone: '2' })
    await save(CONTRACT.name, { staff: arunStaff.row_id, terms: 'full time' })
    await save(CONTRACT.name, { staff: priyaStaff.row_id, terms: 'part time' })
    expect((await meera.get<{ data: Row[] }>(STAFF.listUrl({ fields: ['person'] }))).data.map(row => row.person))
      .toEqual(expect.arrayContaining([arun.user!]))
    expect((await meera.get<{ data: Row[] }>(STAFF.listUrl({ fields: ['person'] }))).data.map(row => row.person)).not.toContain(priya.user!)
    expect((await meera.get<{ data: Row[] }>(CONTRACT.listUrl({ fields: ['terms'] }))).data.map(row => row.terms)).toEqual(['full time'])
    await expectApiError(meera.get(STAFF.rowUrl(String(priyaStaff.row_id))), { status: 403 })
  })

  test('advises and retires within reach only', async ({ admin, createUser }) => {
    const { meera, arun, a1 } = await setup(admin, createUser)
    expect(await meera.get(`${SHELF.rowUrl(String(a1.row_id))}:capabilities`)).toMatchObject({ write: true, delete: true, retire: true, rename: false })
    expect(await meera.post(`${SHELF.rowUrl(String(a1.row_id))}:retire`, { reason: 'Moved' })).toMatchObject({ retired_reason: 'Moved' })
    expect(await meera.get(`${SHELF.rowUrl(String(a1.row_id))}:capabilities`)).toMatchObject({ retire: false, reactivate: true })
    await meera.post(`${SHELF.rowUrl(String(a1.row_id))}:reactivate`, {})
    // Someone with no reach is refused the same way.
    await expectApiError(arun.post(`${SHELF.rowUrl(String(a1.row_id))}:retire`, { reason: 'x' }), { status: 403 })
  })

  test('a provider answer naming a role that is not a job role reaches nothing', async ({ admin, createUser }) => {
    const { meera, module } = await setup(admin, createUser)
    module.faults.result = [{ role: 'Shelf Helper', stores: ['A'] }]
    await expectApiError(meera.get(SHELF.url), { status: 403 })
    // A job role over no stores sees no rows.
    module.faults.result = [{ role: 'Shelf Manager', stores: [] }]
    expect(await list(meera)).toEqual([])
  })

  test('gives nothing for an action, a Table or a person it does not cover', async ({ admin, createUser }) => {
    const { meera } = await setup(admin, createUser)
    expect(await reachGrants(meera.user!, SHELF.name, 'read')).toHaveLength(1)
    expect(await reachGrants(meera.user!, SHELF.name, 'read_identifiers')).toEqual([])
    expect(await reachGrants(meera.user!, SHELF.name, 'submit')).toEqual([])
    expect(await reachGrants(meera.user!, 'No Such Table', 'read')).toEqual([])
    expect(await reachOnlyWrite(meera.user!, 'No Such Table')).toBe(false)
    expect(await sql`select count(*)::int as n from storeadmin.shelf where ${(await reachWhere(SHELF.name, [], 'shelf')).frag}`).toEqual([{ n: 0 }])
    // A person who can no longer sign in reaches nothing.
    await sql`update person set enabled = false where row_id = ${meera.user!}`
    expect(await reachGrants(meera.user!, SHELF.name, 'read')).toEqual([])
  })

  test('a path not taught about reach refuses', async ({ admin, createUser }) => {
    const { meera, a1 } = await setup(admin, createUser)
    await expectApiError(meera.post(`${SHELF.rowUrl(String(a1.row_id))}:rename`, { new_name: 'renamed' }), { status: 403 })
  })
})

describe('a store administrator gives a narrower role', () => {
  test('to their staff, over their stores; it reaches only those', async ({ admin, createUser }) => {
    const { meera, arun, a1, b1 } = await setup(admin, createUser)
    const given = await meera.post<Row>(GIVEN, { person: arun.user!, role: 'Shelf Helper', stores: ['A'] })
    expect(given).toMatchObject({ person: arun.user!, role: 'Shelf Helper', stores: ['A'], given_by: meera.user!, given_through: 'Shelf Manager' })
    expect((await list(arun)).map(row => row.store)).toEqual(['A'])
    const current = await arun.get<Row>(SHELF.rowUrl(String(a1.row_id)))
    await patchDoc(arun, SHELF.rowUrl(String(a1.row_id)), { note: 'helper', updated_at: current.updated_at })
    await expectApiError(arun.get(SHELF.rowUrl(String(b1.row_id))), { status: 403 })
    await expectApiError(arun.post(SHELF.url, { store: 'A', shelf_name: 'New' }), { status: 403 })
    expect((await arun.get<{ data: Row[] }>(GIVEN)).data).toHaveLength(1)
  })

  test('refuses past the boundary', async ({ admin, createUser }) => {
    const { meera, arun, priya } = await setup(admin, createUser)
    await expectApiError(meera.post(GIVEN, { person: arun.user!, role: 'Shelf Helper', stores: ['B'] }), { status: 403 })
    await expectApiError(meera.post(GIVEN, { person: meera.user!, role: 'Shelf Helper', stores: ['A'] }), { status: 403 })
    await expectApiError(meera.post(GIVEN, { person: priya.user!, role: 'Shelf Helper', stores: ['A'] }), { status: 403 })
    await expectApiError(meera.post(GIVEN, { person: arun.user!, role: 'Shelf Manager', stores: ['A'] }), { status: 403 })
    await expectApiError(meera.post(GIVEN, { person: arun.user!, role: 'Shelf Viewer', stores: ['A'] }), { status: 403 })
    await expectApiError(arun.post(GIVEN, { person: meera.user!, role: 'Shelf Helper', stores: ['A'] }), { status: 403 })
    expect(await sql`select 1 from role_assignment`).toHaveLength(0)
  })

  test('a given role gives no roles itself, and is not written through generic saves', async ({ admin, createUser }) => {
    const { meera, arun, priya, job } = await setup(admin, createUser)
    await job(priya.user!, 'Staff', 'A')
    await meera.post(GIVEN, { person: arun.user!, role: 'Shelf Helper', stores: ['A'] })
    await expectApiError(arun.post(GIVEN, { person: priya.user!, role: 'Shelf Helper', stores: ['A'] }), { status: 403 })
    await expectApiError(admin.post('/api/save_row', { table: 'Role Assignment', row: { app: 'storeadmin', person: priya.user!, role: 'Shelf Helper',
      stores: ['A'], given_by: meera.user!, given_through: 'Shelf Manager' } }), { status: 403 })
  })

  test('stops where its holder no longer works, and the next manager takes it back', async ({ admin, createUser }) => {
    const { meera, arun, priya, managerJob, job } = await setup(admin, createUser)
    const given = await meera.post<Row>(GIVEN, { person: arun.user!, role: 'Shelf Helper', stores: ['A'] })
    await expectApiError(priya.post(`${GIVEN}/${String(given.row_id)}/take_back`), { status: 403 })
    // The giver moves on; the role still reaches A.
    await sql`update storeadmin.job set ends_on = ${istDay()} where row_id = ${String(managerJob.row_id)}`
    expect((await list(arun)).map(row => row.store)).toEqual(['A'])
    await job(priya.user!, 'Manager', 'A')
    const back = await priya.post<Row>(`${GIVEN}/${String(given.row_id)}/take_back`)
    expect(back).toMatchObject({ revoked_by: priya.user! })
    expect(back.revoked_at).toBeTruthy()
    await expectApiError(arun.get(SHELF.url), { status: 403 })
    // Kept on record.
    expect(await sql`select given_by, revoked_by from role_assignment`).toEqual([{ given_by: meera.user!, revoked_by: priya.user! }])
  })

  test('refuses a malformed or unknown request, and takes back once', async ({ admin, createUser }) => {
    const { meera, arun } = await setup(admin, createUser)
    await expectApiError(meera.post(GIVEN, { person: arun.user!, role: 'Shelf Helper' }), { status: 417 })
    expect((await meera.fetch(GIVEN, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json' })).status).toBe(417)
    await expectApiError(meera.post(GIVEN, { person: arun.user!, role: 'Shelf Helper', stores: ['A'], starts_on: '2026-12-01', ends_on: '2026-11-01' }), { status: 417 })
    await expectApiError(meera.post('/api/apps/nosuchapp/given_roles', { person: arun.user!, role: 'Shelf Helper', stores: ['A'] }), { status: 404 })
    await expectApiError(meera.post(`${GIVEN}/ra_missing/take_back`), { status: 404 })
    await expectApiError(meera.post('/api/apps/nosuchapp/given_roles/ra_missing/take_back'), { status: 404 })
    expect((await meera.get<{ data: Row[] }>('/api/apps/nosuchapp/given_roles')).data).toEqual([])
    const given = await meera.post<Row>(GIVEN, { person: arun.user!, role: 'Shelf Helper', stores: ['A'] })
    const first = await meera.post<Row>(`${GIVEN}/${String(given.row_id)}/take_back`)
    expect(await meera.post<Row>(`${GIVEN}/${String(given.row_id)}/take_back`)).toMatchObject({ revoked_at: first.revoked_at })
    // A System Manager sees every given role; the giver sees theirs.
    expect((await admin.get<{ data: Row[] }>(GIVEN)).data).toHaveLength(1)
    expect((await meera.get<{ data: Row[] }>(GIVEN)).data).toHaveLength(1)
  })

  test('a Head, reaching every store, gives in any store its staff work in, and sees what others gave', async ({ admin, createUser }) => {
    const { meera, arun, priya, job } = await setup(admin, createUser)
    await meera.post(GIVEN, { person: arun.user!, role: 'Shelf Helper', stores: ['A'] })
    const head = await createUser({ email: 'head@example.test', roles: [] })
    await job(head.user!, 'Head', 'HQ')
    expect((await head.get<{ data: Row[] }>(GIVEN)).data).toHaveLength(1)
    expect(await head.post<Row>(GIVEN, { person: priya.user!, role: 'Shelf Helper', stores: ['B'] })).toMatchObject({ stores: ['B'] })
    expect((await list(priya)).map(row => row.store)).toEqual(['B'])
  })

  test('a holder who leaves the store loses its reach there', async ({ admin, createUser }) => {
    const { meera, arun } = await setup(admin, createUser)
    await meera.post(GIVEN, { person: arun.user!, role: 'Shelf Helper', stores: ['A'] })
    await sql`update storeadmin.job set ends_on = ${istDay()} where person = ${arun.user!}`
    await expectApiError(arun.get(SHELF.url), { status: 403 })
  })
})

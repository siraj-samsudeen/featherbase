// View as (#1222) by real reads and writes on the platform: a View As Tester sees Dash as another
// person does; anything they change is their own, never the person's. Made-up people and stores.
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { makeClient } from 'feather-testing-postgres'
import { describe, expect } from 'vitest'
import { test as pgTest } from '../pg-test'
import { sandboxRequest } from '../pg-test-shared'
import { tableRelation } from '../../src/table-engine'
import { sql } from '../../src/db'
import { issueSession } from '../../src/auth'
import { APP_DIR, REPORT_ROWS, createCoreTables, installApp, pinned, saveRow } from './helpers'

const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})
process.env.MOTHERDUCK_TOKEN = 'made-up-token'
void APP_DIR

const TESTER = 'View As Tester'
const json = { 'content-type': 'application/json' }
const call = (client: TestClient, kind: 'app_actions' | 'app_reads', name: string, payload: Record<string, unknown>) =>
  client.fetch(`/api/${kind}/dash/${name}`, { method: 'POST', headers: json, body: JSON.stringify(kind === 'app_actions' ? { idempotencyKey: crypto.randomUUID(), payload } : { payload }) })
async function ok<T>(sent: Response | Promise<Response>): Promise<T> {
  const response = await sent
  const body = await response.text()
  expect([response.status, response.status === 200 ? null : body]).toEqual([200, null])
  return JSON.parse(body) as T
}
async function refused(sent: Response | Promise<Response>, says: string) {
  const response = await sent
  const body = await response.text()
  expect([response.status >= 400, body]).toEqual([true, expect.stringContaining(says)])
}
const reports = (client: TestClient) => ok<{ result: { key: string }[] }>(call(client, 'app_reads', 'reports', {})).then(r => r.result.map(x => x.key))
type Person = { person: string; name: string; code: string | null; jobs: string[] }
type State = { may: boolean; viewing?: Person | null; recent?: Person[]; frequent?: Person[] }
const state = (client: TestClient) => ok<State>(client.fetch('/api/view_as'))
const start = (client: TestClient, person: string) => client.fetch('/api/view_as/start', { method: 'POST', headers: json, body: JSON.stringify({ person }) })
const exit = (client: TestClient) => ok<State>(client.fetch('/api/view_as/exit', { method: 'POST', headers: json, body: '{}' }))
const search = (client: TestClient, q: string) => ok<Person[]>(client.fetch(`/api/view_as/people?q=${encodeURIComponent(q)}`))

async function setup(admin: TestClient, createUser: CreateUserFn) {
  await installApp(admin)
  await createCoreTables(admin)
  const save = (table: string, row: Record<string, unknown>) => saveRow(admin, table, row)
  await save('Site', { code: 'LKS', name: 'Lakeside', is_store: true })
  await save('Site', { code: 'HLV', name: 'Hillview', is_store: true })
  await save('Plant', { plant_code: '9901', plant_type: 'Store', site: 'LKS' })
  await save('Plant', { plant_code: '9902', plant_type: 'Store', site: 'HLV' })
  await save('Section', { row_id: 'LKS-S1', name: 'Sarees', site: 'LKS', status: 'Active' })
  await save('Section', { row_id: 'HLV-S1', name: 'Sarees', site: 'HLV', status: 'Active' })
  await save('Subcategory', { row_id: '010101001', subcategory: 'Silk', subcategory_type: 'Merchandise' })
  await save('Section Subcategory', { section_subcategory_id: 'P1', store: 'LKS', subcategory: '010101001', section: 'LKS-S1', starts_on: '2026-01-01' })
  await save('Section Subcategory', { section_subcategory_id: 'P2', store: 'HLV', subcategory: '010101001', section: 'HLV-S1', starts_on: '2026-01-01' })
  for (const row of REPORT_ROWS) await save('dash.report', row)
  await save('dash.report', { report_key: 'open', report_name: 'Company notices', dive_id: 'made-up-open-dive', filter_shape: 'No filter' })
  const person = (name: string, roles = ['Dash Reader']) => createUser({ email: `${name}@example.test`, roles })
  const people = {
    // The tester also manages report access, so a change they make while viewing would show.
    tester: await person('va-tester', [TESTER, 'Report Access Manager']),
    buyer: await person('va-buyer'), other: await person('va-other'), plain: await person('va-plain'),
    boss: await person('va-boss', ['Dash Reader', 'System Manager']),
  }
  await save('Employee', { employee_code: 'B1', name: 'Meena Example', person: people.buyer.user, status: 'Current' })
  await save('Employee', { employee_code: 'O1', name: 'Kavya Example', person: people.other.user, status: 'Current' })
  await save('Employee', { employee_code: 'S1', name: 'Boss Example', person: people.boss.user, status: 'Current' })
  await save('Job Assignment', { assignment_id: 'JA-B1', employee: 'B1', job: 'Team Leader', site: 'LKS', section: 'LKS-S1', starts_on: '2026-01-01' })
  await save('Job Assignment', { assignment_id: 'JA-O1', employee: 'O1', job: 'Team Leader', site: 'HLV', section: 'HLV-S1', starts_on: '2026-01-01' })
  await save('Job Assignment', { assignment_id: 'JA-S1', employee: 'S1', job: 'Store Manager', site: 'LKS', starts_on: '2026-01-01' })
  const give = (report: string, to: TestClient) => ok(call(people.tester, 'app_actions', 'give_report', { report, person: to.user }))
  // The tester's own Dash: Company notices. Meena's: Sales versus target, for her section at Lakeside.
  await give('open', people.tester)
  await give('sales', people.buyer)
  await give('sales', people.other)
  return people
}

describe('View as: a tester sees what a person sees', () => {
  test('someone without View As Tester is offered nothing and refused', async ({ admin, createUser }) => {
    const { plain, buyer, boss } = await setup(admin, createUser)
    expect(await state(plain)).toEqual({ may: false })
    await refused(start(plain, buyer.user), 'Only a View As Tester')
    // System Manager is not a View As Tester by default.
    expect(await state(boss)).toEqual({ may: false })
    await refused(start(boss, buyer.user), 'Only a View As Tester')
  })

  test('finds people by name, by code, and by job and site, each with who they are', async ({ admin, createUser }) => {
    const { tester, buyer, other } = await setup(admin, createUser)
    const meena = { person: buyer.user, name: 'Meena Example', code: 'B1', jobs: ['Team Leader · Lakeside'] }
    expect(await search(tester, 'Team Leader Lakeside')).toEqual([meena])
    expect(await search(tester, 'meena')).toEqual([meena])
    expect((await search(tester, 'O1')).map(p => p.person)).toEqual([other.user])
    // Both team leaders, and never the System Manager.
    expect((await search(tester, 'example')).map(p => p.name)).toEqual(['Kavya Example', 'Meena Example'])
  })

  test('reads as the person viewed, and Exit returns the tester to their own view', async ({ admin, createUser }) => {
    const { tester, buyer } = await setup(admin, createUser)
    expect(await reports(tester)).toEqual(['open'])
    await ok(start(tester, buyer.user))
    expect(await reports(tester)).toEqual(['sales'])
    expect((await state(tester)).viewing).toMatchObject({ person: buyer.user, name: 'Meena Example', code: 'B1', jobs: ['Team Leader · Lakeside'] })
    expect((await exit(tester)).viewing).toBeNull()
    expect(await reports(tester)).toEqual(['open'])
  })

  test('a change made while viewing is the tester\'s own, never the person\'s', async ({ admin, createUser }) => {
    const { tester, buyer, other } = await setup(admin, createUser)
    await ok(start(tester, buyer.user))
    // The tester also manages report access: the give goes through as the tester, not as Meena.
    await ok(call(tester, 'app_actions', 'give_report', { report: 'vendor_sales', person: other.user }))
    const access = sql(await tableRelation('dash.report_access'))
    expect(await sql`select created_by from ${access} where report = 'vendor_sales' and person = ${other.user}`).toEqual([{ created_by: tester.user }])
    expect((await state(tester)).viewing?.person).toBe(buyer.user)
  })

  test('cannot view yourself, a System Manager, or someone turned off', async ({ admin, createUser }) => {
    const { tester, boss, other } = await setup(admin, createUser)
    await refused(start(tester, tester.user!), 'You are already yourself')
    await refused(start(tester, boss.user!), 'A System Manager or Administrator cannot be viewed')
    await refused(start(tester, 'Administrator'), 'A built-in account cannot be viewed')
    await sql`update person set enabled = false where row_id = ${other.user}`
    await refused(start(tester, other.user!), 'turned off')
  })

  test('ends by itself when its time is up, and when the tester loses the role', async ({ admin, createUser }) => {
    const { tester, buyer } = await setup(admin, createUser)
    await ok(start(tester, buyer.user))
    await sql`update view_as_session set expires_at = now() - interval '1 second'`
    expect(await reports(tester)).toEqual(['open'])
    // Its end is on the record, under the tester.
    expect(await sql`select "user", reference_name, method from access_log where operation = 'view_as_end'`)
      .toEqual([{ user: tester.user, reference_name: buyer.user, method: 'expired' }])
    await ok(start(tester, buyer.user))
    expect(await reports(tester)).toEqual(['sales'])
    await sql`delete from has_role where parent = ${tester.user} and role = ${TESTER}`
    expect(await reports(tester)).toEqual(['open'])
    expect(await sql`select count(*)::int as n from view_as_session`).toEqual([{ n: 0 }])
    expect(await sql`select method from access_log where operation = 'view_as_end' order by created_at`).toEqual([{ method: 'expired' }, { method: 'no_longer_allowed' }])
  })

  test('signing out ends it, on the record', async ({ admin, createUser }) => {
    const { tester, buyer } = await setup(admin, createUser)
    await ok(start(tester, buyer.user))
    expect((await tester.fetch('/api/logout', { method: 'POST', headers: json, body: '{}' })).status).toBeLessThan(300)
    expect(await sql`select count(*)::int as n from view_as_session`).toEqual([{ n: 0 }])
    expect(await sql`select "user", reference_name, method from access_log where operation = 'view_as_end'`)
      .toEqual([{ user: tester.user, reference_name: buyer.user, method: 'sign_out' }])
  })

  test('belongs to one session: the same tester signed in elsewhere sees their own view', async ({ admin, createUser }) => {
    const { tester, buyer } = await setup(admin, createUser)
    await ok(start(tester, buyer.user))
    const elsewhere = pinned(makeClient({ request: sandboxRequest }, (await issueSession(tester.user!)).token, tester.user))
    expect(await reports(elsewhere)).toEqual(['open'])
    expect(await reports(tester)).toEqual(['sales'])
  })

  test('each start, switch and end is logged under the tester; Recent and Frequently used come from that log', async ({ admin, createUser }) => {
    const { tester, buyer, other } = await setup(admin, createUser)
    await ok(start(tester, buyer.user))
    await ok(start(tester, other.user))
    await ok(start(tester, buyer.user))
    const viewed = await exit(tester)
    expect(await sql`select "user", operation, ref_table, reference_name from access_log where operation like 'view_as%' order by created_at, operation`)
      .toEqual([
        { user: tester.user, operation: 'view_as_start', ref_table: 'Person', reference_name: buyer.user },
        { user: tester.user, operation: 'view_as_switch', ref_table: 'Person', reference_name: other.user },
        { user: tester.user, operation: 'view_as_switch', ref_table: 'Person', reference_name: buyer.user },
        { user: tester.user, operation: 'view_as_end', ref_table: 'Person', reference_name: buyer.user },
      ])
    expect(viewed.recent?.map(p => p.person)).toEqual([buyer.user, other.user])
    expect(viewed.frequent?.map(p => p.person)).toEqual([buyer.user])
    expect(viewed.recent?.[0]).toMatchObject({ code: 'B1', jobs: ['Team Leader · Lakeside'] })
  })
})

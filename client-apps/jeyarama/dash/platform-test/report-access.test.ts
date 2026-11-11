// Report access (#1046) by real reads on the platform: who sees which report is read fresh on
// every request, so removing a row, a role, a job or a bundle's report takes effect on the
// next one. Made-up people, stores and reports.
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { afterEach, describe, expect, vi } from 'vitest'
import { test as pgTest } from '../pg-test'
import { sql } from '../../src/db'
import { _setAlertSender } from '../../src/waiting-for-access'
import { APP_DIR, REPORT_ROWS, createCoreTables, installApp, pinned, saveRow } from './helpers'

const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})
process.env.MOTHERDUCK_TOKEN = 'made-up-token'
process.env.MOTHERDUCK_EMBED_TOKEN = 'made-up-embed-token'
void APP_DIR

afterEach(() => { vi.unstubAllGlobals(); _setAlertSender(null) })

async function setup(admin: TestClient, createUser: CreateUserFn) {
  await installApp(admin)
  await createCoreTables(admin)
  const save = (table: string, row: Record<string, unknown>) => saveRow(admin, table, row)
  await save('Site', { code: 'LKS', name: 'Lakeside', is_store: true })
  await save('Site', { code: 'HOF', name: 'Head Office', is_store: false })
  await save('Plant', { plant_code: '9901', plant_type: 'Store', site: 'LKS' })
  await save('Section', { row_id: 'LKS-S1', name: 'Sarees', site: 'LKS', status: 'Active' })
  await save('Subcategory', { row_id: '010101001', subcategory: 'Silk', subcategory_type: 'Merchandise' })
  await save('Section Subcategory', { section_subcategory_id: 'P1', store: 'LKS', subcategory: '010101001', section: 'LKS-S1', starts_on: '2026-01-01' })
  for (const row of REPORT_ROWS) await save('dash.report', row)
  await save('dash.report', { report_key: 'open', report_name: 'Company notices', dive_id: 'made-up-open-dive', filter_shape: 'No filter' })
  const person = async (name: string, roles = ['Dash Reader']) => createUser({ email: `${name}@example.test`, roles })
  const people = {
    leader: await person('ra-leader'), manager: await person('ra-manager'), office: await person('ra-office'),
    giver: await person('ra-giver', ['Dash Reader', 'Report Access Manager']), sysman: await person('ra-sysman', ['Dash Reader', 'System Manager']),
  }
  await save('Employee', { employee_code: '1', name: 'Made-up Leader', person: people.leader.user, status: 'Current' })
  await save('Employee', { employee_code: '2', name: 'Made-up Manager', person: people.manager.user, status: 'Current' })
  await save('Employee', { employee_code: '3', name: 'Made-up Office', person: people.office.user, status: 'Current' })
  await save('Job Assignment', { assignment_id: 'JA-1', employee: '1', job: 'Team Leader', site: 'LKS', section: 'LKS-S1', starts_on: '2026-01-01' })
  await save('Job Assignment', { assignment_id: 'JA-2', employee: '2', job: 'Store Manager', site: 'LKS', starts_on: '2026-01-01' })
  await save('Job Assignment', { assignment_id: 'JA-3', employee: '3', job: 'Head office staff', site: 'HOF', starts_on: '2026-01-01' })
  return { ...people, save }
}

const reports = (client: TestClient) => client.post<{ result: { key: string }[] }>('/api/app_reads/dash/reports', { payload: {} }).then(a => a.result.map(r => r.key))
const gate = (client: TestClient) => client.post<{ result: unknown }>('/api/app_reads/dash/can_open', { payload: {} }).then(a => a.result)
const catalog = (client: TestClient) => client.get<{ name: string }[]>('/api/app_catalog').then(list => list.map(app => app.name))
const give = (client: TestClient, payload: Record<string, unknown>) =>
  client.post<{ result: { id: string } }>('/api/app_actions/dash/give_report', { idempotencyKey: crypto.randomUUID(), payload }).then(a => a.result)
const remove = async (admin: TestClient, table: string, id: string) => {
  const row = await admin.get<{ updated_at: string }>(`/api/table/${encodeURIComponent(table)}/${encodeURIComponent(id)}`)
  const response = await admin.fetch(`/api/table/${encodeURIComponent(table)}/${encodeURIComponent(id)}?updated_at=${encodeURIComponent(row.updated_at)}`, { method: 'DELETE' })
  expect([response.status, response.status === 200 ? null : await response.text()]).toEqual([200, null])
}

describe('who sees which report, read fresh', () => {
  // #1172 (owner, 10-Nov-2026, "Open for any Dash role"): Dash opens for its readers; reports still need giving.
  test('nobody sees a report until one is given, a System Manager included, though Dash opens for its readers', async ({ admin, createUser }) => {
    const { leader, sysman } = await setup(admin, createUser)
    expect([await reports(leader), await gate(leader), (await catalog(leader)).includes('dash')]).toEqual([[], true, true])
    expect([await reports(sysman), await gate(sysman)]).toEqual([[], true])
  })

  test('a report given directly opens, and is gone on the next request once the row is removed', async ({ admin, createUser }) => {
    const { leader, giver } = await setup(admin, createUser)
    await give(giver, { report: 'sales', person: leader.user })
    expect([await reports(leader), await gate(leader), (await catalog(leader)).includes('dash')]).toEqual([['sales'], true, true])
    // Removed as the Report access page removes it: the row as the page lists it.
    const page = await giver.post<{ result: { rows: { id: string; updated_at: string }[] } }>('/api/app_reads/dash/access_page', { payload: {} })
    const [row] = page.result.rows
    await giver.post('/api/app_actions/dash/remove_report_access', { idempotencyKey: crypto.randomUUID(), payload: { id: row.id, updated_at: row.updated_at } })
    expect([await reports(leader), await gate(leader)]).toEqual([[], true])
  })

  test('a report given to a role is gone once the person loses the role', async ({ admin, createUser }) => {
    const { leader, giver } = await setup(admin, createUser)
    await sql`insert into role (row_id, created_by, updated_by) values ('Store Reviewers', 'Administrator', 'Administrator') on conflict do nothing`
    await sql`insert into has_role (row_id, parent, parenttype, parentfield, role, created_by, updated_by) values ('hr-ra-1', ${leader.user!}, 'Person', 'roles', 'Store Reviewers', 'Administrator', 'Administrator')`
    await give(giver, { report: 'vendor_sales', role: 'Store Reviewers' })
    expect(await reports(leader)).toEqual(['vendor_sales'])
    await sql`delete from has_role where row_id = 'hr-ra-1'`
    expect(await reports(leader)).toEqual([])
  })

  test('a report given to a job is gone once the job ends', async ({ admin, createUser }) => {
    const { leader, giver } = await setup(admin, createUser)
    await give(giver, { report: 'sales', job: 'Team Leader' })
    expect(await reports(leader)).toEqual(['sales'])
    const job = await admin.get<{ updated_at: string }>('/api/table/Job%20Assignment/JA-1')
    await saveRow(admin, 'Job Assignment', { row_id: 'JA-1', updated_at: job.updated_at, ends_on: '2026-02-01' })
    expect(await reports(leader)).toEqual([])
  })

  test("a bundle's reports reach everyone given it, and a report taken out of it is gone", async ({ admin, createUser }) => {
    const { leader, manager, giver, save } = await setup(admin, createUser)
    const bundle = await save('dash.report_bundle', { bundle_name: 'Store pack' })
    await save('dash.report_bundle_member', { report_bundle: bundle.row_id, report: 'sales' })
    const vendors = await save('dash.report_bundle_member', { report_bundle: bundle.row_id, report: 'vendor_sales' })
    await give(giver, { report_bundle: bundle.row_id, role: 'Dash Reader' })
    expect([await reports(leader), await reports(manager)]).toEqual([['sales', 'vendor_sales'], ['sales', 'vendor_sales']])
    await remove(admin, 'dash.report_bundle_member', String(vendors.row_id))
    expect([await reports(leader), await reports(manager)]).toEqual([['sales'], ['sales']])
  })

  test('a store-filtered report given to someone whose job reaches no store stays shut; one taking no filter opens', async ({ admin, createUser }) => {
    const { office, giver } = await setup(admin, createUser)
    await give(giver, { report: 'sales', person: office.user })
    // #1172: Dash itself opens for them (its reader role), and the store-filtered report still doesn't.
    expect([await reports(office), await gate(office)]).toEqual([[], true])
    await give(giver, { report: 'open', person: office.user })
    expect([await reports(office), await gate(office)]).toEqual([['open'], true])
    const lookup = await giver.post<{ result: { reports: { key: string; closed: string | null; because: string[] }[] } }>('/api/app_reads/dash/person_lookup', { payload: { person: office.user } })
    expect(lookup.result.reports).toEqual([
      { key: 'open', name: 'Company notices', because: ['Given directly'], closed: null },
      { key: 'sales', name: 'Sales versus target', because: ['Given directly'], closed: 'Given, but their job reaches no store' },
    ])
  })
})

describe('removals and bundles keep their history', () => {
  const act = (client: TestClient, name: string, payload: Record<string, unknown>) =>
    client.post<{ result: { id: string } }>(`/api/app_actions/dash/${name}`, { idempotencyKey: crypto.randomUUID(), payload }).then(a => a.result)
  const page = (client: TestClient) => client.post<{ result: {
    rows: { id: string; updated_at: string; given_by: string }[]
    bundles: { id: string; name: string; reports: { member: string; updated_at: string; key: string }[] }[]
  } }>('/api/app_reads/dash/access_page', { payload: {} }).then(a => a.result)

  test('a removed row stays, marked removed, with who removed it in its history, and the same thing can be given again', async ({ admin, createUser }) => {
    const { leader, giver } = await setup(admin, createUser)
    await sql`update person set full_name = 'Made-up Giver' where row_id = ${giver.user!}`
    const { id } = await give(giver, { report: 'sales', person: leader.user })
    const [row] = (await page(giver)).rows
    expect(row.given_by).toBe('Made-up Giver')
    await act(giver, 'remove_report_access', { id: row.id, updated_at: row.updated_at })
    expect([await reports(leader), (await page(giver)).rows]).toEqual([[], []])
    const [kept] = await sql`select removed, access_key, updated_by from dash.report_access where row_id = ${id}`
    expect([Boolean(kept.removed), kept.access_key, kept.updated_by]).toEqual([true, null, giver.user])
    const history = await sql`select created_by from version where ref_table = 'dash.report_access' and ref_name = ${id}`
    expect(history.map(v => v.created_by)).toContain(giver.user)
    await give(giver, { report: 'sales', person: leader.user })
    expect(await reports(leader)).toEqual(['sales'])
  })

  test('a Report Access Manager makes a bundle, puts reports in it and takes one out, on the page', async ({ admin, createUser }) => {
    const { leader, giver } = await setup(admin, createUser)
    const { id: bundle } = await act(giver, 'make_bundle', { name: 'Team leader pack' })
    await act(giver, 'add_to_bundle', { bundle, report: 'sales' })
    await act(giver, 'add_to_bundle', { bundle, report: 'vendor_sales' })
    await give(giver, { report_bundle: bundle, job: 'Team Leader' })
    expect(await reports(leader)).toEqual(['sales', 'vendor_sales'])
    const [pack] = (await page(giver)).bundles
    const vendors = pack.reports.find(r => r.key === 'vendor_sales')!
    await act(giver, 'remove_from_bundle', { id: vendors.member, updated_at: vendors.updated_at })
    expect([await reports(leader), (await page(giver)).bundles[0].reports.map(r => r.key)]).toEqual([['sales'], ['sales']])
    await act(giver, 'add_to_bundle', { bundle, report: 'vendor_sales' })
    expect(await reports(leader)).toEqual(['sales', 'vendor_sales'])
    const refused = await giver.fetch('/api/app_actions/dash/make_bundle', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), payload: { name: 'Team leader pack' } }) })
    expect(await refused.text()).toContain('There is already a bundle with that name')
    const reader = await leader.fetch('/api/app_actions/dash/make_bundle', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), payload: { name: 'Mine' } }) })
    expect(reader.status).toBeGreaterThanOrEqual(400)
  })

  test("the lookup says a whole-stores report won't open for someone whose job reaches part of a store", async ({ admin, createUser }) => {
    const { leader, giver } = await setup(admin, createUser)
    await give(giver, { report: 'store_target', person: leader.user })
    const lookup = await giver.post<{ result: { reports: { key: string; closed: string | null }[] } }>('/api/app_reads/dash/person_lookup', { payload: { person: leader.user } })
    expect(lookup.result.reports.map(r => [r.key, r.closed])).toEqual([['store_target', 'Given, but it covers whole stores and their job reaches part of a store']])
    expect([await reports(leader), await gate(leader)]).toEqual([[], true])
  })

  test('someone holding no role opens Dash once Dash Reader goes to everyone and a report reaches their job', async ({ admin, createUser }) => {
    const { giver, save } = await setup(admin, createUser)
    const plain = await createUser({ email: 'ra-plain@example.test', roles: [] })
    await save('Employee', { employee_code: '4', name: 'Made-up Plain', person: plain.user, status: 'Current' })
    await save('Job Assignment', { assignment_id: 'JA-4', employee: '4', job: 'Team Leader', site: 'LKS', section: 'LKS-S1', starts_on: '2026-01-01' })
    await give(giver, { report: 'sales', job: 'Team Leader' })
    expect((await catalog(plain)).includes('dash')).toBe(false)
    await admin.post('/api/save_row', { table: 'System Settings', row: { everyone_roles: 'Dash Reader' } })
    expect([(await catalog(plain)).includes('dash'), await reports(plain)]).toEqual([true, ['sales']])
  })
})

describe('opening a report not given is refused before anything goes out', () => {
  test('the embed session for a report not given is refused and MotherDuck is never called', async ({ admin, createUser }) => {
    const { leader, giver } = await setup(admin, createUser)
    await give(giver, { report: 'sales', person: leader.user })
    await admin.post('/api/save_row', { table: 'App Setting', row: { row_id: 'dash.embed_service_account', value: 'svc-made-up' } })
    const called: string[] = []
    const real = globalThis.fetch
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      if (!String(url).startsWith('https://api.motherduck.com/')) return real(url, init)
      called.push(String(url))
      return new Response(JSON.stringify({ session: 'made-up-session' }), { status: 200 })
    })
    expect(await leader.post('/api/app_reads/dash/embed_session', { payload: { report: 'vendor_sales' } })).toEqual({ result: { refused: 'no_access' } })
    expect(called).toEqual([])
  })

  test('a reader cannot list the access Tables, and cannot give a report', async ({ admin, createUser }) => {
    const { leader } = await setup(admin, createUser)
    expect((await leader.fetch('/api/table/dash.report_access')).status).toBe(403)
    const refused = await leader.fetch('/api/app_actions/dash/give_report', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), payload: { report: 'sales', person: leader.user } }) })
    expect(refused.status).toBeGreaterThanOrEqual(400)
  })

  test("a Report Access Manager can't give themselves a role, a permission or a data scope", async ({ admin, createUser }) => {
    const { giver } = await setup(admin, createUser)
    for (const [table, row] of [
      ['Permission', { ref_table: 'dash.report', role: 'Dash Reader', operation: 'write' }],
      ['Has Role', { parent: giver.user, parenttype: 'Person', role: 'System Manager' }],
      ['Data Scope', { name: 'ra-widen' }],
    ] as const) {
      const response = await giver.fetch('/api/save_row', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ table, row }) })
      expect([table, response.status]).toEqual([table, 403])
    }
  })
})

describe('the save rule', () => {
  test('refuses a row giving two things or to two receivers, and the same thing given twice', async ({ admin, createUser }) => {
    const { leader, giver } = await setup(admin, createUser)
    const saving = (row: Record<string, unknown>) => admin.fetch('/api/save_row', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ table: 'dash.report_access', row }) })
    expect((await saving({ report: 'sales', report_bundle: 'x', person: leader.user })).status).toBe(417)
    expect((await saving({ report: 'sales', person: leader.user, job: 'Team Leader' })).status).toBe(417)
    await give(giver, { report: 'sales', job: 'Team Leader' })
    expect((await saving({ report: 'sales', job: 'Team Leader' })).status).not.toBe(200)
  })
})

describe('the Report access page', () => {
  test('lists who has what, by name and kind, for a Report Access Manager only', async ({ admin, createUser }) => {
    const { leader, giver } = await setup(admin, createUser)
    await give(giver, { report: 'sales', job: 'Team Leader' })
    await give(giver, { report: 'open', person: leader.user })
    const page = await giver.post<{ result: { rows: { gives: unknown; to: unknown; given_by: string }[] } }>('/api/app_reads/dash/access_page', { payload: {} })
    expect(page.result.rows.map(({ gives, to }) => [gives, to])).toEqual([
      [{ kind: 'Report', name: 'Company notices' }, { kind: 'Person', name: 'Made-up Leader' }],
      [{ kind: 'Report', name: 'Sales versus target' }, { kind: 'Job', name: 'Team Leader' }],
    ])
    expect((await leader.fetch('/api/app_reads/dash/access_page', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payload: {} }) })).status).toBeGreaterThanOrEqual(400)
  })

  // #1172: a Dash reader with no report opens Dash and asks for nothing; only someone holding no Dash
  // role is refused, and their request is mailed to the Report Access Managers.
  test('a Dash reader with no report opens Dash and asks for nothing; someone with no Dash role is refused and their request mailed', async ({ admin, createUser }) => {
    const { leader, giver } = await setup(admin, createUser)
    await sql`update person set email = 'ra-giver@example.test' where row_id = ${giver.user!}`
    const mailed: string[] = []
    _setAlertSender(async message => { mailed.push(message.to) })
    const opened = await leader.fetch('/dash/', { headers: { accept: 'text/html' } })
    const asked = { status: opened.status, mailed: [...mailed] }
    const stranger = await createUser({ email: 'no-dash-role@example.test', roles: [] })
    const refused = await stranger.fetch('/dash/', { headers: { accept: 'text/html' } })
    const waiting = await giver.post<{ result: { waiting: { person: string }[] } }>('/api/app_reads/dash/access_page', { payload: {} })
    expect([asked, refused.status, mailed.includes('ra-giver@example.test'), waiting.result.waiting.map(w => w.person)])
      .toEqual([{ status: 200, mailed: [] }, 403, true, [stranger.user]])
  })
})

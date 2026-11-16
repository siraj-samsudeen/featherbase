// Team report giving (#1217) by real reads and writes on the platform: a Team Report Manager
// gives reports they hold to the people who report to them, and nothing else. Made-up people,
// stores and reports.
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { describe, expect } from 'vitest'
import { test as pgTest } from '../pg-test'
import { sql } from '../../src/db'
import { APP_DIR, REPORT_ROWS, createCoreTables, installApp, pinned, saveRow } from './helpers'

const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})
process.env.MOTHERDUCK_TOKEN = 'made-up-token'
void APP_DIR

const json = { 'content-type': 'application/json' }
const call = (client: TestClient, kind: 'app_actions' | 'app_reads', name: string, payload: Record<string, unknown>) =>
  client.fetch(`/api/${kind}/dash/${name}`, { method: 'POST', headers: json, body: JSON.stringify(kind === 'app_actions' ? { idempotencyKey: crypto.randomUUID(), payload } : { payload }) })
async function ok<T>(sent: Response | Promise<Response>): Promise<T> {
  const response = await sent
  const body = await response.text()
  expect([response.status, response.status === 200 ? null : body]).toEqual([200, null])
  return (JSON.parse(body) as { result: T }).result
}
async function refused(sent: Response | Promise<Response>, says: string) {
  const response = await sent
  const body = await response.text()
  expect([response.status >= 400, body]).toEqual([true, expect.stringContaining(says)])
}
const give = (client: TestClient, payload: Record<string, unknown>) => call(client, 'app_actions', 'give_report', payload)
const reports = (client: TestClient) => ok<{ key: string }[]>(call(client, 'app_reads', 'reports', {})).then(list => list.map(r => r.key))
const page = (client: TestClient) => ok<{
  scope: string; team: { person: string; name: string }[]
  reports: { key: string }[]; bundles: { id: string; reports: unknown[] }[]; roles: string[]; jobs: string[]
  rows: { id: string; updated_at: string; to: { name: string }; removable: boolean }[]; waiting: unknown[]
}>(call(client, 'app_reads', 'access_page', {}))

async function setup(admin: TestClient, createUser: CreateUserFn) {
  await installApp(admin)
  await createCoreTables(admin)
  const save = (table: string, row: Record<string, unknown>) => saveRow(admin, table, row)
  await save('Site', { code: 'LKS', name: 'Lakeside', is_store: true })
  await save('Plant', { plant_code: '9901', plant_type: 'Store', site: 'LKS' })
  await save('Section', { row_id: 'LKS-S1', name: 'Sarees', site: 'LKS', status: 'Active' })
  await save('Subcategory', { row_id: '010101001', subcategory: 'Silk', subcategory_type: 'Merchandise' })
  await save('Section Subcategory', { section_subcategory_id: 'P1', store: 'LKS', subcategory: '010101001', section: 'LKS-S1', starts_on: '2026-01-01' })
  for (const row of REPORT_ROWS) await save('dash.report', row)
  await save('dash.report', { report_key: 'open', report_name: 'Company notices', dive_id: 'made-up-open-dive', filter_shape: 'No filter' })
  const person = (name: string, roles = ['Dash Reader']) => createUser({ email: `${name}@example.test`, roles })
  const people = {
    head: await person('tr-head', ['Dash Reader', 'Team Report Manager']),
    buyer: await person('tr-buyer'), other: await person('tr-other'),
    giver: await person('tr-giver', ['Dash Reader', 'Report Access Manager']),
  }
  await save('Employee', { employee_code: 'H1', name: 'Made-up Head', person: people.head.user, status: 'Current' })
  await save('Employee', { employee_code: 'B1', name: 'Made-up Buyer', person: people.buyer.user, status: 'Current' })
  await save('Employee', { employee_code: 'O1', name: 'Made-up Other', person: people.other.user, status: 'Current' })
  await save('Employee', { employee_code: 'X1', name: 'Made-up Other Head', status: 'Current' })
  await save('Job Assignment', { assignment_id: 'JA-H1', employee: 'H1', job: 'Store Manager', site: 'LKS', starts_on: '2026-01-01' })
  await save('Job Assignment', { assignment_id: 'JA-B1', employee: 'B1', job: 'Team Leader', site: 'LKS', section: 'LKS-S1', reports_to: 'H1', starts_on: '2026-01-01' })
  await save('Job Assignment', { assignment_id: 'JA-O1', employee: 'O1', job: 'Team Leader', site: 'LKS', section: 'LKS-S1', reports_to: 'X1', starts_on: '2026-01-01' })
  // What the head can open: Sales versus target and Company notices, given by the company-wide manager.
  await ok(give(people.giver, { report: 'sales', person: people.head.user }))
  await ok(give(people.giver, { report: 'open', person: people.head.user }))
  return { ...people, save }
}

describe('a Team Report Manager gives reports to their own team only', () => {
  test('gives a report they hold to someone who reports to them', async ({ admin, createUser }) => {
    const { head, buyer } = await setup(admin, createUser)
    await ok(give(head, { report: 'sales', person: buyer.user }))
    expect(await reports(buyer)).toEqual(['sales'])
  })

  test('refuses someone outside their team', async ({ admin, createUser }) => {
    const { head, other } = await setup(admin, createUser)
    await refused(await give(head, { report: 'sales', person: other.user }), 'is not in your team')
    expect(await reports(other)).toEqual([])
  })

  test('refuses a report they can’t open themselves', async ({ admin, createUser }) => {
    const { head, buyer } = await setup(admin, createUser)
    await refused(await give(head, { report: 'vendor_sales', person: buyer.user }), 'only reports you can open yourself')
    expect(await reports(buyer)).toEqual([])
  })

  // Codex adversarial round 1: given is not enough; they must be able to open it, as Dash offers it to them.
  test('refuses a report given to them that their own reach can’t open, and gives one taking no filter', async ({ admin, createUser }) => {
    const { head, buyer } = await setup(admin, createUser)
    const job = await admin.get<{ updated_at: string }>('/api/table/Job%20Assignment/JA-H1')
    await saveRow(admin, 'Job Assignment', { row_id: 'JA-H1', updated_at: job.updated_at, ends_on: '2026-02-01' })
    await refused(give(head, { report: 'sales', person: buyer.user }), 'only reports you can open yourself')
    await ok(give(head, { report: 'open', person: buyer.user }))
    expect((await page(head)).reports.map(r => r.key)).toEqual(['open'])
  })

  test('refuses a whole-stores report when their reach is part of a store', async ({ admin, createUser }) => {
    const { head, buyer, giver } = await setup(admin, createUser)
    const job = await admin.get<{ updated_at: string }>('/api/table/Job%20Assignment/JA-H1')
    await saveRow(admin, 'Job Assignment', { row_id: 'JA-H1', updated_at: job.updated_at, job: 'Team Leader', section: 'LKS-S1' })
    await ok(give(giver, { report: 'store_target', person: head.user }))
    await refused(give(head, { report: 'store_target', person: buyer.user }), 'only reports you can open yourself')
    await ok(give(head, { report: 'sales', person: buyer.user }))
  })

  test('refuses giving to themselves', async ({ admin, createUser }) => {
    const { head } = await setup(admin, createUser)
    await refused(await give(head, { report: 'store_target', person: head.user }), 'to yourself')
  })

  test('refuses a role or a job', async ({ admin, createUser }) => {
    const { head } = await setup(admin, createUser)
    await refused(await give(head, { report: 'sales', job: 'Team Leader' }), 'only to a person in your team')
    await refused(await give(head, { report: 'sales', role: 'Dash Reader' }), 'only to a person in your team')
  })

  test('refuses a bundle holding a report they can’t open, and gives one whose every report they can', async ({ admin, createUser }) => {
    const { head, buyer, save } = await setup(admin, createUser)
    const mixed = await save('dash.report_bundle', { bundle_name: 'Mixed pack' })
    await save('dash.report_bundle_member', { report_bundle: mixed.row_id, report: 'sales' })
    await save('dash.report_bundle_member', { report_bundle: mixed.row_id, report: 'vendor_sales' })
    const held = await save('dash.report_bundle', { bundle_name: 'Held pack' })
    await save('dash.report_bundle_member', { report_bundle: held.row_id, report: 'open' })
    await refused(await give(head, { report_bundle: mixed.row_id, person: buyer.user }), 'only reports you can open yourself')
    await ok(give(head, { report_bundle: held.row_id, person: buyer.user }))
    expect(await reports(buyer)).toEqual(['open'])
    expect((await page(head)).bundles.map(b => b.id)).toEqual([held.row_id])
  })

  test('can’t make a bundle', async ({ admin, createUser }) => {
    const { head } = await setup(admin, createUser)
    await refused(await call(head, 'app_actions', 'make_bundle', { name: 'Mine' }), 'Only a Report Access Manager')
  })

  test('can’t write a grant straight into the access Table, nor change one they gave', async ({ admin, createUser }) => {
    const { head, buyer, other } = await setup(admin, createUser)
    const direct = await head.fetch('/api/save_row', { method: 'POST', headers: json, body: JSON.stringify({ table: 'dash.report_access', row: { report: 'vendor_sales', person: other.user } }) })
    expect(direct.status).toBeGreaterThanOrEqual(400)
    const { id } = await ok<{ id: string }>(give(head, { report: 'sales', person: buyer.user }))
    const mine = await head.get<{ updated_at: string }>(`/api/table/dash.report_access/${encodeURIComponent(id)}`)
    const moved = await head.fetch('/api/save_row', { method: 'POST', headers: json, body: JSON.stringify({ table: 'dash.report_access', row: { row_id: id, updated_at: mine.updated_at, person: other.user } }) })
    expect(moved.status).toBeGreaterThanOrEqual(400)
    expect(await reports(other)).toEqual([])
  })

  test('reads only the grants they gave through the access Table', async ({ admin, createUser }) => {
    const { head, buyer } = await setup(admin, createUser)
    await ok(give(head, { report: 'sales', person: buyer.user }))
    const listed = await head.get<{ data: { person: string }[] } | { person: string }[]>('/api/table/dash.report_access?fields=["person"]')
    const rows = Array.isArray(listed) ? listed : listed.data
    expect(rows.map(r => r.person)).toEqual([buyer.user])
  })

  test('takes away a grant they gave their team, but not one the company-wide manager gave', async ({ admin, createUser }) => {
    const { head, buyer, giver } = await setup(admin, createUser)
    await ok(give(giver, { report: 'vendor_sales', person: buyer.user }))
    await ok(give(head, { report: 'sales', person: buyer.user }))
    const rows = (await page(head)).rows
    const theirs = rows.find(r => r.removable)!
    const company = rows.find(r => !r.removable)!
    await refused(await call(head, 'app_actions', 'remove_report_access', { id: company.id, updated_at: company.updated_at }), 'only what you gave')
    await ok(call(head, 'app_actions', 'remove_report_access', { id: theirs.id, updated_at: theirs.updated_at }))
    expect(await reports(buyer)).toEqual(['vendor_sales'])
  })
})

describe('the Report access page, for a Team Report Manager', () => {
  test('shows only their team, their team’s grants and what they may give', async ({ admin, createUser }) => {
    const { head, buyer, other, giver } = await setup(admin, createUser)
    await ok(give(giver, { report: 'store_target', person: other.user }))
    await ok(give(giver, { report: 'store_target', person: buyer.user }))
    const seen = await page(head)
    expect({ scope: seen.scope, team: seen.team, reports: seen.reports.map(r => r.key), roles: seen.roles, jobs: seen.jobs, waiting: seen.waiting,
      rows: seen.rows.map(r => [r.to.name, r.removable]) }).toEqual({
      scope: 'team', team: [{ person: buyer.user, name: 'Made-up Buyer' }], reports: ['open', 'sales'], roles: [], jobs: [], waiting: [],
      rows: [['Made-up Buyer', false]],
    })
    expect(await ok<{ person: string }[]>(call(head, 'app_reads', 'person_search', { q: 'Made-up' }))).toEqual([{ person: buyer.user, name: 'Made-up Buyer' }])
    await refused(await call(head, 'app_reads', 'person_lookup', { person: other.user }), 'is not in your team')
    expect(await ok<boolean>(call(head, 'app_reads', 'manages_access', {}))).toBe(true)
  })

  test('a Report Access Manager still sees the whole company', async ({ admin, createUser }) => {
    const { other, buyer, giver } = await setup(admin, createUser)
    await ok(give(giver, { report: 'store_target', person: other.user }))
    const seen = await page(giver)
    expect([seen.scope, seen.rows.length, seen.reports.length]).toEqual(['company', 3, 4])
    const found = (await ok<{ person: string }[]>(call(giver, 'app_reads', 'person_search', { q: 'Made-up' }))).map(p => p.person)
    expect([found.includes(buyer.user!), found.includes(other.user!)]).toEqual([true, true])
  })
})

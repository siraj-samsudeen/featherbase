// Dash's report reads on the real platform: the reader's places come
// from the app's own scope provider, and the platform limits the cached
// dataset to them before the app sees a row. The cached copy is seeded the
// way the platform stores one (the warehouse is MotherDuck, which a test
// cannot reach). Made-up stores 9901 and 9902, people and figures.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { afterEach, beforeEach, describe, expect, vi } from 'vitest'
import { test as pgTest } from '../pg-test'
import { datasetsDeclaration } from '../../src/app-datasets'
import { invalidateSources } from '../../src/sources/registry'
import { withNamedVariable } from '../../src/env'
import { sql } from '../../src/db'
import { activeSnapshot, buildSnapshot } from '../../src/dataset-snapshot'
import { drainJobs, enqueue, loadJobs } from '../../src/jobs'
import { ACCESS_ROWS, APP_DIR, REPORT_ROWS, createCoreTables, installApp, pinned, saveRow } from './helpers'
import { FOUR_TARGETS, addSource, answerWithoutPeriod, closeWarehouse, fillWarehouse, openWarehouse } from './warehouse'

const test = pgTest.extend<{ admin: TestClient; createUser: CreateUserFn }>({
  admin: async ({ admin }, use) => use(pinned(admin)),
  createUser: async ({ createUser }, use) => use(async options => pinned(await createUser(options))),
})
const READER = 'Dash Reader'
// A declared secret is required by every read (featherbase app-settings.ts), so the
// instance sets the token even where no Dive is configured.
process.env.MOTHERDUCK_TOKEN = 'made-up-token'
// #1139: the embed call has its own token; only the two reads that open a Dive need it.
process.env.MOTHERDUCK_EMBED_TOKEN = 'made-up-embed-token'
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
const periodStart = `${today.slice(0, 8)}01`
const lastMonthEnd = new Date(new Date(`${periodStart}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10)
const lastMonthStart = `${lastMonthEnd.slice(0, 8)}01`
const monthName = (day: string) => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(day.slice(5, 7)) - 1]}'${day.slice(2, 4)}`

const salesRow = (store: string, code: string, name: string, target: number, actual: number) => ({
  store_code: store, store_name: name, short_code: null, subcategory_code: code, subcategory: `Made-up ${code}`, target, actual,
  days_with_actual: 3, days: 3, period_start: periodStart, data_through: today, targets_available: true })

/** A cached copy of the app's dataset, stored as the platform stores one, under the definition it registered. */
async function seedSnapshot(rows: Record<string, unknown>[], name = 'sales_to_date') {
  const manifest = JSON.parse(await readFile(resolve(APP_DIR, 'featherbase.json'), 'utf8'))
  const dataset = datasetsDeclaration.parse(manifest.datasets).find(d => d.name === name)!
  // As the platform keys it (featherbase app-datasets.ts): a guard is not part of the definition.
  const version = createHash('sha256').update(JSON.stringify({ ...dataset, guard: undefined })).digest('hex').slice(0, 16)
  await sql`update dataset_snapshot set state = 'superseded' where dataset = ${`dash.${name}`} and state = 'active'`
  const id = randomUUID()
  await sql`insert into dataset_snapshot (row_id, dataset, definition_version, state, built_at, activated_at, row_count)
    values (${id}, ${`dash.${name}`}, ${version}, 'active', now(), now(), ${rows.length})`
  for (const row of rows) await sql`insert into app_dataset_row (snapshot_id, row) values (${id}, ${sql.json(row)})`
}

async function setup(admin: TestClient, createUser: CreateUserFn, facts?: Record<string, unknown>[]) {
  await installApp(admin)
  await createCoreTables(admin)
  invalidateSources()
  // The instance's MotherDuck source, played by a local DuckDB path: the platform
  // accepts it as read-only. The reads never query it; a refresh below queries the
  // made-up warehouse instead (warehouse.ts).
  await addSource(admin)
  const user = async (name: string) => createUser({ email: `${name}@example.test`, roles: [READER] })
  const people = { manager: await user('p-101'), leader: await user('p-103'), nobody: await user('p-999'), headOffice: await user('p-998') }
  const save = (table: string, row: Record<string, unknown>) => saveRow(admin, table, row)
  for (const [code, name] of [['LKS', 'Lakeside'], ['HIL', 'Hillview']]) await save('Site', { code, name, is_store: true })
  await save('Site', { code: 'HOF', name: 'Head Office', is_store: false })
  await save('Plant', { plant_code: '9901', plant_type: 'Store', site: 'LKS' })
  await save('Plant', { plant_code: '9902', plant_type: 'Store', site: 'HIL' })
  for (const [row_id, name] of [['LKS-S1', 'Sarees'], ['LKS-S2', 'Lehenga']]) await save('Section', { row_id, name, site: 'LKS', status: 'Active' })
  for (const [code, name] of [['010101001', 'Silk'], ['010101003', 'Bridal']]) await save('Subcategory', { row_id: code, subcategory: name, subcategory_type: 'Merchandise' })
  await save('Section Subcategory', { section_subcategory_id: 'P1', store: 'LKS', subcategory: '010101001', section: 'LKS-S1', starts_on: '2026-01-01' })
  await save('Section Subcategory', { section_subcategory_id: 'P2', store: 'LKS', subcategory: '010101003', section: 'LKS-S2', starts_on: '2026-01-01' })
  await save('Employee', { employee_code: '101', name: 'Made-up Manager', person: people.manager.user, status: 'Current' })
  await save('Employee', { employee_code: '103', name: 'Made-up Leader', person: people.leader.user, status: 'Current' })
  await save('Employee', { employee_code: '998', name: 'Made-up Office', person: people.headOffice.user, status: 'Current' })
  await save('Job Assignment', { assignment_id: 'JA-101', employee: '101', job: 'Store Manager', site: 'LKS', starts_on: '2026-01-01' })
  await save('Job Assignment', { assignment_id: 'JA-103', employee: '103', job: 'Team Leader', site: 'LKS', section: 'LKS-S1', starts_on: '2026-01-01' })
  await save('Job Assignment', { assignment_id: 'JA-998', employee: '998', job: 'Head office staff', site: 'HOF', starts_on: '2026-01-01' })
  for (const row of REPORT_ROWS) await save('dash.report', row)
  for (const row of ACCESS_ROWS) await save('dash.report_access', row)
  await seedSnapshot(facts ?? [
    salesRow('9901', '010101001', 'Lakeside', 1000, 800),
    salesRow('9901', '010101003', 'Lakeside', 500, 650),
    salesRow('9901', '010909001', 'Lakeside', 0, 120),
    salesRow('9902', '010404001', 'Hillview', 300, 100),
  ])
  // The month's metadata, which names a store on the report's header when the reader has no row.
  await seedSnapshot(['010101001', '010101003', '010909001'].map(code => ({ store_code: '9901', store_name: 'Lakeside', subcategory_code: code,
    period_start: periodStart, data_through: today, targets_available: true })), 'sales_month')
  return { ...people, save }
}

const report = (client: TestClient, payload: Record<string, unknown> = { store: '9901' }) =>
  client.post<{ result: { state: string; rows: { code: string; section: string | null }[] } }>('/api/app_reads/dash/report', { payload }).then(a => a.result)

describe('the report reads on the platform', () => {
  // A whole-store place names no section: the Dive reads sections for itself (#967).
  test("give a Store Manager every cached row of their store", async ({ admin, createUser }) => {
    const { manager } = await setup(admin, createUser)
    const answer = await report(manager)
    expect([answer.state, answer.rows.map(r => r.code)]).toEqual(['ready', ['010101001', '010101003', '010909001']])
  })

  test("give a Team Leader only their section's rows: the platform limits the dataset to their places", async ({ admin, createUser }) => {
    const { leader } = await setup(admin, createUser)
    expect((await report(leader)).rows.map(r => r.code)).toEqual(['010101001'])
  })

  // #4486: the places' `basis` survives the platform's narrowing into the read, so the page can say why.
  test("say why each reader sees the store, from the bases on their places", async ({ admin, createUser }) => {
    const { manager, leader } = await setup(admin, createUser)
    const heading = (client: TestClient) => client.post<{ result: { heading: unknown } }>('/api/app_reads/dash/report', { payload: { store: '9901' } })
      .then(a => a.result.heading)
    expect(await heading(manager)).toEqual({ name: 'Lakeside', sections: [], reasons: [{ basis: 'store_manager', sections: [] }] })
    expect(await heading(leader)).toEqual({ name: 'Lakeside', sections: ['Sarees'], reasons: [{ basis: 'team_leader', sections: ['Sarees'] }] })
  })

  test("refuse a store that is not the reader's", async ({ admin, createUser }) => {
    const { leader } = await setup(admin, createUser)
    await expect(report(leader, { store: '9902' })).rejects.toMatchObject({ status: 417 })
  })

  test("show a quiet section as ready, from the month's metadata, when the store's month has arrived", async ({ admin, createUser }) => {
    // Sarees sold nothing and had no target: the Team Leader's scoped rows are empty.
    const { leader } = await setup(admin, createUser, [salesRow('9901', '010101003', 'Lakeside', 500, 650)])
    await seedSnapshot(['010101001', '010101003'].map(code => ({ store_code: '9901', store_name: 'Lakeside', subcategory_code: code, period_start: periodStart,
      data_through: today, targets_available: true })), 'sales_month')
    const answer = await report(leader)
    expect([answer.state, answer.rows.map(r => r.code)]).toEqual(['ready', ['010101001']])
  })

  test('refuse a person who covers nothing', async ({ admin, createUser }) => {
    const { nobody } = await setup(admin, createUser)
    await expect(report(nobody)).rejects.toMatchObject({ status: 403 })
  })

  test("fill the bar's store picker with the reader's stores, and its month picker with this month and last (#750)", async ({ admin, createUser }) => {
    const { manager } = await setup(admin, createUser)
    expect(await manager.get('/api/app_bar/dash')).toEqual({ controls: [
      { picker: 'Store', sets: 'store', hiddenWhen: 'view', dependsOn: ['report'], options: [{ value: '9901', label: 'Lakeside' }] },
      { picker: 'Month', sets: 'month', hiddenWhen: 'view', dependsOn: ['report'], options: [{ value: 'this', label: `This month · ${monthName(periodStart)}` },
        { value: 'last', label: `Last month · ${monthName(lastMonthStart)}` }] },
    ] })
  })

  // #750: last month's copy is limited to the reader's places as this month's is.
  test("give a Team Leader only their section's rows of last month", async ({ admin, createUser }) => {
    const { leader } = await setup(admin, createUser)
    await seedSnapshot([
      { ...salesRow('9901', '010101001', 'Lakeside', 900, 950), period_start: lastMonthStart, data_through: lastMonthEnd },
      { ...salesRow('9901', '010101003', 'Lakeside', 400, 300), period_start: lastMonthStart, data_through: lastMonthEnd },
    ], 'sales_last_month')
    const answer = await report(leader, { store: '9901', month: 'last' }) as Awaited<ReturnType<typeof report>> & { period_start: string; period_end: string }
    expect([answer.state, answer.period_start, answer.period_end, answer.rows.map(r => r.code)])
      .toEqual(['ready', lastMonthStart, lastMonthEnd, ['010101001']])
  })

  test("list the reports for the sidebar, and none for someone whose job reaches nothing", async ({ admin, createUser }) => {
    const { manager, leader, headOffice, nobody } = await setup(admin, createUser)
    const reports = (client: TestClient) => client.post<{ result: unknown[] }>('/api/app_reads/dash/reports', { payload: {} }).then(a => a.result)
    expect(await reports(manager)).toEqual([
      { key: 'sales', name: 'Sales versus target', takes_store: true, takes_month: true, no_filter: false },
      { key: 'store_target', name: 'Store target month to date', takes_store: false, takes_month: false, no_filter: false },
      { key: 'vendor_sales', name: 'Vendor sales by city', takes_store: false, takes_month: false, no_filter: false },
    ])
    // A Team Leader holds no whole store, so the whole-stores report isn't offered (#967 point 1).
    expect((await reports(leader) as { key: string }[]).map(r => r.key)).toEqual(['sales', 'vendor_sales'])
    expect(await Promise.all([reports(headOffice), reports(nobody)])).toEqual([[], []])
  })

  test('say why a job reaches nothing', async ({ admin, createUser }) => {
    const { headOffice, nobody } = await setup(admin, createUser)
    const why = (client: TestClient) => client.post<{ result: unknown }>('/api/app_reads/dash/reach_problem', { payload: {} }).then(a => a.result)
    expect(await Promise.all([why(headOffice), why(nobody)])).toEqual([{ problems: ['head_office'] }, { problems: ['no_job'] }])
  })

  test("name the store on the report's picker and header from the core Tables, and offer pickers only where the report takes them", async ({ admin, createUser }) => {
    const { manager } = await setup(admin, createUser)
    const options = (name: string, payload: object) => manager.post<{ result: unknown[] }>(`/api/app_reads/dash/${name}`, { payload }).then(a => a.result)
    expect(await options('stores', { report: 'sales' })).toEqual([{ value: '9901', label: 'Lakeside' }])
    expect(await options('stores', { report: 'store_target' })).toEqual([])
    expect(await options('months', { report: 'store_target' })).toEqual([])
    expect(await options('months', { report: 'nope' })).toEqual([])
  })

  test('answer no_access for a report that does not exist, on the report and on the Dive', async ({ admin, createUser }) => {
    const { leader } = await setup(admin, createUser)
    expect(await report(leader, { report: 'nope' })).toEqual({ state: 'no_access' })
    expect(await leader.post('/api/app_reads/dash/embed_session', { payload: { report: 'nope' } })).toEqual({ result: { refused: 'no_access' } })
  })

  test("tell a section reader a whole-stores report isn't for them", async ({ admin, createUser }) => {
    const { leader } = await setup(admin, createUser)
    expect(await report(leader, { report: 'store_target' })).toEqual({ state: 'whole_stores_only' })
  })

  // The whole outbound path on the platform: its prepare step reads the row in the transaction, and
  // the handler calls out afterwards. MotherDuck's API is the one thing played by a stand-in.
  describe('calling MotherDuck for a Dive', () => {
    afterEach(() => { vi.unstubAllGlobals() })
    /** The bearer each MotherDuck call carried, in order. */
    let tokens: string[] = []
    async function opening(admin: TestClient) {
      await admin.post('/api/save_row', { table: 'App Setting', row: { row_id: 'dash.embed_service_account', value: 'svc-made-up' } })
      const real = globalThis.fetch
      const called: { url: string; body: unknown }[] = []
      tokens = []
      vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
        if (!String(url).startsWith('https://api.motherduck.com/')) return real(url, init)
        called.push({ url: String(url), body: JSON.parse(String(init?.body)) })
        tokens.push((init?.headers as Record<string, string>).authorization)
        return new Response(JSON.stringify({ session: 'made-up-session' }), { status: 200 })
      })
      return called
    }

    test('asks MotherDuck with the embed token, never the warehouse token (#1139)', async ({ admin, createUser }) => {
      const { leader } = await setup(admin, createUser)
      await opening(admin)
      await leader.post('/api/app_reads/dash/embed_session', { payload: { report: 'sales', store: '9901' } })
      expect(tokens).toEqual(['Bearer made-up-embed-token'])
    })

    test('without the embed token, only the Dive is not set up: the quick view still answers on the warehouse token', async ({ admin, createUser }) => {
      const { leader } = await setup(admin, createUser)
      const called = await opening(admin)
      await withNamedVariable('MOTHERDUCK_EMBED_TOKEN', undefined, async () => {
        await expect(leader.post('/api/app_reads/dash/embed_session', { payload: { report: 'sales', store: '9901' } })).rejects.toMatchObject({ status: 409 })
        expect((await report(leader)).rows.map(r => r.code)).toEqual(['010101001'])
      })
      expect(called).toEqual([])
    })

    test("sends a Team Leader's one-store Dive only their store, subcategories and month", async ({ admin, createUser }) => {
      const { leader } = await setup(admin, createUser)
      const called = await opening(admin)
      expect(await leader.post('/api/app_reads/dash/embed_session', { payload: { report: 'sales', store: '9901' } }))
        .toEqual({ result: { frame: 'https://embed-motherduck.com/sandbox/#session=made-up-session' } })
      expect(called).toEqual([{ url: 'https://api.motherduck.com/v1/dives/made-up-sales-dive/embed-session',
        body: { username: 'svc-made-up', initial_state: { plant_code: '9901', material_groups: ['010101001'], period_end: today } } }])
    })

    test("sends a Store Manager's whole-stores Dive only their stores", async ({ admin, createUser }) => {
      const { manager } = await setup(admin, createUser)
      const called = await opening(admin)
      await manager.post('/api/app_reads/dash/embed_session', { payload: { report: 'store_target' } })
      expect(called[0].body).toEqual({ username: 'svc-made-up', initial_state: { plant_codes: ['9901'] } })
    })

    test("sends a Team Leader's per-store Dive their store's reach", async ({ admin, createUser }) => {
      const { leader } = await setup(admin, createUser)
      const called = await opening(admin)
      await leader.post('/api/app_reads/dash/embed_session', { payload: { report: 'vendor_sales' } })
      expect(called[0].body).toEqual({ username: 'svc-made-up', initial_state: { store_reach: { 9901: ['010101001'] } } })
    })

    test('opens a report taking no filter for someone whose job reaches nothing, and nothing else', async ({ admin, createUser }) => {
      const { headOffice, leader } = await setup(admin, createUser)
      await saveRow(admin, 'dash.report', { report_key: 'open', report_name: 'Open to anyone given it', dive_id: 'made-up-open-dive', filter_shape: 'No filter' })
      await saveRow(admin, 'dash.report_access', { report: 'open', role: 'Dash Reader' })
      const called = await opening(admin)
      const reports = await headOffice.post<{ result: { key: string; no_filter: boolean }[] }>('/api/app_reads/dash/reports', { payload: {} })
      expect(reports.result.map(r => [r.key, r.no_filter])).toEqual([['open', true]])
      expect(await headOffice.post('/api/app_reads/dash/report_open', { payload: { report: 'open' } }))
        .toEqual({ result: { state: 'ready', no_quick_view: true, heading: { name: null, sections: [], reasons: [] } } })
      expect(await headOffice.post('/api/app_reads/dash/embed_open', { payload: { report: 'open' } }))
        .toEqual({ result: { frame: 'https://embed-motherduck.com/sandbox/#session=made-up-session' } })
      expect(called).toEqual([{ url: 'https://api.motherduck.com/v1/dives/made-up-open-dive/embed-session', body: { username: 'svc-made-up', initial_state: {} } }])
      called.length = 0
      // A store-filtered report never opens this way, for them or for someone with reach.
      expect(await headOffice.post('/api/app_reads/dash/embed_open', { payload: { report: 'sales' } })).toEqual({ result: { refused: 'no_access' } })
      expect(await leader.post('/api/app_reads/dash/embed_open', { payload: { report: 'sales', store: '9901' } })).toEqual({ result: { refused: 'no_access' } })
      expect(called).toEqual([])
    })

    // #1159: on the real platform, a report whose Dive has its own pickers.
    test('opens a Dive with its own pickers with the reader\'s reach, and offers no picker in the bar', async ({ admin, createUser }) => {
      const { leader } = await setup(admin, createUser)
      await saveRow(admin, 'dash.report', { report_key: 'picked', report_name: 'Pickers in the Dive', dive_id: 'made-up-picked-dive',
        filter_shape: 'One store and subcategories', store_key: 'plant_code', subcategory_key: 'material_groups', whole_store_key: 'whole_store',
        month_key: 'period_end', quick_view: 'Sales target', pickers_in_dive: true })
      await saveRow(admin, 'dash.report_access', { report: 'picked', role: 'Dash Reader' })
      const called = await opening(admin)
      await leader.post('/api/app_reads/dash/embed_session', { payload: { report: 'picked', store: '9901', month: 'last' } })
      const bar = await leader.get<{ controls: { sets: string; options: unknown[] }[] }>('/api/app_bar/dash?report=picked')
      // With no store named, the cached view opens on the reader's store that has figures.
      const cached = await report(leader, { report: 'picked' }) as { store?: string; rows: { code: string }[]; pickers_in_dive?: boolean }
      expect([cached.store, cached.rows.map(r => r.code), cached.pickers_in_dive]).toEqual(['9901', ['010101001'], true])
      expect([called, bar.controls.map(control => [control.sets, control.options.length])]).toEqual([
        [{ url: 'https://api.motherduck.com/v1/dives/made-up-picked-dive/embed-session',
          body: { username: 'svc-made-up', initial_state: { reach: { 9901: ['010101001'] }, store: '9901', month: 'last' } } }],
        [['store', 0], ['month', 0]]])
    })

    test('never calls MotherDuck for a refused report', async ({ admin, createUser }) => {
      const { leader } = await setup(admin, createUser)
      const called = await opening(admin)
      expect(await leader.post('/api/app_reads/dash/embed_session', { payload: { report: 'store_target' } })).toEqual({ result: { refused: 'whole_stores_only' } })
      expect(called).toEqual([])
    })
  })

  test('say the Dive is not set up while the instance has no service account setting, so the page shows the quick view', async ({ admin, createUser }) => {
    const { leader } = await setup(admin, createUser)
    expect(await leader.post('/api/app_reads/dash/embed_session', { payload: { store: '9901' } })).toEqual({ result: { not_set_up: true } })
  })

  test('answer "not set up" to every read while the MotherDuck token is missing', async ({ admin, createUser }) => {
    const { leader } = await setup(admin, createUser)
    await withNamedVariable('MOTHERDUCK_TOKEN', undefined, async () => {
      await expect(report(leader)).rejects.toMatchObject({ status: 409 })
    })
  })

  test('record each opening of the report in the Access Log', async ({ admin, createUser }) => {
    const { leader } = await setup(admin, createUser)
    await report(leader)
    const [logged] = await sql`select ref_table, method from access_log where "user" = ${leader.user} and operation = 'view_report'`
    expect(logged).toMatchObject({ ref_table: 'dash.sales_to_date', method: 'cached' })
  })
})

// The old report's checks (featherbase sales-target-mtd.ts `validate`), declared as the
// dataset's guard: a refresh with no target at all, or with under half the targets of the active
// snapshot, is a failed or partial upstream build, so the last good snapshot keeps serving. The
// drops compare within one period_start (featherbase #676), as the old check did by keying its
// snapshots by month; the total catches a mart rebuilt for only some days.
describe("a refresh of the sales figures, checked like the old report's", () => {
  const SALES = 'dash.sales_to_date'
  beforeEach(openWarehouse)
  afterEach(closeWarehouse)

  /** The store's figures, refreshed from a warehouse with four targets. */
  async function goodSnapshot(admin: TestClient, createUser: CreateUserFn) {
    const people = await setup(admin, createUser)
    await fillWarehouse(FOUR_TARGETS)
    const good = await buildSnapshot(SALES)
    expect(good).toMatchObject({ status: 'activated' })
    return { ...people, good }
  }

  test('keeps serving the last good snapshot when every target of a refresh is empty or zero', async ({ admin, createUser }) => {
    const { manager, good } = await goodSnapshot(admin, createUser)
    const served = await report(manager)
    await fillWarehouse({ '010101001': 0, '010101003': null, '010909001': 0, '010303001': null })
    expect(await buildSnapshot(SALES)).toMatchObject({ status: 'refused', reason: 'sales_to_date: every target value is empty or zero (4 rows)' })
    expect([(await activeSnapshot(SALES))?.row_id, await report(manager)]).toEqual([good.snapshotId, served])
  })

  test("fails the refresh job with the guard's reason when no target arrives", async ({ admin, createUser }) => {
    await loadJobs()
    await goodSnapshot(admin, createUser)
    await fillWarehouse({ '010101001': null, '010101003': null, '010909001': null, '010303001': null })
    await enqueue('refresh_datasets')
    await sql`update background_job set run_at = now() where method = 'refresh_datasets' and job_status = 'queued'`
    await drainJobs()
    const [run] = await sql`select outcome, error from job_execution where method = 'refresh_datasets'`
    expect([run.outcome, run.error]).toEqual(['error', expect.stringContaining(
      'dash.sales_to_date: refused — sales_to_date: every target value is empty or zero (4 rows)')])
  })

  // The dataset's definition does not change with the month, so the first refresh of a month is
  // compared with last month's snapshot. A month that starts with fewer targeted subcategories is
  // still a complete month, and must replace last month's figures (Codex round 1 on #4450).
  test("activates this month's first refresh against last month's snapshot, however few its targets", async ({ admin, createUser }) => {
    const lastMonth = new Date(Date.UTC(Number(periodStart.slice(0, 4)), Number(periodStart.slice(5, 7)) - 2, 1)).toISOString().slice(0, 10)
    const ofLastMonth = (row: Record<string, unknown>) => ({ ...row, period_start: lastMonth, data_through: periodStart })
    const { manager } = await setup(admin, createUser, Object.entries(FOUR_TARGETS).map(([code, target]) =>
      ofLastMonth(salesRow('9901', code, 'Lakeside', target, 100))))
    await fillWarehouse({ '010101001': 1000, '010101003': null, '010909001': null, '010303001': null })
    expect(await buildSnapshot(SALES)).toMatchObject({ status: 'activated' })
    expect((await report(manager)).state).toBe('ready')
  })

  test('keeps the last good snapshot when the targeted subcategories drop by more than half within the month', async ({ admin, createUser }) => {
    const { good } = await goodSnapshot(admin, createUser)
    await fillWarehouse({ '010101001': 1000, '010101003': null, '010909001': 0, '010303001': null })
    expect(await buildSnapshot(SALES)).toMatchObject({ status: 'refused', reason: 'sales_to_date: target values dropped 75% (4 → 1), limit 50%' })
    expect((await activeSnapshot(SALES))?.row_id).toBe(good.snapshotId)
  })

  test('activates a refresh whose targeted subcategories drop by exactly half within the month', async ({ admin, createUser }) => {
    await goodSnapshot(admin, createUser)
    await fillWarehouse({ '010101001': 1000, '010101003': 500, '010909001': null, '010303001': null })
    const next = await buildSnapshot(SALES)
    expect([next.status, (await activeSnapshot(SALES))?.row_id]).toEqual(['activated', next.snapshotId])
  })

  // A mart rebuilt for only some days: every subcategory keeps a target, so the count holds,
  // but the month's summed target collapses.
  test("keeps the last good snapshot when the month's total target drops by more than half", async ({ admin, createUser }) => {
    const { good } = await goodSnapshot(admin, createUser)
    await fillWarehouse({ '010101001': 300, '010101003': 150, '010909001': 60, '010303001': 30 })
    expect(await buildSnapshot(SALES)).toMatchObject({ status: 'refused', reason: 'sales_to_date: target total dropped 70% (1,800 → 540), limit 50%' })
    expect((await activeSnapshot(SALES))?.row_id).toBe(good.snapshotId)
  })

  // The old report counted target day rows. A rebuild that loses most of them can keep every
  // targeted subcategory and most of the amount; `target_days`, summed, is that old count (#4449).
  const SIX_ZERO_TARGETS = Object.fromEntries(['010505001', '010505002', '010505003', '010505004', '010505005', '010505006'].map(code => [code, 0]))
  const SIX_LOST = Object.fromEntries(Object.keys(SIX_ZERO_TARGETS).map(code => [code, null]))

  test('keeps the last good snapshot when more than half the target days are lost, though the targeted subcategories and the total hold', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    await fillWarehouse({ ...FOUR_TARGETS, ...SIX_ZERO_TARGETS })
    const good = await buildSnapshot(SALES)
    await fillWarehouse({ ...FOUR_TARGETS, ...SIX_LOST })
    expect(await buildSnapshot(SALES)).toMatchObject({ status: 'refused', reason: 'sales_to_date: target_days total dropped 60% (10 → 4), limit 50%' })
    expect((await activeSnapshot(SALES))?.row_id).toBe(good.snapshotId)
  })

  test('activates a refresh that keeps its target days and its total target', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    await fillWarehouse({ ...FOUR_TARGETS, ...SIX_ZERO_TARGETS })
    await buildSnapshot(SALES)
    await fillWarehouse({ ...FOUR_TARGETS, '010101001': 1100, ...SIX_ZERO_TARGETS })
    const next = await buildSnapshot(SALES)
    expect([next.status, (await activeSnapshot(SALES))?.row_id]).toEqual(['activated', next.snapshotId])
  })

  // Codex's case: uneven daily targets (festivals, weekdays). A rebuild keeps the three
  // high-target days of ten in Silk sarees and loses seven low ones: 7 of the store's 13 target
  // day rows, but under a tenth of the amount, and every subcategory keeps a target. It needs
  // ten days of the month behind it, so it runs from the 10th.
  test.skipIf(Number(today.slice(8, 10)) < 10)('keeps the last good snapshot when a rebuild keeps only the high-target days', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    const low = Array<number>(7).fill(50)
    await fillWarehouse({ ...FOUR_TARGETS, '010101001': [1000, 1000, 1000, ...low] })
    const good = await buildSnapshot(SALES)
    expect(good).toMatchObject({ status: 'activated' })
    await fillWarehouse({ ...FOUR_TARGETS, '010101001': [1000, 1000, 1000, ...low.map(() => null)] })
    expect(await buildSnapshot(SALES)).toMatchObject({ status: 'refused', reason: 'sales_to_date: target_days total dropped 53.8% (13 → 6), limit 50%' })
    expect((await activeSnapshot(SALES))?.row_id).toBe(good.snapshotId)
  })

  test('refuses a refresh whose rows carry no period_start', async ({ admin, createUser }) => {
    const { good } = await goodSnapshot(admin, createUser)
    await fillWarehouse(FOUR_TARGETS)
    answerWithoutPeriod()
    expect(await buildSnapshot(SALES)).toMatchObject({ status: 'refused',
      reason: 'sales_to_date: period_start holds 0 values and 4 empty, but target is compared within one period_start' })
    expect((await activeSnapshot(SALES))?.row_id).toBe(good.snapshotId)
  })

  test('activates a refresh with every target present', async ({ admin, createUser }) => {
    await goodSnapshot(admin, createUser)
    await fillWarehouse({ ...FOUR_TARGETS, '010101001': 1200 })
    const next = await buildSnapshot(SALES)
    expect([next.status, (await activeSnapshot(SALES))?.row_id]).toEqual(['activated', next.snapshotId])
  })
})

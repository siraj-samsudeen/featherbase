// Dash's report reads on the real platform: the reader's places come from the app's own scope
// provider, and the platform hands them to the read. Dash copies no figures into Featherbase
// (#1366): the Dive reads the warehouse itself, and opening it writes the Access Log row.
// MotherDuck's embed API is played by a stand-in. Made-up stores 9901 and 9902, and people.
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { afterEach, describe, expect, vi } from 'vitest'
import { test as pgTest } from '../pg-test'
import { invalidateSources } from '../../src/sources/registry'
import { withNamedVariable } from '../../src/env'
import { sql } from '../../src/db'
import { ACCESS_ROWS, REPORT_ROWS, createCoreTables, installApp, pinned, saveRow } from './helpers'

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

/** The instance's `motherduck` Data Source, which Dash's one dataset (the organisation's Dives) names. */
const addSource = (admin: TestClient) =>
  admin.post('/api/table/Data%20Source', { row_id: 'motherduck', engine: 'duckdb', url_env: 'DASH_TEST_DUCKDB', access: 'read_only' })

async function setup(admin: TestClient, createUser: CreateUserFn) {
  await installApp(admin)
  await createCoreTables(admin)
  invalidateSources()
  // The instance's MotherDuck source, played by a local DuckDB path: the platform
  // accepts it as read-only. The report reads never query it.
  await addSource(admin)
  const user = async (name: string) => createUser({ email: `${name}@example.test`, roles: [READER] })
  const people = { manager: await user('p-101'), leader: await user('p-103'), nobody: await user('p-999'), headOffice: await user('p-998') }
  const save = (table: string, row: Record<string, unknown>) => saveRow(admin, table, row)
  for (const region of ['East', 'West']) await save('Operating Region', { region })
  for (const [code, name, operating_region] of [['LKS', 'Lakeside', 'East'], ['HIL', 'Hillview', 'East'], ['RIV', 'Riverside', 'West']]) await save('Site', { code, name, is_store: true, operating_region })
  await save('Site', { code: 'HOF', name: 'Head Office', is_store: false, operating_region: 'East' })
  await save('Plant', { plant_code: '9901', plant_type: 'Store', site: 'LKS' })
  await save('Plant', { plant_code: '9902', plant_type: 'Store', site: 'HIL' })
  await save('Plant', { plant_code: '9903', plant_type: 'Store', site: 'RIV' })
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
  return { ...people, save }
}

type Answer = { state: string; heading?: { name: string | null }; period_start?: string; period_end?: string; pickers_in_dive?: boolean }
const report = (client: TestClient, payload: Record<string, unknown> = { store: '9901' }) =>
  client.post<{ result: Answer }>('/api/app_reads/dash/report', { payload }).then(a => a.result)

describe('the report reads on the platform', () => {
  // #1366: the report read answers that the report opens, its period and its header; it reads no copy.
  test("open a Store Manager's store, with this month's period", async ({ admin, createUser }) => {
    const { manager } = await setup(admin, createUser)
    expect(await report(manager)).toEqual({ state: 'ready', period_start: periodStart, period_end: today,
      heading: { name: 'Lakeside', sections: [], reasons: [{ basis: 'store_manager', sections: [] }] } })
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

  // #1192: Dash All-Stores Reader reaches every store of the holder's region (#1458), through the platform's own scope.
  test("open every store of their region for a head-office holder of Dash All-Stores Reader, no other region's, and refuse a plain head-office reader", async ({ admin, createUser }) => {
    const { headOffice, save } = await setup(admin, createUser)
    const holder = await createUser({ email: 'p-997@example.test', roles: [READER, 'Dash All-Stores Reader'] })
    await save('Employee', { employee_code: '997', name: 'Made-up Data Steward', person: holder.user, status: 'Current' })
    await save('Job Assignment', { assignment_id: 'JA-997', employee: '997', job: 'Head office staff', site: 'HOF', starts_on: '2026-01-01' })
    const read = (client: TestClient, store: string) => client.fetch('/api/app_reads/dash/report', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payload: { store } }) })
    const lakeside = await read(holder, '9901')
    const body = await lakeside.json() as { result: { state: string; heading: unknown } }
    expect([lakeside.status, body.result.state]).toEqual([200, 'ready'])
    expect(body.result.heading).toEqual({ name: 'Lakeside', sections: [], reasons: [{ basis: 'all_stores_reader', sections: [] }] })
    expect((await report(holder, { store: '9902' })).heading?.name).toBe('Hillview')
    await expect(report(holder, { store: '9903' })).rejects.toMatchObject({ status: 417 })
    expect((await holder.post<{ result: unknown }>('/api/app_reads/dash/reach_problem', { payload: {} })).result).toEqual({ problems: [] })
    expect((await read(headOffice, '9901')).status).toBe(403)
    expect((await headOffice.post<{ result: unknown }>('/api/app_reads/dash/reach_problem', { payload: {} })).result).toEqual({ problems: ['head_office'] })
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

  // #750: last month whole.
  test("open last month whole for a Team Leader", async ({ admin, createUser }) => {
    const { leader } = await setup(admin, createUser)
    const answer = await report(leader, { store: '9901', month: 'last' })
    expect([answer.state, answer.period_start, answer.period_end]).toEqual(['ready', lastMonthStart, lastMonthEnd])
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

    test('without the embed token, only the Dive is not set up: the report read still answers on the warehouse token', async ({ admin, createUser }) => {
      const { leader } = await setup(admin, createUser)
      const called = await opening(admin)
      await withNamedVariable('MOTHERDUCK_EMBED_TOKEN', undefined, async () => {
        await expect(leader.post('/api/app_reads/dash/embed_session', { payload: { report: 'sales', store: '9901' } })).rejects.toMatchObject({ status: 409 })
        expect((await report(leader)).state).toBe('ready')
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
        .toEqual({ result: { state: 'ready', heading: { name: null, sections: [], reasons: [] } } })
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
        month_key: 'period_end', pickers_in_dive: true })
      await saveRow(admin, 'dash.report_access', { report: 'picked', role: 'Dash Reader' })
      const called = await opening(admin)
      await leader.post('/api/app_reads/dash/embed_session', { payload: { report: 'picked', store: '9901', month: 'last' } })
      const bar = await leader.get<{ controls: { sets: string; options: unknown[] }[] }>('/api/app_bar/dash?report=picked')
      // With no store named, the page is headed with the reader's first store A–Z.
      const opened = await report(leader, { report: 'picked' })
      expect([opened.heading?.name, opened.pickers_in_dive]).toEqual(['Lakeside', true])
      expect([called, bar.controls.map(control => [control.sets, control.options.length])]).toEqual([
        [{ url: 'https://api.motherduck.com/v1/dives/made-up-picked-dive/embed-session',
          body: { username: 'svc-made-up', initial_state: { reach: { 9901: ['010101001'] }, store: '9901', month: 'last' } } }],
        [['store', 0], ['month', 0]]])
    })

    // #1366: every report's open is one Access Log row, whichever report and however it opens;
    // the report read itself, and a refused open, record nothing.
    test('record one Access Log view for each report opened, and none for a refused one', async ({ admin, createUser }) => {
      const { leader, headOffice } = await setup(admin, createUser)
      await saveRow(admin, 'dash.report', { report_key: 'open', report_name: 'Open to anyone given it', dive_id: 'made-up-open-dive', filter_shape: 'No filter' })
      await saveRow(admin, 'dash.report_access', { report: 'open', role: 'Dash Reader' })
      await opening(admin)
      const views = (client: TestClient) => sql`select ref_table, reference_name, method, scope from access_log
        where "user" = ${client.user} and operation = 'view_report' order by created_at, ref_table`.then(rows => rows.map(r => ({ ...r })))
      await report(leader, { report: 'sales', store: '9901' })
      expect(await views(leader)).toEqual([])
      await leader.post('/api/app_reads/dash/embed_session', { payload: { report: 'sales', store: '9901' } })
      await leader.post('/api/app_reads/dash/embed_session', { payload: { report: 'vendor_sales' } })
      await leader.post('/api/app_reads/dash/embed_session', { payload: { report: 'store_target' } })
      await headOffice.post('/api/app_reads/dash/embed_open', { payload: { report: 'open' } })
      const opened = { ref_table: 'dash.embed_session', reference_name: null, method: null, scope: expect.stringContaining('Sarees') }
      expect([await views(leader), await views(headOffice)])
        .toEqual([[opened, opened], [{ ref_table: 'dash.embed_open', reference_name: null, method: null, scope: null }]])
    })

    test('never calls MotherDuck for a refused report', async ({ admin, createUser }) => {
      const { leader } = await setup(admin, createUser)
      const called = await opening(admin)
      expect(await leader.post('/api/app_reads/dash/embed_session', { payload: { report: 'store_target' } })).toEqual({ result: { refused: 'whole_stores_only' } })
      expect(called).toEqual([])
    })
  })

  test("say the Dive is not set up while the instance has no service account setting, so the page says it couldn't open", async ({ admin, createUser }) => {
    const { leader } = await setup(admin, createUser)
    expect(await leader.post('/api/app_reads/dash/embed_session', { payload: { store: '9901' } })).toEqual({ result: { not_set_up: true } })
  })

  test('answer "not set up" to every read while the MotherDuck token is missing', async ({ admin, createUser }) => {
    const { leader } = await setup(admin, createUser)
    await withNamedVariable('MOTHERDUCK_TOKEN', undefined, async () => {
      await expect(report(leader)).rejects.toMatchObject({ status: 409 })
    })
  })

})

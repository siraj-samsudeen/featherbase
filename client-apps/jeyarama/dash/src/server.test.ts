// Dash's reads over a stand-in for what the platform hands a read handler (the reader's places, the
// cached dataset, the report rows, the core Tables, settings, secrets, recordView), and a stand-in
// for MotherDuck's embed API (the network boundary). Made-up stores, people and figures.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMBED_API_TIMEOUT_MS, LAST_MONTH_DATASET, LAST_SALES_DATASET, MONTH_DATASET, appOrigin, reads, setEmbedFetch, SALES_DATASET } from './server'
import type { Place } from './provider.ts'
import type { SalesRow } from './report.ts'

const AT = '2026-10-15T00:19:00.000Z'
const place = (label: string, store: string, subcategory?: string[]): Place =>
  ({ label, filters: subcategory ? { store: [store], subcategory } : { store: [store] } })
const row = (store: string, code: string, name: string | null = 'Lakeside'): SalesRow => ({
  store_code: store, store_name: name, short_code: null, subcategory_code: code, subcategory: `Name ${code}`, target: 1000, actual: 800,
  days_with_actual: 14, days: 15, period_start: '2026-10-01', data_through: '2026-10-14', targets_available: true, target_days: 15,
  target_quantity: 10, actual_quantity: 8 })

type Row = Record<string, unknown>
/** The three made-up Dives, each taking a different shape of filters. */
const SALES = { report_key: 'sales', report_name: 'Sales versus target', dive_id: 'dive-sales', filter_shape: 'One store and subcategories', store_key: 'plant_code',
  subcategory_key: 'material_groups', whole_store_key: 'whole_store', month_key: 'period_end', ready_signal: 0, quick_view: 'Sales target' }
const WHOLE = { report_key: 'whole', report_name: 'Store target month to date', dive_id: 'dive-whole', filter_shape: 'Whole stores', store_key: 'plant_codes',
  subcategory_key: null, whole_store_key: null, month_key: null, ready_signal: 0, quick_view: null }
const VENDORS = { report_key: 'vendors', report_name: 'Vendor sales by city', dive_id: 'dive-vendors', filter_shape: 'Stores and subcategories', store_key: 'reach',
  subcategory_key: null, whole_store_key: null, month_key: null, ready_signal: 0, quick_view: null }

/** The platform's table reads: the filters and paging `list` is given, over in-memory rows. */
function reader(tables: Record<string, Row[]>, throws: boolean | string[] = false) {
  return {
    async list(table: string, args: { filters?: [string, string, unknown][]; order_by?: string; limit_start?: number; limit_page_length?: number }) {
      if (throws === true || (Array.isArray(throws) && throws.includes(table))) throw new Error('not set up')
      const found = (tables[table] ?? []).filter(r => (args.filters ?? []).every(([column, op, value]) => (op === 'in' ? (value as unknown[]).includes(r[column]) : op === 'like' ? String(r[column]).includes(String(value).replaceAll('%', '')) : r[column] === value)))
      const start = args.limit_start ?? 0
      return found.slice(start, start + (args.limit_page_length ?? 500))
    },
  }
}
const STORES = {
  Plant: [{ row_id: '9901', site: 'LKS', plant_type: 'Store' }, { row_id: '9902', site: 'HLV', plant_type: 'Store' }],
  Site: [{ row_id: 'LKS', name: 'Lakeside', is_store: true, cluster: null }, { row_id: 'HLV', name: 'Hillview', is_store: true, cluster: null }],
}

interface Options {
  places?: Place[]
  rows?: SalesRow[] | null
  payload?: Record<string, unknown>
  settings?: Record<string, string>
  /** The cache read throws (its source is not set up, say). */
  cacheThrows?: boolean
  /** What a live read of the dataset answers: the warehouse, as the platform limits it to the reader's places. */
  live?: SalesRow[]
  /** The month's metadata rows (`sales_month`); none when it isn't built. */
  month?: Record<string, unknown>[] | null
  /** The rows of `dash.report`. */
  reports?: Row[]
  /** The core Tables as the app's base Table reads see them. */
  core?: Record<string, Row[]>
  /** Every core Table read throws, or only these. */
  coreThrows?: boolean | string[]
  /** The secrets the platform hands the read: both MotherDuck tokens, unless a test says otherwise. */
  secrets?: Record<string, string>
}
const DIVE = { embed_service_account: 'svc-made-up' }
/** The warehouse token every read uses, and the separate one only the embed call uses (#1139). */
const TOKENS = { MOTHERDUCK_TOKEN: 'token-made-up', MOTHERDUCK_EMBED_TOKEN: 'embed-token-made-up' }

function context({ places = [place('9901 / Section: Sarees', '9901', ['010101001'])], rows = [row('9901', '010101001')], payload = {}, settings = DIVE,
  cacheThrows = false, live = [], month = null, reports = [SALES], core = STORES, coreThrows = false, secrets = TOKENS }: Options = {}) {
  const views: unknown[] = []
  const asked: unknown[] = []
  return {
    views, asked,
    ctx: {
      user: 'psn_103', payload, settings, secrets,
      authorization: { places },
      roles: ['Dash Reader'],
      documents: reader({ 'dash.report': reports }),
      // #1046: every report given to everyone holding Dash Reader, unless a test says otherwise.
      baseTables: reader({ 'dash.report_access': reports.map(r => ({ row_id: `a-${String(r.report_key)}`, report: r.report_key, role: 'Dash Reader' })),
        'dash.report_bundle_member': [], ...core }, coreThrows),
      reject(message: string): never { throw new Error(message) },
      datasets: {
        async active(name: string, filters?: Record<string, unknown>) {
          asked.push([name, filters])
          if (cacheThrows) throw new Error('not set up')
          if (name === MONTH_DATASET || name === LAST_MONTH_DATASET) return month && { dataset: name, served: 'cached', at: AT, rows: month }
          if (rows === null) return null
          const store = filters?.store_code
          return { dataset: name, served: 'cached', at: AT, rows: store ? rows.filter(r => r.store_code === store) : rows }
        },
        async live(name: string, filters?: Record<string, unknown>) {
          asked.push(['live', name, filters])
          return { dataset: name, served: 'live', at: AT, rows: live.filter(r => r.store_code === filters?.store_code) }
        },
      },
      async recordView(details: unknown) { views.push(details) },
    },
  }
}
type Context = ReturnType<typeof context>['ctx']

/**
 * An outbound read as the platform runs it: `prepare` in the transaction, then the handler with what
 * it read, and no Table left to read.
 */
async function embedSession(ctx: Context) {
  const prepared = await reads.embed_session.prepare(ctx)
  const { documents: _documents, baseTables: _baseTables, ...handed } = ctx
  return reads.embed_session({ ...handed, prepared })
}

// The fixtures are October 2026's: the reads work out the month from the clock, so it is frozen
// on a day of that month (only Date is faked; promises and timers run as usual).
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T06:00:00Z'))
})
afterEach(() => {
  setEmbedFetch(null)
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('a report taking no filter', () => {
  const OPEN = { report_key: 'open', report_name: 'Open', dive_id: 'dive-open', filter_shape: 'No filter', store_key: null, subcategory_key: null, whole_store_key: null, month_key: null, ready_signal: 0, quick_view: null }
  const noReach = { 'Employee': [], ...STORES }
  const nobody = (over: Options) => { const made = context({ reports: [SALES, WHOLE, VENDORS, OPEN], core: noReach, ...over }); (made.ctx.authorization as { places?: unknown }).places = undefined; return made }
  let posted: { url: string; body: unknown }[]
  beforeEach(() => {
    posted = []
    setEmbedFetch((async (url: string, init: RequestInit) => {
      posted.push({ url, body: JSON.parse(String(init.body)) })
      return new Response(JSON.stringify({ session: 's' }), { status: 200 })
    }) as unknown as typeof fetch)
  })
  afterEach(() => setEmbedFetch(null))

  it('is the only report offered to someone whose job reaches nothing', async () => {
    const answer = await reads.reports(nobody({}).ctx) as { key: string; no_filter: boolean }[]
    expect(answer.map(r => [r.key, r.no_filter])).toEqual([['open', true]])
  })

  it('opens for them with empty filters', async () => {
    const { ctx } = nobody({ payload: { report: 'open' } })
    const prepared = await reads.embed_open.prepare(ctx)
    expect(await reads.embed_open({ ...ctx, prepared })).toMatchObject({ frame: expect.any(String) })
    expect(posted).toEqual([{ url: expect.stringContaining('/dives/dive-open/'), body: { username: 'svc-made-up', initial_state: {} } }])
  })

  it('no store-filtered report opens through these reads, even for someone with reach', async () => {
    for (const key of ['sales', 'whole', 'vendors']) {
      const { ctx } = context({ reports: [SALES, WHOLE, VENDORS, OPEN], payload: { report: key }, places: [place('9901', '9901')] })
      const prepared = await reads.embed_open.prepare(ctx)
      expect(await reads.embed_open({ ...ctx, prepared })).toEqual({ refused: 'no_access' })
      expect(await reads.report_open(ctx)).toEqual({ state: 'no_access' })
    }
    expect(posted).toEqual([])
  })

  it('a store-filtered report is not theirs to name', async () => {
    const { ctx } = nobody({ payload: { report: 'sales' } })
    expect(await reads.embed_open.prepare(ctx)).toBeNull()
    expect(await reads.report_open(ctx)).toEqual({ state: 'no_access' })
  })
})

describe('the me read', () => {
  it("answers the caller's user name", () => {
    expect(reads.me({ user: 'manager@example.com' })).toEqual({ user: 'manager@example.com' })
  })
})

describe('the ready-message origin', () => {
  it('refuses malformed origins', () => {
    expect(appOrigin('not an origin')).toBeNull()
    expect(appOrigin('https://dash.example.test')).toBe('https://dash.example.test')
    expect(appOrigin('https://dash.example.test/report')).toBeNull()
  })
})

// A person's job, in the core Tables the provider reads.
const jobOf = (job: Record<string, unknown>) => ({
  ...STORES,
  Employee: [{ row_id: 'E1', person: 'psn_103', status: 'Current' }],
  'Job Assignment': [{ row_id: 'J1', employee: 'E1', site: 'LKS', floor: null, section: null, acting: 0, starts_on: '2026-01-01', ends_on: null, ...job }],
  Section: [],
  'Section Subcategory': [],
})

describe("the reports read (Dash's sidebar)", () => {
  const ALL = [SALES, WHOLE, VENDORS]

  it('lists every report by name, saying which takes a store and which a month', async () => {
    const { ctx } = context({ places: [], reports: ALL, core: jobOf({ job: 'Store Manager' }) })
    expect(await reads.reports(ctx)).toEqual([
      { key: 'sales', name: 'Sales versus target', takes_store: true, takes_month: true, no_filter: false },
      { key: 'whole', name: 'Store target month to date', takes_store: false, takes_month: false, no_filter: false },
      { key: 'vendors', name: 'Vendor sales by city', takes_store: false, takes_month: false, no_filter: false },
    ])
  })

  it("doesn't offer a whole-stores report to someone without a whole store (#967 point 1)", async () => {
    const { ctx } = context({ reports: ALL })
    expect((await reads.reports(ctx)).map(report => report.key)).toEqual(['sales', 'vendors'])
  })

  it.each([
    ['Head office staff', { job: 'Head office staff' }],
    ['Staff with no section', { job: 'Staff' }],
    ['a Department Manager, until departments are filled', { job: 'Department Manager' }],
  ])('answers nothing for %s, whose job reaches nothing', async (_who, job) => {
    const { ctx } = context({ reports: ALL, core: jobOf(job), places: [] })
    expect(await reads.reports(ctx)).toEqual([])
  })

  it('answers nothing for someone with no job at all', async () => {
    const { ctx } = context({ reports: ALL, core: { ...STORES, Employee: [] }, places: [] })
    expect(await reads.reports(ctx)).toEqual([])
  })

  it('answers only a report taking no filter when the reader\'s reach can\'t be read', async () => {
    const OPEN = { ...SALES, report_key: 'open', report_name: 'Open', filter_shape: 'No filter', store_key: null, subcategory_key: null, whole_store_key: null, month_key: null, quick_view: null }
    const { ctx } = context({ reports: [...ALL, OPEN], core: jobOf({ job: 'Store Manager' }), coreThrows: ['Site'], places: [] })
    expect((await reads.reports(ctx)).map(r => r.key)).toEqual(['open'])
  })

  it('answers nothing, never an error, when the core Tables can\'t be read yet', async () => {
    const { ctx } = context({ reports: ALL, coreThrows: true, places: [] })
    expect(await reads.reports(ctx)).toEqual([])
  })
})

describe('the reach_problem read', () => {
  it.each([
    [{ job: 'Head office staff' }, ['head_office']],
    [{ job: 'Staff' }, ['no_section']],
    [{ job: 'Department Manager' }, ['departments_not_filled']],
    [{ job: 'Store Manager' }, []],
  ])('says why a job reaches nothing: %j', async (job, problems) => {
    const { ctx } = context({ core: jobOf(job) })
    expect(await reads.reach_problem(ctx)).toEqual({ problems })
  })
})

describe("the stores read (the bar's store picker)", () => {
  const TWO = [place('9902', '9902'), place('9901 / Section: Sarees', '9901', ['010101001'])]
  const SAME_NAME = { Plant: STORES.Plant, Site: STORES.Site.map(site => ({ ...site, name: 'Lakeside' })) }

  it("offers each of the reader's stores from their places, named from the core Tables, A–Z by name (#1153)", async () => {
    const { ctx } = context({ places: TWO })
    expect(await reads.stores(ctx)).toEqual([{ value: '9902', label: 'Hillview' }, { value: '9901', label: 'Lakeside' }])
  })

  // #1153: the picker shows no codes, so an order by code looked random.
  it('orders the stores A–Z by name, whatever their codes', async () => {
    const names = [['9901', 'Marthandam'], ['9902', 'kattakada'], ['9903', 'Attingal'], ['9904', 'Nagercoil']]
    const core = { Plant: names.map(([code]) => ({ row_id: code, site: `S${code}`, plant_type: 'Store' })),
      Site: names.map(([code, name]) => ({ row_id: `S${code}`, name, is_store: true, cluster: null })) }
    const { ctx } = context({ places: names.map(([code]) => place(code, code)), core })
    expect((await reads.stores(ctx)).map(option => option.label)).toEqual(['Attingal', 'kattakada', 'Marthandam', 'Nagercoil'])
  })

  it('never reads the cached figures, so a failing cache leaves the picker whole', async () => {
    const { ctx, asked } = context({ places: TWO, cacheThrows: true })
    expect(await reads.stores(ctx)).toEqual([{ value: '9902', label: 'Hillview' }, { value: '9901', label: 'Lakeside' }])
    expect(asked).toEqual([])
  })

  it('offers every store by its place in the list, never its plant code, when the core Tables name none (#4531)', async () => {
    const { ctx } = context({ places: TWO, core: { Plant: [], Site: [] } })
    expect(await reads.stores(ctx)).toEqual([{ value: '9901', label: 'Store 1' }, { value: '9902', label: 'Store 2' }])
  })

  it('names a store the same for a reader with no cached figures', async () => {
    const { ctx } = context({ rows: null })
    expect(await reads.stores(ctx)).toEqual([{ value: '9901', label: 'Lakeside' }])
  })

  it('offers a lone store as "Your store", never its plant code, when the core Tables name none (#4531)', async () => {
    const { ctx } = context({ core: { Plant: [], Site: [] } })
    expect(await reads.stores(ctx)).toEqual([{ value: '9901', label: 'Your store' }])
  })

  it('numbers two stores of one name', async () => {
    const { ctx } = context({ places: TWO, core: SAME_NAME })
    expect(await reads.stores(ctx)).toEqual([{ value: '9901', label: 'Lakeside (1)' }, { value: '9902', label: 'Lakeside (2)' }])
  })

  it('keeps every store when the cached figures fail while telling stores apart', async () => {
    const { ctx } = context({ places: TWO, core: SAME_NAME, cacheThrows: true })
    expect(await reads.stores(ctx)).toEqual([{ value: '9901', label: 'Lakeside (1)' }, { value: '9902', label: 'Lakeside (2)' }])
  })

  it.each([['a report taking whole stores', 'whole'], ['a report taking stores and subcategories', 'vendors'], ['a report that does not exist', 'nope']])(
    'offers none on %s', async (_what, key) => {
      const { ctx } = context({ places: TWO, reports: [SALES, WHOLE, VENDORS], payload: { report: key } })
      expect(await reads.stores(ctx)).toEqual([])
    })

  it('follows the report named, not the first', async () => {
    const { ctx } = context({ places: TWO, reports: [WHOLE, SALES], payload: { report: 'sales' } })
    expect((await reads.stores(ctx)).map(option => option.value)).toEqual(['9902', '9901'])
  })
})

describe('the report read', () => {
  it("answers the chosen store's report", async () => {
    const { ctx } = context({ payload: { store: '9901' } })
    expect(await reads.report(ctx)).toMatchObject({ state: 'ready', store: '9901', rows: [{ code: '010101001', section: 'Sarees' }] })
  })

  it("answers the reader's first store when none is chosen", async () => {
    const { ctx } = context({ places: [place('9902 / Section: Belts', '9902', ['010404001']), place('9901 / Section: Sarees', '9901', ['010101001'])] })
    expect((await reads.report(ctx) as { store: string }).store).toBe('9901')
  })

  it('reads only the chosen store from the cached dataset', async () => {
    const { ctx, asked } = context({ payload: { store: '9901' } })
    await reads.report(ctx)
    expect(asked).toEqual([[SALES_DATASET, { store_code: '9901' }], [MONTH_DATASET, { store_code: '9901' }]])
  })

  it("refuses a store that is not one of the reader's", async () => {
    const { ctx } = context({ payload: { store: '9909' } })
    await expect(reads.report(ctx)).rejects.toThrow(/not one of your stores/)
  })

  it("answers a quiet section as ready from the month's metadata, the Dive allowed", async () => {
    const month = [{ store_code: '9901', subcategory_code: '010101001', period_start: '2026-10-01', data_through: '2026-10-14', targets_available: true }]
    const { ctx } = context({ payload: { store: '9901' }, rows: [], month })
    expect(await reads.report(ctx)).toMatchObject({ state: 'ready', rows: [{ code: '010101001', target: 0, actual: 0, targetRecorded: false, salesRecorded: false }] })
  })

  it('records who viewed the report', async () => {
    const { ctx, views } = context({ payload: { store: '9901' } })
    await reads.report(ctx)
    expect(views).toEqual([{ dataset: SALES_DATASET }])
  })

  it('answers no_access for a report that does not exist, reading nothing else', async () => {
    const { ctx, asked } = context({ payload: { report: 'nope', store: '9901' } })
    expect(await reads.report(ctx)).toEqual({ state: 'no_access' })
    expect(asked).toEqual([])
  })

  it('answers no_access for a one-store report when the reader has no store', async () => {
    const { ctx } = context({ places: [] })
    expect(await reads.report(ctx)).toEqual({ state: 'no_access' })
  })

  it("opens the one-store report for a Store Manager, whose place names the store and no section", async () => {
    const { ctx } = context({ places: [place('9901', '9901')], payload: { store: '9901' } })
    expect(await reads.report(ctx)).toMatchObject({ state: 'ready', rows: [{ code: '010101001', section: null }] })
  })

  it("says a whole-stores report isn't for someone without a whole store", async () => {
    const { ctx, asked } = context({ reports: [WHOLE] })
    expect(await reads.report(ctx)).toEqual({ state: 'whole_stores_only' })
    expect(asked).toEqual([])
  })

  it('says a report whose row lacks its keys is not set up', async () => {
    const { ctx } = context({ reports: [{ ...WHOLE, store_key: null }], places: [place('9901', '9901')] })
    expect(await reads.report(ctx)).toEqual({ state: 'report_not_set_up' })
  })

  it('reads no figures for a report with no quick view: it answers only that it can open, and its header', async () => {
    const { ctx, asked, views } = context({ reports: [WHOLE], places: [place('9901', '9901')] })
    expect(await reads.report(ctx)).toEqual({ state: 'ready', no_quick_view: true, heading: { name: null, sections: [], reasons: [] } })
    expect([asked, views]).toEqual([[], []])
  })

  it('names the store from the core Tables on a one-store report with no quick view', async () => {
    const { ctx } = context({ reports: [{ ...SALES, quick_view: null }], payload: { store: '9901' } })
    expect(await reads.report(ctx)).toEqual({ state: 'ready', no_quick_view: true, period_start: '2026-10-01', period_end: '2026-10-15',
      heading: { name: 'Lakeside', sections: ['Sarees'], reasons: [] } })
  })

  it('answers the period only on a report taking a month', async () => {
    const { ctx } = context({ reports: [{ ...VENDORS, month_key: 'period_end' }], payload: { month: 'last' } })
    expect(await reads.report(ctx)).toMatchObject({ state: 'ready', no_quick_view: true, period_start: '2026-09-01', period_end: '2026-09-30' })
  })
})

// #750: this month or last month. The clock is 15-Oct-2026, so last month is September.
describe("the months read (the bar's month picker)", () => {
  it('offers this month and last month, each named by its month', async () => {
    expect(await reads.months(context().ctx)).toEqual([{ value: 'this', label: "This month · Oct'26" }, { value: 'last', label: "Last month · Sep'26" }])
  })

  it('names December of the year before in January', async () => {
    vi.setSystemTime(new Date('2027-01-01T00:30:00Z'))
    expect((await reads.months(context().ctx)).map(o => o.label)).toEqual(["This month · Jan'27", "Last month · Dec'26"])
  })

  it.each([['a report taking no month', 'whole'], ['a report that does not exist', 'nope']])('offers none on %s', async (_what, key) => {
    const { ctx } = context({ reports: [SALES, WHOLE], payload: { report: key } })
    expect(await reads.months(ctx)).toEqual([])
  })

  it("follows the first report when none is named", async () => {
    expect(await reads.months(context({ reports: [WHOLE, SALES] }).ctx)).toEqual([])
  })
})

describe('a report of last month (#750)', () => {
  const september = (store: string, code: string): SalesRow => ({ ...row(store, code), period_start: '2026-09-01', data_through: '2026-09-30', days: 30, days_with_actual: 30 })
  const lastMonth = (options: Options = {}) => context({ rows: [september('9901', '010101001')], ...options, payload: { store: '9901', month: 'last', ...options.payload } })

  it("reads last month's datasets, never this month's", async () => {
    const { ctx, asked } = lastMonth()
    await reads.report(ctx)
    expect(asked).toEqual([[LAST_SALES_DATASET, { store_code: '9901' }], [LAST_MONTH_DATASET, { store_code: '9901' }]])
  })

  it('answers the whole of last month', async () => {
    const { ctx } = lastMonth()
    expect(await reads.report(ctx)).toMatchObject({ state: 'ready', month: 'last', period_start: '2026-09-01', period_end: '2026-09-30', data_through: '2026-09-30' })
  })

  it("answers this month's datasets when the month says this", async () => {
    const { ctx, asked } = context({ payload: { store: '9901', month: 'this' } })
    expect(await reads.report(ctx)).toMatchObject({ month: 'this', period_start: '2026-10-01' })
    expect(asked.map(a => (a as unknown[])[0])).toEqual([SALES_DATASET, MONTH_DATASET])
  })

  it('records the view against the dataset it read', async () => {
    const { ctx, views } = lastMonth()
    await reads.report(ctx)
    expect(views).toEqual([{ dataset: LAST_SALES_DATASET }])
  })

  it.each([['next'], [1], [{}]])('refuses any other month (%j)', async month => {
    const { ctx } = context({ payload: { store: '9901', month } })
    await expect(reads.report(ctx)).rejects.toThrow('Choose this month or last month')
  })

  it("says last month hasn't arrived while its copy still holds the month before", async () => {
    const { ctx } = context({ rows: [row('9901', '010101001')], payload: { store: '9901', month: 'last' } })
    expect((await reads.report(ctx) as { state: string }).state).toBe('no_data_yet')
  })

  const upstream = () => {
    const calls: { init: RequestInit }[] = []
    setEmbedFetch(async (_url, init) => { calls.push({ init: init! }); return new Response(JSON.stringify({ session: 's' }), { status: 200 }) })
    return calls
  }

  it("gives the Dive last month's last day", async () => {
    const calls = upstream()
    const { ctx } = lastMonth()
    await embedSession(ctx)
    expect(JSON.parse(String(calls[0].init.body)).initial_state.period_end).toBe('2026-09-30')
  })

  it('gives the Dive today, in this month', async () => {
    const calls = upstream()
    const { ctx } = context({ payload: { store: '9901', month: 'this' } })
    await embedSession(ctx)
    expect(JSON.parse(String(calls[0].init.body)).initial_state.period_end).toBe('2026-10-15')
  })
})

describe('the embed_session read', () => {
  function upstream(answer: () => Promise<Response>) {
    const calls: { url: string; init: RequestInit }[] = []
    setEmbedFetch(async (url, init) => { calls.push({ url: String(url), init: init! }); return answer() })
    return calls
  }
  const ok = () => Promise.resolve(new Response(JSON.stringify({ session: 'session-made-up' }), { status: 200 }))
  const sentBody = (calls: { init: RequestInit }[]) => JSON.parse(String(calls[0].init.body))

  it("answers the Dive's frame address, carrying the new session", async () => {
    upstream(ok)
    const { ctx } = context({ payload: { store: '9901' } })
    expect(await embedSession(ctx)).toEqual({ frame: 'https://embed-motherduck.com/sandbox/#session=session-made-up' })
  })

  it("asks MotherDuck for a session of the report's Dive's latest version, as its service account, with the reader's state", async () => {
    const calls = upstream(ok)
    const { ctx } = context({ payload: { store: '9901' } })
    await embedSession(ctx)
    const body = sentBody(calls)
    expect([calls[0].url, Object.keys(body).sort(), body.username, body.initial_state.plant_code])
      .toEqual(['https://api.motherduck.com/v1/dives/dive-sales/embed-session', ['initial_state', 'username'], 'svc-made-up', '9901'])
  })

  it("asks with the embed token, never the warehouse token (#1139: the warehouse's read-only account can't create embed sessions)", async () => {
    const calls = upstream(ok)
    await embedSession(context({ payload: { store: '9901' } }).ctx)
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer embed-token-made-up')
  })

  it('says the Dive is not set up, and never calls MotherDuck, without the embed token', async () => {
    const calls = upstream(ok)
    const { ctx } = context({ payload: { store: '9901' }, secrets: { MOTHERDUCK_TOKEN: 'token-made-up' } })
    expect(await embedSession(ctx)).toEqual({ not_set_up: true })
    expect(calls).toEqual([])
  })

  it('opens the Dive of the report named, not the first', async () => {
    const calls = upstream(ok)
    const { ctx } = context({ reports: [SALES, VENDORS], places: [place('9901', '9901')], payload: { report: 'vendors' } })
    await embedSession(ctx)
    expect(calls[0].url).toBe('https://api.motherduck.com/v1/dives/dive-vendors/embed-session')
  })

  describe('sends exactly the filters, and nothing else (no rows, no section mapping, no cache)', () => {
    const MIXED = [place('9901', '9901'), place('9902 / Section: Belts', '9902', ['010404001']), place('9903 / Section: Sarees', '9903', ['010101001'])]
    const bodyFor = async (options: Options) => {
      const calls = upstream(ok)
      await embedSession(context(options).ctx)
      return sentBody(calls)
    }

    it('one store, for a section reader: the store, their subcategories, the last day of the month', async () => {
      expect(await bodyFor({ payload: { store: '9903' }, places: MIXED })).toEqual({ username: 'svc-made-up',
        initial_state: { plant_code: '9903', material_groups: ['010101001'], period_end: '2026-10-15' } })
    })

    it('one store, for a whole-store reader: the store, the flag, the last day of the month', async () => {
      expect(await bodyFor({ payload: { store: '9901' }, places: MIXED })).toEqual({ username: 'svc-made-up',
        initial_state: { plant_code: '9901', whole_store: true, period_end: '2026-10-15' } })
    })

    it('whole stores: only the stores the reader covers whole', async () => {
      expect(await bodyFor({ reports: [WHOLE], places: MIXED })).toEqual({ username: 'svc-made-up', initial_state: { plant_codes: ['9901'] } })
    })

    it('stores and subcategories: each store its own reach', async () => {
      expect(await bodyFor({ reports: [VENDORS], places: MIXED })).toEqual({ username: 'svc-made-up',
        initial_state: { reach: { 9901: null, 9902: ['010404001'], 9903: ['010101001'] } } })
    })
  })

  describe('a refused report never calls the embed API', () => {
    it.each<[string, Options, unknown]>([
      ['a report that does not exist', { payload: { report: 'nope' } }, { refused: 'no_access' }],
      ['a whole-stores report for someone without a whole store', { reports: [WHOLE] }, { refused: 'whole_stores_only' }],
      ['a one-store report for someone with no store', { places: [] }, { refused: 'no_access' }],
      ['a report whose row lacks its keys', { reports: [{ ...SALES, whole_store_key: null }], payload: { store: '9901' } }, { refused: 'report_not_set_up' }],
    ])('%s', async (_what, options, refusal) => {
      const calls = upstream(ok)
      expect([await embedSession(context(options).ctx), calls.length]).toEqual([refusal, 0])
    })
  })

  // The Dive posts its ready message to the page's own origin, which the page sends (#4453).
  const SAYS_READY = { ...SALES, ready_signal: 1 }
  const stateFor = async (payload: Record<string, unknown>) => {
    const calls = upstream(ok)
    await embedSession(context({ payload, reports: [SAYS_READY] }).ctx)
    return sentBody(calls).initial_state
  }

  it("gives the Dive the page's origin as `app_origin`, for its ready message", async () => {
    expect((await stateFor({ store: '9901', app_origin: 'https://dash.example.test' })).app_origin).toBe('https://dash.example.test')
  })

  it.each([['a path', 'https://dash.example.test/dash/'], ['a script address', 'javascript:alert(1)'], ['a number', 7]])(
    'gives the Dive no `app_origin` when the page sends %s', async (_what, origin) => {
      expect(await stateFor({ store: '9901', app_origin: origin })).not.toHaveProperty('app_origin')
    })

  it("asks the page to wait for the Dive's ready message when the report says its Dive sends one", async () => {
    upstream(ok)
    const { ctx } = context({ payload: { store: '9901' }, reports: [SAYS_READY] })
    expect(await embedSession(ctx)).toEqual({ frame: 'https://embed-motherduck.com/sandbox/#session=session-made-up', ready_signal: true })
  })

  it.each<[string, Options]>([
    ['the service account setting', { settings: {} }],
    ["the report's Dive", { reports: [{ ...SALES, dive_id: '' }] }],
  ])('says the Dive is not set up when %s is missing, and calls nothing', async (_what, options) => {
    const calls = upstream(ok)
    const { ctx } = context({ payload: { store: '9901' }, ...options })
    expect([await embedSession(ctx), calls.length]).toEqual([{ not_set_up: true }, 0])
  })

  it('says the Dive is unreachable when MotherDuck refuses the session', async () => {
    upstream(() => Promise.resolve(new Response('{"message":"nope"}', { status: 503 })))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { ctx } = context({ payload: { store: '9901' } })
    expect(await embedSession(ctx)).toEqual({ unreachable: true })
  })

  it('says the Dive is unreachable when MotherDuck answers something that is not JSON', async () => {
    upstream(() => Promise.resolve(new Response('<html>busy</html>', { status: 200 })))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { ctx } = context({ payload: { store: '9901' } })
    expect(await embedSession(ctx)).toEqual({ unreachable: true })
  })

  it('says the Dive is unreachable when MotherDuck cannot be reached', async () => {
    upstream(() => Promise.reject(new TypeError('fetch failed')))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { ctx } = context({ payload: { store: '9901' } })
    expect(await embedSession(ctx)).toEqual({ unreachable: true })
  })

  it('never writes the token into what it logs', async () => {
    upstream(() => Promise.resolve(new Response('{"message":"bad token token-made-up"}', { status: 401 })))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { ctx } = context({ payload: { store: '9901' } })
    await embedSession(ctx)
    expect(JSON.stringify(logged.mock.calls)).not.toContain('token-made-up')
  })

  it('gives up on a MotherDuck that never answers, after its own timeout', async () => {
    vi.useRealTimers()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-10-15T06:00:00Z'))
    // Hangs for good unless the read aborts it.
    setEmbedFetch((_url, init) => new Promise<Response>((_resolve, reject) =>
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { ctx } = context({ payload: { store: '9901' } })
    let settled: unknown = 'pending'
    void embedSession(ctx).then(a => { settled = a })
    await vi.advanceTimersByTimeAsync(EMBED_API_TIMEOUT_MS ?? 10_000)
    expect(settled).toEqual({ unreachable: true })
  })

  it("refuses a store that is not one of the reader's", async () => {
    upstream(ok)
    const { ctx } = context({ payload: { store: '9909' } })
    await expect(embedSession(ctx)).rejects.toThrow(/not one of your stores/)
  })

  it('reads no dataset, cached or live: the Dive opens on live figures of its own', async () => {
    upstream(ok)
    const { ctx, asked } = context({ payload: { store: '9901' }, rows: [row('9901', '010101001')] })
    await embedSession(ctx)
    expect(asked).toEqual([])
  })

  describe("a whole-store reader's Dive", () => {
    const manager = [place('9901', '9901'), place('9901 / Section: Sarees', '9901', ['010101001'])]
    const warehouse = [row('9901', '010101001'), row('9901', '010909001')]
    const state = async (options: Options) => {
      const calls = upstream(ok)
      await embedSession(context({ payload: { store: '9901' }, ...options }).ctx)
      return sentBody(calls).initial_state
    }

    it('names the whole store, so the Dive filters on the store alone', async () => {
      expect((await state({ places: manager })).whole_store).toBe(true)
    })

    it('sends a whole-store reader no subcategories, however many their sections hold', async () => {
      const many = Array.from({ length: 6000 }, (_, i) => String(10100000 + i).padStart(9, '0'))
      expect(await state({ places: [place('9901', '9901'), place('9901 / Section: All', '9901', many)] })).toEqual({ plant_code: '9901', whole_store: true, period_end: '2026-10-15' })
    })

    it('asks the warehouse for nothing live, even with nothing cached', async () => {
      const { ctx, asked } = context({ payload: { store: '9901' }, places: manager, rows: null, live: warehouse })
      upstream(ok)
      await embedSession(ctx)
      expect(asked.filter(a => (a as unknown[])[0] === 'live')).toEqual([])
    })

    it("never widens a section-scoped reader's Dive", async () => {
      const s = await state({ rows: null, live: warehouse })
      expect([s.whole_store, s.material_groups]).toEqual([undefined, ['010101001']])
    })

    // #4453: only the reader's places make a whole-store reader, never the request.
    it('keeps a section reader section-scoped whatever the request says', async () => {
      const s = await state({ payload: { store: '9901', whole_store: true, material_groups: [], sections: { All: [10101001] } } })
      expect(s).toEqual({ plant_code: '9901', material_groups: ['010101001'], period_end: '2026-10-15' })
    })

    describe('a reader who covers one store whole and a section of another', () => {
      const mixed = [place('9902', '9902'), place('9902 / Section: Belts', '9902', ['010404001']), place('9901 / Section: Sarees', '9901', ['010101001'])]

      it('is section-scoped in the store where they hold a section', async () => {
        const s = await state({ places: mixed, payload: { store: '9901' } })
        expect([s.whole_store, s.material_groups]).toEqual([undefined, ['010101001']])
      })

      it('is whole-store in the store they cover whole', async () => {
        const s = await state({ places: mixed, payload: { store: '9902' } })
        expect([s.whole_store, s.material_groups]).toEqual([true, undefined])
      })
    })
  })
})

// #4486: the page's header says why the reader sees the store on show.
describe("the report read's heading", () => {
  const based = (label: string, store: string, subcategory: string[] | undefined, basis: string): Place =>
    ({ ...place(label, store, subcategory), basis })
  const PLACES = [based('9901 / Section: Sarees', '9901', ['010101001'], 'team_leader'), based('9902', '9902', undefined, 'store_manager')]
  type Answered = { state: string; heading: unknown }

  it("answers the chosen store's reasons and sections, named by the cached rows", async () => {
    const { ctx } = context({ places: PLACES, payload: { store: '9901' } })
    expect((await reads.report(ctx) as Answered).heading).toEqual({ name: 'Lakeside', sections: ['Sarees'], reasons: [{ basis: 'team_leader', sections: ['Sarees'] }] })
  })

  it("names the store from the month's metadata when the reader has no row of figures", async () => {
    const monthRow = { store_code: '9902', store_name: 'Hillview', subcategory_code: '010404001', period_start: '2026-10-01', data_through: '2026-10-14', targets_available: true }
    const { ctx } = context({ places: PLACES, payload: { store: '9902' }, rows: [], month: [monthRow] })
    expect((await reads.report(ctx) as Answered).heading).toEqual({ name: 'Hillview', sections: [], reasons: [{ basis: 'store_manager', sections: [] }] })
  })

  it('still answers the heading while nothing is cached yet (the figures are being prepared)', async () => {
    const { ctx } = context({ places: PLACES, payload: { store: '9901' }, rows: null })
    const report = await reads.report(ctx) as Answered
    // The store's name comes from the core Tables, never a code (#967 point 13).
    expect([report.state, report.heading]).toEqual(['not_built', { name: 'Lakeside', sections: ['Sarees'], reasons: [{ basis: 'team_leader', sections: ['Sarees'] }] }])
  })
})

describe('the Report access reads (#1046)', () => {
  const manager = (core: Record<string, Row[]>, coreThrows: boolean | string[] = false, payload: Record<string, unknown> = {}) => {
    const { ctx } = context({ core: { ...jobOf({ job: 'Store Manager' }), ...core }, coreThrows, payload, places: [] })
    return { ...ctx, roles: ['Report Access Manager'], people: { async names() { return {} }, async rolesOf() { return ['Dash Reader'] } } }
  }

  it('says whether the reader manages report access', () => {
    expect([reads.manages_access(manager({})), reads.manages_access(context().ctx)]).toEqual([true, false])
  })

  it('lists bundles by name, and searches the staff list', async () => {
    const ctx = manager({ 'dash.report_bundle': [{ row_id: 'b2', bundle_name: 'Store pack' }, { row_id: 'b1', bundle_name: 'Leader pack' }],
      Employee: [{ row_id: 'E1', person: 'psn_103', name: 'Made-up Manager', status: 'Current' }] }, false, { q: 'Made' })
    expect((await reads.access_page(ctx)).bundles.map(b => b.name)).toEqual(['Leader pack', 'Store pack'])
    expect(await reads.person_search({ ...ctx, payload: { q: 'Made-up Manager' } })).toEqual([{ person: 'psn_103', name: 'Made-up Manager' }])
  })

  it('looks a person up by what their job reaches, and as reaching nothing when that can\'t be read', async () => {
    const lookup = (coreThrows: boolean | string[]) => reads.person_lookup(manager({}, coreThrows, { person: 'psn_103' }))
    expect((await lookup(false)).reports.map(r => [r.key, r.closed])).toEqual([['sales', null]])
    expect((await lookup(['Site'])).reports.map(r => [r.key, r.closed])).toEqual([['sales', 'Given, but their job reaches no store']])
  })
})

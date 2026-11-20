// Dash's reads over a stand-in for what the platform hands a read handler (the reader's places, its
// datasets, the report rows, the core Tables, settings, secrets, recordView), and a stand-in
// for MotherDuck's embed API (the network boundary). Made-up stores, people and figures.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMBED_API_TIMEOUT_MS, appOrigin, reads, setEmbedFetch } from './server'
import type { Place } from './provider.ts'

const AT = '2026-10-15T00:19:00.000Z'
const place = (label: string, store: string, subcategory?: string[]): Place =>
  ({ label, filters: subcategory ? { store: [store], subcategory } : { store: [store] } })

type Row = Record<string, unknown>
/** The three made-up Dives, each taking a different shape of filters. */
const SALES = { report_key: 'sales', report_name: 'Sales versus target', dive_id: 'dive-sales', filter_shape: 'One store and subcategories', store_key: 'plant_code',
  subcategory_key: 'material_groups', whole_store_key: 'whole_store', month_key: 'period_end', ready_signal: 0 }
const WHOLE = { report_key: 'whole', report_name: 'Store target month to date', dive_id: 'dive-whole', filter_shape: 'Whole stores', store_key: 'plant_codes',
  subcategory_key: null, whole_store_key: null, month_key: null, ready_signal: 0 }
const VENDORS = { report_key: 'vendors', report_name: 'Vendor sales by city', dive_id: 'dive-vendors', filter_shape: 'Stores and subcategories', store_key: 'reach',
  subcategory_key: null, whole_store_key: null, month_key: null, ready_signal: 0 }

/** The platform's table reads: the filters and paging `list` is given, over in-memory rows. */
function reader(tables: Record<string, Row[]>, throws: boolean | string[] = false) {
  return {
    async list(table: string, args: { filters?: [string, string, unknown][]; order_by?: string; limit_start?: number; limit_page_length?: number; with_retired?: boolean }) {
      if (throws === true || (Array.isArray(throws) && throws.includes(table))) throw new Error('not set up')
      // As the platform: a retired row only when asked for.
      const found = (tables[table] ?? []).filter(r => args.with_retired || !r.retired_at).filter(r => (args.filters ?? []).every(([column, op, value]) => (op === 'in' ? (value as unknown[]).includes(r[column]) : op === 'like' ? String(r[column]).includes(String(value).replaceAll('%', '')) : r[column] === value)))
      const start = args.limit_start ?? 0
      return found.slice(start, start + (args.limit_page_length ?? 500))
    },
    /** As the platform's: whether the Table can be read, never a failure. */
    async available(table: string) {
      return table in tables && throws !== true && !(Array.isArray(throws) && throws.includes(table))
    },
  }
}
const STORES = {
  Plant: [{ row_id: '9901', site: 'LKS', plant_type: 'Store' }, { row_id: '9902', site: 'HLV', plant_type: 'Store' }],
  Site: [{ row_id: 'LKS', name: 'Lakeside', is_store: true, cluster: null }, { row_id: 'HLV', name: 'Hillview', is_store: true, cluster: null }],
}

interface Options {
  places?: Place[]
  payload?: Record<string, unknown>
  settings?: Record<string, string>
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

function context({ places = [place('9901 / Section: Sarees', '9901', ['010101001'])], payload = {}, settings = DIVE,
  reports = [SALES], core = STORES, coreThrows = false, secrets = TOKENS }: Options = {}) {
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
      // #1366: Dash copies no figures; any dataset read is recorded, so a test can say none was made.
      datasets: {
        async active(name: string, filters?: Record<string, unknown>) {
          asked.push([name, filters])
          return null
        },
        async live(name: string, filters?: Record<string, unknown>) {
          asked.push(['live', name, filters])
          return { dataset: name, served: 'live', at: AT, rows: [] }
        },
      },
      /** Each call's arguments: the Access Log view takes none (#1366). */
      async recordView(...args: unknown[]) { views.push(args) },
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
  const OPEN = { report_key: 'open', report_name: 'Open', dive_id: 'dive-open', filter_shape: 'No filter', store_key: null, subcategory_key: null, whole_store_key: null, month_key: null, ready_signal: 0 }
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

  // #1172 (owner, 10-Nov-2026, "Open for any Dash role"): Dash opens for anyone holding a Dash role,
  // so someone whose job reaches nothing sees Dash's reason; its data stays shut for them.
  describe('Dash opening for anyone holding a Dash role', () => {
    const withRoles = (roles: string[]) => { const made = nobody({ reports: [SALES, WHOLE, VENDORS] }); made.ctx.roles = roles; return made.ctx }

    it('opens for a Dash Reader whose job reaches nothing and who has no report', async () => {
      expect(await reads.can_open(withRoles(['Dash Reader']))).toBe(true)
    })

    it('opens for each Dash role, and stays shut for someone holding none', async () => {
      const opens = async (roles: string[]) => reads.can_open(withRoles(roles))
      expect([await opens(['Report Access Manager']), await opens(['Dash Section Editor']), await opens(['Master Data Editor']), await opens([])])
        .toEqual([true, false, false, false])
    })

    // #1192: holding Dash All-Stores Reader alone opens Dash.
    it('opens for a holder of Dash All-Stores Reader alone', async () => {
      expect(await reads.can_open(withRoles(['All', 'Dash All-Stores Reader']))).toBe(true)
    })

    it('stays shut for someone the platform hands no roles at all', async () => {
      const ctx = withRoles([])
      delete (ctx as { roles?: string[] }).roles
      expect(await reads.can_open(ctx)).toBe(false)
    })

    it('gives them no report, no store, no rows and no Dive', async () => {
      const ctx = withRoles(['Dash Reader'])
      const prepared = await reads.embed_session.prepare({ ...ctx, payload: { report: 'sales' } })
      expect([await reads.reports(ctx), await reads.stores(ctx), await reads.report({ ...ctx, payload: { report: 'sales' } }),
        await reads.embed_session({ ...ctx, payload: { report: 'sales' }, prepared }), posted])
        .toEqual([[], [], { state: 'no_access' }, { refused: 'no_access' }, []])
    })
  })

  it('is the only report offered to someone whose job reaches nothing', async () => {
    const answer = await reads.reports(nobody({}).ctx) as { key: string; no_filter: boolean }[]
    expect(answer.map(r => [r.key, r.no_filter])).toEqual([['open', true]])
  })

  it('opens for them with empty filters, recording the open in the Access Log (#1366)', async () => {
    const { ctx, views } = nobody({ payload: { report: 'open' } })
    const prepared = await reads.embed_open.prepare(ctx)
    expect(await reads.embed_open({ ...ctx, prepared })).toMatchObject({ frame: expect.any(String) })
    expect(posted).toEqual([{ url: expect.stringContaining('/dives/dive-open/'), body: { username: 'svc-made-up', initial_state: {} } }])
    expect(views).toEqual([[]])
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
    const OPEN = { ...SALES, report_key: 'open', report_name: 'Open', filter_shape: 'No filter', store_key: null, subcategory_key: null, whole_store_key: null, month_key: null }
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
    [{ job: 'Department Manager' }, ['store_sections_not_set_up']],
    [{ job: 'Store Manager' }, []],
  ])('says why a job reaches nothing: %j', async (job, problems) => {
    const { ctx } = context({ core: jobOf(job) })
    expect(await reads.reach_problem(ctx)).toEqual({ problems })
  })

  it("says a Department Manager's department isn't set up when their store has sections (#1195)", async () => {
    const { ctx } = context({ core: { ...jobOf({ job: 'Department Manager' }), Section: [{ row_id: 'LKS-S1', name: 'Sarees', site: 'LKS', floor: null }] } })
    expect(await reads.reach_problem(ctx)).toEqual({ problems: ['departments_not_filled'] })
  })
})

// #1192: the role's reach counts wherever Dash works reach out, not only in the platform's scope.
describe('a holder of Dash All-Stores Reader', () => {
  const holder = (over: Options = {}) => {
    const made = context({ core: jobOf({ job: 'Head office staff' }), reports: [SALES, WHOLE], ...over })
    ;(made.ctx.authorization as { places?: unknown }).places = undefined
    made.ctx.roles = ['All', 'Dash All-Stores Reader']
    return made.ctx
  }

  it('is told of no problem, though their job is in head office', async () => {
    expect(await reads.reach_problem(holder())).toEqual({ problems: [] })
  })

  // The role decides reach only; which reports a person has is still given on the Report access page (#1046).
  // Its stores come from the platform's scope; the Dash platform test reads them on a real database.
  it('is offered the whole-stores report once the reports are given to them', async () => {
    const given = holder()
    given.roles = ['All', 'Dash All-Stores Reader', 'Dash Reader']
    expect([(await reads.reports(holder())).length, (await reads.reports(given)).map(report => report.key)]).toEqual([0, ['sales', 'whole']])
  })

  it('reads as reaching every store on the Report access page, by the roles the platform says they hold', async () => {
    const { ctx } = context({ core: jobOf({ job: 'Head office staff' }), reports: [WHOLE], payload: { person: 'psn_104' }, places: [] })
    const lookup = (roles: string[]) => reads.person_lookup({ ...ctx, roles: ['Report Access Manager'],
      people: { async names() { return {} }, async rolesOf(person: string) { return person === 'psn_104' ? roles : [] } } })
    expect((await lookup(['Dash Reader', 'Dash All-Stores Reader'])).reports.map(r => [r.key, r.closed])).toEqual([['whole', null]])
    expect((await lookup(['Dash Reader'])).reports.map(r => [r.key, r.closed])).toEqual([['whole', 'Given, but their job reaches no store']])
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

  // #1153, the owner's naming rule (10-Nov-2026): a store goes by its Site's name, unless more than one
  // plant shares that site; then each of them goes by its Plant name.
  describe('stores sharing a site', () => {
    const SHARED = {
      Plant: [{ row_id: '9901', site: 'LKS', plant_type: 'Store', plant_name: 'Lakeside Store' },
        { row_id: '9903', site: 'LKS', plant_type: 'Store', plant_name: 'Lakeside Gold House' },
        { row_id: '9902', site: 'HLV', plant_type: 'Store', plant_name: 'Hillview Store' }],
      Site: STORES.Site,
    }
    const THREE = [place('9901', '9901'), place('9902', '9902'), place('9903', '9903')]

    it('names each plant on a shared site by its Plant name, and a plant alone on its site by the Site name', async () => {
      const { ctx } = context({ places: THREE, core: SHARED })
      expect(await reads.stores(ctx)).toEqual([{ value: '9902', label: 'Hillview' }, { value: '9903', label: 'Lakeside Gold House' },
        { value: '9901', label: 'Lakeside Store' }])
    })

    it("counts a plant on the same site that the reader doesn't cover", async () => {
      const { ctx } = context({ places: [place('9901', '9901')], core: SHARED })
      expect(await reads.stores(ctx)).toEqual([{ value: '9901', label: 'Lakeside Store' }])
    })

    it('names the store in the heading the same way', async () => {
      const { ctx } = context({ places: [place('9901', '9901')], core: SHARED, payload: { store: '9901' } })
      expect(((await reads.report(ctx)) as { heading: { name: string } }).heading.name).toBe('Lakeside Store')
    })

    it('keeps the Site name for a plant on a shared site with no Plant name, numbering the twins', async () => {
      const core = { ...SHARED, Plant: SHARED.Plant.map(plant => ({ ...plant, plant_name: null })) }
      const { ctx } = context({ places: THREE, core })
      expect((await reads.stores(ctx)).map(option => option.label)).toEqual(['Hillview', 'Lakeside (1)', 'Lakeside (2)'])
    })

    it("keeps the Site names on an instance whose Plant Table has no Plant name, rather than failing", async () => {
      const { ctx } = context({ places: THREE, core: SHARED })
      const list = ctx.baseTables.list
      ctx.baseTables.list = async (table: string, args: { fields?: string[] } & Record<string, unknown>) => {
        if (table === 'Plant' && args.fields?.includes('plant_name')) throw new Error('Unknown column plant_name')
        return list(table, args as Parameters<typeof list>[1])
      }
      expect((await reads.stores(ctx)).map(option => option.label)).toEqual(['Hillview', 'Lakeside (1)', 'Lakeside (2)'])
    })
  })

  it('reads no dataset (#1366)', async () => {
    const { ctx, asked } = context({ places: TWO })
    expect(await reads.stores(ctx)).toEqual([{ value: '9902', label: 'Hillview' }, { value: '9901', label: 'Lakeside' }])
    expect(asked).toEqual([])
  })

  it('offers every store by its place in the list, never its plant code, when the core Tables name none (#4531)', async () => {
    const { ctx } = context({ places: TWO, core: { Plant: [], Site: [] } })
    expect(await reads.stores(ctx)).toEqual([{ value: '9901', label: 'Store 1' }, { value: '9902', label: 'Store 2' }])
  })

  it('offers a lone store as "Your store", never its plant code, when the core Tables name none (#4531)', async () => {
    const { ctx } = context({ core: { Plant: [], Site: [] } })
    expect(await reads.stores(ctx)).toEqual([{ value: '9901', label: 'Your store' }])
  })

  it('numbers two stores of one name', async () => {
    const { ctx } = context({ places: TWO, core: SAME_NAME })
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

// #1159: a report whose Dive has its own Store and Month pickers.
describe('a report whose Dive has its own pickers', () => {
  const PICKERS = { ...SALES, pickers_in_dive: 1, ready_signal: 1 }
  const TWO = [place('9902', '9902'), place('9901 / Section: Sarees', '9901', ['010101001'])]
  const ok = () => Promise.resolve(new Response(JSON.stringify({ session: 'session-made-up' }), { status: 200 }))
  function sent() {
    const calls: { url: string; init: RequestInit }[] = []
    setEmbedFetch(async (url, init) => { calls.push({ url: String(url), init: init! }); return ok() })
    return () => JSON.parse(String(calls[0].init.body))
  }

  it('offers the bar no store and no month', async () => {
    const { ctx } = context({ places: TWO, reports: [PICKERS] })
    expect([await reads.stores(ctx), await reads.months(ctx)]).toEqual([[], []])
  })

  it('tells the page the Dive has the pickers, so it takes neither from the bar', async () => {
    const { ctx } = context({ places: TWO, reports: [PICKERS] })
    expect(await reads.reports(ctx)).toEqual([{ key: 'sales', name: 'Sales versus target', takes_store: false, takes_month: false, no_filter: false, pickers_in_dive: true }])
  })

  it('opens the Dive with the reach of every place, and the store and month from the address', async () => {
    const body = sent()
    const { ctx } = context({ places: TWO, reports: [PICKERS], payload: { store: '9901', month: 'last', app_origin: 'https://dash.example.test' } })
    await embedSession(ctx)
    expect(body()).toEqual({ username: 'svc-made-up',
      initial_state: { reach: { 9901: ['010101001'], 9902: null }, store: '9901', month: 'last', app_origin: 'https://dash.example.test' } })
  })

  it("leaves out a store from the address that isn't the reader's, rather than refusing", async () => {
    const body = sent()
    const { ctx } = context({ places: TWO, reports: [PICKERS], payload: { store: '9999' } })
    await embedSession(ctx)
    expect(body().initial_state).toEqual({ reach: { 9901: ['010101001'], 9902: null }, month: 'this' })
  })

  // #1366: as the Dive opens with no store named, the reader's first store A–Z; no copy is read.
  it("heads the page with the address's store, else the reader's first store A–Z, reading no dataset", async () => {
    const named = async (payload: Record<string, unknown>) => {
      const { ctx, asked } = context({ places: TWO, reports: [PICKERS], payload })
      const answer = await reads.report(ctx) as { heading: { name: string }; pickers_in_dive?: boolean }
      return [answer.heading.name, answer.pickers_in_dive, asked.length]
    }
    expect([await named({ store: '9901' }), await named({}), await named({ store: '9999' })])
      .toEqual([['Lakeside', true, 0], ['Hillview', true, 0], ['Hillview', true, 0]])
  })
})

describe('the report read', () => {
  it("answers that the chosen store's report can open, with its header named from the core Tables, and the period", async () => {
    const { ctx } = context({ payload: { store: '9901' } })
    expect(await reads.report(ctx)).toEqual({ state: 'ready', period_start: '2026-10-01', period_end: '2026-10-15',
      heading: { name: 'Lakeside', sections: ['Sarees'], reasons: [] } })
  })

  it("answers the reader's first store when none is chosen", async () => {
    const { ctx } = context({ places: [place('9902 / Section: Belts', '9902', ['010404001']), place('9901 / Section: Sarees', '9901', ['010101001'])] })
    expect(await reads.report(ctx)).toMatchObject({ heading: { name: 'Lakeside', sections: ['Sarees'] } })
  })

  // #1366: no copy of the figures is read, and opening the Dive, not this read, is what is logged.
  it('reads no dataset, cached or live, and records no view', async () => {
    const { ctx, asked, views } = context({ payload: { store: '9901' } })
    await reads.report(ctx)
    expect([asked, views]).toEqual([[], []])
  })

  it("refuses a store that is not one of the reader's", async () => {
    const { ctx } = context({ payload: { store: '9909' } })
    await expect(reads.report(ctx)).rejects.toThrow(/not one of your stores/)
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
    expect(await reads.report(ctx)).toMatchObject({ state: 'ready', heading: { name: 'Lakeside', sections: [] } })
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

  it('answers only that a whole-stores report can open, and an empty header', async () => {
    const { ctx, asked, views } = context({ reports: [WHOLE], places: [place('9901', '9901')] })
    expect(await reads.report(ctx)).toEqual({ state: 'ready', heading: { name: null, sections: [], reasons: [] } })
    expect([asked, views]).toEqual([[], []])
  })

  it('answers the period only on a report taking a month', async () => {
    const { ctx } = context({ reports: [{ ...VENDORS, month_key: 'period_end' }], payload: { month: 'last' } })
    expect(await reads.report(ctx)).toMatchObject({ state: 'ready', period_start: '2026-09-01', period_end: '2026-09-30' })
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
  const lastMonth = (options: Options = {}) => context({ ...options, payload: { store: '9901', month: 'last', ...options.payload } })

  it('answers the whole of last month', async () => {
    const { ctx } = lastMonth()
    expect(await reads.report(ctx)).toMatchObject({ state: 'ready', period_start: '2026-09-01', period_end: '2026-09-30' })
  })

  it('answers this month to date when the month says this', async () => {
    const { ctx } = context({ payload: { store: '9901', month: 'this' } })
    expect(await reads.report(ctx)).toMatchObject({ period_start: '2026-10-01', period_end: '2026-10-15' })
  })

  it.each([['next'], [1], [{}]])('refuses any other month (%j)', async month => {
    const { ctx } = context({ payload: { store: '9901', month } })
    await expect(reads.report(ctx)).rejects.toThrow('Choose this month or last month')
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

  // #1366: every report's open is one Access Log row, whichever report; a session refused or
  // never minted is not an open.
  it('records one Access Log view when the Dive opens, for any report', async () => {
    upstream(ok)
    const opened = await Promise.all(([[SALES, { store: '9901' }], [VENDORS, {}]] as const).map(async ([report, payload]) => {
      const { ctx, views } = context({ reports: [report], payload })
      await embedSession(ctx)
      return views
    }))
    expect(opened).toEqual([[[]], [[]]])
  })

  it('records no view when MotherDuck refuses the session, or the report is refused', async () => {
    upstream(() => Promise.resolve(new Response('no', { status: 500 })))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const failed = context({ payload: { store: '9901' } })
    await embedSession(failed.ctx)
    const refused = context({ payload: { store: '9909' } })
    await expect(embedSession(refused.ctx)).rejects.toThrow(/not one of your stores/)
    expect([failed.views, refused.views]).toEqual([[], []])
  })

  it("fails the open when the Access Log can't record it, rather than open unrecorded", async () => {
    upstream(ok)
    const { ctx } = context({ payload: { store: '9901' } })
    ctx.recordView = async () => { throw new Error('Required access audit is unavailable') }
    await expect(embedSession(ctx)).rejects.toThrow('Required access audit is unavailable')
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
    const { ctx, asked } = context({ payload: { store: '9901' } })
    await embedSession(ctx)
    expect(asked).toEqual([])
  })

  describe("a whole-store reader's Dive", () => {
    const manager = [place('9901', '9901'), place('9901 / Section: Sarees', '9901', ['010101001'])]
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

    it('asks the warehouse for nothing live', async () => {
      const { ctx, asked } = context({ payload: { store: '9901' }, places: manager })
      upstream(ok)
      await embedSession(ctx)
      expect(asked.filter(a => (a as unknown[])[0] === 'live')).toEqual([])
    })

    it("never widens a section-scoped reader's Dive", async () => {
      const s = await state({})
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

  // #1269: a reach Dive gets each store's subcategories as the shortest code prefixes the reader wholly holds.
  describe("a reach Dive's subcategories", () => {
    const LINE = ['920101001', '920101002', '920201001']
    const OTHER = ['930101001', '930101002']
    const SUBCATEGORIES = [...LINE, ...OTHER].map(row_id => ({ row_id }))
    const head = [place('9901 / Assigned subcategories', '9901', LINE), place('9902 / Assigned subcategories', '9902', [...LINE, OTHER[0]])]
    const reach = async (options: Options) => {
      const calls = upstream(ok)
      vi.spyOn(console, 'info').mockImplementation(() => {})
      vi.spyOn(console, 'error').mockImplementation(() => {})
      await embedSession(context({ reports: [VENDORS], payload: { report: 'vendors' }, places: head, ...options }).ctx)
      return sentBody(calls).initial_state.reach
    }

    it('sends a wholly held line as its prefix, and a line short of one code as its codes', async () => {
      expect(await reach({ core: { ...STORES, Subcategory: SUBCATEGORIES } })).toEqual({ 9901: ['92'], 9902: ['92', '930101001'] })
    })

    it('never sends a prefix over a code of another type the reader does not hold', async () => {
      const service = { row_id: '920199001' }
      expect(await reach({ core: { ...STORES, Subcategory: [...SUBCATEGORIES, service] } })).toEqual({ 9901: ['920101', '9202'], 9902: ['920101', '9202', '930101001'] })
    })

    it('never sends a prefix over a retired code the reader does not hold', async () => {
      const retired = { row_id: '920201009', retired_at: '2026-01-01T00:00:00Z' }
      expect(await reach({ core: { ...STORES, Subcategory: [...SUBCATEGORIES, retired] } })).toEqual({ 9901: ['9201', '920201001'], 9902: ['9201', '920201001', '930101001'] })
    })

    it('sends the codes themselves when the hierarchy cannot be read', async () => {
      expect(await reach({ core: { ...STORES, Subcategory: SUBCATEGORIES }, coreThrows: ['Subcategory'] }))
        .toEqual({ 9901: LINE, 9902: [...LINE, OTHER[0]] })
      expect(await reach({ core: STORES })).toEqual({ 9901: LINE, 9902: [...LINE, OTHER[0]] })
    })

    it('reads the hierarchy page by page, and fails the read rather than collapse on a list cut short', async () => {
      const many = Array.from({ length: 600 }, (_, i) => ({ row_id: `94${String(i).padStart(7, '0')}` }))
      const held = [place('9901 / Assigned subcategories', '9901', many.map(r => r.row_id))]
      expect(await reach({ places: held, core: { ...STORES, Subcategory: many } })).toEqual({ 9901: ['94'] })
      const { ctx } = context({ reports: [VENDORS], payload: { report: 'vendors' }, places: held, core: { ...STORES, Subcategory: many } })
      const list = ctx.baseTables.list
      ctx.baseTables.list = async (table, args) => {
        if (table === 'Subcategory' && args.limit_start) throw new Error('connection lost')
        return list(table, args)
      }
      const calls = upstream(ok)
      await expect(embedSession(ctx)).rejects.toThrow('connection lost')
      expect(calls).toEqual([])
    })

    it('logs the size of every request it sends', async () => {
      const calls = upstream(ok)
      const logged = vi.spyOn(console, 'info').mockImplementation(() => {})
      await embedSession(context({ reports: [VENDORS], payload: { report: 'vendors' }, places: head, core: { ...STORES, Subcategory: SUBCATEGORIES } }).ctx)
      expect(JSON.parse(String(logged.mock.calls[0][0]))).toEqual({ event: 'dash_embed_session_opened', person: 'psn_103',
        bytes: new TextEncoder().encode(String(calls[0].init.body)).length })
    })

    it('says the reach is too large when MotherDuck answers 413, and logs its size', async () => {
      upstream(() => Promise.resolve(new Response('{"message":"too large"}', { status: 413 })))
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { ctx } = context({ reports: [VENDORS], payload: { report: 'vendors' }, places: head })
      expect(await embedSession(ctx)).toEqual({ too_large: true })
      expect(JSON.parse(String(logged.mock.calls[0][0]))).toMatchObject({ event: 'dash_embed_session_failed', message: 'embed API answered HTTP 413', bytes: expect.any(Number) })
    })

    it('reads no hierarchy for a Dive that takes one store', async () => {
      const { ctx } = context({ payload: { store: '9901' } })
      expect(await reads.embed_session.prepare(ctx)).toEqual({ report: expect.objectContaining({ report_key: 'sales' }) })
    })
  })
})

// #4486: the page's header says why the reader sees the store on show.
describe("the report read's heading", () => {
  const based = (label: string, store: string, subcategory: string[] | undefined, basis: string): Place =>
    ({ ...place(label, store, subcategory), basis })
  const PLACES = [based('9901 / Section: Sarees', '9901', ['010101001'], 'team_leader'), based('9902', '9902', undefined, 'store_manager')]
  type Answered = { state: string; heading: unknown }

  it("answers the chosen store's reasons and sections, named from the core Tables", async () => {
    const { ctx } = context({ places: PLACES, payload: { store: '9901' } })
    expect((await reads.report(ctx) as Answered).heading).toEqual({ name: 'Lakeside', sections: ['Sarees'], reasons: [{ basis: 'team_leader', sections: ['Sarees'] }] })
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
    expect(await reads.person_search({ ...ctx, payload: { q: 'Made-up Manager' } })).toEqual([{ person: 'psn_103', name: 'Made-up Manager', code: null, jobs: ['Store Manager · Lakeside'], staff: 'current' }])
  })

  it('looks a person up by what their job reaches, and as reaching nothing when that can\'t be read', async () => {
    const lookup = (coreThrows: boolean | string[]) => reads.person_lookup(manager({}, coreThrows, { person: 'psn_103' }))
    expect((await lookup(false)).reports.map(r => [r.key, r.closed])).toEqual([['sales', null]])
    expect((await lookup(['Site'])).reports.map(r => [r.key, r.closed])).toEqual([['sales', 'Given, but their job reaches no store']])
  })
})

// #1240: what "Report an issue" sends with the reader's words, read as the reader.
describe('the context of a report issue', () => {
  const lead = (label: string, store: string, subcategory?: string[]): Place => ({ ...place(label, store, subcategory),
    reasons: [{ text: 'Team Leader job assignment', since: '2026-04-01' }] })

  it('names the report, the reader and their job, and each store they reach, whole or by section', async () => {
    const { ctx } = context({ payload: { report: 'sales' }, places: [
      lead('9901 / Section: Sarees', '9901', ['010101002', '010101001']), lead('9901 / Section: Silk', '9901', ['010101003']),
      { label: '9902', filters: { store: ['9902'] }, reasons: [{ text: 'Store Manager job assignment' }] }] })
    expect(await reads.feedback_context({ ...ctx, userName: 'Asha Leader' })).toEqual({
      state: 'ok', report: { key: 'sales', name: 'Sales versus target' }, person: 'Asha Leader',
      jobs: ['Store Manager job assignment', 'Team Leader job assignment, since 01-Apr-2026'],
      reach: [
        { store: '9901', name: 'Lakeside', whole: false, sections: ['Sarees', 'Silk'], subcategories: ['010101001', '010101002', '010101003'] },
        { store: '9902', name: 'Hillview', whole: true, sections: [], subcategories: [] },
      ],
    })
  })

  it('counts only the places that name a store', async () => {
    const { ctx } = context({ payload: { report: 'sales' }, places: [
      lead('9901 / Section: Sarees', '9901', ['010101001']), { label: 'Merchandise only', filters: { subcategory: ['020202002'] } }] })
    const answer = await reads.feedback_context(ctx) as { reach: { store: string; subcategories: string[] }[] }
    expect(answer.reach).toEqual([{ store: '9901', name: 'Lakeside', whole: false, sections: ['Sarees'], subcategories: ['010101001'] }])
  })

  it('says nothing about a report that isn\'t the reader\'s', async () => {
    const { ctx } = context({ payload: { report: 'not-given' } })
    expect(await reads.feedback_context(ctx)).toEqual({ state: 'no_access' })
  })

  it('still answers, with store codes, when the store names can\'t be read', async () => {
    const { ctx } = context({ payload: { report: 'sales' }, coreThrows: ['Plant'] })
    const answer = await reads.feedback_context(ctx) as { reach: { store: string; name: string | null }[] }
    expect(answer.reach).toEqual([{ store: '9901', name: null, whole: false, sections: ['Sarees'], subcategories: ['010101001'] }])
  })
})

// #1223: the edges of the report read and its store names that the tests above don't reach.
describe('the report read at its edges', () => {
  it("offers no whole-stores report when the reader's reach reads, then fails when the whole-store check reads it again", async () => {
    const { ctx } = context({ places: [], reports: [SALES, WHOLE], core: jobOf({ job: 'Store Manager' }) })
    const list = ctx.baseTables.list
    let employeeReads = 0
    ctx.baseTables.list = async (table, args) => {
      if (table === 'Employee' && ++employeeReads > 2) throw new Error('not set up')
      return list(table, args)
    }
    expect((await reads.reports(ctx) as { key: string }[]).map(r => r.key)).toEqual(['sales'])
  })

  it('opens a Dive with its own pickers on the first store A–Z', async () => {
    const PLAIN = { ...SALES, pickers_in_dive: 1 }
    const { ctx } = context({ places: [place('9902', '9902'), place('9901', '9901')], reports: [PLAIN] })
    expect(await reads.report(ctx)).toMatchObject({ state: 'ready', pickers_in_dive: true, heading: { name: 'Hillview' } })
  })

  it('answers no_access for a Dive with its own pickers when the reader reaches no store', async () => {
    const { ctx } = context({ places: [], reports: [{ ...SALES, pickers_in_dive: 1 }], core: jobOf({ job: 'Head office staff' }) })
    ctx.roles = ['All', 'Dash Reader', 'Dash All-Stores Reader']
    expect(await reads.report(ctx)).toEqual({ state: 'no_access' })
  })

  it('names a store whose site the core Tables lack not at all, never by its code', async () => {
    const core = { Plant: [{ row_id: '9901', site: 'ZZZ', plant_type: 'Store' }], Site: STORES.Site }
    expect(await reads.report(context({ payload: { store: '9901' }, core }).ctx)).toMatchObject({ state: 'ready', heading: { name: null } })
  })

  it('says the Dive is unreachable when the call fails with no error at all', async () => {
    setEmbedFetch(() => Promise.reject(null))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await embedSession(context({ payload: { store: '9901' } }).ctx)).toEqual({ unreachable: true })
    expect(JSON.stringify(logged.mock.calls)).toContain('embed API unreachable: error')
  })
})

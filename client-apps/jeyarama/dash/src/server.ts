// Dash's server module, loaded by the Featherbase platform at boot. The platform's app contract
// is structural: this module imports nothing from the platform. Reads are declared in
// featherbase.json under "reads". A report is a row of `dash.report`; nothing here knows one Dive.
import { checked } from './values.ts'
import { orgChartProvider, reachOf, type Documents, type Place } from './provider.ts'
import { diveFilters, storesOfReport, type ReportRecord } from './dive-filters.ts'
import { MONTH_CHOICES, buildReport, monthLabel, headingOf, istToday, periodOf, storeLabels, storeShortName, type CachedAnswer, type Heading, type Month, type MonthChoice, type SalesRow } from './report.ts'
import { actions as sectionActions, reads as sectionReads } from './my-sections.ts'
import { accessPage, addToBundle, giveReport, makeBundle, managesAccess, personLookup, personSearch, removeAccess, removeFromBundle, reportsGivenTo, validators as accessValidators, type AccessContext } from './report-access-server.ts'

/** The save rules of Dash's own Tables. */
export const validators = accessValidators

/** The places each person covers, from the core Tables. */
export const scopeProviders = { org_chart: orgChartProvider() }

/** The cached dataset the report reads (featherbase.json's `datasets`). */
export const SALES_DATASET = 'sales_to_date'

/** The month's metadata dataset: period, last day of actuals, targets available; no figure. */
export const MONTH_DATASET = 'sales_month'

/** Last month's two datasets (#750), the same shapes as this month's: the whole month, kept apart so each holds one period. */
export const LAST_SALES_DATASET = 'sales_last_month'
export const LAST_MONTH_DATASET = 'sales_last_month_meta'

/** Each month choice's figures and metadata. */
const DATASETS: Readonly<Record<MonthChoice, { sales: string; month: string }>> = {
  this: { sales: SALES_DATASET, month: MONTH_DATASET },
  last: { sales: LAST_SALES_DATASET, month: LAST_MONTH_DATASET },
}

/** Where MotherDuck serves embedded Dives (featherbase.json's `frameOrigins`) and mints their sessions. */
export const EMBED_ORIGIN = 'https://embed-motherduck.com'
const EMBED_API = 'https://api.motherduck.com'

/** How long the embed API has to mint a session; the platform puts no limit on an outbound read. */
export const EMBED_API_TIMEOUT_MS = 10_000

/** What the platform hands a read handler (the part this module uses). */
interface ReadContext {
  user: string
  roles?: readonly string[]
  people?: AccessContext['people']
  payload?: unknown
  authorization?: { places?: readonly Place[] }
  /** What this outbound read's prepare step read in its transaction. */
  prepared?: unknown
  documents?: Documents
  baseTables?: Documents
  settings?: Readonly<Record<string, string>>
  secrets?: Readonly<Record<string, string>>
  reject?(message: string): never
  datasets?: {
    active(name: string, filters?: unknown): Promise<{ at: string; rows: unknown[] } | null>
    live(name: string, filters?: unknown): Promise<{ at: string; rows: unknown[] }>
  }
  recordView?(details: { dataset: string }): Promise<void>
}
type ScopedContext = Required<ReadContext>

export const platformVersion = '2026-10'

// Swappable for the tests: MotherDuck's embed API is the network boundary.
let embedFetch: typeof fetch | null = null
export function setEmbedFetch(f: typeof fetch | null) {
  embedFetch = f
}

const placesOf = (ctx: ScopedContext) => ctx.authorization.places ?? []

const REPORT_FIELDS = ['report_key', 'report_name', 'dive_id', 'filter_shape', 'store_key', 'subcategory_key', 'whole_store_key', 'month_key', 'ready_signal', 'quick_view']

/**
 * The one place that decides which reports this person may open: the reports given to them by
 * any route (#1046), read fresh on every request. No row means no report, for everyone. Someone
 * whose job reaches nothing gets only a given report that takes no filter: a grant never widens
 * which stores a person sees. Unreadable means nothing.
 */
export async function reportsFor(ctx: ScopedContext): Promise<ReportRecord[]> {
  let given: Set<string>
  try { given = new Set((await reportsGivenTo(ctx.baseTables, ctx.user, ctx.roles ?? [], istToday())).keys()) } catch { return [] }
  if (!given.size) return []
  const rows = await ctx.documents.list('dash.report', { fields: REPORT_FIELDS, order_by: 'report_name asc', limit_page_length: 200 })
  const reports = rows.map(row => ({ ...row, ready_signal: checked(row.ready_signal) }) as unknown as ReportRecord).filter(report => given.has(report.report_key))
  return (await reachesSomething(ctx)) ? reports : reports.filter(report => report.filter_shape === 'No filter')
}

/**
 * The reports offered to the reader, in the sidebar and for opening Dash: a whole-stores report
 * isn't offered to someone without a whole store (#967 point 1); opened by its address, it still
 * says why.
 */
async function offeredReports(ctx: ScopedContext): Promise<ReportRecord[]> {
  const reports = await reportsFor(ctx)
  const places = reports.some(report => report.filter_shape === 'Whole stores') ? await placesHeld(ctx) : []
  const wholeStore = places.some(place => !place.filters.subcategory)
  return reports.filter(report => report.filter_shape !== 'Whole stores' || wholeStore)
}

/** The reader's places: a person_scope read's, else worked out from the core Tables. Unreadable means none. */
async function placesHeld(ctx: ScopedContext): Promise<readonly Place[]> {
  if (ctx.authorization?.places?.length) return ctx.authorization.places
  try { return (await reachOf(ctx.baseTables, ctx.user, istToday())).places } catch { return [] }
}

/** A person_scope read already holds the reader's places; any other read works them out. Unreadable means nothing. */
async function reachesSomething(ctx: ScopedContext): Promise<boolean> {
  if (ctx.authorization?.places?.length) return true
  try { return (await reachOf(ctx.baseTables, ctx.user, istToday())).places.length > 0 } catch { return false }
}

/** The report the read is for: the one the payload names, or the reader's first. Undefined when it isn't one of theirs. */
async function chosenReport(ctx: ScopedContext): Promise<ReportRecord | undefined> {
  const reports = await reportsFor(ctx)
  const named = (ctx.payload as { report?: unknown } | undefined)?.report
  return named === undefined || named === null || named === '' ? reports[0] : reports.find(report => report.report_key === named)
}

/** The store the read is for: the one the payload names, which must be the reader's own, or their first. */
function chosenStore(ctx: ScopedContext, report: ReportRecord): string | undefined {
  const stores = storesOfReport(report, placesOf(ctx))
  const named = (ctx.payload as { store?: unknown } | undefined)?.store
  if (named === undefined || named === null || named === '') return stores[0]
  if (typeof named !== 'string' || !stores.includes(named)) ctx.reject('That store is not one of your stores')
  return named
}

/** The month the read is for (#750): `this` (also when none is named) or `last`; anything else is refused. */
function chosenMonth(ctx: ScopedContext): MonthChoice {
  const named = (ctx.payload as { month?: unknown } | undefined)?.month
  if (named === undefined || named === null || named === '') return 'this'
  if (typeof named !== 'string' || !(MONTH_CHOICES as readonly string[]).includes(named)) ctx.reject('Choose this month or last month')
  return named as MonthChoice
}

/**
 * The page's origin as the page sends it, when it is a plain http(s) origin: the Dive's ready
 * message is sent to it. It carries no data, so a wrong origin only misdirects that message.
 */
export function appOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value ? value : null
  } catch {
    return null
  }
}


async function cachedRows(ctx: ScopedContext, store: string, month: MonthChoice): Promise<CachedAnswer> {
  const answer = await ctx.datasets.active(DATASETS[month].sales, { store_code: store })
  return answer ? { at: answer.at, rows: answer.rows as SalesRow[] } : null
}

/** The month's metadata as the store's snapshot has it: any of the reader's rows carries the same values. */
async function monthOf(ctx: ScopedContext, store: string, month: MonthChoice): Promise<Month | null> {
  const answer = await ctx.datasets.active(DATASETS[month].month, { store_code: store })
  const row = (answer?.rows as Month[] | undefined)?.[0]
  return row && answer ? { period_start: row.period_start, data_through: row.data_through, targets_available: row.targets_available, at: answer.at,
    store_name: row.store_name ?? null } : null
}

/** The sales target quick view's figures for one store and month. */
async function salesReport(ctx: ScopedContext, store: string) {
  const choice = chosenMonth(ctx)
  const answer = await cachedRows(ctx, store, choice)
  const month = await monthOf(ctx, store, choice)
  const report = buildReport({ store, places: placesOf(ctx), answer, month, today: istToday(), choice })
  const named = (await storeNames(ctx, [store])).get(store) ?? null
  return { ...report, heading: headingOf(placesOf(ctx), store, storeShortName(report, month, named)) }
}

/** A store's name from the core Tables, for the page's header and the bar. */
async function storeNames(ctx: ScopedContext, stores: readonly string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  if (!stores.length) return names
  const plants = await ctx.baseTables.list('Plant', { fields: ['row_id', 'site'], filters: [['row_id', 'in', [...stores]]], limit_page_length: 500 })
  const sites = await ctx.baseTables.list('Site', { fields: ['row_id', 'name'], filters: [['row_id', 'in', plants.map(plant => String(plant.site))]], limit_page_length: 500 })
  const siteName = new Map(sites.map(site => [String(site.row_id), String(site.name)]))
  for (const plant of plants) {
    const name = siteName.get(String(plant.site))
    if (name) names.set(String(plant.row_id), name)
  }
  return names
}

/** What a report's first answer says, for a report with no quick view: whether it can open, and its header. */
type Plain = { state: 'ready'; no_quick_view: true; heading: Heading; period_start?: string; period_end?: string }

/** A fresh MotherDuck embed session for a report's Dive, opening its latest saved version, with only filters in its state. */
async function openDive(ctx: ScopedContext, report: ReportRecord | null) {
  if (!report) return { refused: 'no_access' }
  const { embed_service_account: account } = ctx.settings
  // #1139: its own token. The warehouse token (MOTHERDUCK_TOKEN) is a read-only account's, which
  // can't create embed sessions; the platform hands this one only to the two reads opening a Dive.
  const token = ctx.secrets.MOTHERDUCK_EMBED_TOKEN
  if (!report.dive_id || !account || !token) return { not_set_up: true }
  const store = chosenStore(ctx, report)
  const period = periodOf(istToday(), chosenMonth(ctx))
  const origin = appOrigin((ctx.payload as { app_origin?: unknown } | undefined)?.app_origin)
  const filters = diveFilters(report, placesOf(ctx), { store, periodEnd: period.period_end, appOrigin: origin })
  if ('refused' in filters) return { refused: filters.refused }
  const body = JSON.stringify({ username: account, initial_state: filters.state })
  let failure: string
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), EMBED_API_TIMEOUT_MS)
  try {
    const response = await (embedFetch ?? fetch)(`${EMBED_API}/v1/dives/${encodeURIComponent(report.dive_id)}/embed-session`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body,
      signal: abort.signal,
    })
    const answered = await response.json().catch(() => null) as { session?: unknown } | null
    if (response.ok && typeof answered?.session === 'string') {
      // `ready_signal`: the Dive posts { type: 'dash:dive-ready' } once it has drawn, and the
      // page waits for it rather than trusting the frame's load event.
      return { frame: `${EMBED_ORIGIN}/sandbox/#session=${encodeURIComponent(answered.session)}`,
        ...(report.ready_signal ? { ready_signal: true } : {}) }
    }
    failure = `embed API answered HTTP ${response.status}`
  } catch (error) {
    failure = abort.signal.aborted ? `embed API gave no answer in ${EMBED_API_TIMEOUT_MS} ms`
      : `embed API unreachable: ${(error as Error)?.constructor?.name ?? 'error'}`
  } finally {
    clearTimeout(timer)
  }
  // For whoever runs the instance: the person's opaque id and the status, never the token or the upstream text.
  console.error(JSON.stringify({ event: 'dash_embed_session_failed', person: ctx.user, message: failure }))
  return { unreachable: true }
}

/** Your sections and its approvals (#975), and giving reports (#1046). */
export const actions = {
  ...sectionActions,
  give_report: (context: AccessContext) => giveReport(context),
  remove_report_access: (context: AccessContext) => removeAccess(context),
  make_bundle: (context: AccessContext) => makeBundle(context),
  add_to_bundle: (context: AccessContext) => addToBundle(context),
  remove_from_bundle: (context: AccessContext) => removeFromBundle(context),
}

export const reads = {
  ...sectionReads,

  /** The signed-in person, as the platform knows them. */
  me({ user }: ReadContext) {
    return { user }
  },

  /** The app's gate (#1046): Dash opens for someone with a report, or who manages report access. */
  async can_open(context: ReadContext) {
    const ctx = context as ScopedContext
    return managesAccess(ctx) || (await offeredReports(ctx)).length > 0
  },

  /** Whether this person manages report access, for the sidebar's link. */
  manages_access(context: ReadContext) {
    return managesAccess(context as AccessContext)
  },

  /** The Report access page (#1046). Managers only. */
  access_page: (context: ReadContext) => accessPage(context as AccessContext),
  person_search: (context: ReadContext) => personSearch(context as AccessContext),
  person_lookup: (context: ReadContext) => personLookup(context as AccessContext, istToday(), async person => {
    try {
      const { places } = await reachOf((context as ScopedContext).baseTables, person, istToday())
      return { any: places.length > 0, wholeStore: places.some(place => !place.filters.subcategory) }
    } catch { return { any: false, wholeStore: false } }
  }),

  /** The reports this person may open, for the sidebar. */
  async reports(context: ReadContext) {
    return (await offeredReports(context as ScopedContext)).map(report => ({ key: report.report_key, name: report.report_name,
      takes_store: report.filter_shape === 'One store and subcategories', takes_month: !!report.month_key, no_filter: report.filter_shape === 'No filter' }))
  },

  /** Why this person's job reaches nothing, for the page's message. */
  async reach_problem(context: ReadContext) {
    const ctx = context as ScopedContext
    return { problems: (await reachOf(ctx.baseTables, ctx.user, istToday())).problems }
  },

  /** The bar's store picker on the chosen report: the reader's stores by name, none on a report taking no store. */
  async stores(context: ReadContext) {
    const ctx = context as ScopedContext
    const report = await chosenReport(ctx)
    const stores = report ? storesOfReport(report, placesOf(ctx)) : []
    return storeLabels(stores, await storeNames(ctx, stores))
  },

  /**
   * The bar's month picker: this month and last month, each named by its month ("This month ·
   * Nov'26"), none on a report taking no month. The values are the choice, not the month, so an
   * address keeps its meaning ("last month") from one month to the next.
   */
  async months(context: ReadContext) {
    const report = await chosenReport(context as ScopedContext)
    if (!report?.month_key) return []
    const today = istToday()
    return MONTH_CHOICES.map(choice => ({ value: choice,
      label: `${choice === 'this' ? 'This month' : 'Last month'} · ${monthLabel(periodOf(today, choice).period_start)}` }))
  },

  /** Whether the chosen report can open for this reader, its header, and its quick view's figures if it has one. */
  async report(context: ReadContext) {
    const ctx = context as ScopedContext
    const report = await chosenReport(ctx)
    if (!report) return { state: 'no_access' }
    const store = chosenStore(ctx, report)
    const period = periodOf(istToday(), chosenMonth(ctx))
    const filters = diveFilters(report, placesOf(ctx), { store, periodEnd: period.period_end, appOrigin: null })
    if ('refused' in filters) return { state: filters.refused === 'not_your_store' ? 'no_access' : filters.refused }
    if (report.quick_view && store) {
      const figures = await salesReport(ctx, store)
      await ctx.recordView({ dataset: DATASETS[figures.month].sales })
      return figures
    }
    const names = await storeNames(ctx, store ? [store] : [])
    const plain: Plain = { state: 'ready', no_quick_view: true, heading: store ? headingOf(placesOf(ctx), store, names.get(store) ?? null) : { name: null, sections: [], reasons: [] },
      ...(report.month_key ? { period_start: period.period_start, period_end: period.period_end } : {}) }
    return plain
  },

  /**
   * A fresh MotherDuck embed session for the chosen report's Dive, opening its latest saved version
   * (outbound: it runs after the platform's transaction has closed, so `prepare` reads the row). The
   * Dive's state carries only filters.
   */
  embed_session: Object.assign(async (context: ReadContext) => openDive(context as ScopedContext, (context as ScopedContext).prepared as ReportRecord | null), {
    /** In the transaction: the report's row, which the handler can no longer read. */
    prepare: async (context: ReadContext) => (await chosenReport(context as ScopedContext)) ?? null,
  }),

  /**
   * A report taking no filter, for someone given it whatever their job reaches (#1046). These two
   * reads run without the reader's places, so they refuse every other report: a store-filtered
   * Dive is only ever opened by `report` and `embed_session`, under the reader's scope.
   */
  async report_open(context: ReadContext) {
    const report = await chosenReport(context as ScopedContext)
    if (report?.filter_shape !== 'No filter') return { state: 'no_access' }
    return { state: 'ready', no_quick_view: true, heading: { name: null, sections: [], reasons: [] } } satisfies Plain
  },

  embed_open: Object.assign(async (context: ReadContext) => {
    const report = (context as ScopedContext).prepared as ReportRecord | null
    return report?.filter_shape === 'No filter' ? openDive(context as ScopedContext, report) : { refused: 'no_access' }
  }, {
    prepare: async (context: ReadContext) => (await chosenReport(context as ScopedContext)) ?? null,
  }),
}

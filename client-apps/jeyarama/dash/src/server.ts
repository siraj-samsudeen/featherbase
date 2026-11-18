// Dash's server module, loaded by the Featherbase platform at boot. The platform's app contract
// is structural: this module imports nothing from the platform. Reads are declared in
// featherbase.json under "reads". A report is a row of `dash.report`; nothing here knows one Dive.
import { checked } from './values.ts'
import { ALL_STORES_ROLE, type Documents, type Place } from './provider.ts'
import { BUSINESS_ROLES, accessSource, dashScopeProvider, liveReach, placesSource } from './access-source.ts'
import { businessAccessSummary, giveOldGrantsAction, switchOverLog } from './switch-over-server.ts'
import { opensDashByBusinessRoles } from './business-reports.ts'
import type { Base } from './business-access.ts'
import { diveFilters, storesOfReport, storesReached, type ReportRecord } from './dive-filters.ts'
import { MONTH_CHOICES, buildReport, dayLabel, monthLabel, headingOf, istToday, periodOf, storeLabels, storeShortName, type CachedAnswer, type Heading, type Month, type MonthChoice, type SalesRow } from './report.ts'
import { actions as sectionActions, reads as sectionReads } from './my-sections.ts'
import { departmentActions, departmentReads } from './department-setup.ts'
import { storeActions, storeReads } from './my-store.ts'
import { buyerSectionActions, buyerSectionReads } from './buyer-sections.ts'
import { coverageReads } from './coverage.ts'
import { prefillActions } from './department-prefill.ts'
import { accessPage, addReport, addToBundle, diveChoices, diveChoicesPrepared, giveReport, grantOptions, makeBundle, managesAccess, managesTeamAccess, personLookup, personSearch, removeAccess, removeFromBundle, reportsGivenNow, validators as accessValidators, type AccessContext } from './report-access-server.ts'
import { TEAM_MANAGER } from './team-access.ts'
import { viewAsPeople } from './view-as-people.ts'
import { describePeople } from './people-describe.ts'
import { DASH_ROLES, offeredByPlaces, openableByReach, opensDashFor } from './report-eligibility.ts'
import { accessChanges, addStartingRoles, businessRoles, explainPerson, giveRole, mapTitle, removeRole } from './business-roles-server.ts'

/** The save rules of Dash's own Tables. */
export const validators = accessValidators

/** The places each person covers: by business roles, or by the old rules, as dash.access_source says (#1277). */
export const scopeProviders = { org_chart: dashScopeProvider() }

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
  /** The signed-in person's name, as the platform knows it. */
  userName?: string
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

/** #1277: what decides Dash access for this request. */
const sourceOf = (ctx: ScopedContext) => accessSource(ctx.baseTables as Base)


/** #1218: the Dash Tables whose records open on a page only a company-wide manager may open. */
const MANAGERS_PAGES = new Set(['dash.business_role', 'dash.report_bundle'])

/** Dash's own roles (featherbase.json's `roles`): holding any of them opens Dash (#1172). */
export { DASH_ROLES }

const REPORT_FIELDS = ['report_key', 'report_name', 'dive_id', 'filter_shape', 'store_key', 'subcategory_key', 'whole_store_key', 'month_key', 'ready_signal', 'quick_view', 'pickers_in_dive']

/**
 * The one place that decides which reports this person may open: the reports given to them by
 * any route (#1046), read fresh on every request. No row means no report, for everyone. Someone
 * whose job reaches nothing gets only a given report that takes no filter: a grant never widens
 * which stores a person sees. Unreadable means nothing.
 */
export async function reportsFor(ctx: ScopedContext): Promise<ReportRecord[]> {
  let given: Set<string>
  try {
    // One reading of the switch for the whole read; places worked out under the other rules give nothing.
    const source = await sourceOf(ctx)
    const placedBy = placesSource(ctx.authorization?.places ?? [])
    if (placedBy && placedBy !== source) return []
    given = new Set((await reportsGivenNow(ctx.baseTables as Base, ctx.user, ctx.roles ?? [], istToday(), source)).keys())
  } catch { return [] }
  if (!given.size) return []
  const rows = await ctx.documents.list('dash.report', { fields: REPORT_FIELDS, order_by: 'report_name asc', limit_page_length: 200 })
  const reports = rows.map(row => ({ ...row, ready_signal: checked(row.ready_signal), pickers_in_dive: checked(row.pickers_in_dive) }) as unknown as ReportRecord).filter(report => given.has(report.report_key))
  const reaches = await reachesSomething(ctx)
  return reports.filter(report => openableByReach(report.filter_shape, reaches))
}

/**
 * The reports offered to the reader, in the sidebar and for opening Dash: a whole-stores report
 * isn't offered to someone without a whole store (#967 point 1); opened by its address, it still
 * says why.
 */
async function offeredReports(ctx: ScopedContext): Promise<ReportRecord[]> {
  const reports = await reportsFor(ctx)
  const places = reports.some(report => report.filter_shape === 'Whole stores') ? await placesHeld(ctx) : []
  return reports.filter(report => offeredByPlaces(report.filter_shape, places))
}

/** The reader's places: a person_scope read's, else worked out from the core Tables. Unreadable means none. */
async function placesHeld(ctx: ScopedContext): Promise<readonly Place[]> {
  if (ctx.authorization?.places?.length) return ctx.authorization.places
  try { return (await liveReach(ctx.baseTables as Base, ctx.user, ctx.roles ?? [], istToday())).places } catch { return [] }
}

/** A person_scope read already holds the reader's places; any other read works them out. Unreadable means nothing. */
async function reachesSomething(ctx: ScopedContext): Promise<boolean> {
  if (ctx.authorization?.places?.length) return true
  try { return (await liveReach(ctx.baseTables as Base, ctx.user, ctx.roles ?? [], istToday())).places.length > 0 } catch { return false }
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

/**
 * #1159: for a Dive with its own pickers, the store the address names when it is the reader's, else
 * none: the Dive opens on its first store, and the address never refuses the page.
 */
function storeInReach(ctx: ScopedContext): string | undefined {
  const named = (ctx.payload as { store?: unknown } | undefined)?.store
  return typeof named === 'string' && storesReached(placesOf(ctx)).includes(named) ? named : undefined
}

/**
 * The store a report's page reads: the chosen one. For a Dive with its own pickers, the address's;
 * else where the Dive opens with none named (agreed with v16): the reader's first store A–Z that
 * has figures in the cached copy, or their first A–Z when none has.
 */
async function storeOfPage(ctx: ScopedContext, report: ReportRecord): Promise<string | undefined> {
  if (!report.pickers_in_dive) return chosenStore(ctx, report)
  const named = storeInReach(ctx)
  if (named) return named
  const reached = storesReached(placesOf(ctx))
  const byName = storeLabels(reached, await storeNames(ctx, reached)).map(option => option.value)
  // The platform limits the cached copy to the reader's places. Figures are rows of the month on
  // show with a day of actuals, as the quick view counts them; an earlier month's rows are none.
  const month = chosenMonth(ctx)
  const { period_start: start } = periodOf(istToday(), month)
  const cached = await ctx.datasets.active(DATASETS[month].sales).catch(() => null)
  const withFigures = new Set(((cached?.rows ?? []) as SalesRow[])
    .filter(row => row.period_start === start && !!row.data_through && row.data_through >= start).map(row => String(row.store_code)))
  return byName.find(store => withFigures.has(store)) ?? byName[0]
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

/**
 * A store's name from the core Tables, for the page's header and the bar. The owner's rule
 * (#1153, 10-Nov-2026): a store goes by its Site's name, unless more than one plant shares that
 * site; then each of them goes by its Plant name. Every plant on the site counts, whoever reads,
 * except a retired one, which the platform's reads leave out. An instance whose Plant Table has no
 * Plant name keeps the Site names.
 */
async function storeNames(ctx: ScopedContext, stores: readonly string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  if (!stores.length) return names
  const plantsOf = (fields: string[], filters: [string, string, unknown][]) =>
    ctx.baseTables.list('Plant', { fields, filters, limit_page_length: 500 })
  const withNames = await plantsOf(['row_id', 'site', 'plant_name'], [['row_id', 'in', [...stores]]]).catch(() => null)
  const plants = withNames ?? await plantsOf(['row_id', 'site'], [['row_id', 'in', [...stores]]])
  const siteIds = [...new Set(plants.map(plant => String(plant.site)))]
  const sites = await ctx.baseTables.list('Site', { fields: ['row_id', 'name'], filters: [['row_id', 'in', siteIds]], limit_page_length: 500 })
  const siteName = new Map(sites.map(site => [String(site.row_id), String(site.name)]))
  // How many plants each site holds, the reader's or not: only a shared site's plants need it.
  const onSite = new Map<string, number>()
  if (withNames && siteIds.length)
    for (const plant of await plantsOf(['row_id', 'site'], [['site', 'in', siteIds]])) onSite.set(String(plant.site), (onSite.get(String(plant.site)) ?? 0) + 1)
  for (const plant of plants) {
    const plantName = typeof plant.plant_name === 'string' ? plant.plant_name.trim() : ''
    const name = (onSite.get(String(plant.site)) ?? 0) > 1 && plantName ? plantName : siteName.get(String(plant.site))
    if (name) names.set(String(plant.row_id), name)
  }
  return names
}

/** #1240: the reader's jobs (why they see what they see) and each store they reach, by name, whole or by section and subcategory. */
async function reachInWords(ctx: ScopedContext) {
  const places = await placesHeld(ctx)
  const stores = storesReached(places)
  const names = await storeNames(ctx, stores).catch(() => new Map<string, string>())
  const jobs = [...new Set(places.flatMap(place => (place.reasons ?? []).map(reason => reason.since ? `${reason.text}, since ${dayLabel(reason.since)}` : reason.text)))].sort()
  const reach = stores.map(store => {
    const here = places.filter(place => (place.filters.store ?? []).includes(store))
    const whole = here.some(place => !place.filters.subcategory)
    return { store, name: names.get(store) ?? null, whole, sections: whole ? [] : headingOf(places, store, null).sections,
      // Not whole: every place here names its subcategories.
      subcategories: whole ? [] : [...new Set(here.flatMap(place => place.filters.subcategory!))].sort() }
  })
  return { jobs, reach }
}

/** What a report's first answer says, for a report with no quick view: whether it can open, and its header. */
type Plain = { state: 'ready'; no_quick_view: true; heading: Heading; period_start?: string; period_end?: string }

/** A fresh MotherDuck embed session for a report's Dive, opening its latest saved version, with only filters in its state. */
/** What `embed_session` reads in the transaction: the report, and every Subcategory code when its Dive reads `reach`. */
interface PreparedDive { report: ReportRecord; everyCode?: string[] }

/** The report's Dive reads `reach`: each store's subcategories, which #1269 collapses to code prefixes. */
const readsReach = (report: ReportRecord) => report.pickers_in_dive || report.filter_shape === 'Stores and subcategories'

/**
 * #1269: every Subcategory code, of any type and retired ones too: a retired code still has sales a
 * prefix would match. Without the Table nothing collapses. A page that fails fails the whole read
 * (the platform rethrows it when the read ends), so a list cut short never makes a prefix look held.
 */
async function everySubcategoryCode(ctx: ScopedContext): Promise<string[] | undefined> {
  if (!await ctx.baseTables.available?.('Subcategory')) return undefined
  const codes: string[] = []
  for (;;) {
    const page = await ctx.baseTables.list('Subcategory', { fields: ['row_id'], order_by: 'row_id asc', limit_start: codes.length, limit_page_length: 500, with_retired: true })
    codes.push(...page.map(row => String(row.row_id)))
    if (page.length < 500) return codes
  }
}

/** MotherDuck's answer to an embed request too large to take: the page says so, not "couldn't open". */
const TOO_LARGE = 413

async function openDive(ctx: ScopedContext, report: ReportRecord | null, everyCode?: readonly string[]) {
  if (!report) return { refused: 'no_access' }
  const { embed_service_account: account } = ctx.settings
  // #1139: its own token. The warehouse token (MOTHERDUCK_TOKEN) is a read-only account's, which
  // can't create embed sessions; the platform hands this one only to the two reads opening a Dive.
  const token = ctx.secrets.MOTHERDUCK_EMBED_TOKEN
  if (!report.dive_id || !account || !token) return { not_set_up: true }
  const store = report.pickers_in_dive ? storeInReach(ctx) : chosenStore(ctx, report)
  const month = chosenMonth(ctx)
  const period = periodOf(istToday(), month)
  const origin = appOrigin((ctx.payload as { app_origin?: unknown } | undefined)?.app_origin)
  const filters = diveFilters(report, placesOf(ctx), { store, month, periodEnd: period.period_end, appOrigin: origin, everyCode })
  if ('refused' in filters) return { refused: filters.refused }
  const body = JSON.stringify({ username: account, initial_state: filters.state })
  // #1269: the request's size, for whoever runs the instance: the reach is what grows.
  const bytes = Buffer.byteLength(body)
  let failure: string
  let tooLarge = false
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
      console.info(JSON.stringify({ event: 'dash_embed_session_opened', person: ctx.user, bytes }))
      return { frame: `${EMBED_ORIGIN}/sandbox/#session=${encodeURIComponent(answered.session)}`,
        ...(report.ready_signal ? { ready_signal: true } : {}) }
    }
    failure = `embed API answered HTTP ${response.status}`
    tooLarge = response.status === TOO_LARGE
  } catch (error) {
    failure = abort.signal.aborted ? `embed API gave no answer in ${EMBED_API_TIMEOUT_MS} ms`
      : `embed API unreachable: ${(error as Error)?.constructor?.name ?? 'error'}`
  } finally {
    clearTimeout(timer)
  }
  // For whoever runs the instance: the person's opaque id and the status, never the token or the upstream text.
  console.error(JSON.stringify({ event: 'dash_embed_session_failed', person: ctx.user, message: failure, bytes }))
  return tooLarge ? { too_large: true } : { unreachable: true }
}

/** Your sections and its approvals (#975), and giving reports (#1046). */
/** What a person reaches today, for Report access: any store, and a whole store. Unreadable means nothing. */
const reachFor = (context: AccessContext) => async (person: string, roles: readonly string[]) => {
  try {
    const { places } = await liveReach((context as unknown as ScopedContext).baseTables as Base, person, roles, istToday())
    return { any: places.length > 0, wholeStore: places.some(place => !place.filters.subcategory) }
  } catch { return { any: false, wholeStore: false } }
}
/** #1217: a Team Report Manager gives only reports they can open, so the access reads and actions know reach. */
const withReach = (context: AccessContext): AccessContext => ({ ...context, reach: reachFor(context) })

export const actions = {
  ...sectionActions,
  ...departmentActions,
  ...storeActions,
  ...buyerSectionActions,
  ...prefillActions,
  give_report: (context: AccessContext) => giveReport(withReach(context)),
  remove_report_access: (context: AccessContext) => removeAccess(withReach(context)),
  make_bundle: (context: AccessContext) => makeBundle(context),
  add_to_bundle: (context: AccessContext) => addToBundle(context),
  remove_from_bundle: (context: AccessContext) => removeFromBundle(context),
  add_report: (context: AccessContext) => addReport(context),
  // #1218: business roles in shadow; they change no one's access.
  give_role: (context: AccessContext) => giveRole(context),
  remove_role: (context: AccessContext) => removeRole(context),
  map_title: (context: AccessContext) => mapTitle(context),
  add_starting_roles: (context: AccessContext) => addStartingRoles(context),
  /** #1277 (J3): the old grants given to business roles, logged, only when a System Manager asks; rerunning adds nothing. */
  give_old_grants_to_roles: (context: AccessContext) => giveOldGrantsAction(context),
}

export const reads = {
  ...sectionReads,
  ...departmentReads,
  ...storeReads,
  ...buyerSectionReads,
  ...coverageReads,

  /**
   * Which records this viewer may open on Dash's own pages (record-link.tsx): people, departments and sections by
   * coverage.ts's rules; #1218: a report they are offered opens as itself, and a business role or a bundle on the
   * pages that show them, which only a company-wide manager may open.
   */
  async dash_pages_open(context: ReadContext) {
    const answers = await coverageReads.dash_pages_open(context as never) as boolean[]
    const manager = managesAccess(context as AccessContext)
    const offered = new Set((await offeredReports(context as ScopedContext)).map(report => report.report_key))
    return answers.map((answer, i) => {
      const { table, id } = (context.payload as { refs: { table: unknown; id: unknown }[] }).refs[i]
      return table === 'dash.report' ? offered.has(String(id)) : MANAGERS_PAGES.has(String(table)) ? manager : answer
    })
  },

  /** The signed-in person, as the platform knows them. */
  me({ user }: ReadContext) {
    return { user }
  },

  /**
   * The app's gate. #1172 (owner, 10-Nov-2026, "Open for any Dash role"), refining #1046: Dash opens
   * for anyone holding one of its roles, so someone whose job reaches no store sees Dash's reason.
   * It opens no data: reports, rows and the Dive still need reach, or a report taking no filter.
   */
  async can_open(context: ReadContext) {
    const ctx = context as ScopedContext
    const roles = ctx.roles ?? []
    const source = await sourceOf(ctx)
    if (source === BUSINESS_ROLES) {
      // #1277 (D3): behind the platform's door (a Dash role), a business role holding a Dash permission opens it, as does a role that manages access.
      if (opensDashByBusinessRoles(roles, false, 0)) return true
      const { access } = await liveReach(ctx.baseTables as Base, ctx.user, roles, istToday(), source)
      return opensDashByBusinessRoles(roles, !!access?.opens, access?.opens ? 0 : (await offeredReports(ctx)).length)
    }
    // Asked first without reports: a Dash role opens it with no read of reach.
    return opensDashFor(roles, 0) || opensDashFor(roles, (await offeredReports(ctx)).length)
  },

  /** Whether this person manages report access, company-wide or for their team (#1217), for the sidebar's link. */
  manages_access(context: ReadContext) {
    return managesAccess(context as AccessContext) || managesTeamAccess(context as AccessContext)
  },

  /** #1218: whether this person sees the business roles pages (company-wide managers only), for the sidebar's links. */
  manages_roles: (context: ReadContext) => managesAccess(context as AccessContext),
  /** #1218, in shadow: the Business Roles page, Explain a person, and Who would gain or lose access. Company-wide managers only. */
  business_roles: (context: ReadContext) => businessRoles(context as AccessContext),
  explain_person: (context: ReadContext) => explainPerson(context as AccessContext),
  access_changes: (context: ReadContext) => accessChanges(context as AccessContext),
  /** #1277: what decides Dash access now, and the business roles log. Company-wide managers only. */
  access_source: (context: ReadContext) => businessAccessSummary(context as AccessContext),
  switch_over_log: (context: ReadContext) => switchOverLog(context as AccessContext),

  /** The Report access page (#1046). Managers only. */
  access_page: (context: ReadContext) => accessPage(withReach(context as AccessContext)),
  /** #1173: what the platform's Waiting for access drawer can give one person. Company managers only. */
  grant_options: (context: ReadContext) => grantOptions(context as AccessContext, istToday()),
  person_search: (context: ReadContext) => personSearch(withReach(context as AccessContext)),

  /**
   * The organisation's Dives for Add a Dive (#1169), read live from MotherDuck (outbound: it runs
   * after the transaction has closed, so `prepare` reads which Dives are already reports).
   */
  dive_choices: Object.assign(async (context: ReadContext) => diveChoices(context as AccessContext & Pick<ReadContext, 'datasets'>,
    (context as ScopedContext).prepared as Awaited<ReturnType<typeof diveChoicesPrepared>> | undefined), {
    prepare: (context: ReadContext) => diveChoicesPrepared(context as AccessContext),
  }),
  /** #1222: View as's people, for the platform's picker; run as the tester. View As Testers only. */
  view_as_people: (context: ReadContext) => viewAsPeople(context as AccessContext),
  /** #1267: who people are (Employee, Former Employee, External), for the Person page; the platform's actor only. */
  describe_people: (context: ReadContext) => describePeople(context as AccessContext),
  person_lookup: (context: ReadContext) => personLookup(withReach(context as AccessContext), istToday(), reachFor(context as AccessContext)),

  /** The reports this person may open, for the sidebar. */
  async reports(context: ReadContext) {
    return (await offeredReports(context as ScopedContext)).map(report => ({ key: report.report_key, name: report.report_name,
      // #1159: a Dive with its own pickers takes neither from the bar.
      takes_store: report.filter_shape === 'One store and subcategories' && !report.pickers_in_dive, takes_month: !!report.month_key && !report.pickers_in_dive,
      no_filter: report.filter_shape === 'No filter', ...(report.pickers_in_dive ? { pickers_in_dive: true } : {}) }))
  },

  /** Why this person's job reaches nothing, for the page's message. */
  async reach_problem(context: ReadContext) {
    const ctx = context as ScopedContext
    return { problems: (await liveReach(ctx.baseTables as Base, ctx.user, ctx.roles ?? [], istToday())).problems }
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
    if (!report?.month_key || report.pickers_in_dive) return []
    const today = istToday()
    return MONTH_CHOICES.map(choice => ({ value: choice,
      label: `${choice === 'this' ? 'This month' : 'Last month'} · ${monthLabel(periodOf(today, choice).period_start)}` }))
  },

  /**
   * #1240: what "Report an issue" sends with the reader's words: the report, who they are, their
   * jobs and what they reach, store by store. Read as the reader, for a report that is theirs; the
   * ticket is raised in Tickets by the reader themselves, so nothing here writes.
   */
  async feedback_context(context: ReadContext) {
    const ctx = context as ScopedContext
    const report = await chosenReport(ctx)
    if (!report) return { state: 'no_access' }
    return { state: 'ok', report: { key: report.report_key, name: report.report_name }, person: ctx.userName ?? null,
      ...await reachInWords(ctx) }
  },

  /** Whether the chosen report can open for this reader, its header, and its quick view's figures if it has one. */
  async report(context: ReadContext) {
    const ctx = context as ScopedContext
    const report = await chosenReport(ctx)
    if (!report) return { state: 'no_access' }
    const store = await storeOfPage(ctx, report)
    const month = chosenMonth(ctx)
    const period = periodOf(istToday(), month)
    const filters = diveFilters(report, placesOf(ctx), { store, month, periodEnd: period.period_end, appOrigin: null })
    if ('refused' in filters) return { state: filters.refused === 'not_your_store' ? 'no_access' : filters.refused }
    // #1159: the page draws no heading over a Dive with its own pickers, only over its cached view.
    const marked = report.pickers_in_dive ? { pickers_in_dive: true } : {}
    if (report.quick_view && store) {
      const figures = await salesReport(ctx, store)
      await ctx.recordView({ dataset: DATASETS[figures.month].sales })
      return { ...figures, ...marked }
    }
    const names = await storeNames(ctx, store ? [store] : [])
    const plain: Plain = { state: 'ready', no_quick_view: true, heading: store ? headingOf(placesOf(ctx), store, names.get(store) ?? null) : { name: null, sections: [], reasons: [] },
      ...(report.month_key ? { period_start: period.period_start, period_end: period.period_end } : {}) }
    return { ...plain, ...marked }
  },

  /**
   * A fresh MotherDuck embed session for the chosen report's Dive, opening its latest saved version
   * (outbound: it runs after the platform's transaction has closed, so `prepare` reads the row). The
   * Dive's state carries only filters.
   */
  embed_session: Object.assign(async (context: ReadContext) => {
    const prepared = (context as ScopedContext).prepared as PreparedDive | null
    return openDive(context as ScopedContext, prepared?.report ?? null, prepared?.everyCode)
  }, {
    /** In the transaction: the report's row, and the codes its reach collapses against, which the handler can no longer read. */
    prepare: async (context: ReadContext): Promise<PreparedDive | null> => {
      const report = await chosenReport(context as ScopedContext)
      if (!report) return null
      return readsReach(report) ? { report, everyCode: await everySubcategoryCode(context as ScopedContext) } : { report }
    },
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

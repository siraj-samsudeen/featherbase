// Feather Dash's server module, loaded by the Featherbase platform at boot.
// The platform's app contract is structural: this module imports nothing from
// the platform. Reads are declared in featherbase.json under "reads"; the org
// chart Tables' save rules are its `validators`.
export { validators } from './validators.ts'
import { orgChartProvider, type Place } from './provider.ts'
import { EMBED_STATE_LIMIT_BYTES, MONTH_CHOICES, buildReport, monthLabel, headingOf, initialState, istToday, needsShortCodes, periodOf, storeLabels, storeShortName, storesOf, type CachedAnswer, type Month, type MonthChoice, type SalesRow } from './report.ts'
import { gzipBase64 } from './compress.ts'
import { actions as sectionActions, reads as sectionReads } from './my-sections.ts'

/** The places each person covers (featherbase B2), per store: the new org chart or today's derivation. */
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

/**
 * How long the store picker waits for the stores' names before offering them by code: well
 * inside the page's own waits, since the bar reads its options once and can't fill names later.
 */
export const STORE_NAMES_TIMEOUT_MS = 800

/** Where MotherDuck serves embedded Dives (featherbase.json's `frameOrigins`) and mints their sessions. */
export const EMBED_ORIGIN = 'https://embed-motherduck.com'
const EMBED_API = 'https://api.motherduck.com'

/** How long the embed API has to mint a session; the platform puts no limit on an outbound read. */
export const EMBED_API_TIMEOUT_MS = 10_000

/** What the platform hands a read handler (the part this module uses). */
interface ReadContext {
  user: string
  payload?: unknown
  authorization?: { places?: readonly Place[] }
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

/** The store the read is for: the one the payload names, which must be the reader's own, or their first. */
function chosenStore(ctx: ScopedContext): string {
  const stores = storesOf(placesOf(ctx))
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


async function cachedRows(ctx: ScopedContext, store: string | undefined, month: MonthChoice): Promise<CachedAnswer> {
  const answer = await ctx.datasets.active(DATASETS[month].sales, store ? { store_code: store } : undefined)
  return answer ? { at: answer.at, rows: answer.rows as SalesRow[] } : null
}

/** The month's metadata as the store's snapshot has it: any of the reader's rows carries the same values. */
async function monthOf(ctx: ScopedContext, store: string, month: MonthChoice): Promise<Month | null> {
  const answer = await ctx.datasets.active(DATASETS[month].month, { store_code: store })
  const row = (answer?.rows as Month[] | undefined)?.[0]
  return row && answer ? { period_start: row.period_start, data_through: row.data_through, targets_available: row.targets_available, at: answer.at,
    store_name: row.store_name ?? null } : null
}

async function storeReport(ctx: ScopedContext) {
  const store = chosenStore(ctx)
  const choice = chosenMonth(ctx)
  const answer = await cachedRows(ctx, store, choice)
  const month = await monthOf(ctx, store, choice)
  const today = istToday()
  const report = buildReport({ store, places: placesOf(ctx), answer, month, today, choice })
  return { answer, today, report, heading: headingOf(placesOf(ctx), store, storeShortName(report, month)) }
}

/** Your sections and its approvals (#975). */
export const actions = sectionActions

export const reads = {
  ...sectionReads,

  /** The signed-in person, as the platform knows them. */
  me({ user }: ReadContext) {
    return { user }
  },

  /**
   * The bar's store picker (the platform's bar draws these labels, the single-store label too):
   * the reader's stores from their places alone. Each is named from the month's metadata
   * (`sales_month`, which names every store for every reader of it alike) by its name alone,
   * never its plant code (#4531). Only when names are missing or shared are the reader's cached
   * figures asked for short codes to tell the stores apart (`storeLabels`). When the names are
   * slow (STORE_NAMES_TIMEOUT_MS) or fail, the stores are "Store 1", "Store 2" or "Your store".
   */
  async stores(context: ReadContext) {
    const ctx = context as ScopedContext
    const stores = storesOf(placesOf(ctx))
    const names = new Map<string, string>()
    let timer: ReturnType<typeof setTimeout> | undefined
    let named = false
    try {
      const answer = await Promise.race([
        ctx.datasets.active(MONTH_DATASET),
        new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), STORE_NAMES_TIMEOUT_MS) }),
      ])
      for (const row of (answer?.rows ?? []) as { store_code: string; store_name: string | null }[])
        if (row.store_name && !names.has(row.store_code)) names.set(row.store_code, row.store_name)
      named = !!answer
    } catch {
      // Labelled by code: the names are a convenience, the stores are the reader's places.
    } finally {
      clearTimeout(timer)
    }
    // Short codes come from the reader's own cached rows, asked only when the names can't tell
    // the stores apart, and only when the names answered in time (else the budget is spent).
    const shorts = new Map<string, string>()
    if (named && needsShortCodes(stores, names)) {
      try {
        const answer = await Promise.race([
          ctx.datasets.active(SALES_DATASET),
          new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), STORE_NAMES_TIMEOUT_MS) }),
        ])
        for (const row of (answer?.rows ?? []) as SalesRow[])
          if (row.short_code && stores.includes(row.store_code) && !shorts.has(row.store_code)) shorts.set(row.store_code, row.short_code)
      } catch {
        // Numbered instead: the labels are a convenience, the stores are the reader's places.
      } finally {
        clearTimeout(timer)
      }
    }
    return storeLabels(stores, names, shorts)
  },

  /**
   * The bar's month picker (#750): this month and last month, each named by its month
   * ("This month · Nov'26"). The values are the choice, not the month, so an address keeps its
   * meaning ("last month") from one month to the next.
   */
  months() {
    const today = istToday()
    return MONTH_CHOICES.map(choice => ({ value: choice,
      label: `${choice === 'this' ? 'This month' : 'Last month'} · ${monthLabel(periodOf(today, choice).period_start)}` }))
  },

  /** One store's report from the cached rows (what the quick view shows), with the page's header (#4486). */
  async report(context: ReadContext) {
    const ctx = context as ScopedContext
    const { report, heading } = await storeReport(ctx)
    await ctx.recordView({ dataset: DATASETS[report.month].sales })
    return { ...report, heading }
  },

  /**
   * A fresh MotherDuck embed session for the reader's Dive (outbound: it runs after the
   * platform's transaction has closed). The Dive's state carries the reader's store,
   * scope (a section reader's subcategories, or the whole store) and the cached month to date
   * under `cached`, on the first rung of the 56 KB ladder that fits (`initialState`).
   */
  async embed_session(context: ReadContext) {
    const ctx = context as ScopedContext
    const store = chosenStore(ctx)
    const choice = chosenMonth(ctx)
    // The latest saved Dive, always (#937): MotherDuck renders it when no version is asked for,
    // so publishing a Dive is its release, and the Dive reads every state this app sends.
    const { dive_id: diveId, embed_service_account: account } = ctx.settings
    if (!diveId || !account) return { not_set_up: true }
    let answer: CachedAnswer = null
    let month: Month | null = null
    try {
      answer = await cachedRows(ctx, store, choice)
      month = await monthOf(ctx, store, choice)
    } catch {
      // The Dive reads the warehouse itself; without a cached copy it opens without one.
    }
    const today = istToday()
    const report = buildReport({ store, places: placesOf(ctx), answer, month, today, choice })
    const origin = appOrigin((ctx.payload as { app_origin?: unknown } | undefined)?.app_origin)
    const state = initialState(report, answer, placesOf(ctx), today, { appOrigin: origin, compress: gzipBase64, format: 'compact' })
    // Past MotherDuck's cap the session would be refused: never trimmed, the page shows the cached
    // table. The operator log names the store, never the person.
    const stateBytes = new TextEncoder().encode(JSON.stringify(state)).length
    if (stateBytes > EMBED_STATE_LIMIT_BYTES) {
      console.warn(JSON.stringify({ event: 'feather_dash_embed_state_too_large', store, bytes: stateBytes, limit: EMBED_STATE_LIMIT_BYTES,
        message: `Store ${store}'s interactive report exceeds the embed size limit; readers see the cached table.` }))
      return { too_large: true }
    }
    const body = JSON.stringify({ username: account, initial_state: state })
    let failure: string
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), EMBED_API_TIMEOUT_MS)
    try {
      const response = await (embedFetch ?? fetch)(`${EMBED_API}/v1/dives/${encodeURIComponent(diveId)}/embed-session`, {
        method: 'POST', headers: { authorization: `Bearer ${ctx.secrets.MOTHERDUCK_TOKEN}`, 'content-type': 'application/json' }, body,
        signal: abort.signal,
      })
      const answered = await response.json().catch(() => null) as { session?: unknown } | null
      if (response.ok && typeof answered?.session === 'string') {
        await ctx.recordView({ dataset: DATASETS[choice].sales })
        // `dive_ready_signal: on`: the Dive posts { type: 'feather-dash:dive-ready' } once it has drawn
        // (B7), and the page waits for it rather than trusting the frame's load event.
        return { frame: `${EMBED_ORIGIN}/sandbox/#session=${encodeURIComponent(answered.session)}`,
          ...(ctx.settings.dive_ready_signal === 'on' ? { ready_signal: true } : {}) }
      }
      failure = `embed API answered HTTP ${response.status}`
    } catch (error) {
      failure = abort.signal.aborted ? `embed API gave no answer in ${EMBED_API_TIMEOUT_MS} ms`
        : `embed API unreachable: ${(error as Error)?.constructor?.name ?? 'error'}`
    } finally {
      clearTimeout(timer)
    }
    // For whoever runs the instance: the person's opaque id and the status, never the token or the upstream text.
    console.error(JSON.stringify({ event: 'feather_dash_embed_session_failed', person: ctx.user, message: failure }))
    return { unreachable: true }
  },
}

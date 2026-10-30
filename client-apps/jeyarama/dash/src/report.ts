// The report: one store's month-to-date target against sales, built from the
// reader's cached rows (the `sales_to_date` dataset, already limited to the
// reader's places by the platform) and the reader's places. The arithmetic is
// featherbase's `sales-target-report.ts` (`shape`, `totalOf`) moved here, line
// for line, so the quick view and the Dive's cache agree with today's report.
import { sectionLabel, type Place } from './provider.ts'

/** One row of the `sales_to_date` dataset: a store and subcategory, month to date. */
export interface SalesRow {
  store_code: string
  store_name: string | null
  short_code: string | null
  subcategory_code: string
  subcategory: string | null
  target: number | null
  actual: number | null
  days_with_actual: number
  days: number
  period_start: string
  data_through: string | null
  targets_available: boolean
  /** The days with a target, month to date: only for the refresh guard (#4449), never shown. */
  target_days: number
}

/**
 * The month as the warehouse has it, from the snapshot as a whole (the `sales_month` dataset):
 * metadata only, never a figure. It tells a month that hasn't arrived from a section that simply
 * sold nothing, whose scoped rows are empty either way.
 */
export interface Month {
  period_start: string
  data_through: string | null
  targets_available: boolean
  /** When its snapshot was activated (ISO instant). */
  at?: string
  /** The store's name, for the page's header when the reader has no row of figures (#4486). */
  store_name?: string | null
}

/** What the platform's `datasets.active` answers, as far as the report uses it; null when nothing is cached yet. */
export type CachedAnswer = { at: string; rows: SalesRow[] } | null

export interface ReportRow {
  code: string
  /** The subcategory's name; null when the store had no row for it this month. */
  subcategory: string | null
  section: string | null
  target: number | null
  actual: number | null
  gap: number | null
  achievement: number | null
  missingActual: boolean
  /** ₹0 target and ₹0 sales (the old report's rule): hidden by default. */
  noTargetNoSale: boolean
  /** The warehouse has a target for it this month (else `target` is the old report's ₹0). */
  targetRecorded: boolean
  /** The warehouse has a day of sales for it this month (else `actual` is ₹0 or missing). */
  salesRecorded: boolean
}

export interface Totals {
  target: number | null
  actual: number | null
  gap: number | null
  achievement: number | null
  missing: number
  no_target_no_sale: number
  n: number
  /** Rows that recorded a target, and rows that recorded sales: for the display rule only, never in a sum. */
  targets_recorded: number
  sales_recorded: number
}

/** `unconfirmed`: the reader has no row, and no metadata compatible with the figures says whether the month has arrived. */
export type ReportState = 'ready' | 'not_built' | 'no_data_yet' | 'no_sections' | 'unconfirmed'

export interface Report {
  state: ReportState
  store: string
  store_name: string | null
  short_code: string | null
  period_start: string
  period_end: string
  /** When the cached copy was made (ISO instant). */
  refreshed_at: string | null
  /** The last day the warehouse has actuals for. */
  data_through: string | null
  targets_available: boolean
  rows: ReportRow[]
  sections: (Totals & { section: string | null })[]
  total: Totals
  /** What the page's header says about the store (#4486); the `report` read adds it. */
  heading?: Heading
}

/** One reason the reader sees the store: a basis on their places there, and the sections those places name. */
export interface Reason { basis: string; sections: string[] }

/** The page's header for one store: its short name (null when unknown), its sections, and why the reader sees it. */
export interface Heading { name: string | null; sections: string[]; reasons: Reason[] }

/**
 * The reader's reasons in one store, from their places there: each basis a place carries (the
 * provider joins several with ", "), with the sections of the places carrying it. A place named
 * by the store itself (a whole store, or subcategories outside the map) adds no section.
 */
export function headingOf(places: readonly Place[], store: string, name: string | null): Heading {
  const prefix = sectionLabel(store, '')
  const sections = new Set<string>()
  const byBasis = new Map<string, Set<string>>()
  for (const place of places) {
    if (!(place.filters.store ?? []).includes(store)) continue
    const section = place.label.startsWith(prefix) ? place.label.slice(prefix.length) : null
    if (section) sections.add(section)
    for (const basis of (place.basis ?? '').split(',').map(b => b.trim()).filter(Boolean)) {
      const named = byBasis.get(basis) ?? new Set<string>()
      if (section) named.add(section)
      byBasis.set(basis, named)
    }
  }
  const sorted = (values: Iterable<string>) => [...values].sort((a, b) => a.localeCompare(b))
  return { name, sections: sorted(sections),
    reasons: [...byBasis].sort(([a], [b]) => a.localeCompare(b)).map(([basis, named]) => ({ basis, sections: sorted(named) })) }
}

/** The store's short name as people know it: its short code, else its name; never its plant code. */
export function storeShortName(report: { short_code: string | null; store_name: string | null }, month: { store_name?: string | null } | null): string | null {
  return report.short_code || report.store_name || month?.store_name || null
}

/** Today in India Standard Time. */
export function istToday(now = Date.now()): string {
  return new Date(now + 330 * 60_000).toISOString().slice(0, 10)
}

/** Month to date: the first of the month through today. */
export function periodOf(today: string) {
  return { period_start: `${today.slice(0, 8)}01`, period_end: today }
}

/** Every store the reader's places name, by plant code. */
export function storesOf(places: readonly Place[]): string[] {
  return [...new Set(places.flatMap(p => p.filters.store ?? []))].sort()
}

/** The reader's scope in one store: the whole store, or its subcategories; and each subcategory's section. */
export function scopeIn(places: readonly Place[], store: string) {
  const mine = places.filter(p => (p.filters.store ?? []).includes(store))
  const prefix = sectionLabel(store, '')
  const sectionOf: Record<string, string> = {}
  for (const p of [...mine].sort((a, b) => a.label.localeCompare(b.label)))
    if (p.label.startsWith(prefix)) for (const code of p.filters.subcategory ?? []) sectionOf[code] ??= p.label.slice(prefix.length)
  return {
    wholeStore: mine.some(p => !p.filters.subcategory),
    codes: [...new Set(mine.flatMap(p => p.filters.subcategory ?? []))].sort(),
    sectionOf,
    hasSections: mine.some(p => p.label.startsWith(prefix)),
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100

function totalOf(rows: ReportRow[]): Totals {
  const present = rows.filter(r => r.target != null)
  const target = present.length ? round2(present.reduce((a, r) => a + (r.target as number), 0)) : null
  const withActual = rows.filter(r => r.actual != null)
  const actual = withActual.length ? round2(withActual.reduce((a, r) => a + (r.actual as number), 0)) : null
  const gap = target != null && actual != null ? round2(actual - target) : null
  const achievement = target != null && target !== 0 && actual != null ? (100 * actual) / target : null
  return { target, actual, gap, achievement, missing: rows.filter(r => r.missingActual).length,
    no_target_no_sale: rows.filter(r => r.noTargetNoSale).length, n: rows.length,
    targets_recorded: rows.filter(r => r.targetRecorded).length, sales_recorded: rows.filter(r => r.salesRecorded).length }
}

const NO_ROW: SalesRow = { store_code: '', store_name: null, short_code: null, subcategory_code: '', subcategory: null, target: null,
  actual: null, days_with_actual: 0, days: 0, period_start: '', data_through: null, targets_available: true, target_days: 0 }

/** One store's month-to-date row per subcategory: the cached rows, and the reader's listed subcategories the store had no row for. */
function grouped(rows: SalesRow[], codes: string[]): SalesRow[] {
  const byCode = new Map(rows.map(r => [r.subcategory_code, r]))
  const absent = codes.filter(code => !byCode.has(code)).map((code): SalesRow => ({
    ...(rows[0] ?? NO_ROW), subcategory_code: code, subcategory: null, target: null, actual: null, days_with_actual: 0, days: 0, target_days: 0 }))
  return [...rows, ...absent]
}

interface BuildInput {
  store: string
  places: readonly Place[]
  answer: CachedAnswer
  /** The month's metadata; when unknown, the reader's own rows stand in for it. */
  month?: Month | null
  today: string
}

export function buildReport({ store, places, answer, month = null, today }: BuildInput): Report {
  const period = periodOf(today)
  const scope = scopeIn(places, store)
  const rows = (answer?.rows ?? []).filter(r => r.store_code === store)
  const first = rows[0]
  // The reader's own rows set the period, the cutoff and the targets. Only an empty scoped result
  // looks at the month's metadata, and only metadata compatible with the figures' snapshot: of
  // this month, and activated no earlier than that snapshot (they refresh apart).
  const istDay = (instant: string) => new Date(new Date(instant).getTime() + 330 * 60_000).toISOString().slice(0, 10)
  const compatible = !!month && !!answer && month.period_start === period.period_start && !!month.at && month.at >= answer.at
  const known: Month | null = first
    ? { period_start: first.period_start, data_through: first.data_through, targets_available: first.targets_available }
    : compatible ? month : null
  const empty = { target: null, actual: null, gap: null, achievement: null, missing: 0, no_target_no_sale: 0, n: 0, targets_recorded: 0, sales_recorded: 0 }
  const base = { store, store_name: first?.store_name ?? null, short_code: first?.short_code ?? null, ...period,
    refreshed_at: answer?.at ?? null, data_through: known?.data_through ?? null, targets_available: known?.targets_available ?? true,
    rows: [] as ReportRow[], sections: [], total: empty }
  if (!answer) return { ...base, state: 'not_built' }
  if (scope.wholeStore && !scope.hasSections) return { ...base, state: 'no_sections' }
  // Figures cut before this month began can't hold this month's figures.
  if (!first && istDay(answer.at) < period.period_start) return { ...base, state: 'no_data_yet' }
  // An empty scope with nothing compatible to say whether the month has arrived: not claimed
  // either way (the page still opens the Dive, which reads the warehouse itself).
  if (!known) return { ...base, state: 'unconfirmed' }
  // The month hasn't arrived (an earlier month's rows, or no day of actuals yet): never shown as zero.
  if (known.period_start !== period.period_start || !known.data_through || known.data_through < period.period_start)
    return { ...base, state: 'no_data_yet' }

  const targetsAvailable = known.targets_available
  // Parity first: the old report's arithmetic, line for line (featherbase `shape`). A target not
  // set is ₹0; a subcategory with no day row neither had a target nor sold (₹0 / ₹0); day rows
  // with no actual on any of them are missing, never ₹0. Whether each value was recorded rides
  // beside it, for the page's display rule.
  const shaped: ReportRow[] = grouped(rows, scope.codes).map(g => {
    const neither = g.days === 0
    const target = targetsAvailable ? g.target ?? 0 : null
    const actual = neither ? 0 : g.days_with_actual > 0 ? g.actual : null
    const gap = target != null && actual != null ? round2(actual - target) : null
    const achievement = target != null && target !== 0 && actual != null ? (100 * actual) / target : null
    return { code: g.subcategory_code, subcategory: g.subcategory, section: scope.sectionOf[g.subcategory_code] ?? null,
      target, actual, gap, achievement, missingActual: actual == null, noTargetNoSale: target === 0 && actual === 0,
      targetRecorded: targetsAvailable && g.target != null, salesRecorded: g.days_with_actual > 0 }
  })
  const key = (r: ReportRow) => (r.section == null ? '￿' : r.section)
  shaped.sort((a, b) => key(a).localeCompare(key(b)) || a.code.localeCompare(b.code))
  const names = [...new Set(shaped.map(r => r.section))]
  return { ...base, state: 'ready', targets_available: targetsAvailable, rows: shaped,
    sections: names.map(section => ({ section, ...totalOf(shaped.filter(r => r.section === section)) })), total: totalOf(shaped) }
}

/** MotherDuck caps `initial_state` at 64 KB; the cache rides only while the whole state fits in 56 KB (design D6). */
export const CACHE_BUDGET_BYTES = 56 * 1024

/**
 * The Dive's `initial_state`: the keys today's Dive reads (store, subcategories, their
 * sections, the period), plus `cached`, the reader's cached month-to-date rows shaped as
 * the Dive's own live query answers them, with their refresh time. A cache that would
 * take the state past the budget is left out whole, never cut: a partial cache would
 * read as a total.
 */
/** The Dive's `initial_state`. */
export interface InitialState {
  plant_code: string
  /**
   * The reader covers the whole store: the Dive should filter on `plant_code` alone, every
   * subcategory included (B7). `material_groups` still lists every subcategory known.
   */
  whole_store: boolean
  material_groups: string[]
  section_by_material_group: Record<string, string>
  period_start: string
  period_end: string
  cached?: {
    refreshed_at: string | null
    data_through: string | null
    rows: { hierarchy_code: string; subcategory: string | null; mtd_target: number | null; mtd_actual: number | null; days_with_actual: number; days: number }[]
  }
}

export function initialState(report: Report, answer: CachedAnswer, places: readonly Place[], today: string,
  storeCodes: readonly string[] = []): InitialState {
  const scope = scopeIn(places, report.store)
  // A whole-store reader's subcategories are the store's, as the cache or the warehouse knows
  // them (`storeCodes`), never only the placed ones; anyone else's are their places' alone.
  const codes = [...new Set([...scope.codes, ...(scope.wholeStore ? [...report.rows.map(r => r.code), ...storeCodes] : [])])].sort()
  const state: InitialState = {
    plant_code: report.store,
    whole_store: scope.wholeStore,
    material_groups: codes,
    section_by_material_group: Object.fromEntries(codes.filter(c => scope.sectionOf[c]).map(c => [c, scope.sectionOf[c]])),
    ...periodOf(today),
  }
  if (report.state !== 'ready') return state
  const rows = grouped((answer?.rows ?? []).filter(r => r.store_code === report.store), scope.codes)
    .sort((a, b) => a.subcategory_code.localeCompare(b.subcategory_code))
    .map(r => ({ hierarchy_code: r.subcategory_code, subcategory: r.subcategory, mtd_target: r.target, mtd_actual: r.actual,
      days_with_actual: r.days_with_actual, days: r.days }))
  const withCache = { ...state, cached: { refreshed_at: report.refreshed_at, data_through: report.data_through, rows } }
  return new TextEncoder().encode(JSON.stringify(withCache)).length <= CACHE_BUDGET_BYTES ? withCache : state
}

/**
 * The bar's store picker labels (#4531): each store by its name alone, never its plant code. A
 * store with no name known goes by its short code, else "Your store" (the reader's only store) or
 * "Store 1", "Store 2" (its place in the list). Stores whose labels collide are told apart by their
 * short codes ("Lakeside · LKS"), else numbered ("Lakeside (1)").
 */
export function storeLabels(stores: readonly string[], names: ReadonlyMap<string, string>, shorts: ReadonlyMap<string, string> = new Map()) {
  const base = stores.map((store, i) => names.get(store) ?? shorts.get(store) ?? (stores.length === 1 ? 'Your store' : `Store ${i + 1}`))
  const clashes = (label: string) => base.filter(b => b === label).length > 1
  return stores.map((store, i) => {
    if (!clashes(base[i])) return { value: store, label: base[i] }
    const twins = stores.filter((_, j) => base[j] === base[i])
    const twinShorts = twins.map(s => shorts.get(s))
    const distinct = twinShorts.every(s => s && s !== base[i]) && new Set(twinShorts).size === twins.length
    return { value: store, label: distinct ? `${base[i]} · ${shorts.get(store)}` : `${base[i]} (${twins.indexOf(store) + 1})` }
  })
}

/** Whether `storeLabels` needs short codes: some store has no name, or two share one. */
export function needsShortCodes(stores: readonly string[], names: ReadonlyMap<string, string>): boolean {
  const named = stores.map(s => names.get(s))
  return named.some(n => !n) || new Set(named).size < named.length
}

// MADE-UP DATA. No real store, figure or festival. Daily sales for every made-up store × subcategory ×
// day, September to November 2026: the engine's raw base (before the flat uplift), its final figure
// (with the uplift) and what sold. Every day is whole rupees, and each month's days add up to the
// Run's month figure for the subcategory (madeUp.ts), and a closed month's actuals to what sold, so the
// Workspace, Results and Charts agree, and subcategories add up to stores, regions and the business.
import { ALL_WEEKS, CHART_SUBS, UPLIFT, inScope, wobble, type Scope, type Sub } from './madeUp'
import { dateOf, monthOf, weekOfDay, weekdayOf, type Month } from './months'

export interface DayEvent { month: string; day: number; kind: 'festival' | 'holiday'; name: string; note: string }
export const EVENTS: DayEvent[] = [
  { month: '2026-11', day: 5, kind: 'festival', name: 'Harvest Festival', note: 'planned by the engine' },
  { month: '2026-11', day: 19, kind: 'holiday', name: 'Civic holiday', note: 'announced after the Run, so the engine did not plan for it' },
]
/** A store-day whose sales are only partly loaded, and the share of the day that is in so far. */
export const PARTIAL: { month: string; store: string; day: number; share: number }[] = [
  { month: '2026-11', store: 'Pinecrest', day: 22, share: 0.38 },
]
export const eventsOf = (m: Month) => EVENTS.filter(e => e.month === m.key)

/** The month's figures the days must add up to: the Run's, and what sold once the month is closed. */
function monthFigures(s: Sub, m: Month): { final: number; actual: number | null; lean: number } | null {
  if (m.key === '2026-11') return { final: s.engine, actual: null, lean: s.novLean }
  if (m.key === '2026-10') return { final: s.octEngine, actual: s.octActual, lean: 0 }
  if (m.key === '2026-09') return { final: s.sepEngine, actual: s.sepActual, lean: 0 }
  return null
}

// How a day sells against the month: weekends up, the first days of the month (pay) up, and the
// festival and its run-up up, as the engine plans them.
const WEEKDAY_SHAPE = [1.3, 0.86, 0.84, 0.88, 0.92, 1.02, 1.22]
const RUN_UP = [1, 1.5, 1.3, 1.15]
function shape(m: Month, day: number, s: Sub) {
  const w = WEEKDAY_SHAPE[weekdayOf(m, day)]
  let v = s.division === 'Grocery' ? 1 + (w - 1) * 0.45 : w
  if (day <= 5) v *= 1.08
  for (const e of eventsOf(m)) if (e.kind === 'festival') {
    const before = e.day - day
    if (before === 0) v *= s.division === 'Grocery' ? 1.35 : 1.8
    else if (before > 0 && before < RUN_UP.length) v *= RUN_UP[before]
    else if (before === -1) v *= 0.8
  }
  return v
}
/** What sold against the plan, beyond the subcategory's lean: the festival sold more than planned, the late holiday less. */
function surprise(m: Month, day: number) {
  let v = 1
  for (const e of eventsOf(m)) {
    const before = e.day - day
    if (e.kind === 'festival') v *= before === 0 ? 1.12 : before > 0 && before < RUN_UP.length ? 1.06 : 1
    if (e.kind === 'holiday' && before === 0) v *= 0.78
  }
  return v
}

/** Whole rupees in proportion to the weights, adding up to the total exactly (largest remainder). */
function apportion(total: number, weights: number[]) {
  const sum = weights.reduce((a, b) => a + b, 0)
  const raw = weights.map(w => (total * w) / sum)
  const out = raw.map(Math.floor)
  let left = total - out.reduce((a, b) => a + b, 0)
  for (const i of raw.map((r, i) => [r - out[i], i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i)) { if (left-- <= 0) break; out[i]++ }
  return out
}

/** One subcategory's days. `actual` holds only days loaded in full; a partly loaded day is in `soFar`. */
interface Series { base: number[]; final: number[]; actual: (number | null)[]; soFar: (number | null)[]; weekFinal: number[] }
const built = new Map<string, Map<Sub, Series>>()
function seriesOf(m: Month): Map<Sub, Series> {
  const known = built.get(m.key)
  if (known) return known
  const map = new Map<Sub, Series>()
  for (const s of CHART_SUBS) {
    const figures = monthFigures(s, m)
    if (!figures) continue
    const days = Array.from({ length: m.days }, (_, i) => i + 1)
    const shapes = days.map(d => shape(m, d, s))
    // November keeps the Run's own weekly shape (the Workspace grid); a closed month takes its days' shape.
    const weights = m.key === '2026-11'
      ? days.map((d, i) => s.weekShare[weekOfDay(d) - 1] * shapes[i] / days.filter(x => weekOfDay(x) === weekOfDay(d)).reduce((t, x) => t + shapes[x - 1], 0))
      : days.map((d, i) => shapes[i] * (1 + 0.04 * wobble(s.seed * 31 + m.index * 7 + d)))
    const final = apportion(figures.final, weights)
    const base = apportion(Math.round(figures.final / (1 + UPLIFT)), weights)
    const sold = days.map((d, i) => final[i] * (1 + figures.lean) * (1 + 0.09 * wobble(s.seed * 17 + m.index * 37 + d * 3)) * surprise(m, d))
    const share = (d: number) => PARTIAL.find(p => p.month === m.key && p.store === s.store && p.day === d)?.share
    const actual: (number | null)[] = figures.actual != null ? apportion(figures.actual, sold)
      : days.map((d, i) => (d > m.loadedTo || share(d) != null ? null : Math.round(sold[i])))
    const soFar = days.map((d, i) => (d <= m.loadedTo && share(d) != null ? Math.round(sold[i] * share(d)!) : null))
    map.set(s, { base, final, actual, soFar, weekFinal: ALL_WEEKS.map(w => days.filter(d => weekOfDay(d) === w).reduce((t, d) => t + final[d - 1], 0)) })
  }
  built.set(m.key, map)
  return map
}

export type DayState = 'complete' | 'partial' | 'none'
export interface DayRow {
  day: number; date: string; base: number; final: number
  /** What sold, on a day loaded in full for every store in the selection; otherwise null. */
  actual: number | null
  state: DayState
  /** A partly loaded day: what is in so far, and the stores still loading. */
  soFar: number | null; partialStores: string[]
  events: DayEvent[]
}
/** The days of a month for some store × subcategory pairs, added up. None for a month with no Run. */
export function daysFor(m: Month, subs: Sub[]): DayRow[] {
  const series = seriesOf(m)
  const picked = subs.flatMap(s => { const x = series.get(s); return x ? [[s, x] as const] : [] })
  if (!picked.length) return []
  const stores = new Set(subs.map(s => s.store))
  return Array.from({ length: m.days }, (_, i) => {
    const day = i + 1
    const partialStores = PARTIAL.filter(p => p.month === m.key && p.day === day && stores.has(p.store)).map(p => p.store)
    const state: DayState = day > m.loadedTo ? 'none' : partialStores.length ? 'partial' : 'complete'
    const sum = (k: 'base' | 'final' | 'actual') => picked.reduce((t, [, x]) => t + (x[k][i] ?? 0), 0)
    return { day, date: dateOf(m, day), base: sum('base'), final: sum('final'), actual: state === 'complete' ? sum('actual') : null,
      state, soFar: state === 'partial' ? picked.reduce((t, [, x]) => t + (x.actual[i] ?? x.soFar[i] ?? 0), 0) : null,
      partialStores, events: eventsOf(m).filter(e => e.day === day) }
  })
}
/** The last day loaded in full, with every day before it loaded in full too. 0: none. */
export function completeTo(rows: DayRow[]) {
  let to = 0
  for (const r of rows) { if (r.state !== 'complete') break; to = r.day }
  return to
}
export interface Totals { base: number; final: number; actual: number }
export const totalsTo = (rows: DayRow[], to: number): Totals => rows.filter(r => r.day <= to)
  .reduce((t, r) => ({ base: t.base + r.base, final: t.final + r.final, actual: t.actual + (r.actual ?? 0) }), { base: 0, final: 0, actual: 0 })

/** The engine's figure (its final, with the uplift) for one subcategory over some weeks of a month. */
export const finalWeeks = (s: Sub, m: Month, weeks: number[]) => { const x = seriesOf(m).get(s); return x ? weeks.reduce((t, w) => t + x.weekFinal[w - 1], 0) : 0 }
/** What sold for one subcategory over some weeks, on days loaded in full; up to a day if given. */
export function soldWeeks(s: Sub, m: Month, weeks: number[], to = m.days) {
  const x = seriesOf(m).get(s)
  if (!x) return 0
  return x.actual.reduce<number>((t, a, i) => t + (a != null && i + 1 <= to && weeks.includes(weekOfDay(i + 1)) ? a : 0), 0)
}
/** The engine's figure for a scope in a month: some weeks, or all five. */
export const engineFor = (sc: Scope, month: string) => CHART_SUBS.filter(s => inScope(s, sc)).reduce((n, s) => n + finalWeeks(s, monthOf(month), sc.weeks), 0)
/** What sold for a scope in a month, over some weeks (all five if not given). */
export const actualFor = (sc: Pick<Scope, 'store' | 'level' | 'name'> & { weeks?: number[] }, month: string) =>
  CHART_SUBS.filter(s => inScope(s, sc)).reduce((n, s) => n + soldWeeks(s, monthOf(month), sc.weeks ?? ALL_WEEKS), 0)

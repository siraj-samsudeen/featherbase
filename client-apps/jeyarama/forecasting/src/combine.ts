// How people's Applied numbers combine with the engine, in one place: the Workspace grid and its panel,
// the Ledger, Results and the proposed target on Runs & Targets all ask this, so they agree.
//
// The most specific Applied number goes first and holds its cells (subcategory × week). Then, for each
// broader one, on the cells nobody more specific holds:
//   - "Set a total" (and a weights change, which gives a subcategory's month) spreads what is left of its
//     total, after the held cells, by the engine's own shape;
//   - a percent ("Change by a percent", "Closure or event", -100 for a closure) is kept as a percent and
//     moves those cells by it. A more specific number inside stays exactly as entered, and the scope's
//     total is whatever that adds up to (the forecast owner's option 1). Worked out whenever it is shown, so it follows
//     a new Run.
// The engine's own flat uplift is not a person's number: it is in the engine's figure already.
import { ALL_WEEKS, SUBS, inScope, parseWeeks, type Scope } from './madeUp'
import { finalWeeks } from './sales'
import { monthOf, type Month } from './months'
import type { NumberRow } from './App'

export const isPercent = (n: Pick<NumberRow, 'kind'>) => n.kind === 'Change by a percent' || n.kind === 'Closure or event'
const RANK = { Store: 0, Division: 1, Category: 2, Subcategory: 3 }
/** More specific: a lower level, then fewer weeks. */
const specificity = (n: Pick<NumberRow, 'scope_level' | 'weeks'>) => RANK[n.scope_level] * 10 - parseWeeks(n.weeks).length
const scopeOf = (n: NumberRow): Scope => ({ store: n.store, level: n.scope_level, name: n.scope_name, weeks: parseWeeks(n.weeks) })
const cellsOf = (sc: Scope) => SUBS.filter(s => inScope(s, sc)).flatMap(s => sc.weeks.map(w => `${s.name}:${w}`))

/** A store's month after its Applied numbers: each subcategory's five weeks, and what each number moved (₹). */
export function combine(numbers: NumberRow[], store: string, m: Month) {
  const subs = SUBS.filter(s => s.store === store)
  const adj = new Map(subs.map(s => [s.name, ALL_WEEKS.map(w => finalWeeks(s, m, [w]))]))
  const at = (c: string) => { const [s, w] = c.split(':'); return { row: adj.get(s)!, i: Number(w) - 1 } }
  const held = new Set<string>()
  const moved = new Map<string, number>()
  const applied = numbers.filter(n => n.month === m.key && n.store === store && n.status === 'Applied').sort((a, b) => specificity(b) - specificity(a))
  for (const n of applied) {
    const cells = cellsOf(scopeOf(n))
    const free = cells.filter(c => !held.has(c))
    const value = (c: string) => { const { row, i } = at(c); return row[i] }
    const freeSum = free.reduce((t, c) => t + value(c), 0), heldSum = cells.filter(c => held.has(c)).reduce((t, c) => t + value(c), 0)
    const f = isPercent(n) ? 1 + (n.percent ?? 0) / 100 : freeSum > 0 ? Math.max(0, (n.value - heldSum) / freeSum) : 0
    for (const c of free) { const { row, i } = at(c); row[i] *= f }
    moved.set(n.row_id, freeSum * (f - 1))
    cells.forEach(c => held.add(c))
  }
  return { adj, moved }
}

/**
 * What a number makes its scope's total, worked out now: a total as entered; a percent on the engine's cells
 * that no more specific Applied number inside holds, those held cells as they are. For a number not applied
 * yet, what it would make the scope if it were.
 */
export function figureOf(n: NumberRow, numbers: NumberRow[]) {
  if (!isPercent(n)) return n.value
  return percentParts(n, numbers).reduce((t, { v, held, f }) => t + (held ? v : v * f), 0)
}

/** What a percent itself moves (₹): the cells of its scope that no more specific Applied number holds, times the percent. */
export function percentEffect(n: NumberRow, numbers: NumberRow[]) {
  return percentParts(n, numbers).reduce((t, { v, held, f }) => t + (held ? 0 : v * (f - 1)), 0)
}

/** Each cell of a percent's scope after the more specific Applied numbers inside it, and whether one of them holds it. */
function percentParts(n: NumberRow, numbers: NumberRow[]) {
  const inner = numbers.filter(o => o.row_id !== n.row_id && o.status === 'Applied' && o.month === n.month && o.store === n.store && specificity(o) > specificity(n))
  const { adj } = combine(inner, n.store, monthOf(n.month))
  const heldBy = new Set(inner.flatMap(o => cellsOf(scopeOf(o))))
  const f = 1 + (n.percent ?? 0) / 100
  return cellsOf(scopeOf(n)).map(c => { const [s, w] = c.split(':'); return { v: adj.get(s)![Number(w) - 1], held: heldBy.has(c), f } })
}

/** The business's month after every Applied number: the proposed target. Nested numbers are counted once. */
export const proposedTotal = (numbers: NumberRow[], stores: string[], m: Month) =>
  stores.reduce((t, store) => t + [...combine(numbers, store, m).adj.values()].flat().reduce((a, b) => a + b, 0), 0)

/** "−8%", "+20%" */
export const percentText = (p: number | null | undefined) => `${(p ?? 0) > 0 ? '+' : (p ?? 0) < 0 ? '−' : ''}${Math.abs(p ?? 0)}%`

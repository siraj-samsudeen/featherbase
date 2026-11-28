// The category head's own figures (the agreed prototype, category_head_review): how many stores, categories and
// big subcategories are more than 10% behind AOP; the store map's cells (categories down, stores across, each
// tinted by how far Feather Forecast sits from the plan, last year or last month); the two ranked lists of
// Furthest From Plan; and which tree nodes to open for a scope. Pure functions; the page draws them.
import { combine, type Group, type Line } from '../shared/model'
import type { Level } from '../shared/levels'

type Sums = Pick<Line | Group, 'fc' | 'aop' | 'ly' | 'r31'>

/** More than 10% behind the plan (Featherbase's achievement band "behind"). */
export const isBehind = (o: Pick<Sums, 'fc' | 'aop'>) => o.aop > 0 && o.fc < o.aop * 0.9

const sumsBy = (lines: Line[], key: (l: Line) => string) => {
  const by = new Map<string, Line[]>()
  for (const l of lines) { const k = key(l); (by.get(k) ?? by.set(k, []).get(k)!).push(l) }
  return [...by.values()].map(ls => combine(ls, -1))
}

/** The page's own tile: stores, categories, and subcategories planned at ₹1 L or more, more than 10% behind AOP. */
export function behindCounts(lines: Line[]) {
  const pair = (xs: Sums[]) => ({ behind: xs.filter(isBehind).length, of: xs.length })
  return {
    stores: pair(sumsBy(lines, l => l.store)),
    categories: pair(sumsBy(lines, l => l.category)),
    subcategories: pair(lines.filter(l => l.aop >= 1e5)),
  }
}

// ---- the store map ---------------------------------------------------------------------------------------
export type Metric = 'aop' | 'ly' | 'lm' | 'v'
export const METRICS: { value: Metric; label: string }[] = [
  { value: 'aop', label: 'vs AOP' }, { value: 'ly', label: 'vs Last year' }, { value: 'lm', label: 'vs Last month' }, { value: 'v', label: 'Value' },
]
const REF: Record<Exclude<Metric, 'v'>, keyof Sums> = { aop: 'aop', ly: 'ly', lm: 'r31' }

/** What a cell measures: Feather Forecast against the reference as a ratio less one (−0.2 is 20% below), or its
 *  value; null when there is nothing to compare with. */
export function metricOf(metric: Metric, o: Sums): number | null {
  if (metric === 'v') return o.fc
  const ref = o[REF[metric]]
  return ref ? o.fc / ref - 1 : null
}

/** A cell's tint: below or above the reference, darker the further (full at 40%), none within about 2%; for Value,
 *  darker the bigger within its row. `strength` runs 0..1. */
export type Tint = { tone: 'below' | 'above' | 'size'; strength: number } | null
export function tintOf(metric: Metric, value: number | null, rowMax: number): Tint {
  if (value == null) return null
  if (metric === 'v') return rowMax > 0 ? { tone: 'size', strength: Math.min(1, value / rowMax) } : null
  const strength = Math.min(1, Math.abs(value) / 0.4)
  return strength < 0.06 ? null : { tone: value < 0 ? 'below' : 'above', strength }
}

export interface Cell { store: string | null; lines: Line[]; item: Group | null; value: number | null; tint: Tint }
export interface MatrixRow { key: string; label: string; cells: Cell[]; all: Cell }

/** The stores across the map, biggest Feather Forecast first. */
export const storesBySize = (lines: Line[]) =>
  sumsBy(lines, l => l.store).map(g => ({ code: g.members[0].store, name: g.members[0].storeName, fc: g.fc })).sort((a, b) => b.fc - a.fc)

/** One row of the map: a cell per store (empty where the store has none of it) and the row's "All". */
export function matrixRow(lines: Line[], key: string, label: string, stores: string[], metric: Metric): MatrixRow {
  const at = stores.map(s => lines.filter(l => l.store === s))
  const items = at.map(ls => (ls.length ? combine(ls, -1) : null))
  const rowMax = Math.max(0, ...items.map(g => g?.fc ?? 0))
  const cells = stores.map((store, i): Cell => {
    const item = items[i], value = item ? metricOf(metric, item) : null
    return { store, lines: at[i], item, value, tint: tintOf(metric, value, rowMax) }
  })
  const all = combine(lines, -1), value = metricOf(metric, all)
  return { key, label, cells, all: { store: null, lines, item: all, value, tint: metric === 'v' ? null : tintOf(metric, value, 0) } }
}

/** The map: a row per category in `order`, then (for each open category) its subcategories; keys are the
 *  category, or "category › subcategory". */
export function matrix(lines: Line[], stores: string[], metric: Metric, openCats: Set<string>, order: (a: Sums, b: Sums) => number) {
  const cats = sumsBy(lines, l => l.category).sort(order)
  return cats.map(c => {
    const cat = c.members[0].category
    const row = matrixRow(c.members, cat, cat, stores, metric)
    const subs = openCats.has(cat)
      ? sumsBy(c.members, l => l.name).sort(order).map(s => matrixRow(s.members, `${cat} › ${s.members[0].name}`, s.members[0].name, stores, metric))
      : []
    return { row, subs }
  })
}

/** The subcategories behind a clicked cell: a row key ("*" for all categories) at a store (null for all). */
export const cellLines = (lines: Line[], row: string, store: string | null) => lines.filter(l =>
  (!store || l.store === store) && (row === '*' || (row.includes(' › ') ? `${l.category} › ${l.name}` === row : l.category === row)))

// ---- furthest from plan -----------------------------------------------------------------------------------
export type RankBy = 'line' | 'cat'
export interface Ranked { key: string; store: string; storeName: string; name: string; category: string; line: Line | null; item: Line | Group }

/** Store × subcategory (each line) or store × category, as rows of the two ranked lists. */
export function rankRows(lines: Line[], by: RankBy): Ranked[] {
  if (by === 'line') return lines.map(l => ({ key: l.rowId, store: l.store, storeName: l.storeName, name: l.name, category: l.category, line: l, item: l }))
  return sumsBy(lines, l => `${l.store}|${l.category}`).map(g => {
    const l = g.members[0]
    return { key: `${l.store}|${l.category}`, store: l.store, storeName: l.storeName, name: l.category, category: l.category, line: null, item: g }
  })
}
/** The biggest shortfalls against AOP in rupees (only rows with a plan), and the biggest changes on last year,
 *  up or down; `n` of each. */
export function rankings(lines: Line[], by: RankBy, n = 15) {
  const rows = rankRows(lines, by)
  return {
    behindAop: rows.filter(r => r.item.aop).sort((a, b) => (a.item.fc - a.item.aop) - (b.item.fc - b.item.aop)).slice(0, n),
    fromLastYear: [...rows].sort((a, b) => Math.abs(b.item.fc - b.item.ly) - Math.abs(a.item.fc - a.item.ly)).slice(0, n),
  }
}

// ---- opening the tree at a scope ----------------------------------------------------------------------------
/** The tree nodes every line in scope sits under, top down: open them and the scope shows unfolded (a store opens
 *  to its categories, a subcategory to its stores). */
export function commonPath(lines: Line[], levels: Level[]): string[] {
  const out: string[] = []
  let path = ''
  for (const lv of levels) {
    const keys = new Set(lines.map(lv.key))
    if (keys.size !== 1) break
    path = path ? `${path} › ${[...keys][0]}` : [...keys][0]
    out.push(path)
  }
  return out
}

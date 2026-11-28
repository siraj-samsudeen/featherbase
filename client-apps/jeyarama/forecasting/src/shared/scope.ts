// Search and scope (the managers' prototypes, 27-Nov-2026): one box finds a store, floor, section, division,
// subdivision, category or subcategory; choosing one scopes the whole page (tiles, table, totals) until its chip is
// removed. Two hierarchies stack, the store as it is laid out and the merchandise as it is bought: a store AND a
// division. Within one hierarchy a new choice replaces the old one. Pure functions; ScopeSearch.tsx draws them.
import type { Line } from './model'

export type Kind = 'store' | 'floor' | 'section' | 'division' | 'subdivision' | 'category' | 'subcategory'
interface KindDef {
  name: string; plural: string; tree: 'place' | 'merch'
  /** Which entry a line belongs to; null when it has none (a line on no floor). */
  key: (l: Line) => string | null
  label: (l: Line) => string
  /** A dim word after the label (a store's name after its code). */
  sub?: (l: Line) => string
  /** Where it sits, top down, shown under the label; `many` is whether the page shows more than one store. */
  path: (l: Line, many: boolean) => string[]
}
export const KINDS: Record<Kind, KindDef> = {
  store: { name: 'Store', plural: 'Stores', tree: 'place', key: l => l.store, label: l => l.store, sub: l => l.storeName, path: l => [l.region].filter(Boolean) },
  floor: { name: 'Floor', plural: 'Floors', tree: 'place', key: l => (l.floor ? `${l.store}|${l.floor}` : null), label: l => l.floor, path: (l, many) => (many ? [l.store] : []) },
  section: { name: 'Section', plural: 'Sections', tree: 'place', key: l => (l.section ? `${l.store}|${l.section}` : null), label: l => l.section, path: (l, many) => [many ? l.store : '', l.floor].filter(Boolean) },
  division: { name: 'Division', plural: 'Divisions', tree: 'merch', key: l => l.division || null, label: l => l.division, path: () => [] },
  subdivision: { name: 'Subdivision', plural: 'Subdivisions', tree: 'merch', key: l => `${l.division}|${l.subdivision}`, label: l => l.subdivision, path: l => [l.division] },
  category: { name: 'Category', plural: 'Categories', tree: 'merch', key: l => `${l.division}|${l.subdivision}|${l.category}`, label: l => l.category, path: l => [l.division, l.subdivision] },
  subcategory: { name: 'Subcategory', plural: 'Subcategories', tree: 'merch', key: l => (l.n > 1 ? null : `${l.division}|${l.subdivision}|${l.category}|${l.name}`), label: l => l.name, path: l => [l.division, l.subdivision, l.category] },
}
export const KIND_ORDER = Object.keys(KINDS) as Kind[]

export interface Entry { kind: Kind; key: string; label: string; sub: string; path: string[]; lines: Line[]; fc: number; hay: string; low: string }
export interface Scope { kind: Kind; key: string; label: string; path: string[] }

/** Every place and piece of merchandise the lines have, once each, with its lines. */
export function buildIndex(lines: Line[], kinds: Kind[] = KIND_ORDER): Entry[] {
  const many = new Set(lines.map(l => l.store)).size > 1
  const out: Entry[] = []
  for (const kind of kinds) {
    const K = KINDS[kind], by = new Map<string, Line[]>()
    for (const l of lines) { const k = K.key(l); if (k) (by.get(k) ?? by.set(k, []).get(k)!).push(l) }
    for (const [key, ls] of by) {
      const l = ls[0], label = K.label(l)
      if (!label) continue
      const path = K.path(l, many), sub = K.sub?.(l) ?? ''
      out.push({ kind, key, label, sub, path, lines: ls, fc: ls.reduce((t, x) => t + x.fc, 0), hay: [label, sub, ...path].join(' ').toLowerCase(), low: label.toLowerCase() })
    }
  }
  return out
}

export const inScope = (scope: Scope[]) => (l: Line) => scope.every(s => KINDS[s.kind].key(l) === s.key)

/** The scope after choosing an entry: it replaces any choice in the same hierarchy, and stacks on the other's. */
export const choose = (scope: Scope[], e: Pick<Entry, 'kind' | 'key' | 'label' | 'path'>): Scope[] =>
  [...scope.filter(s => KINDS[s.kind].tree !== KINDS[e.kind].tree), { kind: e.kind, key: e.key, label: e.label, path: e.path }]

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean)
function rank(e: Entry, ws: string[], q: string) {
  let s = e.low === q ? 100 : e.low.startsWith(q) ? 60 : 0
  for (const w of ws) s += e.low.split(/[\s/&,-]+/).some(x => x.startsWith(w)) ? 12 : e.low.includes(w) ? 6 : 1
  return s + Math.log10(1 + Math.max(0, e.fc))
}

/** What a query finds, grouped by kind in the kinds' order: every word must appear; already-chosen entries and
 *  entries outside the scope are left out. Up to 8 subcategories and 5 of each other kind. */
export function results(index: Entry[], q: string, scope: Scope[] = []): [Kind, Entry[]][] {
  const ws = words(q)
  if (!ws.length) return []
  const ok = inScope(scope)
  const hits = index.filter(e => ws.every(w => e.hay.includes(w)) && (!scope.length || e.lines.some(ok)) && !scope.some(s => s.kind === e.kind && s.key === e.key))
    .map(e => ({ e, r: rank(e, ws, q.trim().toLowerCase()) })).sort((a, b) => b.r - a.r)
  return KIND_ORDER.map((k): [Kind, Entry[]] => [k, hits.filter(h => h.e.kind === k).slice(0, k === 'subcategory' ? 8 : 5).map(h => h.e)]).filter(([, es]) => es.length > 0)
}

/** When nothing matches: the nearest names, by shared three-letter pieces. */
export function nearest(index: Entry[], q: string, n = 6): Entry[] {
  const tri = (s: string) => { const t = new Set<string>(), x = `  ${s.toLowerCase()} `; for (let i = 0; i < x.length - 2; i++) t.add(x.slice(i, i + 3)); return t }
  const a = tri(q)
  return index.map(e => { const b = tri(e.label); let k = 0; a.forEach(x => { if (b.has(x)) k++ }); return { e, s: k / (a.size + b.size - k) } })
    .filter(x => x.s > 0.12).sort((x, y) => y.s - x.s).slice(0, n).map(x => x.e)
}

/** What the empty box offers: the biggest entries to start from, per kind. */
export const starts = (index: Entry[], kind: Kind, scope: Scope[], n = 6) =>
  index.filter(e => e.kind === kind && (!scope.length || e.lines.some(inScope(scope)))).sort((a, b) => b.fc - a.fc).slice(0, n)

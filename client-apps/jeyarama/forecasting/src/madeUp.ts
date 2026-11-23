// MADE-UP DATA. No real store, person, code or figure. It stands in for what the warehouse will serve
// the app (the engine's Runs, each basis's value, actual sales), so every state of the pages can be
// seen on a local instance. Codes start with 9 so none can be mistaken for an SAP subcategory code.

export type Code = 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'B6'
export const BASES: { code: Code; name: string }[] = [
  { code: 'B6', name: "Festival lift: last 28 days × past years' month ratio" },
  { code: 'B1', name: 'Same date last year, × growth' },
  { code: 'B2', name: 'Same festival position last year, × growth' },
  { code: 'B3', name: "Last 28 days' run rate" },
  { code: 'B4', name: 'Last four same weekdays' },
  { code: 'B5', name: 'Same date last month' },
]
export const UPLIFT = 0.06
/** The Run whose bases (B1–B6) are kept here: the current month's. A closed month keeps only its figures. */
export const BASES_MONTH = '2026-11'

export interface Person { id: string; name: string; code: string; role: string; place: string; reportsTo?: string }
export const PEOPLE: Person[] = [
  { id: 'asha', name: 'Asha', code: 'MU-1042', role: 'Team Leader', place: 'Lakeside · Girls Bottoms', reportsTo: 'mani' },
  { id: 'ravi', name: 'Ravi', code: 'MU-1077', role: 'Team Leader', place: 'Lakeside · Men Top', reportsTo: 'mani' },
  { id: 'meena', name: 'Meena', code: 'MU-2015', role: 'Team Leader', place: 'Hillview · Girls Bottoms', reportsTo: 'gopal' },
  { id: 'mani', name: 'Mani', code: 'MU-0910', role: 'Department Manager', place: 'Lakeside', reportsTo: 'selvi' },
  { id: 'gopal', name: 'Gopal', code: 'MU-0933', role: 'Department Manager', place: 'Hillview', reportsTo: 'hari' },
  { id: 'selvi', name: 'Selvi', code: 'MU-0500', role: 'Store Manager', place: 'Lakeside', reportsTo: 'kumar' },
  { id: 'hari', name: 'Hari', code: 'MU-0512', role: 'Store Manager', place: 'Hillview', reportsTo: 'kumar' },
  { id: 'bina', name: 'Bina', code: 'MU-0301', role: 'Category Head', place: 'Womenswear & Girls', reportsTo: 'kumar' },
  { id: 'farah', name: 'Farah', code: 'MU-0120', role: 'Forecast Lead', place: 'Head Office', reportsTo: 'kumar' },
  { id: 'devan', name: 'Devan', code: 'MU-0102', role: 'Operations Head', place: 'Head Office', reportsTo: 'kumar' },
  { id: 'kumar', name: 'Kumar', code: 'MU-0001', role: 'Chief Executive', place: 'Head Office' },
]
export const person = (id: string) => PEOPLE.find(p => p.id === id)!
export const personByName = (name: string) => PEOPLE.find(p => p.name === name)

export interface Sub {
  store: string; region: string; division: string; category: string; section: string; name: string; code: string
  /** Where its made-up days come from (sales.ts): one number per store × subcategory. */
  seed: number
  /** November: the engine's month figure before tax (computed from its parts), and its weekly shape. */
  engine: number; parts: Partial<Record<Code, [weight: number, value: number]>>; other: number; weekShare: number[]
  /** How November runs against the forecast, as a share (+0.47: 47% ahead). */
  novLean: number
  /** October and September, both closed: the engine's figure and what sold. */
  octEngine: number; octActual: number; sepEngine: number; sepActual: number
}

// [division, category, section, subcategory, code, rough month size, weights B6/B1/B2/B3/B4/B5, how it runs to the 20th, October error]
type Seed = [string, string, string, string, string, number, number[], number, number]
const TREE: Seed[] = [
  ['Fashion', 'Men Top', 'Men Top', 'Men Formal Shirt', '910401002', 410000, [0.26, 0.33, 0.41, 0, 0, 0], 0.13, 0.05],
  ['Fashion', 'Men Top', 'Men Top', 'Men Casual Shirt', '910401001', 330000, [0.5, 0.22, 0.17, 0.07, 0.04, 0], 0.15, -0.03],
  ['Fashion', 'Men Top', 'Men Top', 'Men T Shirt', '910401003', 210000, [0.58, 0.16, 0.14, 0.08, 0.04, 0], -0.05, -0.05],
  ['Fashion', 'Women Ethnic Wear', 'Women Ethnic', 'Women Kurti', '910501001', 360000, [0.45, 0.2, 0.25, 0.1, 0, 0], 0.04, -0.07],
  ['Fashion', 'Women Ethnic Wear', 'Women Ethnic', 'Churidar', '910501002', 130000, [0.4, 0.3, 0.3, 0, 0, 0], -0.08, 0.02],
  ['Fashion', 'Women Ethnic Wear', 'Women Ethnic', 'Women Palazzo Set', '910501003', 90000, [0.6, 0.2, 0.2, 0, 0, 0], 0.02, 0.04],
  ['Fashion', 'Girls Bottom', 'Girls Bottoms', 'Girls Jean', '910202002', 497700, [0.5, 0.24, 0.26, 0, 0, 0], 0.47, 0.11],
  ['Fashion', 'Girls Bottom', 'Girls Bottoms', 'Girls Short', '910202009', 297582, [0.66, 0.09, 0.25, 0, 0, 0], -0.07, -0.06],
  ['Fashion', 'Girls Bottom', 'Girls Bottoms', 'Girls Leggings', '910202003', 157288, [1, 0, 0, 0, 0, 0], -0.16, -0.07],
  ['Fashion', 'Girls Bottom', 'Girls Bottoms', 'Girls Skirt', '910202010', 140004, [0.56, 0, 0.31, 0.09, 0.04, 0], 0.16, 0.11],
  ['Grocery', 'Fresh Vegetables', 'Fresh', 'Onion', '930201001', 210000, [0.1, 0.1, 0.1, 0.5, 0.2, 0], -0.12, 0.18],
  ['Grocery', 'Fresh Vegetables', 'Fresh', 'Root Veg', '930201002', 160000, [0.1, 0.15, 0.15, 0.4, 0.2, 0], 0.03, -0.04],
  ['Grocery', 'Fresh Vegetables', 'Fresh', 'Basic Veg', '930201003', 135000, [0.1, 0.1, 0.1, 0.5, 0.2, 0], -0.09, -0.08],
  ['Grocery', 'Health Drinks', 'Girls Bottoms', 'Malt Drinks', '930304001', 94529, [0.04, 0.04, 0.05, 0.72, 0.11, 0.04], -0.1, 0.03],
  ['Home', 'Cookware', 'Home', 'Steel Utensils', '920101001', 320000, [0.3, 0.3, 0.3, 0.1, 0, 0], 0.06, -0.02],
  ['Home', 'Cookware', 'Home', 'Non Stick Cookware', '920101002', 95000, [0.3, 0.3, 0.2, 0.2, 0, 0], -0.02, 0.06],
  ['Home', 'Cookware', 'Home', 'Brass Utensils', '920101003', 120000, [0.5, 0.25, 0.25, 0, 0, 0], 0.09, -0.1],
]
const CODES: Code[] = ['B6', 'B1', 'B2', 'B3', 'B4', 'B5']

/** A small, repeatable wobble so the made-up stores do not look machine-cut. */
export const wobble = (seed: number) => { const x = Math.sin(seed * 9301 + 49297) * 233280; return x - Math.floor(x) - 0.5 }

// Two made-up regions of made-up stores. Each store: its region, its size against Lakeside, where its
// wobble starts, how November runs (× the Lakeside cell's lean, + a store-wide lean), October's error
// (×, +) and September's store-wide error. The Workspace shows the first two; Charts show them all.
type StoreSeed = [store: string, region: string, scale: number, offset: number, nov: [number, number], oct: [number, number], sep: number]
const STORE_SEEDS: StoreSeed[] = [
  ['Lakeside', 'Meadow', 1, 0, [1, 0], [1, 0], 0.01],
  ['Hillview', 'Ridge', 1.4, 40, [-0.6, 0], [-0.5, 0], -0.03],
  ['Willowmere', 'Meadow', 0.8, 80, [0.5, 0.06], [0.6, 0.03], 0.04],
  ['Mistbrook', 'Meadow', 0.6, 120, [-0.3, -0.05], [-0.4, -0.02], -0.02],
  ['Pinecrest', 'Ridge', 1.15, 160, [0.4, 0.08], [0.5, 0.05], 0.03],
  ['Stonereach', 'Ridge', 0.7, 200, [-0.5, 0.03], [0.3, -0.04], -0.05],
  ['Oakhollow', 'Ridge', 0.5, 240, [0.8, -0.08], [-0.6, 0.01], 0.02],
]
export const REGIONS = [...new Set(STORE_SEEDS.map(s => s[1]))].map(name => ({ name, stores: STORE_SEEDS.filter(s => s[1] === name).map(s => s[0]) }))
export const ALL_STORES = REGIONS.flatMap(r => r.stores)

function makeSub([store, region, scale, offset, nov, oct, sep]: StoreSeed, s: Seed, n: number): Sub {
  const [division, category, section, name, code, size, w, run20, octErr] = s
  const i = n + offset
  const base = (size * scale) / (1 + UPLIFT)
  const parts: Sub['parts'] = {}
  // Each basis says something a little different; the weighted blend lands on the month size.
  CODES.forEach((c, k) => { parts[c] = [w[k], Math.round(base * (1 + 0.18 * wobble(i * 7 + k + scale)))] })
  const week = [0.24, 0.255, 0.235, 0.205, 0.065].map((x, k) => x * (1 + 0.08 * wobble(i * 3 + k + scale)))
  const t = week.reduce((a, b) => a + b, 0)
  const octEngine = Math.round(size * scale * 0.9), sepEngine = Math.round(size * scale * 0.86 * (1 + 0.05 * wobble(i * 11 + scale)))
  return { store, region, division, category, section, name, code, seed: i, parts, other: 0, weekShare: week.map(x => x / t), engine: 0,
    novLean: run20 * nov[0] + nov[1], octEngine, octActual: Math.round(size * scale * 0.9 * (1 + octErr * oct[0] + oct[1])),
    sepEngine, sepActual: Math.round(sepEngine * (1 + 0.12 * wobble(i * 5 + 3) + sep)) }
}
/** Every made-up store × subcategory, for Charts. */
export const CHART_SUBS: Sub[] = STORE_SEEDS.flatMap(store => TREE.map((s, n) => makeSub(store, s, n)))
/** The Workspace's two stores. */
export const STORES = ['Lakeside', 'Hillview']
export const SUBS: Sub[] = CHART_SUBS.filter(s => STORES.includes(s.store))
export const subKey = (s: Pick<Sub, 'store' | 'name'>) => `${s.store}|${s.name}`

export const value = (s: Sub, c: Code) => s.parts[c]?.[1] ?? null
export const weightOf = (s: Sub, c: Code) => s.parts[c]?.[0] ?? 0
/** A weight change recomputes that row only: Σ weight × value, the uplift, then the Run's other steps. */
export const fromWeights = (s: Sub, percent: Partial<Record<Code, number>>) =>
  BASES.reduce((n, b) => n + ((percent[b.code] ?? 0) / 100) * (value(s, b.code) ?? 0), 0) * (1 + UPLIFT) + s.other

// The engine's figure IS its parts, so the "why" always adds up to it.
CHART_SUBS.forEach(s => { s.engine = Math.round(fromWeights(s, Object.fromEntries(BASES.map(b => [b.code, weightOf(s, b.code) * 100])))) })

/** Engine Runs and target versions: what Runs & Targets lists. */
export interface Run { id: string; month: string; purpose: 'official' | 'trial' | 'baseline'; origin: string; written: string; note: string; wape: number | null; total: number }
const nov = SUBS.reduce((n, s) => n + s.engine, 0)
const oct = SUBS.reduce((n, s) => n + s.octEngine, 0)
const sep = SUBS.reduce((n, s) => n + s.sepEngine, 0)
export const RUNS: Run[] = [
  { id: 'demo_2026_11_official', month: 'Nov 2026', purpose: 'official', origin: '30-Oct-2026', written: '02-Nov-2026', note: 'Engine on sales to 30-Oct, with a flat 6% uplift (a judgement call, not a model output)', wape: null, total: nov },
  { id: 'demo_2026_11_trial_no_festival', month: 'Nov 2026', purpose: 'trial', origin: '30-Oct-2026', written: '01-Nov-2026', note: 'Same, with the festival lift (B6) switched off for small cells', wape: null, total: nov * 0.97 },
  { id: 'demo_2026_11_naive_weekly', month: 'Nov 2026', purpose: 'baseline', origin: '30-Oct-2026', written: '02-Nov-2026', note: 'Same weekday, last four weeks', wape: null, total: nov * 0.88 },
  { id: 'demo_2026_10_official', month: 'Oct 2026', purpose: 'official', origin: '30-Sep-2026', written: '01-Oct-2026', note: 'Engine on sales to 30-Sep, festival-aligned', wape: 0.184, total: oct },
  { id: 'demo_2026_10_naive_weekly', month: 'Oct 2026', purpose: 'baseline', origin: '30-Sep-2026', written: '01-Oct-2026', note: 'Same weekday, last four weeks', wape: 0.271, total: oct * 0.91 },
  { id: 'demo_2026_09_official', month: 'Sep 2026', purpose: 'official', origin: '30-Aug-2026', written: '01-Sep-2026', note: 'Engine on sales to 30-Aug, with a flat 6% uplift', wape: 0.171, total: sep },
  { id: 'demo_2026_09_naive_weekly', month: 'Sep 2026', purpose: 'baseline', origin: '30-Aug-2026', written: '01-Sep-2026', note: 'Same weekday, last four weeks', wape: 0.244, total: sep * 0.93 },
]

export interface TargetVersion { month: string; revision: number; fromRun: string; loaded: string; note: string }
export const TARGETS: TargetVersion[] = [
  { month: 'Nov 2026', revision: 6, fromRun: 'demo_2026_11_official', loaded: 'next build', note: 'The official Run with every number applied so far' },
  { month: 'Nov 2026', revision: 5, fromRun: 'demo_2026_11_official', loaded: '02-Nov-2026', note: 'The official Run as the target' },
  { month: 'Oct 2026', revision: 4, fromRun: 'demo_2026_10_official', loaded: '01-Oct-2026', note: 'The official Run as the target' },
  { month: 'Sep 2026', revision: 3, fromRun: 'demo_2026_09_official', loaded: '01-Sep-2026', note: 'The official Run as the target' },
]

/** A scope: a store, and optionally a level and name under it, and optionally some weeks (1-based). */
export interface Scope { store: string; level: 'Store' | 'Division' | 'Category' | 'Subcategory'; name: string; weeks: number[] }
export const ALL_WEEKS = [1, 2, 3, 4, 5]
export const parseWeeks = (w: string | null | undefined) => (w ? w.split(/[,\s]+/).filter(Boolean).map(Number) : ALL_WEEKS)
export const inScope = (s: Sub, sc: Pick<Scope, 'store' | 'level' | 'name'>) => s.store === sc.store && (sc.level === 'Store'
  || (sc.level === 'Division' && s.division === sc.name) || (sc.level === 'Category' && s.category === sc.name) || (sc.level === 'Subcategory' && s.name === sc.name))

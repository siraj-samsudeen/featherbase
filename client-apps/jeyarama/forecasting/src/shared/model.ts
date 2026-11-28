// The Team Leader review's model (#1419): pure functions from the copied warehouse rows (the Forecasting data
// model's own table and column names) to the lines the screen draws, the groups (TL-20), totals and the words
// and numbers it writes. No React and no fetching here, so the screen definition stays portable and the story,
// the local instance and a copied Run all go through the same code.
import { fmtCount, fmtINR } from '@featherbase/shop-floor/format'
import { bandsOf, type Band, type BandRows } from './bands'

export type BasisCode = 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'B6'
export const BASIS_CODES: BasisCode[] = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6']

/** One base of a subcategory's forecast: its own month, Feather Forecast's fitted month weight for it (`mw`), the
 *  share of its own month it actually added (`w`, adds ÷ own; the day's weights differ on Sundays, salary days and
 *  Christmas), and what it adds. */
export interface Base { code: BasisCode; own: number | null; w: number | null; mw: number | null; adds: number }

/** One subcategory of the section for the month: Feather Forecast, its parts, and the sales it is read against. */
export interface Line {
  rowId: string; name: string; category: string
  /** Where it sits: the store (code and name) and its region, floor and Team Leader section; the merchandise above
   *  its category. A manager's page builds its levels from these (levels.ts). */
  store: string; storeName: string; region: string; floor: string; floorOrder: number; section: string
  division: string; subdivision: string
  /** How many subcategories the row stands for: 1, or more for "Smaller subcategories" (foldSmall). */
  n: number
  /** Where it sits in the merchandise hierarchy: "Fashion › Girls › Girls Bottom". */
  path: string
  /** Its SAP subcategory code (material group), when known. */
  code?: string
  /** For a subcategory in no section: where it most likely belongs, why, and the org chart's row ids already taken. */
  suggestedSection?: string; suggestedSectionNote?: string; sectionRowIds?: string[]
  fc: number; fq: number; growth: number; step: number
  fromRecent: number; lift: number; lyg: number; adj: number; bases: Base[]
  /** The two kinds of step after the blend (adj = rebal + price): rebalancing among a category's slower-selling
   *  subcategories, which nets to zero in the category; and price, whole-rupee rounding and negative-to-zero. */
  rebal: number; price: number
  l28: number; l28q: number; ly28: number; ly28q: number; ly: number; lyq: number; n91: number; y91: number
  aop: number; aq: number; xgb: number; lgbm: number
  /** Last month as December: the last 28 days' rate per day × 31 (and its pieces). */
  r31: number; r31q: number
  /** By Price Band: the month's forecast split by band, with stock; absent when the Run's copies carry no bands. */
  bands?: Band[]
}
/** Two or more lines read together (TL-20), or the section total: summed figures plus the member lines. */
export interface Group extends Omit<Line, 'rowId' | 'bases' | 'step'> { index: number; members: Line[]; step: number | null; bases: Base[] }

// ---- the copied warehouse rows the screen reads ---------------------------------------------------------
type Num = number | string | null | undefined
export interface RunRow { run_id: string; purpose: string; origin_date: string; horizon_from: string; horizon_to: string }
/** One subcategory's month in the Run: the copy of the warehouse's fb_forecast_explanation_month (data-warehouse #4980). */
export interface LineMonthRow {
  row_id: string; run_id: string; store_code: string; store_short_code: string; division_name?: string; subdivision_name?: string; category_name: string; subcategory_name: string
  /** The subcategory's SAP code (material group): the org chart's link and the item feeds' key. Null for a line the
   *  Run merged from several codes. */
  subcategory_code: string | null
  /** The Run's region code (KL, TN): the managers' Region. */
  region?: string | null
  forecast_value_before_tax: Num; forecast_qty: Num; seasonal_factor: Num; growth_factor: Num
  from_recent_selling: Num; seasonal_step_on_top: Num; from_last_year: Num; adjustments: Num
  rebalanced_within_category?: Num; price_and_rounding?: Num
  own_value_b1: Num; own_value_b2: Num; own_value_b3: Num; own_value_b4: Num; own_value_b5: Num; own_value_b6: Num
  adds_value_b1: Num; adds_value_b2: Num; adds_value_b3: Num; adds_value_b4: Num; adds_value_b5: Num; adds_value_b6: Num
}
/** The copies the screen reads beside the Run's lines, keyed by store and subcategory name: every line feed names its
 *  lines from the Run's own hierarchy, and a line merged from several codes has no single code (data-warehouse #4980). */
interface ByLine { store_code: string; subcategory_name: string }
export interface SalesRow extends ByLine { window_name: string; sales_value_before_tax: Num; sales_qty: Num }
export interface PlanRow extends ByLine { plan_month: string; plan_value_before_tax: Num; plan_qty: Num }
/** Another model's forecast, a day (other_model_day, the Team Leader's page) or a month (other_model_month, the
 *  managers' pages), summed per subcategory for the month. */
export interface OtherModelRow extends ByLine { model: string; forecast_value_before_tax: Num }
export interface CopiedRows { lines: LineMonthRow[]; sales: SalesRow[]; plans: PlanRow[]; others: OtherModelRow[]; bands?: BandRows }

const n = (v: Num) => (v == null || v === '' ? 0 : Number(v))

/** The lines of one store (by its plant code), or of every store when none is named, built exactly as the
 *  prototype's data was (team_leader_tables.py build). A manager's page fills each line's section and floor from the
 *  live org chart afterwards (chainData.ts). */
export function linesFrom({ lines, sales, plans, others, bands }: CopiedRows, store?: string): Line[] {
  // index the rows read beside each line by store and subcategory, so many stores stay fast
  const index = <T extends ByLine>(rows: T[]) => {
    const m = new Map<string, T[]>()
    for (const r of rows) { const k = `${r.store_code}|${r.subcategory_name}`; (m.get(k) ?? m.set(k, []).get(k)!).push(r) }
    return m
  }
  const ix = { sales: index(sales), plans: index(plans), others: index(others) }
  return lines.filter(l => store == null || l.store_code === store).map(l => {
    const sub = l.subcategory_name, code = l.subcategory_code ?? undefined, k = `${l.store_code}|${sub}`
    const at = <K extends keyof typeof ix>(name: K) => (ix[name].get(k) ?? []) as (typeof ix)[K] extends Map<string, infer T> ? T : never
    const win = Object.fromEntries(at('sales').map(s => [s.window_name, s]))
    const v = (w: string) => n(win[w]?.sales_value_before_tax), q = (w: string) => n(win[w]?.sales_qty)
    const plan = at('plans')[0]
    // another model's month: its days summed; a model with no row for the subcategory has no figure
    // the warehouse names the models in lower case (xgboost, lightgbm); the made-up rows as people read them
    const model = (m: string) => at('others').filter(o => o.model.toLowerCase() === m.toLowerCase()).reduce((t, o) => t + n(o.forecast_value_before_tax), 0)
    const row = l as unknown as Record<string, Num>
    const bases = BASIS_CODES.map((code, i): Base => {
      const own = row[`own_value_b${i + 1}`], adds = n(row[`adds_value_b${i + 1}`])
      // the weight this base actually carried over the month: what it adds ÷ its own December
      const mw = row[`weight_b${i + 1}`]
      return { code, own: own == null || own === '' ? null : n(own), w: n(own) ? Math.round(adds / n(own) * 1000) / 1000 : null, mw: mw == null || mw === '' ? null : n(mw), adds }
    })
    const l28 = v('last_28_days'), l28q = q('last_28_days')
    return {
      rowId: l.row_id, name: sub, category: l.category_name, path: [l.division_name, l.subdivision_name, l.category_name].filter(Boolean).join(' › '), code,
      // where it sits: the store by its site code and the Run's region; section and floor come from the org chart (chainData.ts)
      store: l.store_short_code, storeName: l.store_short_code, region: l.region ?? '', floor: '', floorOrder: 99, section: '',
      division: l.division_name ?? '', subdivision: l.subdivision_name ?? '', n: 1,
      fc: n(l.forecast_value_before_tax), fq: n(l.forecast_qty), growth: Math.round(n(l.growth_factor) * 100) / 100, step: Math.round(n(l.seasonal_factor) * 100) / 100,
      fromRecent: n(l.from_recent_selling), lift: n(l.seasonal_step_on_top), lyg: n(l.from_last_year), adj: n(l.adjustments), bases,
      // a Run without the two kinds counts all of its adjustment as rebalancing
      rebal: l.rebalanced_within_category == null || l.rebalanced_within_category === '' ? n(l.adjustments) : n(l.rebalanced_within_category), price: n(l.price_and_rounding),
      l28, l28q, ly28: v('same_28_days_last_year'), ly28q: q('same_28_days_last_year'), ly: v('same_month_last_year'), lyq: q('same_month_last_year'),
      n91: v('last_91_days'), y91: v('same_91_days_last_year'),
      aop: n(plan?.plan_value_before_tax), aq: n(plan?.plan_qty), xgb: model('XGBoost'), lgbm: model('LightGBM'),
      r31: l28 * 31 / 28, r31q: l28q * 31 / 28,
      ...(bands ? { bands: (code ? bandsOf(bands, l.store_code, code, n(l.forecast_value_before_tax), n(l.forecast_qty)) : []) } : {}),
    }
  })
}

const SUMMED = ['fc', 'fq', 'fromRecent', 'lift', 'lyg', 'adj', 'rebal', 'price', 'l28', 'l28q', 'ly28', 'ly28q', 'ly', 'lyq', 'n91', 'y91', 'aop', 'aq', 'xgb', 'lgbm', 'r31', 'r31q', 'n'] as const
const PLACE = ['store', 'storeName', 'region', 'floor', 'floorOrder', 'section', 'division', 'subdivision'] as const

/** The words every member's name shares at the front ("Girls"), dropped from a group's name. */
function shortNames(names: string[]): string[] {
  const words = names.map(x => x.split(' '))
  let k = 0
  while (words.every(w => w.length > k + 1 && w[k] === words[0][k])) k++
  return words.map(w => w.slice(k).join(' '))
}

/** Lines summed into one: a group (its members by growth, highest first, named "Jean + Jeggings + Pant") or the section. */
export function combine(members: Line[], index: number, name?: string): Group {
  const ms = [...members].sort((a, b) => b.n91 / b.y91 - a.n91 / a.y91)
  const sum = Object.fromEntries(SUMMED.map(k => [k, ms.reduce((t, l) => t + l[k], 0)])) as Record<typeof SUMMED[number], number>
  const byCode = new Map<BasisCode, Base>()
  for (const m of ms) for (const b of m.bases) {
    const o = byCode.get(b.code) ?? { code: b.code, own: 0, w: null, mw: null, adds: 0 }
    o.own = (o.own ?? 0) + (b.own ?? 0); o.adds += b.adds
    byCode.set(b.code, o)
  }
  // the place the members share; where they differ (a region's total over many stores) the first member's
  const place = Object.fromEntries(PLACE.map(k => [k, ms[0]?.[k] ?? ''])) as Pick<Line, typeof PLACE[number]>
  return { ...sum, ...place, index, members: ms, name: name ?? shortNames(ms.map(m => m.name)).join(' + '), category: ms[0]?.category ?? '', path: ms[0]?.path ?? '',
    growth: Math.round(sum.n91 / sum.y91 * 100) / 100, step: null, bases: [...byCode.values()] }
}

/** TL-20: inside one category, when one line's growth is ×2 or more and another's ½ or less, all such lines form a group. */
export function groupsOf(lines: Line[]): Group[] {
  const groups: Line[][] = []
  for (const cat of [...new Set(lines.map(l => l.category))].sort()) {
    const mem = lines.filter(l => l.category === cat)
    if (mem.some(l => l.growth >= 2) && mem.some(l => l.growth <= 0.5)) groups.push(mem.filter(l => l.growth >= 2 || l.growth <= 0.5))
  }
  return groups.map((g, i) => combine(g, i))
}

/** RB: inside each store × category, the subcategories under `under` folded into one "Smaller subcategories" row
 *  (n says how many); it reads like a subcategory but opens no panel and takes no answer. */
export function foldSmall(lines: Line[], under: number): Line[] {
  const out: Line[] = [], small = new Map<string, Line[]>()
  for (const l of lines) {
    if (l.fc >= under) { out.push(l); continue }
    const k = `${l.store}|${l.category}`
    small.set(k, [...(small.get(k) ?? []), l])
  }
  for (const [k, ls] of small) {
    if (ls.length === 1) { out.push(ls[0]); continue }
    const g = combine(ls, -1, 'Smaller subcategories')
    out.push({ ...g, rowId: `fold:${k}`, step: ls[0].step, growth: g.growth, bases: g.bases, n: ls.length })
  }
  return out
}
export const isFolded = (l: Pick<Line, 'n'>) => l.n > 1

/** The rupee gap to AOP, signed (+₹73,516, −₹5.50 L); a dash without a plan. */
export const gapToAop = (o: { fc: number; aop: number }) => (o.aop ? `${o.fc >= o.aop ? '+' : ''}${inr(o.fc - o.aop)}` : '—')

/** TL-16: by the absolute rupee gap between Feather Forecast and last year, largest first. */
export const byGapToLastYear = <T extends { fc: number; ly: number }>(rows: T[]) => [...rows].sort((a, b) => Math.abs(b.fc - b.ly) - Math.abs(a.fc - a.ly))

// ---- the parts and their fixed colours (TL-12) --------------------------------------------------------
export type PartKey = 'fromRecent' | 'lift' | 'lyg' | 'adj'
export type HelpTopic = 'recent' | 'step' | 'lastyear' | 'adjust' | 'adjust-price'
export const PARTS: { key: PartKey; label: string; color: string; topic: HelpTopic }[] = [
  { key: 'fromRecent', label: 'From recent selling', color: 'var(--color-part-recent)', topic: 'recent' },
  { key: 'lift', label: 'December step on top', color: 'var(--color-part-step)', topic: 'step' },
  { key: 'lyg', label: 'From last year × growth', color: 'var(--color-part-last-year)', topic: 'lastyear' },
  { key: 'adj', label: 'Rebalanced, price and rounding', color: 'var(--color-part-adjust)', topic: 'adjust' },
]
/** Each part's share of the forecast, in %, never below zero. */
export const shares = (l: Pick<Line, PartKey | 'fc'>) => PARTS.map(p => ({ ...p, share: l.fc ? Math.max(0, l[p.key]) / l.fc * 100 : 0 }))

// ---- words and numbers (TL-19) -------------------------------------------------------------------------
/** ₹ on the lakh/crore ladder; a negative with the true minus sign, as the prototype writes it. */
export const inr = (v: number | null | undefined) => v == null ? '—' : fmtINR(v).replace('-', '−')
export const count = (v: number) => fmtCount(v)
/** A signed percentage of a against b: +42%, −8%, 0%; a dash when there is nothing to compare with. */
export function pc(a: number, b: number): string {
  if (!b || b < 0) return '—'
  const p = Math.round((a / b - 1) * 100)
  // past ±999% a percentage stops reading; the prototypes say how many times instead (×20)
  if (Math.abs(p) > 999) return p > 0 ? `×${Math.round(a / b)}` : '—'
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)}%`
}
/** How many times one is the other: ×3.2, or ÷2.0 when it is smaller. */
export function times(a: number, b: number): string {
  const r = a / b
  return r >= 1 ? `×${r < 10 ? r.toFixed(1) : Math.round(r)}` : `÷${1 / r < 10 ? (1 / r).toFixed(1) : Math.round(1 / r)}`
}
export const pct0 = (w: number | null) => (w == null ? '' : `${Math.round(w * 100)}%`)
/** Average selling price, whole rupees. */
export const asp = (value: number, qty: number) => (qty ? `₹${fmtCount(value / qty)}` : '—')

/** A date written DD-Mon-YYYY (2026-11-26 → 26-Nov-2026). */
export function day(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${String(d).padStart(2, '0')}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}-${y}`
}
/** The month a Run covers: "December 2026" and "December". */
export function monthOfRun(horizonFrom: string) {
  const d = new Date(`${horizonFrom.slice(0, 10)}T00:00:00Z`)
  const name = d.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })
  const days = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  return { name, year: d.getUTCFullYear(), label: `${name} ${d.getUTCFullYear()}`, days }
}

// ---- what the opened line says (TL-26, TL-28) ----------------------------------------------------------
export const BASE_INFO: Record<BasisCode, string> = {
  B1: 'Same date last year × growth', B2: 'Same festival day last year × growth', B3: 'Last 28 days, per day × 31',
  B4: 'Last four same weekdays', B5: 'Same date last month', B6: 'Last 28 days × December step',
}
/** A base's weight as shown: Feather Forecast's fitted month weight, else (a Run without it) adds ÷ own. */
export const baseWeight = (b: Base) => b.mw ?? b.w
/** The weight of some bases together; null for a group (its members' weights differ). */
export const weightOf = (l: Line | Group, codes: BasisCode[]) => ('members' in l ? null : l.bases.filter(b => codes.includes(b.code)).reduce((t, b) => t + (baseWeight(b) ?? 0), 0))
/** A part's share of the forecast, signed, so the shares add up to 100% (a negative adjustment shows as −16%). */
export const signedShare = (v: number, total: number) => { const p = Math.round(v / total * 100); return `${p < 0 ? '−' : ''}${Math.abs(p)}%` }

/** TL-28 December rise: last year's December rate per day against the 28 days before it, and the note when it strays from the store's. */
export function decemberRise(l: Line | Group, step: number) {
  const lyStep = (l.ly / 31) / (l.ly28 / 28)
  const note = lyStep > step * 1.5 ? ' This subcategory usually rises more than the store in December.'
    : lyStep < step / 1.5 ? ' This subcategory usually rises less than the store in December.' : ''
  return { lyStep, note }
}

/** The store's usual December rise, for a group's sentences: the section's seasonal steps weighted by each line's
 *  forecast (the Run carries each line's own step; the store's is not stored yet). */
export const storeStepOf = (lines: Line[]) => {
  const total = lines.reduce((t, l) => t + l.fc, 0)
  return total ? Math.round(lines.reduce((t, l) => t + l.step * l.fc, 0) / total * 100) / 100 : 1
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** The month before a month's name (December → November). */
export const prevMonth = (name: string) => MONTHS[(MONTHS.indexOf(name) + 11) % 12]

// ---- search (the prototype's "Search your subcategories") ------------------------------------------------
const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean)
/** Whether a subcategory matches what is typed: every word in its name or its category. */
export const matches = (l: Pick<Line, 'name' | 'category'>, q: string) => {
  const ws = words(q), text = `${l.name} ${l.category}`.toLowerCase()
  return ws.every(w => text.includes(w))
}
/** Whether a section matches what is typed (the Sections landing): every word in its name, in one of its Team
 *  Leaders' names, or in one of its subcategories. */
export const sectionMatches = (s: { name: string; teamLeaders: string[]; subcategories: string[] }, q: string) => {
  const ws = words(q)
  return [s.name, ...s.teamLeaders, ...s.subcategories].some(t => ws.every(w => t.toLowerCase().includes(w)))
}
/** The names nearest to something that matches none, by shared three-letter runs (at most `n`). */
export function nearest<T extends Pick<Line, 'name'>>(lines: T[], q: string, n = 3): T[] {
  const tri = (s: string) => { const t = new Set<string>(), x = `  ${s.toLowerCase()} `; for (let i = 0; i < x.length - 2; i++) t.add(x.slice(i, i + 3)); return t }
  const a = tri(q)
  return lines.map(l => { const b = tri(l.name); let both = 0; a.forEach(x => { if (b.has(x)) both++ }); return [l, both / (a.size + b.size - both)] as const })
    .sort((x, y) => y[1] - x[1]).slice(0, n).map(([l]) => l)
}

/** A row's contribution among its siblings (Siraj, 28-Nov: "contribution across similar items in each screen"): its
 *  value over the siblings' total, as a whole %, "<1%" for a sliver above none; "—" with nothing to divide by. */
export function contribution(value: number, siblingsTotal: number): string {
  if (!siblingsTotal) return '—'
  const p = value / siblingsTotal * 100
  return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`
}

/** Siblings' contributions that show exactly 100% between them (largest remainder): every share floored, the points
 *  left over given to the biggest remainders. A sliver under 1% shows "<1%" and takes no points; "—" when the
 *  siblings come to nothing. */
export function contributions(values: number[]): string[] {
  const total = values.reduce((t, v) => t + v, 0)
  if (!total) return values.map(() => '—')
  const raw = values.map(v => v / total * 100), whole = raw.map(r => (r < 1 ? 0 : Math.floor(r)))
  let left = 100 - whole.reduce((t, x) => t + x, 0)
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).filter(([, i]) => raw[i] >= 1).sort((a, b) => b[0] - a[0])
  for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length, left--) whole[order[k][1]]++
  return values.map((v, i) => (v === 0 ? '0%' : raw[i] < 1 ? '<1%' : `${whole[i]}%`))
}

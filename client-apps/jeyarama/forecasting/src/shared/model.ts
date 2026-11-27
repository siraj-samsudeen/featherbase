// The Team Leader review's model (#1419): pure functions from the copied warehouse rows (the Forecasting data
// model's own table and column names) to the lines the screen draws, the groups (TL-20), totals and the words
// and numbers it writes. No React and no fetching here, so the screen definition stays portable and the story,
// the local instance and a copied Run all go through the same code.
import { fmtCount, fmtINR } from '@featherbase/shop-floor/format'

export type BasisCode = 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'B6'
export const BASIS_CODES: BasisCode[] = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6']

/** One base of a line's forecast: its own December, the share of it Feather Forecast used, and what it adds. */
export interface Base { code: BasisCode; own: number | null; w: number | null; adds: number }

/** One subcategory of the section for the month: Feather Forecast, its parts, and the sales it is read against. */
export interface Line {
  rowId: string; name: string; category: string
  /** Where it sits in the merchandise hierarchy: "Fashion › Girls › Girls Bottom". */
  path: string
  fc: number; fq: number; growth: number; step: number
  fromRecent: number; lift: number; lyg: number; adj: number; bases: Base[]
  l28: number; l28q: number; ly28: number; ly28q: number; ly: number; lyq: number; n91: number; y91: number
  aop: number; aq: number; xgb: number; lgbm: number
  /** Last month as December: the last 28 days' rate per day × 31 (and its pieces). */
  r31: number; r31q: number
}
/** Two or more lines read together (TL-20), or the section total: summed figures plus the member lines. */
export interface Group extends Omit<Line, 'rowId' | 'bases' | 'step'> { index: number; members: Line[]; step: number | null; bases: Base[] }

// ---- the copied warehouse rows the screen reads ---------------------------------------------------------
type Num = number | string | null | undefined
export interface RunRow { run_id: string; purpose: string; origin_date: string; horizon_from: string; horizon_to: string }
export interface LineMonthRow {
  row_id: string; run_id: string; store_code: string; store_name: string; division_name?: string; subdivision_name?: string; category_name: string; subcategory_name: string; section_name: string
  forecast_value_before_tax: Num; forecast_qty: Num; seasonal_factor: Num; growth_factor: Num
  from_recent_selling: Num; december_step_on_top: Num; from_last_year: Num; adjustments: Num
  own_value_b1: Num; own_value_b2: Num; own_value_b3: Num; own_value_b4: Num; own_value_b5: Num; own_value_b6: Num
  adds_value_b1: Num; adds_value_b2: Num; adds_value_b3: Num; adds_value_b4: Num; adds_value_b5: Num; adds_value_b6: Num
}
export interface SalesRow { store_code: string; subcategory_name: string; window_name: string; sales_value_before_tax: Num; sales_qty: Num }
export interface PlanRow { store_code: string; subcategory_name: string; plan_value_before_tax: Num; plan_qty: Num }
export interface OtherModelRow { model: string; store_code: string; subcategory_name: string; forecast_value_before_tax: Num }
export interface CopiedRows { lines: LineMonthRow[]; sales: SalesRow[]; plans: PlanRow[]; others: OtherModelRow[] }

const n = (v: Num) => (v == null || v === '' ? 0 : Number(v))

/** The section's lines for one store, built exactly as the prototype's data was (team_leader_tables.py build). */
export function linesFrom({ lines, sales, plans, others }: CopiedRows, store: string): Line[] {
  const at = <T extends { store_code: string; subcategory_name: string }>(rows: T[], sub: string) => rows.filter(r => r.store_code === store && r.subcategory_name === sub)
  return lines.filter(l => l.store_code === store).map(l => {
    const sub = l.subcategory_name
    const win = Object.fromEntries(at(sales, sub).map(s => [s.window_name, s]))
    const v = (w: string) => n(win[w]?.sales_value_before_tax), q = (w: string) => n(win[w]?.sales_qty)
    const plan = at(plans, sub)[0]
    const model = (m: string) => n(at(others, sub).find(o => o.model === m)?.forecast_value_before_tax)
    const row = l as unknown as Record<string, Num>
    const bases = BASIS_CODES.map((code, i): Base => {
      const own = row[`own_value_b${i + 1}`], adds = n(row[`adds_value_b${i + 1}`])
      // the weight this base actually carried over the month: what it adds ÷ its own December
      return { code, own: own == null || own === '' ? null : n(own), w: n(own) ? Math.round(adds / n(own) * 1000) / 1000 : null, adds }
    })
    const l28 = v('last_28_days'), l28q = q('last_28_days')
    return {
      rowId: l.row_id, name: sub, category: l.category_name, path: [l.division_name, l.subdivision_name, l.category_name].filter(Boolean).join(' › '),
      fc: n(l.forecast_value_before_tax), fq: n(l.forecast_qty), growth: Math.round(n(l.growth_factor) * 100) / 100, step: Math.round(n(l.seasonal_factor) * 100) / 100,
      fromRecent: n(l.from_recent_selling), lift: n(l.december_step_on_top), lyg: n(l.from_last_year), adj: n(l.adjustments), bases,
      l28, l28q, ly28: v('same_28_days_last_year'), ly28q: q('same_28_days_last_year'), ly: v('last_december'), lyq: q('last_december'),
      n91: v('last_91_days'), y91: v('same_91_days_last_year'),
      aop: n(plan?.plan_value_before_tax), aq: n(plan?.plan_qty), xgb: model('XGBoost'), lgbm: model('LightGBM'),
      r31: l28 * 31 / 28, r31q: l28q * 31 / 28,
    }
  })
}

const SUMMED = ['fc', 'fq', 'fromRecent', 'lift', 'lyg', 'adj', 'l28', 'l28q', 'ly28', 'ly28q', 'ly', 'lyq', 'n91', 'y91', 'aop', 'aq', 'xgb', 'lgbm', 'r31', 'r31q'] as const

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
    const o = byCode.get(b.code) ?? { code: b.code, own: 0, w: null, adds: 0 }
    o.own = (o.own ?? 0) + (b.own ?? 0); o.adds += b.adds
    byCode.set(b.code, o)
  }
  return { ...sum, index, members: ms, name: name ?? shortNames(ms.map(m => m.name)).join(' + '), category: ms[0]?.category ?? '', path: ms[0]?.path ?? '',
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

/** TL-16: by the absolute rupee gap between Feather Forecast and last year, largest first. */
export const byGapToLastYear = <T extends { fc: number; ly: number }>(rows: T[]) => [...rows].sort((a, b) => Math.abs(b.fc - b.ly) - Math.abs(a.fc - a.ly))

// ---- the parts and their fixed colours (TL-12) --------------------------------------------------------
export type PartKey = 'fromRecent' | 'lift' | 'lyg' | 'adj'
export type HelpTopic = 'recent' | 'step' | 'lastyear' | 'adjust'
export const PARTS: { key: PartKey; label: string; color: string; topic: HelpTopic }[] = [
  { key: 'fromRecent', label: 'From recent selling', color: 'var(--color-part-recent)', topic: 'recent' },
  { key: 'lift', label: 'December step on top', color: 'var(--color-part-step)', topic: 'step' },
  { key: 'lyg', label: 'From last year × growth', color: 'var(--color-part-last-year)', topic: 'lastyear' },
  { key: 'adj', label: 'Adjustments', color: 'var(--color-part-adjust)', topic: 'adjust' },
]
/** Each part's share of the forecast, in %, never below zero. */
export const shares = (l: Pick<Line, PartKey | 'fc'>) => PARTS.map(p => ({ ...p, share: l.fc ? Math.max(0, l[p.key]) / l.fc * 100 : 0 }))

// ---- words and numbers (TL-19) -------------------------------------------------------------------------
/** ₹ on the lakh/crore ladder; a negative with the true minus sign, as the prototype writes it. */
export const inr = (v: number | null | undefined) => v == null ? '—' : fmtINR(v).replace('-', '−')
export const count = (v: number) => fmtCount(v)
/** A signed percentage of a against b: +42%, −8%, 0%; a dash when there is nothing to compare with. */
export function pc(a: number, b: number): string {
  if (!b) return '—'
  const p = Math.round((a / b - 1) * 100)
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
/** The weight of some bases together; null for a group (its members' weights differ). */
export const weightOf = (l: Line | Group, codes: BasisCode[]) => ('members' in l ? null : l.bases.filter(b => codes.includes(b.code)).reduce((t, b) => t + (b.w ?? 0), 0))

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

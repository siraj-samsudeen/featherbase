// How Feather Forecast got a number, as one table that can be checked by hand (Siraj, 28-Nov-2026; prototype
// data-warehouse 6e2732f1e and b93dacc16): From last year (B1, B2) first, then From last month (B3–B6), then
// Rebalanced within category and Price and rounding, then the total. Each base: its own value × weight used = adds.
// Adds are whole rupees, the rounding remainder on the largest row, so they sum to Feather Forecast exactly; shares are
// signed tenths of a percent that sum to exactly 100.0% (largest remainder). Weights come to about 100%, not exactly:
// the day weights shift on Sundays, salary days and Christmas, so their totals carry "≈".
import type { Base, BasisCode } from './model'

export type RowKind = 'base' | 'rebal' | 'price'
export interface ExplainRow { kind: RowKind; code?: BasisCode; own: number | null; fitted: number | null; adds: number; share: number }
export interface Explanation { lastYear: ExplainRow[]; lastMonth: ExplainRow[]; after: ExplainRow[]; total: number }

/** Signed shares of `total`, in tenths of a percent, that add up to exactly 1000 (largest remainder). */
export function sharesOf(values: number[], total: number): number[] {
  if (!total) return values.map(() => 0)
  const raw = values.map(v => v / total * 1000), floor = raw.map(Math.floor)
  let left = 1000 - floor.reduce((t, x) => t + x, 0)
  raw.map((r, i) => [r - floor[i], i] as const).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { floor[i]++; left-- } })
  return floor
}

export function explain(bases: Base[], rebal: number, price: number, fc: number): Explanation {
  const byCode = new Map(bases.map(b => [b.code, b]))
  const rows: ExplainRow[] = []
  const base = (code: BasisCode) => { const b = byCode.get(code); if (b) rows.push({ kind: 'base', code, own: b.own, fitted: b.mw, adds: b.adds, share: 0 }) }
  ;(['B1', 'B2'] as const).forEach(base)
  const nLastYear = rows.length
  ;(['B3', 'B4', 'B5', 'B6'] as const).forEach(base)
  const nLastMonth = rows.length
  if (Math.round(rebal)) rows.push({ kind: 'rebal', own: null, fitted: null, adds: rebal, share: 0 })
  if (Math.round(price)) rows.push({ kind: 'price', own: null, fitted: null, adds: price, share: 0 })
  // whole rupees, the remainder on the largest row, so the adds sum to the forecast exactly
  const total = Math.round(fc)
  rows.forEach(r => { r.adds = Math.round(r.adds) })
  const gap = total - rows.reduce((t, r) => t + r.adds, 0)
  if (gap && rows.length) rows.reduce((m, r) => (Math.abs(r.adds) > Math.abs(m.adds) ? r : m), rows[0]).adds += gap
  sharesOf(rows.map(r => r.adds), total).forEach((s, i) => { rows[i].share = s })
  return { lastYear: rows.slice(0, nLastYear), lastMonth: rows.slice(nLastYear, nLastMonth), after: rows.slice(nLastMonth), total }
}

/** A base's weight used: what it adds ÷ its own value; null without an own value. */
export const weightUsed = (r: ExplainRow) => (r.own ? r.adds / r.own : null)
/** Some rows' weights used, added up (about 100% for all the bases). */
export const weightsOf = (rows: ExplainRow[]) => rows.reduce((t, r) => t + (weightUsed(r) ?? 0), 0)
/** A share in tenths of a percent, signed: "27.1%", "−16.5%", "0%". */
export const shareText = (tenths: number) => { const v = Math.abs(tenths) / 10; return `${tenths < 0 ? '−' : ''}${v % 1 ? v.toFixed(1) : v.toFixed(0)}%` }
/** A weight to two decimals: "13.32%". */
export const weightText = (w: number) => `${(w * 100).toFixed(2)}%`

// MADE-UP DATA. Writes fixtures/team-leader-december.json: one official December Run for one section
// (Lakeside · Girls Bottoms), in the warehouse's own table and column names (the Forecasting data model,
// data-warehouse#4935), so the Team Leader screen reads fixtures and copied warehouse rows through one path.
// No real store, person or figure: every number below is invented, shaped like a real section's.
//
//   node client-apps/jeyarama/forecasting/scripts/make-team-leader-fixture.mts
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RUN = 'made_up_2026_12_official'
const STORE = 'LKS'
const KEY = { store_code: STORE, division_name: 'Fashion', subdivision_name: 'Girls' }
const SECTION = 'Girls Bottoms'

// name, category, last 28 days ₹, its ASP, same 28 days last year ₹, last December ₹, last December's ASP,
// growth, the line's December step, weights B1..B6, adjustments ₹
type Seed = [string, string, number, number, number, number, number, number, number, number[], number]
const SEEDS: Seed[] = [
  ['Girls Jean', 'Girls Bottom', 540000, 520, 210000, 455000, 540, 2.62, 1.29, [0.14, 0.04, 0.01, 0.08, 0.05, 0.68], 0],
  ['Girls Jeggings', 'Girls Bottom', 41000, 270, 120000, 310000, 300, 0.31, 1.33, [0, 0.02, 0.05, 0.1, 0.08, 0.75], 0],
  ['Girls Pant', 'Girls Bottom', 10500, 240, 70000, 205000, 560, 0.07, 1.19, [0.02, 0, 0.4, 0.3, 0.28, 0], 300],
  ['Girls Short', 'Girls Bottom', 245000, 150, 170000, 190000, 140, 1.31, 1.26, [0.2, 0.1, 0.05, 0.1, 0.05, 0.5], 1200],
  ['Girls Skirt', 'Girls Bottom', 140000, 420, 160000, 255000, 330, 0.86, 1.15, [0.3, 0.05, 0.05, 0.05, 0.05, 0.5], 0],
  ['Girls Palazzo', 'Girls Bottom', 125000, 175, 130000, 218000, 150, 0.93, 1.13, [0.22, 0.08, 0.05, 0.05, 0.05, 0.55], 900],
  ['Girls Capri', 'Girls Bottom', 76000, 160, 105000, 262000, 70, 0.72, 1.31, [0.1, 0.15, 0.05, 0.1, 0.05, 0.55], 0],
  ['Girls Leggings', 'Girls Bottom', 73000, 140, 80000, 109000, 160, 0.95, 1.16, [0.12, 0.05, 0.08, 0.1, 0.05, 0.6], 650],
  ['Girls Panties', 'Girls Inner Wear', 172000, 41, 170000, 171000, 40, 1.0, 1.15, [0.25, 0.1, 0.05, 0.05, 0.05, 0.5], 0],
  ['Girls Track Pant', 'Girls Active Wear', 54000, 225, 66000, 92000, 265, 0.82, 1.24, [0, 0, 0.1, 0.1, 0.1, 0.7], 0],
]

const r = (n: number) => Math.round(n)
const q1 = (n: number) => Math.round(n * 10) / 10
const lines: Record<string, unknown>[] = [], sales: Record<string, unknown>[] = [], plans: Record<string, unknown>[] = [], others: Record<string, unknown>[] = []
SEEDS.forEach(([name, category, l28, asp, ly28, ly, aspLy, growth, step, w, adj], i) => {
  const line = { ...KEY, category_name: category, subcategory_name: name }
  const b3 = l28 / 28 * 31
  const own = [ly * growth, ly * growth * 1.008, b3, b3 * 0.995, b3 * 0.985, b3 * step]
  const adds = own.map((o, k) => r(o * w[k]))
  const fc = adds.reduce((a, b) => a + b, 0) + adj
  const b6Level = adds[5] / step
  lines.push({
    row_id: `${RUN}:${STORE}:${name}`, run_id: RUN, ...line, store_name: 'Lakeside', section_name: SECTION, floor_name: 'First Floor', floor_order: 2,
    forecast_value_before_tax: fc, forecast_qty: q1(fc / (asp * 0.97)),
    ...Object.fromEntries(own.map((o, k) => [`own_value_b${k + 1}`, r(o)])),
    ...Object.fromEntries(adds.map((a, k) => [`adds_value_b${k + 1}`, a])),
    ...Object.fromEntries(w.map((x, k) => [`weight_b${k + 1}`, x])),
    seasonal_factor: step, growth_factor: growth,
    from_recent_selling: r(adds[2] + adds[3] + adds[4] + b6Level), december_step_on_top: r(adds[5] - b6Level),
    from_last_year: adds[0] + adds[1], adjustments: adj,
  })
  const n91 = l28 * 3.05
  const windows: [string, string, string, number, number][] = [
    ['last_28_days', '2026-10-30', '2026-11-26', l28, l28 / asp],
    ['same_28_days_last_year', '2025-10-30', '2025-11-26', ly28, ly28 / (aspLy * 0.95)],
    ['last_december', '2025-12-01', '2025-12-31', ly, ly / aspLy],
    ['last_91_days', '2026-08-28', '2026-11-26', n91, n91 / asp],
    ['same_91_days_last_year', '2025-08-28', '2025-11-26', n91 / growth, n91 / growth / aspLy],
  ]
  for (const [window_name, date_from, date_to, v, qty] of windows)
    sales.push({ row_id: `${STORE}:${name}:${window_name}`, ...line, window_name, date_from, date_to, sales_value_before_tax: r(v), sales_qty: r(qty) })
  const aop = ly * (1.04 + (i % 3) * 0.03)
  plans.push({ row_id: `${STORE}:${name}:2026-12:1`, ...line, calendar_year: 2026, calendar_month: 12, revision_id: 1, plan_value_before_tax: r(aop), plan_qty: q1(aop / aspLy) })
  for (const [model, f] of [['XGBoost', 0.78 + (i % 4) * 0.06], ['LightGBM', 0.86 + (i % 3) * 0.05]] as const)
    others.push({ row_id: `${model}:${STORE}:${name}:2026-12`, model, store_code: STORE, subcategory_name: name, month_from: '2026-12-01', forecast_value_before_tax: r(fc * f) })
})

const fixture = {
  forecast_run: [{ row_id: RUN, run_id: RUN, model: 'made_up', purpose: 'official', status: 'complete', origin_date: '2026-11-26', horizon_from: '2026-12-01', horizon_to: '2026-12-31' }],
  forecast_line_month: lines,
  sales_reference: sales,
  annual_plan_line: plans,
  other_model_line: others,
}
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/team-leader-december.json')
writeFileSync(out, JSON.stringify(fixture, null, 1) + '\n')
console.log(`wrote ${out}: ${lines.length} lines`)

// MADE-UP DATA. Writes fixtures/team-leader-december.json: one official December Run for one section
// (Lakeside · Girls Bottoms), in the warehouse's own table and column names (the Forecasting data model,
// data-warehouse#4935), so the Team Leader screen reads fixtures and copied warehouse rows through one path.
// No real store, person or figure: every number below is invented, shaped like a real section's.
//
//   node client-apps/jeyarama/forecasting/scripts/make-team-leader-fixture.mts
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { addSeed, type Rows, type Seed } from '../src/shared/madeUpRows.ts'

const RUN = 'made_up_2026_12_official'
const STORE = 'LKS'
const KEY = { store_code: STORE, division_name: 'Fashion', subdivision_name: 'Girls' }
const SECTION = 'Girls Bottoms'

// Girls Bottom's rebalancing (the seeds' last number) adds up to zero, as the real step's does in a category
const SEEDS: Seed[] = [
  ['Girls Jean', 'Girls Bottom', 540000, 520, 210000, 455000, 540, 2.62, 1.29, [0.14, 0.04, 0.01, 0.08, 0.05, 0.68], 0],
  ['Girls Jeggings', 'Girls Bottom', 41000, 270, 120000, 310000, 300, 0.31, 1.33, [0, 0.02, 0.05, 0.1, 0.08, 0.75], 0],
  ['Girls Pant', 'Girls Bottom', 10500, 240, 70000, 205000, 560, 0.07, 1.19, [0.02, 0, 0.4, 0.3, 0.28, 0], 2100],
  ['Girls Short', 'Girls Bottom', 245000, 150, 170000, 190000, 140, 1.31, 1.26, [0.2, 0.1, 0.05, 0.1, 0.05, 0.5], -1400],
  ['Girls Skirt', 'Girls Bottom', 140000, 420, 160000, 255000, 330, 0.86, 1.15, [0.3, 0.05, 0.05, 0.05, 0.05, 0.5], 0],
  ['Girls Palazzo', 'Girls Bottom', 125000, 175, 130000, 218000, 150, 0.93, 1.13, [0.22, 0.08, 0.05, 0.05, 0.05, 0.55], 900],
  ['Girls Capri', 'Girls Bottom', 76000, 160, 105000, 262000, 70, 0.72, 1.31, [0.1, 0.15, 0.05, 0.1, 0.05, 0.55], 0],
  ['Girls Leggings', 'Girls Bottom', 73000, 140, 80000, 109000, 160, 0.95, 1.16, [0.12, 0.05, 0.08, 0.1, 0.05, 0.6], -1600],
  ['Girls Panties', 'Girls Inner Wear', 172000, 41, 170000, 171000, 40, 1.0, 1.15, [0.25, 0.1, 0.05, 0.05, 0.05, 0.5], 0],
  ['Girls Track Pant', 'Girls Active Wear', 54000, 225, 66000, 92000, 265, 0.82, 1.24, [0, 0, 0.1, 0.1, 0.1, 0.7], 0],
]

// price and rounding ₹: a few rupees of whole-rupee rounding each
const PRICE = [2, -1, 0, 3, -2, 1, -1, 0, 2, -1]
const rows: Rows = { lines: [], sales: [], plans: [], others: [] }
SEEDS.forEach((seed, i) => addSeed(rows, seed, { run: RUN, ...KEY, store_name: 'Lakeside', section_name: SECTION, floor_name: 'First Floor', floor_order: 2 }, i, PRICE[i]))
const { lines, sales, plans, others } = rows

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

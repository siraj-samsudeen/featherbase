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
// growth, the line's December step, weights B1..B6, rebalanced within category ₹ (Girls Bottom's add up to zero,
// as the real step's do in a category)
type Seed = [string, string, number, number, number, number, number, number, number, number[], number]
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
const r = (n: number) => Math.round(n)
const q1 = (n: number) => Math.round(n * 10) / 10
const lines: Record<string, unknown>[] = [], sales: Record<string, unknown>[] = [], plans: Record<string, unknown>[] = [], others: Record<string, unknown>[] = []
const mixes: Record<string, unknown>[] = [], stocks: Record<string, unknown>[] = [], items: Record<string, unknown>[] = [], health: Record<string, unknown>[] = [], elsewhere: Record<string, unknown>[] = []
SEEDS.forEach(([name, category, l28, asp, ly28, ly, aspLy, growth, step, w, rebal], i) => {
  const line = { ...KEY, category_name: category, subcategory_name: name }
  const b3 = l28 / 28 * 31
  const own = [ly * growth, ly * growth * 1.008, b3, b3 * 0.995, b3 * 0.985, b3 * step]
  const adds = own.map((o, k) => r(o * w[k]))
  const adj = rebal + PRICE[i]
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
    rebalanced_within_category: rebal, price_and_rounding: PRICE[i],
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

  // By Price Band: three bands around the line's selling price, the middle one selling most; stock that lasts
  // between 8 and 77 days at December's pace (so some bands run short and some hold too much); every third line also holds stock in a
  // band that sold nothing for 90 days. Items are invented styles.
  const lo = Math.round(asp * 0.6 / 10) * 10, hi = Math.round(asp * 1.3 / 10) * 10, fq = fc / (asp * 0.97)
  const valueShare = [[0.18, 0.47, 0.35], [0.3, 0.5, 0.2], [0.1, 0.55, 0.35]][i % 3]
  const perPiece = [0.5, 1, 1.6], pieces = valueShare.map((v, b) => v / perPiece[b]), total = pieces.reduce((t, x) => t + x, 0)
  const bandNames = [`≤₹${lo}`, `₹${lo}–${hi}`, `₹${hi}+`]
  bandNames.forEach((price_band, b) => {
    const at = { ...line, price_band, price_band_order: b + 1 }, qtyShare = pieces[b] / total
    const v28 = l28 * valueShare[b], q28 = l28 / asp * qtyShare, sold = 4 + (i + b * 3) % 9, n50 = 1 + (i + b) % 2
    const stock = r(fq * qtyShare * (8 + (i * 7 + b * 11) % 70) / 31)
    mixes.push({ row_id: `${RUN}:${STORE}:${name}:${price_band}`, run_id: RUN, ...at, sales_value_before_tax: r(v28), sales_qty: r(q28), items_sold: sold,
      value_share: Math.round(valueShare[b] * 10000) / 10000, qty_share: Math.round(qtyShare * 10000) / 10000, items_to_50_pct: n50, items_to_70_pct: n50 + 1 })
    stocks.push({ row_id: `${STORE}:${name}:${price_band}`, ...at, stock_qty: stock, stock_value_at_cost: r(stock * asp * perPiece[b] * 0.62), items_in_stock: sold + 2, stock_as_of: '2026-11-27' })
    const weight = [0.4, 0.22, 0.16, 0.12, 0.1]
    weight.forEach((w, k) => {
      const itemStock = k === 4 && b === 1 ? 0 : r(stock * w), q = r(q28 * w), v = r(v28 * w), code = `MU${String(i).padStart(2, '0')}${b}${k}`
      // the same item's health: the last 7 days a quarter of the 28 (more for the cheap band of every fourth line,
      // where demand is moving), half in 14 days; it sells at two to four other stores, best at Hilltop
      const q7 = r(q * (b === 0 && i % 4 === 0 ? 0.45 : 0.25)), other = 2 + (i + k) % 3
      health.push({ row_id: `${STORE}:${code}`, ...at, item_code: code, item_name: `${name} ${['Classic', 'Everyday', 'Print', 'Plain', 'Festive'][k]} Style`,
        stock_qty: itemStock, warehouse_qty: (i + b + k) % 4 === 0 ? 12 : 0, last_sold_date: '2026-11-25', days_since_movement: 2, is_dead: false,
        sales_qty_7_days: q7, sales_value_7_days: r(v * q7 / Math.max(q, 1)), sales_qty_14_days: r(q * 0.5), sales_qty: q, sales_value_before_tax: v, selling_price: Math.round(v / Math.max(q, 1)),
        other_stores_selling: other, other_stores_qty: q * other, other_stores_qty_14_days: r(q * other * 0.5),
        best_store_code: 'HLT', best_store_short_code: 'HLT', best_store_name: 'Hilltop', best_store_qty: k === 0 ? q * 3 : q, stock_as_of: '2026-11-27', sales_as_of_date: '2026-11-27' })
      // the same item at two invented stores of the region: Hilltop holds plenty and sells little (it can spare),
      // Riverside sells well and holds little (it will run out)
      for (const [short, name2, stockThere, soldThere] of [['HLT', 'Hilltop', (k + 2) * 12, Math.round(q / 4)], ['RVS', 'Riverside', k % 2, q + 6]] as const)
        elsewhere.push({ row_id: `${STORE}:${code}:${short}`, store_code: STORE, subcategory_name: name, item_code: code, other_store_code: short,
          other_store_short_code: short, other_store_name: name2, other_stock_qty: stockThere, other_sales_qty: soldThere, stock_as_of: '2026-11-28' })
      items.push({ row_id: `${RUN}:${STORE}:${name}:${price_band}:${k + 1}`, run_id: RUN, ...at, item_rank: k + 1,
      item_code: `MU${String(i).padStart(2, '0')}${b}${k}`, item_name: `${name} ${['Classic', 'Everyday', 'Print', 'Plain', 'Festive'][k]} Style`,
      sales_qty: q, sales_value_before_tax: v, stock_qty: itemStock })
    })
  })
  // items that sold nothing in the 28 days: dead in Never sold (every third line), slow for 40 days (every fourth),
  // in stock here and selling at other stores (every third, from the second), and one with no price band (the sixth)
  const idle = (code: string, price_band: string, price_band_order: number, stock_qty: number, days: number, extra: Record<string, unknown> = {}) =>
    health.push({ row_id: `${STORE}:${code}`, ...line, price_band, price_band_order, item_code: code, item_name: `${name} ${code.slice(-2)} Old Style`,
      stock_qty, warehouse_qty: 0, last_sold_date: '2026-08-10', days_since_movement: days, is_dead: days >= 90, sales_qty_7_days: 0, sales_value_7_days: 0,
      sales_qty_14_days: 0, sales_qty: 0, sales_value_before_tax: 0, selling_price: r(asp * 0.9), other_stores_selling: 0, other_stores_qty: 0, other_stores_qty_14_days: 0,
      best_store_code: null, best_store_short_code: null, best_store_name: null, best_store_qty: null, stock_as_of: '2026-11-27', sales_as_of_date: '2026-11-27', ...extra })
  if (i % 3 === 0) idle(`MU${String(i).padStart(2, '0')}D1`, 'Never sold (90 d)', 98, 40 + i * 5, 120)
  if (i % 4 === 1) idle(`MU${String(i).padStart(2, '0')}S1`, bandNames[1], 2, 18 + i, 40)
  if (i % 3 === 1) idle(`MU${String(i).padStart(2, '0')}H1`, bandNames[2], 3, 9, 20, { other_stores_selling: 3, other_stores_qty: 30, other_stores_qty_14_days: 14 })
  if (i === 5) idle('MU05N1', 'No band', 99, 6, 10, { sales_qty: 4, sales_value_before_tax: r(asp * 4), sales_qty_14_days: 2 })
  if (i % 3 === 0) stocks.push({ row_id: `${STORE}:${name}:Never sold (90 d)`, ...line, price_band: 'Never sold (90 d)', price_band_order: 98,
    stock_qty: 40 + i * 5, stock_value_at_cost: r((40 + i * 5) * asp * 0.55), items_in_stock: 3, stock_as_of: '2026-11-27' })
})

const fixture = {
  forecast_run: [{ row_id: RUN, run_id: RUN, model: 'made_up', purpose: 'official', status: 'complete', origin_date: '2026-11-26', horizon_from: '2026-12-01', horizon_to: '2026-12-31' }],
  forecast_line_month: lines,
  sales_reference: sales,
  annual_plan_line: plans,
  other_model_line: others,
  price_band_mix: mixes,
  stock_band: stocks,
  price_band_top_item: items,
  item_health: health,
  item_other_stores: elsewhere,
  // who to ask: invented names, one buyer and one category head for the section
  merchandise_people: SEEDS.map(([name], i) => ({ row_id: `KL-MU-${i}`, operating_region: 'Kerala', subcategory_code: `MU-${String(i).padStart(3, '0')}`, subcategory_name: name,
    category_head_code: 'MU-HEAD-1', category_head: 'Ravi Menon', buyer_code: 'MU-BUY-1', buyer: 'Kavya Nair', source_key: 'Made-up names for the local fixture' })),
}
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/team-leader-december.json')
writeFileSync(out, JSON.stringify(fixture, null, 1) + '\n')
console.log(`wrote ${out}: ${lines.length} lines`)

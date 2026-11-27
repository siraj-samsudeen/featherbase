// MADE-UP DATA. How one invented subcategory becomes the copied warehouse rows the review screens read
// (forecast_line_month, sales_reference, annual_plan_line, other_model_line, in the Forecasting data model's own
// names), so the Team Leader fixture (scripts/make-team-leader-fixture.mts) and the managers' made-up chain
// (madeUpChain.ts) build their Runs the same way. No real store, person or figure.

/** name, category, last 28 days ₹, its ASP, same 28 days last year ₹, last December ₹, last December's ASP,
 *  growth, the line's December step, weights B1..B6, rebalanced within category ₹ */
export type Seed = [string, string, number, number, number, number, number, number, number, number[], number]

/** Where a seed sits: the line's key in the warehouse, and the columns copied beside it. */
export interface SeedPlace {
  run: string; store_code: string; store_name: string; division_name: string; subdivision_name: string; section_name: string
  region_name?: string; floor_name?: string; floor_order?: number
  /** The subcategory's code (a made-up one), when the Run carries it. */
  material_group_code?: string
}

export interface Rows {
  lines: Record<string, unknown>[]; sales: Record<string, unknown>[]; plans: Record<string, unknown>[]; others: Record<string, unknown>[]
}

const r = (n: number) => Math.round(n)
const q1 = (n: number) => Math.round(n * 10) / 10

/** Appends one subcategory's rows to `out`. `i` varies the plan and the other models a little from line to line;
 *  `price` is its price and rounding ₹, the second kind of adjustment beside the seed's rebalancing. */
export function addSeed(out: Rows, [name, category, l28, asp, ly28, ly, aspLy, growth, step, w, rebal]: Seed, place: SeedPlace, i: number, price = 0) {
  const { run, store_code: STORE, store_name, section_name, region_name, floor_name, floor_order, material_group_code, ...merch } = place
  const line = { store_code: STORE, ...merch, category_name: category, subcategory_name: name }
  const b3 = l28 / 28 * 31
  const own = [ly * growth, ly * growth * 1.008, b3, b3 * 0.995, b3 * 0.985, b3 * step]
  const adds = own.map((o, k) => r(o * w[k]))
  const adj = rebal + price
  const fc = adds.reduce((a, b) => a + b, 0) + adj
  const b6Level = adds[5] / step
  out.lines.push({
    row_id: `${run}:${STORE}:${name}`, run_id: run, ...line, store_name, section_name,
    ...(region_name == null ? {} : { region_name }), ...(floor_name == null ? {} : { floor_name, floor_order }), ...(material_group_code == null ? {} : { material_group_code }),
    forecast_value_before_tax: fc, forecast_qty: q1(fc / (asp * 0.97)),
    ...Object.fromEntries(own.map((o, k) => [`own_value_b${k + 1}`, r(o)])),
    ...Object.fromEntries(adds.map((a, k) => [`adds_value_b${k + 1}`, a])),
    // the engine's fitted month weight of each base (forecast_weights.weight_value)
    ...Object.fromEntries(w.map((x, k) => [`weight_b${k + 1}`, x])),
    seasonal_factor: step, growth_factor: growth,
    from_recent_selling: r(adds[2] + adds[3] + adds[4] + b6Level), december_step_on_top: r(adds[5] - b6Level),
    from_last_year: adds[0] + adds[1], adjustments: adj,
    rebalanced_within_category: rebal, price_and_rounding: price,
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
    out.sales.push({ row_id: `${STORE}:${name}:${window_name}`, ...line, window_name, date_from, date_to, sales_value_before_tax: r(v), sales_qty: r(qty) })
  const aop = ly * (1.04 + (i % 3) * 0.03)
  out.plans.push({ row_id: `${STORE}:${name}:2026-12:1`, ...line, calendar_year: 2026, calendar_month: 12, revision_id: 1, plan_value_before_tax: r(aop), plan_qty: q1(aop / aspLy) })
  for (const [model, f] of [['XGBoost', 0.78 + (i % 4) * 0.06], ['LightGBM', 0.86 + (i % 3) * 0.05]] as const)
    out.others.push({ row_id: `${model}:${STORE}:${name}:2026-12`, model, store_code: STORE, subcategory_name: name, month_from: '2026-12-01', forecast_value_before_tax: r(fc * f) })
  return fc
}

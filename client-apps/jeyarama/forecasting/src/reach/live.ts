// A whole store's or a region's days and findings (#4935 in the warehouse repo): the Store Manager's and RB's Day
// Review and Needs Your Attention, read from the same read-only copies as the Team Leader's (forecast_line_day,
// actuals_day, item_health, stock_band, …), one store at a time, each line placed on its store's org chart today.
// A region is read store by store, so the page shows the first store while the rest arrive.
import { listWhere, listWhereAll } from '../api'
import { NO_SECTION, officialRuns, orgOf } from '../teamLeader/live'
import type { OrgChart } from '../orgChart'
import { BASIS_CODES, linesFrom, monthOfRun, type Base, type Line, type LineMonthRow, type PlanRow, type RunRow, type SalesRow } from '../shared/model'
import { ITEM_HEALTH_FIELDS, needsAttention, type Finding, type ItemHealthRow } from '../shared/findings'
import { MIX_FIELDS, STOCK_FIELDS, daysLeft, stockAsOf, type BandMixRow, type StockBandRow } from '../shared/bands'
import { ACTUALS_DAY_FIELDS, DAY_EXPLANATION_FIELDS, FORECAST_DAY_FIELDS, explanationOf, loadedTo, type ActualsDayRow, type DayExplanation,
  type DayExplanationRow, type ForecastDayRow, type SubDays } from '../shared/days'

/** Whose page it is: one store (a Store Manager's), or a region (RB's). */
export type Reach = { kind: 'store'; store: string } | { kind: 'region'; region: string }
/** The Run's region codes, as people read them. */
export const REGION: Record<string, string> = { KL: 'Kerala', TN: 'Tamil Nadu' }
type Filter = [string, string, unknown]

const LINE_FIELDS = ['run_id', 'region', 'store_code', 'store_short_code', 'subcategory_code', 'division_name', 'subdivision_name', 'category_name', 'subcategory_name',
  'forecast_value_before_tax', 'forecast_qty', 'seasonal_factor', 'growth_factor', 'from_recent_selling', 'seasonal_step_on_top', 'from_last_year', 'adjustments',
  'rebalanced_within_category', 'price_and_rounding', ...[1, 2, 3, 4, 5, 6].flatMap(i => [`own_value_b${i}`, `adds_value_b${i}`, `weight_b${i}`])]

/** Today in India, YYYY-MM-DD. */
const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
/** The newest of some dates, YYYY-MM-DD. */
const newest = (dates: (string | null | undefined)[]) => dates.reduce<string | null>((a, d) => (d && (!a || d.slice(0, 10) > a) ? d.slice(0, 10) : a), null)

/** A store of the Run: its site code (as people and the org chart name it), its plant code (as the copies key it),
 *  its name and region, and its Run. */
export interface ReachStore { store: string; storeCode: string; name: string; region: string; run: RunRow }
/** The stores a reach covers in a month's official Runs (the Day Review's: the month that has started; Needs Your
 *  Attention's: the newest), biggest first for a region so the page opens on the store with most to see. */
export interface ReachPlan { month: string; runs: RunRow[]; stores: ReachStore[] }

export async function planOf(reach: Reach, which: 'started' | 'newest'): Promise<ReachPlan | null> {
  const runs = await officialRuns(), today = todayIST()
  const first = which === 'started' ? runs.find(r => r.horizon_from.slice(0, 10) <= today) : runs[0]
  if (!first) return null
  const month = runs.filter(r => r.horizon_from === first.horizon_from)
  const filters: Filter[] = [['run_id', 'in', month.map(r => r.run_id)], ...(reach.kind === 'store' ? [['store_short_code', '=', reach.store] as Filter] : [])]
  // one row per store would do; the copies have no distinct read, so the month's lines name them (a few pages)
  const rows = await listWhereAll<{ run_id: string; store_code: string; store_short_code: string; region: string | null }>('forecasting.forecast_line_month',
    ['run_id', 'store_code', 'store_short_code', 'region'], filters)
  const seen = new Map<string, ReachStore & { n: number }>()
  for (const r of rows) {
    const region = REGION[r.region ?? ''] ?? r.region ?? ''
    if (reach.kind === 'region' && region !== reach.region) continue
    const s = seen.get(r.store_short_code) ?? { store: r.store_short_code, storeCode: r.store_code, name: r.store_short_code, region, run: month.find(m => m.run_id === r.run_id)!, n: 0 }
    s.n++
    seen.set(r.store_short_code, s)
  }
  if (!seen.size) return null
  const stores = [...seen.values()].sort((a, b) => b.n - a.n).map(({ n: _n, ...s }) => s)
  // the store's name, from its org chart (the first store's chart names every store of the region)
  const org = await orgOf(stores[0].store)
  for (const s of stores) s.name = org.stores[s.store] ?? s.store
  return { month: first.horizon_from.slice(0, 10), runs: month, stores }
}

/** Where a subcategory sits on its store's org chart today: its section and floor. */
function placeOn(org: OrgChart, code: string | null | undefined) {
  const s = code ? org.sections.find(x => x.id === org.subcategories[code]?.section) : undefined
  return { section: s?.name ?? NO_SECTION, floor: s?.floor ?? '', floorOrder: s?.floorOrder ?? 99 }
}

// ---- Day Review -------------------------------------------------------------------------------------------

/** One store's month day by day: each subcategory's days (id "store|subcategory"), its row in the Run, and the
 *  explanations given at the store. */
export interface StoreDays { store: ReachStore; subs: SubDays[]; rowIds: Map<string, string>; explanations: (DayExplanation & { section: string })[]
  salesTo: string | null; loaded: number; org: OrgChart
  /** How it was built, by the subcategory's id: Feather Forecast for the month, what each base adds, and the AOP. */
  built: Map<string, { fc: number; aop: number; bases: Base[] }> }
const ADDS = BASIS_CODES.map((_, i) => `adds_value_b${i + 1}`)

/** The explanations given at a store in its Run, with the section each is for. */
export async function loadExplanations(s: ReachStore): Promise<(DayExplanation & { section: string })[]> {
  const said = await listWhere<DayExplanationRow & { section_name: string }>('forecasting.day_explanation', [...DAY_EXPLANATION_FIELDS, 'section_name'],
    [['run_id', '=', s.run.run_id], ['store_code', '=', s.storeCode]])
  return said.map(r => ({ ...explanationOf(r), section: r.section_name }))
}

export async function loadStoreDays(s: ReachStore, days: number): Promise<StoreDays> {
  const at: Filter[] = [['run_id', '=', s.run.run_id], ['store_code', '=', s.storeCode]]
  const [org, lines, fc, sold, explanations, plans] = await Promise.all([
    orgOf(s.store),
    listWhereAll<{ row_id: string; subcategory_name: string; subcategory_code: string | null; category_name: string; forecast_value_before_tax: number | string | null } & Record<string, number | string | null>>(
      'forecasting.forecast_line_month', ['subcategory_name', 'subcategory_code', 'category_name', 'forecast_value_before_tax', ...ADDS], at),
    listWhereAll<ForecastDayRow>('forecasting.forecast_line_day', FORECAST_DAY_FIELDS, at),
    listWhereAll<ActualsDayRow>('forecasting.actuals_day', ACTUALS_DAY_FIELDS, at),
    loadExplanations(s),
    listWhereAll<{ subcategory_name: string; plan_value_before_tax: number | string | null }>('forecasting.annual_plan_line', ['subcategory_name', 'plan_value_before_tax'],
      [...at, ['plan_month', '=', s.run.horizon_from.slice(0, 10)]]),
  ])
  const aop = new Map<string, number>()
  for (const p of plans) aop.set(p.subcategory_name, (aop.get(p.subcategory_name) ?? 0) + Number(p.plan_value_before_tax ?? 0))
  const upTo = loadedTo(sold, s.run.horizon_from)
  // indexed by subcategory: a store has some 1,100 of them and 30,000 days (subDaysFrom scans every row per line)
  const byName = new Map<string, SubDays>()
  for (const l of lines) {
    const p = placeOn(org, l.subcategory_code)
    byName.set(l.subcategory_name, { id: `${s.store}|${l.subcategory_name}`, name: l.subcategory_name, category: l.category_name, section: p.section, floor: p.floor, floorOrder: p.floorOrder,
      store: s.store, storeName: s.name, fc: Array(days).fill(0) as number[], sold: Array.from({ length: days }, (_, i) => (i < upTo ? 0 : null)) as (number | null)[] })
  }
  for (const r of fc) { const x = byName.get(r.subcategory_name); if (x) x.fc[Number(r.forecast_date.slice(8, 10)) - 1] += Number(r.forecast_value_before_tax ?? 0) }
  for (const r of sold) {
    const x = byName.get(r.subcategory_name), d = Number(r.sales_date.slice(8, 10)) - 1
    if (x && d < upTo) x.sold[d] = (x.sold[d] ?? 0) + Number(r.sales_value_before_tax ?? 0)
  }
  return { store: s, org, loaded: upTo, salesTo: newest(sold.map(r => r.actuals_as_of_date)),
    subs: [...byName.values()].sort((a, b) => (a.floorOrder ?? 99) - (b.floorOrder ?? 99) || a.section.localeCompare(b.section) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
    rowIds: new Map(lines.map(l => [`${s.store}|${l.subcategory_name}`, l.row_id])), explanations,
    built: new Map(lines.map(l => [`${s.store}|${l.subcategory_name}`, { fc: Number(l.forecast_value_before_tax ?? 0), aop: aop.get(l.subcategory_name) ?? 0,
      bases: BASIS_CODES.map((code, i) => ({ code, own: null, w: null, mw: null, adds: Number(l[ADDS[i]] ?? 0) })) }])) }
}

// ---- Needs Your Attention ---------------------------------------------------------------------------------

/** One store's findings, each placed on the store's org chart, and the dates they are measured from. */
export interface StoreFindings { store: ReachStore; findings: Finding[]; lines: Line[]; org: OrgChart; salesTo: string | null; stockAsOf: string | null; othersAsOf: string | null }

/** Every line of a store in its Run, with its price bands and today's stock, placed on the org chart. */
async function storeLines(s: ReachStore, org: OrgChart): Promise<{ lines: Line[]; stockAsOf: string | null }> {
  const at: Filter[] = [['run_id', '=', s.run.run_id], ['store_code', '=', s.storeCode]]
  const [rows, sales, plans, mix, stock] = await Promise.all([
    listWhereAll<LineMonthRow>('forecasting.forecast_line_month', LINE_FIELDS, at),
    listWhereAll<SalesRow>('forecasting.sales_reference', ['store_code', 'subcategory_name', 'window_name', 'sales_value_before_tax', 'sales_qty'], at),
    listWhereAll<PlanRow>('forecasting.annual_plan_line', ['store_code', 'subcategory_name', 'plan_month', 'plan_value_before_tax', 'plan_qty'], [...at, ['plan_month', '=', s.run.horizon_from.slice(0, 10)]]),
    listWhereAll<BandMixRow>('forecasting.price_band_mix', MIX_FIELDS, at),
    listWhereAll<StockBandRow>('forecasting.stock_band', STOCK_FIELDS, [['store_code', '=', s.storeCode]]),
  ])
  // the band's top items are the Team Leader's panel; the findings read every item's own health instead
  const lines = linesFrom({ lines: rows, sales, plans, others: [], bands: { mix, stock, items: [] } }, s.storeCode)
  for (const l of lines) Object.assign(l, placeOn(org, l.code), { storeName: s.name, region: s.region })
  return { lines, stockAsOf: stockAsOf(stock) }
}

/** A store's findings: its own items' health first, then the region's other stores' rows of only the items a
 *  transfer was looked for, and the findings again with them. None when no item health is loaded for it. */
export async function loadStoreFindings(s: ReachStore, regionStores: string[]): Promise<StoreFindings | null> {
  const org = await orgOf(s.store)
  const { lines, stockAsOf: asOf } = await storeLines(s, org)
  if (!asOf || !lines.length) return null
  const fields = [...ITEM_HEALTH_FIELDS, 'sales_as_of_date', 'stock_as_of']
  const own = await listWhereAll<ItemHealthRow & { sales_as_of_date: string | null; stock_as_of: string | null }>('forecasting.item_health', fields, [['store_code', '=', s.storeCode]])
  if (!own.length) return null
  const month = monthOfRun(s.run.horizon_from)
  const m = { name: month.name, days: month.days, left: daysLeft(newest(own.map(r => r.stock_as_of)) ?? asOf, month) }
  const bySub = new Map<string, ItemHealthRow[]>()
  for (const r of own) (bySub.get(r.subcategory_code) ?? bySub.set(r.subcategory_code, []).get(r.subcategory_code)!).push(r)
  // first pass: which items a transfer would be looked for
  const wanted = new Set<string>()
  for (const l of lines) needsAttention([l], bySub.get(l.code ?? '') ?? [], org, m, s.storeCode, wanted)
  // the region's other stores: those the page covers, and every store the org chart names in the region (as the Team Leader's)
  const others = [...new Set([...regionStores, ...Object.keys(org.stores)])].filter(x => x !== s.store)
  const codes = [...wanted], theirs: (ItemHealthRow & { stock_as_of: string | null })[] = []
  for (let i = 0; i < codes.length && others.length; i += 150)
    theirs.push(...await listWhereAll<ItemHealthRow & { stock_as_of: string | null }>('forecasting.item_health', [...ITEM_HEALTH_FIELDS, 'stock_as_of'],
      [['store_short_code', 'in', others], ['item_code', 'in', codes.slice(i, i + 150)]]))
  const theirsBy = new Map<string, ItemHealthRow[]>()
  for (const r of theirs) (theirsBy.get(r.item_code) ?? theirsBy.set(r.item_code, []).get(r.item_code)!).push(r)
  const findings = lines.flatMap(l => {
    const mine = bySub.get(l.code ?? '') ?? []
    const place = { store: s.store, storeName: s.name, floor: l.floor, floorOrder: l.floorOrder, section: l.section, rowId: l.rowId }
    return needsAttention([l], [...mine, ...mine.flatMap(i => theirsBy.get(i.item_code) ?? [])], org, m, s.storeCode).map(f => ({ ...f, place }))
  })
  return { store: s, findings, lines, org, salesTo: newest(own.map(r => r.sales_as_of_date)), stockAsOf: newest(own.map(r => r.stock_as_of)) ?? asOf, othersAsOf: newest(theirs.map(r => r.stock_as_of)) }
}

/** Reads each store in turn, a few at a time, telling `onStore` as each arrives: a region's page shows the first
 *  store at once and fills in the rest. A store that can't be read is asked once more, then reported failed. */
export async function eachStore<T>(stores: ReachStore[], read: (s: ReachStore) => Promise<T>, onStore: (s: ReachStore, got: T | null, failed: boolean) => void, at = 2) {
  let next = 0
  const worker = async () => {
    while (next < stores.length) {
      const s = stores[next++]
      try { onStore(s, await read(s).catch(() => read(s)), false) } catch { onStore(s, null, true) }
    }
  }
  await Promise.all(Array.from({ length: Math.min(at, stores.length) }, worker))
}

// What the managers' pages review: the newest official Run in the app's read-only copies (forecast_line_month and the
// copies read beside it, as the Team Leader's page reads them), placed on the live org chart (the org_chart read, one
// store at a time: sections, floors, Team Leaders, Store Managers and each subcategory's category head, from Dash's
// Job Assignment and Merchandise Assignment), or the made-up chain when no real Run is loaded.
import { listWhereAll } from '../api'
import { officialRuns, orgOf } from '../teamLeader/live'
import type { OrgChart } from '../orgChart'
import { linesFrom, type CopiedRows, type LineMonthRow, type Line, type PlanRow, type SalesRow } from './model'
import type { ProposalItem } from './review'

/** A section of a store: its floor (building order) and its Team Leader(s). */
export interface SectionInfo { store: string; section: string; floor: string; floorOrder: number; teamLeader: string }
/** A store a person covers, whole (codes null) or for some subcategory codes (a category head's merchandise). */
export interface Place { store: string; codes: string[] | null }
export interface ChainPerson { name: string; role: string; place: string; places: Place[] }
export interface Chain {
  /** Whether this is a real Run or the made-up chain. */
  real: boolean
  lines: Line[]; sections: SectionInfo[]; people: ChainPerson[]; proposals: ProposalItem[]
  /** The Run's sales cut-off and first day (YYYY-MM-DD). */
  cutOff: string; horizon: string
}

/** The lines a person covers: every store named, whole or for its subcategory codes. */
export function linesOf(p: Pick<ChainPerson, 'places'>, lines: Line[]): Line[] {
  const at = new Map(p.places.map(x => [x.store, x.codes ? new Set(x.codes) : null]))
  return lines.filter(l => at.has(l.store) && (at.get(l.store) === null || (l.code != null && at.get(l.store)!.has(l.code))))
}

const LINE_FIELDS = ['run_id', 'region', 'store_code', 'store_short_code', 'subcategory_code', 'division_name', 'subdivision_name', 'category_name', 'subcategory_name',
  'forecast_value_before_tax', 'forecast_qty', 'seasonal_factor', 'growth_factor', 'from_recent_selling', 'seasonal_step_on_top', 'from_last_year', 'adjustments',
  'rebalanced_within_category', 'price_and_rounding', ...[1, 2, 3, 4, 5, 6].flatMap(i => [`own_value_b${i}`, `adds_value_b${i}`, `weight_b${i}`])]
/** The Run's region codes, as people read them. */
const REGION: Record<string, string> = { KL: 'Kerala', TN: 'Tamil Nadu' }
export const NOT_PLACED = 'Not placed in a section'

/** Each store's org chart today, a few at a time; a store whose chart can't be read has none (its lines stay unplaced). */
async function orgsOf(stores: string[]): Promise<Map<string, OrgChart>> {
  const out = new Map<string, OrgChart>()
  for (let i = 0; i < stores.length; i += 4)
    await Promise.all(stores.slice(i, i + 4).map(s => orgOf(s).then(o => { out.set(s, o) }, () => {})))
  return out
}

/** The newest real official Run, every store loaded; null when only the made-up Run (or none) is there. */
export async function loadRealChain(): Promise<Chain | null> {
  const runs = (await officialRuns()).filter(r => r.model !== 'made_up')
  const run = runs[0]
  if (!run) return null
  const month = runs.filter(r => r.horizon_from === run.horizon_from).map(r => r.run_id), first = run.horizon_from.slice(0, 10)
  const [rows, sales, plans] = await Promise.all([
    listWhereAll<LineMonthRow>('forecasting.forecast_line_month', LINE_FIELDS, [['run_id', 'in', month]]),
    listWhereAll<SalesRow>('forecasting.sales_reference', ['store_code', 'subcategory_name', 'window_name', 'sales_value_before_tax', 'sales_qty'], [['run_id', 'in', month]]),
    listWhereAll<PlanRow>('forecasting.annual_plan_line', ['store_code', 'subcategory_name', 'plan_month', 'plan_value_before_tax', 'plan_qty'], [['run_id', 'in', month], ['plan_month', '=', first]]),
  ])
  // XGBoost and LightGBM are copied by day (other_model_day): a whole region's days are too many to read in a page,
  // so the managers' pages leave them out on a real Run (the Team Leader's page reads them for its one section)
  const lines = linesFrom({ lines: rows, sales, plans, others: [] } as CopiedRows)
  const stores = [...new Set(lines.map(l => l.store))].sort()
  const orgs = await orgsOf(stores)

  // place each line on its store's org chart today: its section and floor, the store's name and region
  const names: Record<string, string> = {}
  for (const o of orgs.values()) Object.assign(names, o.stores)
  for (const l of lines) {
    const org = orgs.get(l.store)
    const sec = org && l.code ? org.sections.find(s => s.id === org.subcategories[l.code!]?.section) : undefined
    l.storeName = names[l.store] ?? l.store
    l.region = REGION[l.region] ?? l.region
    l.section = sec?.name ?? NOT_PLACED; l.floor = sec?.floor ?? ''; l.floorOrder = sec?.floorOrder ?? 99
  }

  // the people, from today's Job Assignments and Merchandise Assignments (the org chart), not a reach table
  const sections: SectionInfo[] = [], people: ChainPerson[] = [], heads = new Map<string, Map<string, Set<string>>>()
  for (const [store, org] of orgs) {
    for (const s of org.sections) {
      sections.push({ store, section: s.name, floor: s.floor, floorOrder: s.floorOrder, teamLeader: s.teamLeaders.join(', ') })
      for (const tl of s.teamLeaders) people.push({ name: tl, role: 'Team Leader', place: `${store} · ${s.name}`, places: [{ store, codes: null }] })
    }
    for (const sm of org.storeManagers) people.push({ name: sm, role: 'Store Manager', place: store, places: [{ store, codes: null }] })
    for (const [code, sub] of Object.entries(org.subcategories)) {
      if (!sub.categoryHead) continue
      const mine = heads.get(sub.categoryHead) ?? heads.set(sub.categoryHead, new Map()).get(sub.categoryHead)!
      ;(mine.get(store) ?? mine.set(store, new Set()).get(store)!).add(code)
    }
  }
  const size = (p: ChainPerson) => p.places.reduce((t, x) => t + (x.codes?.length ?? 0), 0)
  // the biggest category head first, so the page opens on the one with the most to review
  const headPeople = [...heads].map(([name, at]): ChainPerson => ({ name, role: 'Category Head',
    place: [...new Set([...at.keys()].map(s => lines.find(l => l.store === s)?.region).filter(Boolean))].join(' and '),
    places: [...at].map(([store, codes]) => ({ store, codes: [...codes].sort() })) })).sort((a, b) => size(b) - size(a))
  return { real: true, lines, sections, people: [...people, ...headPeople], proposals: [], cutOff: run.origin_date.slice(0, 10), horizon: first }
}

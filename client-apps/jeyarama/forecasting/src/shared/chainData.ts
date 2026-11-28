// What the managers' pages review: the newest official Run in the app's read-only copies (forecast_line_month and the
// copies read beside it, as the Team Leader's page reads them), placed on the live org chart (the org_chart read, one
// store at a time: sections, floors, Team Leaders, Store Managers and each subcategory's category head, from Dash's
// Job Assignment and Merchandise Assignment), or the made-up chain when no real Run is loaded.
import { listWhereAll } from '../api'
import { officialRuns, orgOf } from '../teamLeader/live'
import type { OrgChart } from '../orgChart'
import { linesFrom, type CopiedRows, type LineMonthRow, type Line, type PlanRow, type SalesRow } from './model'
import type { ProposalItem } from './review'
import { loadProposals, type ChangeRow } from './chainWrites'

/** A section of a store: its floor (building order) and its Team Leader(s). */
export interface SectionInfo { store: string; section: string; floor: string; floorOrder: number; teamLeader: string }
/** A store a person covers, whole (codes null) or for some subcategory codes (a category head's merchandise). */
export interface Place { store: string; codes: string[] | null }
/** Someone on the chain. id is their Employee row (made-up ids on the made-up chain): a page matches the signed-in
 *  person by it, never by name, since two employees can share a name. */
export interface ChainPerson { id: string; name: string; role: string; place: string; places: Place[] }
export interface Chain {
  /** Whether this is a real Run or the made-up chain. */
  real: boolean
  lines: Line[]; sections: SectionInfo[]; people: ChainPerson[]; proposals: ProposalItem[]
  /** A real Run's month: its Runs (one per region), and the changes the proposals were read from, by row id (#1442). */
  runIds?: string[]; changes?: Map<string, ChangeRow>
  /** Why the Team Leaders' proposals could not be read; the pages still open on the Run. */
  problem?: string
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

/** Each store's org chart today, a few at a time, in store order (so the first person of a role is the same every
 *  load). A chart that can't be read is asked once more; if it still fails the whole load fails, so the page says it
 *  couldn't load rather than leave the store silently out of every category head's figures. */
async function orgsOf(stores: string[]): Promise<Map<string, OrgChart>> {
  const got = new Map<string, OrgChart>()
  for (let i = 0; i < stores.length; i += 4)
    await Promise.all(stores.slice(i, i + 4).map(s => orgOf(s).catch(() => orgOf(s)).then(o => { got.set(s, o) })))
  return new Map(stores.map(s => [s, got.get(s)!]))
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
  const sections: SectionInfo[] = [], people: ChainPerson[] = [], heads = new Map<string, Map<string, Set<string>>>(), headNames = new Map<string, string>()
  for (const [store, org] of orgs) {
    for (const s of org.sections) {
      sections.push({ store, section: s.name, floor: s.floor, floorOrder: s.floorOrder, teamLeader: s.teamLeaders.join(', ') })
      s.teamLeaders.forEach((tl, i) => people.push({ id: s.teamLeaderIds[i], name: tl, role: 'Team Leader', place: `${store} · ${s.name}`, places: [{ store, codes: null }] }))
    }
    org.storeManagers.forEach((sm, i) => people.push({ id: org.storeManagerIds[i], name: sm, role: 'Store Manager', place: store, places: [{ store, codes: null }] }))
    for (const [code, sub] of Object.entries(org.subcategories)) {
      // grouped by the head's Employee row: two heads who share a name stay two people
      if (!sub.categoryHeadId) continue
      headNames.set(sub.categoryHeadId, sub.categoryHead ?? sub.categoryHeadId)
      const mine = heads.get(sub.categoryHeadId) ?? heads.set(sub.categoryHeadId, new Map()).get(sub.categoryHeadId)!
      ;(mine.get(store) ?? mine.set(store, new Set()).get(store)!).add(code)
    }
  }
  const size = (p: ChainPerson) => p.places.reduce((t, x) => t + (x.codes?.length ?? 0), 0)
  // the biggest category head first, so the page opens on the one with the most to review
  const headPeople = [...heads].map(([id, at]): ChainPerson => ({ id, name: headNames.get(id)!, role: 'Category Head',
    place: [...new Set([...at.keys()].map(s => lines.find(l => l.store === s)?.region).filter(Boolean))].join(' and '),
    places: [...at].map(([store, codes]) => ({ store, codes: [...codes].sort() })) })).sort((a, b) => size(b) - size(a))
  // the Team Leaders' changes on these lines, for each manager's Approvals (each page keeps to its own lines)
  const read = await loadProposals(month, lines).catch((e: Error) => e)
  const { proposals, rows: changes } = read instanceof Error ? { proposals: [], rows: undefined } : read
  return { real: true, lines, sections, people: [...people, ...headPeople], proposals, runIds: month, changes, cutOff: run.origin_date.slice(0, 10), horizon: first,
    ...(read instanceof Error ? { problem: `Team Leaders' proposals could not be read, so none show and nothing can be decided: ${read.message}` } : {}) }
}

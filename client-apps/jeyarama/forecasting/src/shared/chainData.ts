// What the managers' pages review: the newest official Run in the app's tables (forecast_line_month and the rows
// read beside it, the org chart in forecasting.reach), or the made-up chain when no real Run is loaded. A local
// instance loads a real Run with a loader kept outside the repository; the repository carries no real figure.
import { listWhereAll } from '../api'
import { officialRuns } from '../teamLeader/live'
import { linesFrom, type CopiedRows, type LineMonthRow, type Line, type OtherModelRow, type PlanRow, type SalesRow } from './model'
import type { ProposalItem } from './review'

/** A section of a store: its floor (building order) and its Team Leader(s). */
export interface SectionInfo { store: string; section: string; floor: string; floorOrder: number; teamLeader: string }
/** A store a person covers, whole (codes null) or for some subcategory codes (a category head's merchandise). */
export interface Place { store: string; codes: string[] | null }
export interface ChainPerson { name: string; role: string; place: string; places: Place[] }
export interface Chain {
  /** Whether this is a real Run (loaded locally) or the made-up chain. */
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

const LINE_FIELDS = ['run_id', 'store_code', 'store_name', 'region_name', 'material_group_code', 'division_name', 'subdivision_name', 'category_name', 'subcategory_name',
  'section_name', 'floor_name', 'floor_order', 'forecast_value_before_tax', 'forecast_qty', 'seasonal_factor', 'growth_factor', 'from_recent_selling', 'december_step_on_top',
  'from_last_year', 'adjustments', 'rebalanced_within_category', 'price_and_rounding', ...[1, 2, 3, 4, 5, 6].flatMap(i => [`own_value_b${i}`, `adds_value_b${i}`, `weight_b${i}`])]

interface ReachRow { full_name: string; role: string; place: string; places_json: string | null }

/** The newest real official Run, every store loaded; null when only the made-up Run (or none) is there. */
export async function loadRealChain(): Promise<Chain | null> {
  const runs = (await officialRuns()).filter(r => r.model !== 'made_up')
  const run = runs[0]
  if (!run) return null
  const month = runs.filter(r => r.horizon_from === run.horizon_from).map(r => r.run_id)
  const [rows, sales, plans, others, reach] = await Promise.all([
    listWhereAll<LineMonthRow>('forecasting.forecast_line_month', LINE_FIELDS, [['run_id', 'in', month]]),
    listWhereAll<SalesRow>('forecasting.sales_reference', ['store_code', 'subcategory_name', 'window_name', 'sales_value_before_tax', 'sales_qty'], []),
    listWhereAll<PlanRow>('forecasting.annual_plan_line', ['store_code', 'subcategory_name', 'plan_value_before_tax', 'plan_qty'],
      [['calendar_year', '=', Number(run.horizon_from.slice(0, 4))], ['calendar_month', '=', Number(run.horizon_from.slice(5, 7))]]),
    listWhereAll<OtherModelRow>('forecasting.other_model_line', ['model', 'store_code', 'subcategory_name', 'forecast_value_before_tax'], [['month_from', '=', run.horizon_from.slice(0, 10)]]),
    listWhereAll<ReachRow>('forecasting.reach', ['full_name', 'role', 'place', 'places_json'], []),
  ])
  const lines = linesFrom({ lines: rows, sales, plans, others } as CopiedRows)
  // a section's floor from its lines, its Team Leader(s) from the org chart
  const sections = new Map<string, SectionInfo>()
  for (const l of lines) {
    const k = `${l.store}|${l.section}`
    if (sections.has(k)) continue
    // the org chart names a section's place by the store's code ("ATK · Girls Bottoms") or its name
    const leaders = reach.filter(p => p.role === 'Team Leader' && (p.place === `${l.store} · ${l.section}` || p.place === `${l.storeName} · ${l.section}`)).map(p => p.full_name)
    sections.set(k, { store: l.store, section: l.section, floor: l.floor, floorOrder: l.floorOrder, teamLeader: leaders.join(', ') })
  }
  const people = reach.map((p): ChainPerson => ({ name: p.full_name, role: p.role, place: p.place, places: p.places_json ? JSON.parse(p.places_json) as Place[] : [] }))
  return { real: true, lines, sections: [...sections.values()], people, proposals: [], cutOff: run.origin_date.slice(0, 10), horizon: run.horizon_from.slice(0, 10) }
}

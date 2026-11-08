// The filters a Dive receives for one reader. This is the whole of what Dash tells a Dive: the
// report's row says which keys its Dive reads, the reader's places say the values. Nothing here
// knows any one Dive. A Dive applies what it is sent, so a filter must never widen the reader's
// reach: when a shape can't express a reader's reach, the answer is a refusal, never a wider view.
import type { Place } from './provider.ts'

/** How a Dive's filters are shaped: `Report.filter_shape`'s choices. */
export type FilterShape = 'One store and subcategories' | 'Whole stores' | 'Stores and subcategories' | 'No filter'

/** One row of `dash.report`: one Dive Dash can open. */
export interface ReportRecord {
  report_key: string
  report_name: string
  dive_id: string
  filter_shape: FilterShape
  /** The Dive's key for the store (one store), the stores (whole stores), or each store's reach. */
  store_key: string | null
  subcategory_key: string | null
  whole_store_key: string | null
  /** The Dive's key for the last day of the chosen month; empty when the report takes no month. */
  month_key: string | null
  /** The Dive posts a message once it has drawn, so it needs the page's origin. */
  ready_signal: boolean
  /** Which built-in quick view stands in when the Dive can't load; empty for none. */
  quick_view: string | null
}

export interface Opening {
  /** The store chosen in the bar; only a one-store report reads it. */
  store?: string
  /** The last day of the chosen month; only a report with a month key reads it. */
  periodEnd: string
  appOrigin: string | null
}

export type Refusal = 'not_your_store' | 'whole_stores_only' | 'report_not_set_up'
export type Filters = { state: Record<string, unknown> } | { refused: Refusal }

/** Per store, null for the whole store, else its subcategories. A whole-store place beats a section's. */
function reachByStore(places: readonly Place[]): Map<string, Set<string> | null> {
  const reach = new Map<string, Set<string> | null>()
  for (const place of places) {
    for (const store of place.filters.store ?? []) {
      const codes = place.filters.subcategory
      if (!codes) { reach.set(store, null); continue }
      const held = reach.get(store)
      if (held === null) continue
      reach.set(store, new Set([...(held ?? []), ...codes]))
    }
  }
  return reach
}

const sorted = (values: Iterable<string>) => [...values].sort()

export function diveFilters(report: ReportRecord, places: readonly Place[], opening: Opening): Filters {
  const state: Record<string, unknown> = {}
  const reach = reachByStore(places)
  switch (report.filter_shape) {
    case 'One store and subcategories': {
      if (!report.store_key || !report.subcategory_key || !report.whole_store_key) return { refused: 'report_not_set_up' }
      const held = opening.store === undefined ? undefined : reach.get(opening.store)
      if (held === undefined) return { refused: 'not_your_store' }
      state[report.store_key] = opening.store
      if (held === null) state[report.whole_store_key] = true
      else state[report.subcategory_key] = sorted(held)
      break
    }
    case 'Whole stores': {
      if (!report.store_key) return { refused: 'report_not_set_up' }
      const whole = sorted([...reach].filter(([, held]) => held === null).map(([store]) => store))
      if (!whole.length) return { refused: 'whole_stores_only' }
      state[report.store_key] = whole
      break
    }
    case 'Stores and subcategories': {
      if (!report.store_key) return { refused: 'report_not_set_up' }
      state[report.store_key] = Object.fromEntries(sorted(reach.keys()).map(store => {
        const held = reach.get(store)!
        return [store, held === null ? null : sorted(held)]
      }))
      break
    }
    case 'No filter':
      break
    default:
      return { refused: 'report_not_set_up' }
  }
  if (report.month_key) state[report.month_key] = opening.periodEnd
  if (report.ready_signal && opening.appOrigin) state.app_origin = opening.appOrigin
  return { state }
}

/** The stores the bar offers on this report: the reader's, on a report taking one store; else none. */
export function storesOfReport(report: ReportRecord, places: readonly Place[]): string[] {
  return report.filter_shape === 'One store and subcategories' ? sorted(reachByStore(places).keys()) : []
}

// Which data the app shows. An instance whose forecasting.run_line holds a Run shows that Run, for the
// people in forecasting.reach; one with none shows the made-up data (madeUp.ts). Both Tables are loaded
// in bulk from the engine's output and the org chart, never typed in, so the repo carries no real figure.
// main.tsx reads them before it imports the app, so madeUp.ts, months.ts and sales.ts build their usual
// exports from whichever it is, and no page knows which it is showing.

export type BasisCode = 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'B6'
/** One store × subcategory for the month under review: the engine's figure, the AOP and the days, after GST. */
export interface DatasetSub {
  store: string; region: string; division: string; subdivision: string; category: string; section: string; name: string; code: string
  engine: number; aop: number; band: string
  /** Quantity in the item's own unit (pieces, kg, litres): the Run's forecast and the AOP's. */
  qty: number; aopQty: number
  /** The engine's figure for each day of the month, in whole rupees, adding up to `engine`. */
  days: number[]
  /** Each basis: [its share of the forecast, the value it is a share of]. */
  parts: Partial<Record<BasisCode, [number, number]>>
  other: number
}
/** A store a person covers, whole (codes null) or for some subcategory codes, as Dash's places are. */
export interface Place { store: string; codes: string[] | null }
/** Who works where: the places they cover; an empty list is every store. */
export interface DatasetPerson { id: string; name: string; code: string; role: string; place: string; reportsTo: string | null; places: Place[] }
export interface Dataset { month: string; run: string; subs: DatasetSub[]; people: DatasetPerson[] }

export let DATASET: Dataset | null = null

export interface RunLineRow { run: string; month: string; store: string; region: string; division: string; subdivision: string; category: string; section: string
  subcategory: string; code: string; forecast: number | string; aop: number | string; band: string; qty?: number | string | null; aop_qty?: number | string | null; days_json: string; parts_json: string; other: number | string | null }
export interface ReachRow { full_name: string; code: string; role: string; place: string; reports_to: string | null; places_json: string | null }

/** The newest month's Runs (one a region: kl_…, tn_…), and the people who review them; none when no Run is loaded. */
export function datasetFrom(lines: RunLineRow[], reach: ReachRow[]): Dataset | null {
  if (!lines.length) return null
  const month = lines.map(l => l.month).sort().at(-1)!
  const mine = lines.filter(l => l.month === month)
  const run = [...new Set(mine.map(l => l.run))].sort().join(' + ')
  const idOf = new Map(reach.map(r => [r.full_name, (r.code || r.full_name).toLowerCase().replace(/[^a-z0-9]+/g, '-')]))
  return {
    month, run,
    subs: mine.map(l => ({ store: l.store, region: l.region, division: l.division, subdivision: l.subdivision, category: l.category, section: l.section || 'Not placed in a section',
      name: l.subcategory, code: l.code, engine: Number(l.forecast), aop: Number(l.aop), band: l.band, qty: Number(l.qty ?? 0), aopQty: Number(l.aop_qty ?? 0), days: JSON.parse(l.days_json || '[]'),
      parts: JSON.parse(l.parts_json || '{}'), other: Number(l.other ?? 0) })),
    people: reach.map(r => ({ id: idOf.get(r.full_name)!, name: r.full_name, code: r.code, role: r.role, place: r.place,
      reportsTo: (r.reports_to && idOf.get(r.reports_to)) || null, places: JSON.parse(r.places_json || '[]') })),
  }
}
export function setDataset(d: Dataset | null) { DATASET = d }

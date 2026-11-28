// The day review's model (#1425; the agreed 26-Nov mockup): a section's month day by day, each day and the month to
// date against Feather Forecast, and which days went more than 10% off and want a reason. Pure: the page, the story
// and the tests go through it. Read from two copies of the warehouse feeds, forecast_line_day and actuals_day.
import { linesOf } from '../causes'

type Num = number | string | null | undefined
const n = (v: Num) => (v == null || v === '' ? 0 : Number(v))

export interface ForecastDayRow { store_code: string; subcategory_name: string; forecast_date: string; forecast_value_before_tax: Num }
export interface ActualsDayRow { store_code: string; subcategory_name: string; sales_date: string; sales_value_before_tax: Num; actuals_as_of_date?: string | null }
export const FORECAST_DAY_FIELDS = ['store_code', 'subcategory_name', 'forecast_date', 'forecast_value_before_tax']
export const ACTUALS_DAY_FIELDS = ['store_code', 'subcategory_name', 'sales_date', 'sales_value_before_tax', 'actuals_as_of_date']

/** A day more than this far off Feather Forecast, either way, wants a reason. */
export const OFF_POINTS = 10

/** One subcategory's month: Feather Forecast and sales by day of the month (index 0 is the 1st); sold is null for a
 *  day not yet loaded. */
export interface SubDays { name: string; category: string; section: string; fc: number[]; sold: (number | null)[] }

/** One row of the days, for the section or one subcategory: the day and the month to date. */
export interface DayFigures { day: number; fc: number; sold: number | null; off: number | null; mtdFc: number; mtdSold: number | null; mtdOff: number | null }

const pct = (sold: number, fc: number) => (fc ? (sold / fc - 1) * 100 : 0)

/** Each subcategory's month, from the day copies: up to the last loaded day; a loaded day with no sales row sold 0. */
export function subDaysFrom(lines: { name: string; category: string; section: string }[], fc: ForecastDayRow[], sold: ActualsDayRow[], store: string, days: number, loadedTo: number): SubDays[] {
  return lines.map(l => {
    const f = Array(days).fill(0) as number[], s = Array.from({ length: days }, (_, i) => (i < loadedTo ? 0 : null)) as (number | null)[]
    for (const r of fc) if (r.store_code === store && r.subcategory_name === l.name) f[Number(r.forecast_date.slice(8, 10)) - 1] += n(r.forecast_value_before_tax)
    for (const r of sold) {
      const d = Number(r.sales_date.slice(8, 10)) - 1
      if (r.store_code === store && r.subcategory_name === l.name && d < loadedTo) s[d] = (s[d] ?? 0) + n(r.sales_value_before_tax)
    }
    return { ...l, fc: f, sold: s }
  })
}

/** The last day of sales loaded, as a day of the month (0 when none), from the copies' "sales up to" date. */
export function loadedTo(sold: ActualsDayRow[], monthFrom: string) {
  const asOf = sold.reduce<string | null>((a, r) => { const d = (r.actuals_as_of_date ?? r.sales_date)?.slice(0, 10); return d && (!a || d > a) ? d : a }, null)
  if (!asOf || asOf < monthFrom.slice(0, 10)) return 0
  return asOf.slice(0, 7) > monthFrom.slice(0, 7) ? 31 : Number(asOf.slice(8, 10))
}

/** The day and the month to date for a set of subcategories (the section, or one), for every day of the month. */
export function daysOf(subs: SubDays[], days: number): DayFigures[] {
  let mtdFc = 0, mtdSold = 0
  return Array.from({ length: days }, (_, i) => {
    const fc = subs.reduce((t, s) => t + s.fc[i], 0)
    const loaded = subs.length > 0 && subs.every(s => s.sold[i] != null)
    const sold = loaded ? subs.reduce((t, s) => t + (s.sold[i] ?? 0), 0) : null
    mtdFc += fc
    if (sold != null) mtdSold += sold
    return { day: i + 1, fc, sold, off: sold == null ? null : pct(sold, fc), mtdFc, mtdSold: sold == null ? null : mtdSold, mtdOff: sold == null ? null : pct(mtdSold, mtdFc) }
  })
}

/** In the days: a day more than 10% off, either way, has an edge and wants a reason. */
export const dayIsOff = (d: Pick<DayFigures, 'off'>) => Math.abs(d.off ?? 0) > OFF_POINTS
/** On one day: a subcategory more than 10% off that day or over the month to date is shown, and wants a reason. */
export const lineIsOff = (d: Pick<DayFigures, 'off' | 'mtdOff'>) => Math.abs(d.off ?? 0) > OFF_POINTS || Math.abs(d.mtdOff ?? 0) > OFF_POINTS
/** The day's own % off decides its edge: under (red) or over (amber); none within 10%. */
export const edgeOf = (off: number | null) => (off == null || Math.abs(off) <= OFF_POINTS ? null : off < 0 ? 'under' : 'over')

/** A saved explanation, as the page reads it. */
export interface DayExplanation { id: string; updatedAt: string; subcategory: string | null; day: number; causes: string[]; tags: string[]; note: string; by: string }
export interface DayExplanationRow { row_id: string; updated_at: string; subcategory_name: string | null; explained_date: string; causes: string; tags: string | null; note: string | null; explained_by: string }
export const DAY_EXPLANATION_FIELDS = ['subcategory_name', 'explained_date', 'causes', 'tags', 'note', 'explained_by']
export const explanationOf = (r: DayExplanationRow): DayExplanation => ({ id: r.row_id, updatedAt: r.updated_at, subcategory: r.subcategory_name || null,
  day: Number(r.explained_date.slice(8, 10)), causes: linesOf(r.causes), tags: linesOf(r.tags), note: r.note ?? '', by: r.explained_by })
/** The newest explanation of a day, for the section (subcategory null) or one subcategory. */
export const explanationFor = (all: DayExplanation[], day: number, subcategory: string | null) =>
  all.filter(e => e.day === day && e.subcategory === subcategory).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]

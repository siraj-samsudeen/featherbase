// How it was built (#1425): what each kind of evidence adds to a forecast. Pure, for the shared HowBuilt.
import { BASIS_CODES, prevMonth, type Base, type BasisCode } from './model'

/** What each base adds to the forecast, in ₹. */
export type Adds = Partial<Record<BasisCode, number>>

/** What each base adds across the lines in view. */
export const addsOf = (lines: { bases: Base[] }[]): Record<BasisCode, number> =>
  Object.fromEntries(BASIS_CODES.map(c => [c, lines.reduce((t, l) => t + (l.bases.find(b => b.code === c)?.adds ?? 0), 0)])) as Record<BasisCode, number>

/** The three kinds of evidence for a month, what each adds, and what the steps after them add (the forecast less the three). */
export function evidenceOf(fc: number, adds: Adds, month: string) {
  const add = (codes: BasisCode[]) => codes.reduce((t, c) => t + (adds[c] ?? 0), 0)
  const groups = [
    { name: `Last year's ${month}`, what: `Same date and same ${month === 'December' ? 'Christmas' : 'festival'} position last year, × this year's growth. Weekday-corrected: a Wednesday is compared with a Wednesday.`, codes: ['B1', 'B2'] as BasisCode[] },
    { name: 'The seasonal step', what: `The last 28 days × the usual ${prevMonth(month)}-to-${month} jump from past years.`, codes: ['B6'] as BasisCode[] },
    { name: 'The last few weeks', what: 'The last 28 days, the last four same weekdays, and the same date last month.', codes: ['B3', 'B4', 'B5'] as BasisCode[] },
  ].map(g => ({ ...g, value: add(g.codes) }))
  return { groups, other: fc - groups.reduce((t, g) => t + g.value, 0) }
}

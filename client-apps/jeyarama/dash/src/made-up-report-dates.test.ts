import { describe, expect, it } from 'vitest'
import { madeUpReportDates } from '../scripts/made-up-report-dates.ts'
import { buildReport, type SalesRow } from './report.ts'

// Explicit IST expectations, not derived from the fixture generator. In particular,
// the CI failure was 02-Nov before 05:49 IST, when the old demo still cut at 31-Oct.
const cases = [
  ['2026-10-31T18:30:00.000Z', '2026-11-01', '2026-11-01', '2026-10-01', '2026-10-31'],
  ['2026-11-01T00:18:59.999Z', '2026-11-01', '2026-11-01', '2026-10-01', '2026-10-31'],
  ['2026-11-01T23:51:00.000Z', '2026-11-02', '2026-11-01', '2026-10-01', '2026-10-31'],
  ['2026-11-02T00:19:00.000Z', '2026-11-02', '2026-11-01', '2026-10-01', '2026-10-31'],
  ['2026-11-14T23:51:00.000Z', '2026-11-15', '2026-11-01', '2026-10-01', '2026-10-31'],
  ['2026-11-15T08:00:00.000Z', '2026-11-15', '2026-11-01', '2026-10-01', '2026-10-31'],
  ['2026-12-31T18:30:00.000Z', '2027-01-01', '2027-01-01', '2026-12-01', '2026-12-31'],
  ['2028-02-29T18:30:00.000Z', '2028-03-01', '2028-03-01', '2028-02-01', '2028-02-29'],
] as const

describe('made-up report dates (#764)', () => {
  it.each(cases)('serves current-month figures when seeded at %s', (instant, today, periodStart, lastMonth, lastMonthEnd) => {
    const dates = madeUpReportDates(Date.parse(instant))
    expect(dates).toEqual({ refreshedAt: instant, dataThrough: today, periodStart, lastMonth, lastMonthEnd })

    const row: SalesRow = { store_code: '9901', store_name: 'Lakeside', short_code: 'LKS',
      subcategory_code: '010101001', subcategory: 'Silk sarees', target: 1000, actual: 800,
      days: 1, days_with_actual: 1, target_days: 1, targets_available: true, target_quantity: 10, actual_quantity: 8,
      period_start: dates.periodStart, data_through: dates.dataThrough }
    const places = [{ label: '9901 / Section: Sarees', filters: { store: ['9901'], subcategory: ['010101001'] } }]
    const report = buildReport({ store: '9901', places, answer: { at: dates.refreshedAt, rows: [row] }, today })
    expect(report.state).toBe('ready')
    expect(report.rows.map(r => [r.code, r.target, r.actual])).toEqual([['010101001', 1000, 800]])

    // The quiet-section fixture relies on the same dates in sales_month, not on
    // a fabricated sales row. It must still open as ready, with recorded zeroes.
    const quiet = buildReport({ store: '9901', places, answer: { at: dates.refreshedAt, rows: [] }, today,
      month: { at: dates.refreshedAt, period_start: dates.periodStart, data_through: dates.dataThrough, targets_available: true } })
    expect(quiet.state).toBe('ready')
    expect(quiet.rows.map(r => [r.target, r.actual])).toEqual([[0, 0]])
  })
})

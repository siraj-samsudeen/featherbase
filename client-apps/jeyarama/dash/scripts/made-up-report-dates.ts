import { istToday } from '../src/report.ts'

// A demo copy is made now, through today. It does not wait for the warehouse's
// next morning refresh: its designated reader must have figures on every day.
export function madeUpReportDates(now: number) {
  const today = istToday(now)
  return {
    refreshedAt: new Date(now).toISOString(),
    dataThrough: today,
    periodStart: `${today.slice(0, 8)}01`,
    lastMonth: new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1)).toISOString().slice(0, 10),
    lastMonthEnd: new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10),
  }
}

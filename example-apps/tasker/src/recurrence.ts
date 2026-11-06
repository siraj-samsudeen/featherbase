import { localCalendarDate as localDate } from '@featherbase/shop-floor/format'

export interface RecurrenceSchedule {
  mode: 'daily' | 'weekly' | 'monthly' | 'after_completion'
  interval: number
  /** First scheduled local calendar date; fixed schedules retain this anchor. */
  anchor: string
}
const DAY = 86_400_000
function dayNumber(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Choose a valid starting date')
  const value = Date.parse(`${date}T00:00:00Z`)
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) throw new Error('Choose a valid starting date')
  return value / DAY
}
/** The beginning of a local calendar day, including days when the UTC offset changes. */
function startOfDay(date: string, timeZone: string) {
  const target = dayNumber(date)
  let low = target * DAY - DAY
  let high = target * DAY + DAY
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2)
    if (dayNumber(localDate(middle, timeZone)) < target) low = middle
    else high = middle
  }
  return high
}
/** Fixed schedules choose a strictly future local day; completion intervals use elapsed days. */
export function nextOccurrence(schedule: RecurrenceSchedule, after: string, timeZone: string): string {
  if (!Number.isInteger(schedule.interval) || schedule.interval < 1 || schedule.interval > 365) throw new Error('Choose an interval from 1 to 365')
  const instant = Date.parse(after)
  if (!Number.isFinite(instant)) throw new Error('A completion time is required')
  const anchor = dayNumber(schedule.anchor)
  if (schedule.mode === 'after_completion') return new Date(instant + schedule.interval * DAY).toISOString()
  if (schedule.mode === 'monthly') {
    const [year, month, day] = schedule.anchor.split('-').map(Number)
    const current = localDate(instant, timeZone).split('-').map(Number)
    let slot = Math.max(0, Math.floor(((current[0] - year) * 12 + current[1] - month) / schedule.interval))
    for (;;) {
      const first = new Date(Date.UTC(year, month - 1 + slot * schedule.interval, 1))
      const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
      const date = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, lastDay))).toISOString().slice(0, 10)
      const next = startOfDay(date, timeZone)
      if (next > instant) return new Date(next).toISOString()
      slot++
    }
  }
  const days = schedule.interval * (schedule.mode === 'weekly' ? 7 : 1)
  const today = dayNumber(localDate(instant, timeZone))
  const slot = Math.max(0, Math.floor((today - anchor) / days))
  let next = anchor + slot * days
  while (startOfDay(new Date(next * DAY).toISOString().slice(0, 10), timeZone) <= instant) next += days
  return new Date(startOfDay(new Date(next * DAY).toISOString().slice(0, 10), timeZone)).toISOString()
}

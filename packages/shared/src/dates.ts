// Reading a JS Date as a calendar day without shifting it (#387).
//
// A spreadsheet date cell becomes a local-midnight Date (apps/web parse-file
// builds it from the cell's y/m/d), while a date-only string such as
// "2026-01-15" parses to UTC midnight. Either way the day is the one written:
// read it off whichever clock says midnight. Never format a day through
// toISOString(), which moves a local-midnight Date to the previous day east of
// UTC (IST is +05:30).

export function isLocalMidnight(d: Date): boolean {
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0
}

export function isUtcMidnight(d: Date): boolean {
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0
}

/** YYYY-MM-DDTHH:MM:SS from the Date's local components. */
export function localIso(d: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** The calendar day a Date stands for, YYYY-MM-DD, on any machine's clock. */
export function calendarDay(d: Date): string {
  if (!isLocalMidnight(d) && isUtcMidnight(d)) return d.toISOString().slice(0, 10)
  return localIso(d).slice(0, 10)
}

/**
 * Is y-m-d a day PostgreSQL `date` can hold? Refuses 30-Feb, month 13, Excel's
 * fictitious 29-Feb-1900, and year 0 (PostgreSQL has no year zero).
 */
export function isCalendarDay(y: number, m: number, d: number): boolean {
  if (y < 1) return false
  // setUTCFullYear, not Date.UTC: Date.UTC reads years 0-99 as 1900-1999.
  const date = new Date(0)
  date.setUTCFullYear(y, m - 1, d)
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?))?$/

/**
 * A Datetime with no zone is the importer's wall clock: send the instant it
 * names (toISOString), or the database would read it in the server's timezone
 * and an IST noon would come back as 17:30. A bare day is that day's local
 * midnight. Zoned text, and text naming an impossible day (which validation
 * then refuses), is returned unchanged.
 *
 * Daylight-saving edges follow the JavaScript Date rules: a wall time inside a
 * spring-forward gap moves forward by the gap (São Paulo, 04-Nov-2018 00:30 is
 * 01:30), and an ambiguous fall-back time takes its first occurrence (New York,
 * 03-Nov-2024 01:30 is the EDT one).
 */
export function wallTimeToInstant(s: string): string {
  const m = s.match(WALL_TIME)
  if (!m || !isCalendarDay(Number(m[1]), Number(m[2]), Number(m[3]))) return s
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00:00'}`)
  return Number.isNaN(d.getTime()) ? s : d.toISOString()
}

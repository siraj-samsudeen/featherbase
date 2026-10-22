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

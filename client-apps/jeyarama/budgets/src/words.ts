// How the app says months and stores, in one place.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A month as Oct'26, from any day in it (2026-10-01). */
export function fmtMonth(day: string): string {
  return `${MONTHS[Number(day.slice(5, 7)) - 1]}'${day.slice(2, 4)}`
}

/** A day as 15-Oct-2026, from 2026-10-15. */
export function fmtDay(day: string): string {
  return `${day.slice(8, 10)}-${MONTHS[Number(day.slice(5, 7)) - 1]}-${day.slice(0, 4)}`
}

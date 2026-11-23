// The months the app knows, for the shared top bar's Month picker (server.ts) and every page. MADE-UP:
// September and October 2026 are closed, November is the current month (sales loaded to the 22nd),
// December waits for its Run. No dependency here: the server bundle imports this file alone.

export type MonthState = 'closed' | 'current' | 'empty'
export interface Month {
  /** The address value and the month on every row: 2026-11. */
  key: string
  year: number
  /** 0 for January. */
  index: number
  /** November */
  name: string
  /** Nov */
  mon: string
  /** November 2026 */
  label: string
  /** The month before's name: its Run is written then. */
  before: string
  /** Nov'26 */
  short: string
  days: number
  state: MonthState
  /** The official engine Run, and the last day of sales it was run on; none before the Run. */
  run: string | null
  origin: string | null
  /** The last day with sales loaded (0: none yet). */
  loadedTo: number
}

const NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const pad = (n: number) => String(n).padStart(2, '0')

function month(key: string, state: MonthState, run: string | null, origin: string | null, loadedTo: number): Month {
  const [year, m] = key.split('-').map(Number)
  const index = m - 1, name = NAMES[index], mon = name.slice(0, 3)
  return { key, year, index, name, mon, label: `${name} ${year}`, before: NAMES[(index + 11) % 12], short: `${mon}'${String(year).slice(2)}`,
    days: new Date(Date.UTC(year, index + 1, 0)).getUTCDate(), state, run, origin, loadedTo }
}

export const MONTHS: Month[] = [
  month('2026-09', 'closed', 'demo_2026_09_official', '30-Aug-2026', 30),
  month('2026-10', 'closed', 'demo_2026_10_official', '30-Sep-2026', 31),
  month('2026-11', 'current', 'demo_2026_11_official', '30-Oct-2026', 22),
  month('2026-12', 'empty', null, null, 0),
]
export const CURRENT_MONTH = '2026-11'
/** The month an address names; anything else is the current month. */
export const monthOf = (key: string | null | undefined): Month => MONTHS.find(m => m.key === key) ?? MONTHS.find(m => m.key === CURRENT_MONTH)!

/** The bar's options. It opens on the first, so the current month leads; then the closed ones, newest first; then the next. */
export const MONTH_OPTIONS = [...MONTHS].sort((a, b) => rank(a) - rank(b) || b.key.localeCompare(a.key))
  .map(m => ({ value: m.key, label: `${m.short} · ${m.state === 'current' ? 'current' : m.state === 'closed' ? 'closed' : 'no Run yet'}` }))
function rank(m: Month) { return m.state === 'current' ? 0 : m.state === 'closed' ? 1 : 2 }

/** A month's five weeks, as the grid heads them: 1–7 Nov … 29–30 Nov. */
export const weeksOf = (m: Month) => [1, 8, 15, 22, 29].map(start => `${start}–${Math.min(start + 6, m.days)} ${m.mon}`)
/** Which of the five weeks a day falls in, 1-based. */
export const weekOfDay = (day: number) => Math.min(5, Math.floor((day - 1) / 7) + 1)
/** 05-Nov-2026 */
export const dateOf = (m: Month, day: number) => `${pad(day)}-${m.mon}-${m.year}`
/** 0 for Sunday. */
export const weekdayOf = (m: Month, day: number) => new Date(Date.UTC(m.year, m.index, day)).getUTCDay()
export const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

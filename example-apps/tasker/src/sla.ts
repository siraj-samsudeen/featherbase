// Issue clocks. Shared by the server rules and the screens, so it uses no browser formatting.

export type ClockMode = 'Round the clock' | 'Store hours'
export interface StoreHours { opens: string; closes: string }
export interface SlaRule {
  severity: string
  category?: string | null
  respond_minutes: number
  fix_minutes: number
  clock: ClockMode
  director?: string | null
  director_after_minutes?: number | null
}

export const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'] as const
/** Proposed defaults; the business approves its own in the SLA rules page. */
export const DEFAULT_RULES: Record<string, SlaRule> = {
  Critical: { severity: 'Critical', respond_minutes: 15, fix_minutes: 240, clock: 'Round the clock', director_after_minutes: 120 },
  High: { severity: 'High', respond_minutes: 60, fix_minutes: 1440, clock: 'Store hours' },
  Medium: { severity: 'Medium', respond_minutes: 240, fix_minutes: 4320, clock: 'Store hours' },
  Low: { severity: 'Low', respond_minutes: 1440, fix_minutes: 10080, clock: 'Store hours' },
}
export const DEFAULT_HOURS: StoreHours = { opens: '09:00', closes: '22:00' }

// Store hours are read in IST, the platform's one display zone.
const IST = 330 * 60_000
const DAY = 86_400_000
const minutesOf = (time: string) => { const [h, m] = time.split(':').map(Number); return (h * 60 + (m || 0)) * 60_000 }

/** Store-hours windows (UTC milliseconds) for local days around a span. */
function windows(start: number, end: number, hours: StoreHours) {
  const open = minutesOf(hours.opens), close = minutesOf(hours.closes)
  const length = close > open ? close - open : DAY - open + close
  const result: [number, number][] = []
  for (let day = Math.floor((start + IST) / DAY) * DAY - IST - DAY; day < end; day += DAY)
    result.push([day + open, day + open + length])
  return result
}

/** Whole minutes between two instants that count on the clock. */
export function clockMinutes(start: number, end: number, mode: ClockMode, hours: StoreHours = DEFAULT_HOURS): number {
  if (end <= start) return 0
  if (mode === 'Round the clock') return Math.floor((end - start) / 60_000)
  let total = 0
  for (const [from, to] of windows(start, end, hours)) total += Math.max(0, Math.min(to, end) - Math.max(from, start))
  return Math.floor(total / 60_000)
}

/** The instant when `minutes` of clock time have passed since `start`. */
export function deadlineAfter(start: number, minutes: number, mode: ClockMode, hours: StoreHours = DEFAULT_HOURS): number {
  if (mode === 'Round the clock') return start + minutes * 60_000
  let remaining = minutes * 60_000
  for (const [from, to] of windows(start, start + (minutes / 60 + 2) * 2 * DAY, hours)) {
    const begin = Math.max(from, start)
    if (to <= begin) continue
    if (to - begin >= remaining) return begin + remaining
    remaining -= to - begin
  }
  throw new Error('No store hours to count this clock')
}

export function ruleFor(rules: SlaRule[], severity: string, category: string | null | undefined): SlaRule {
  return rules.find(rule => rule.severity === severity && rule.category && rule.category === category)
    ?? rules.find(rule => rule.severity === severity && !rule.category)
    ?? DEFAULT_RULES[severity] ?? DEFAULT_RULES.Medium
}

export interface ClockedIssue {
  raised_at: string
  fix_minutes: number
  clock: ClockMode
  opens_at?: string | null
  closes_at?: string | null
  paused_minutes?: number | null
  paused?: boolean | null
  paused_since?: string | null
  submitted_at?: string | null
}

const instant = (value: unknown) => Date.parse(value instanceof Date ? value.toISOString() : String(value))

/** The resolution clock: it stops while paused and once the issue is submitted. */
export function issueClock(issue: ClockedIssue, now: number) {
  const hours = { opens: issue.opens_at || DEFAULT_HOURS.opens, closes: issue.closes_at || DEFAULT_HOURS.closes }
  const raised = instant(issue.raised_at)
  const stop = issue.submitted_at ? instant(issue.submitted_at) : now
  const pausedNow = issue.paused && issue.paused_since && !issue.submitted_at ? clockMinutes(instant(issue.paused_since), stop, issue.clock, hours) : 0
  const onClock = Math.max(0, clockMinutes(raised, stop, issue.clock, hours) - Number(issue.paused_minutes ?? 0) - pausedNow)
  const left = Number(issue.fix_minutes) - onClock
  return {
    elapsed: Math.floor((now - raised) / 60_000),
    onClock,
    usedPct: Math.floor((onClock / Number(issue.fix_minutes)) * 100),
    left,
    breached: left < 0,
  }
}

/** "5h 20m", "45m", "2d 3h" for a number of minutes. */
export function duration(minutes: number): string {
  const m = Math.abs(Math.round(minutes))
  if (m < 60) return `${m}m`
  if (m < 1440) return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`
  const hours = Math.floor((m % 1440) / 60)
  return hours ? `${Math.floor(m / 1440)}d ${hours}h` : `${Math.floor(m / 1440)}d`
}

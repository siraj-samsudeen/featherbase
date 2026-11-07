// The rules both the server and the pages use. No I/O here.

export const PRIORITY_HOURS: Record<string, number> = { Urgent: 4, High: 24, Normal: 72 }
export const PRIORITIES = ['Urgent', 'High', 'Normal'] as const
export const JOB_STAGES = ['Reported', 'Assigned', 'In progress', 'Waiting for parts', 'Fixed', 'Cancelled'] as const
export const OPEN_STAGES = ['Reported', 'Assigned', 'In progress', 'Waiting for parts'] as const

const HOUR = 3_600_000

export function isOpen(stage: string): boolean {
  return (OPEN_STAGES as readonly string[]).includes(stage)
}

/** When a job reported at `reportedAt` is due for fixing. */
export function fixByFor(reportedAt: string, priority: string): string {
  const hours = PRIORITY_HOURS[priority] ?? PRIORITY_HOURS.Normal
  return new Date(Date.parse(reportedAt) + hours * HOUR).toISOString()
}

function span(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / 60_000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24), rest = hours % 24
  return rest ? `${days}d ${rest}h` : `${days}d`
}

export interface ClockedJob {
  job_state: string
  fix_by?: string | null
  reported_at?: string | null
  fixed_at?: string | null
}

export type ClockTone = 'ok' | 'soon' | 'late' | 'done'

/** What the fix-by clock says about a job right now. */
export function jobClock(job: ClockedJob, now: Date): { tone: ClockTone; label: string } {
  if (job.job_state === 'Cancelled') return { tone: 'done', label: 'Cancelled' }
  const due = job.fix_by ? Date.parse(job.fix_by) : NaN
  if (job.job_state === 'Fixed') {
    const fixed = job.fixed_at ? Date.parse(job.fixed_at) : NaN
    const reported = job.reported_at ? Date.parse(job.reported_at) : NaN
    if (Number.isNaN(fixed)) return { tone: 'done', label: 'Fixed' }
    const took = Number.isNaN(reported) ? '' : ` in ${span(fixed - reported)}`
    const timing = Number.isNaN(due) ? '' : fixed <= due ? ', on time' : `, ${span(fixed - due)} late`
    return { tone: 'done', label: `Fixed${took}${timing}` }
  }
  if (Number.isNaN(due)) return { tone: 'ok', label: 'No fix-by time' }
  const left = due - now.getTime()
  if (left < 0) return { tone: 'late', label: `Late by ${span(left)}` }
  return { tone: left < HOUR ? 'soon' : 'ok', label: `${span(left)} left` }
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** 'ended' once a warranty's last day has passed, 'soon' within the next 30 days. */
export function warrantyNotice(warrantyUntil: string | null | undefined, today: string): 'ended' | 'soon' | null {
  if (!warrantyUntil) return null
  const last = warrantyUntil.slice(0, 10)
  if (last < today) return 'ended'
  return last <= addDays(today, 30) ? 'soon' : null
}

export function localDay(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

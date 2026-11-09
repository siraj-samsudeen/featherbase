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
  restored_at?: string | null
}

export type ClockTone = 'ok' | 'soon' | 'late' | 'done'

/** What the fix-by clock says about a job right now. */
export function jobClock(job: ClockedJob, now: Date): { tone: ClockTone; label: string } {
  if (job.job_state === 'Cancelled') return { tone: 'done', label: 'Cancelled' }
  const due = job.fix_by ? Date.parse(job.fix_by) : NaN
  if (job.job_state === 'Fixed') {
    const fixed = job.restored_at ? Date.parse(job.restored_at) : NaN
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A stored date as DD-Mon-YYYY, Jeyarama's date form. Pure, so the server can use it too. */
export function dayLabel(value: string): string {
  const [y, m, d] = value.slice(0, 10).split('-')
  return `${d}-${MONTHS[Number(m) - 1]}-${y}`
}

/** Whether a warranty or, failing that, an AMC still covers the asset today. */
export function coverNotice(asset: { warranty_until?: string | null; amc_until?: string | null; amc_vendor?: string | null }, today: string): string | null {
  if (asset.warranty_until && asset.warranty_until.slice(0, 10) >= today) return `Under warranty until ${dayLabel(asset.warranty_until)}`
  if (asset.amc_until && asset.amc_until.slice(0, 10) >= today)
    return `Under AMC${asset.amc_vendor ? ` with ${asset.amc_vendor}` : ''} until ${dayLabel(asset.amc_until)}`
  return null
}

export interface PlaceNode { row_id: string; place_name: string; parent_place?: string | null }

/** A place read from its site down, "Site › Building › Floor › Area". */
export function placePath(id: string, places: PlaceNode[]): string {
  const byId = new Map(places.map(place => [place.row_id, place]))
  const names: string[] = []
  const seen = new Set<string>()
  let current = byId.get(id)
  if (!current) return id
  while (current && !seen.has(current.row_id)) {
    seen.add(current.row_id)
    names.unshift(current.place_name)
    current = current.parent_place ? byId.get(current.parent_place) : undefined
  }
  return names.join(' › ')
}

/** A place by its own name, the last part of its path. */
export function placeName(id: string, places: PlaceNode[]): string {
  return places.find(place => place.row_id === id)?.place_name ?? id
}

/** Warranty or, failing that, AMC cover as a short chip. */
export function coverChip(asset: { warranty_until?: string | null; amc_until?: string | null; amc_vendor?: string | null }, today: string): string | null {
  if (asset.warranty_until && asset.warranty_until.slice(0, 10) >= today) return `Warranty to ${dayLabel(asset.warranty_until)}`
  if (asset.amc_until && asset.amc_until.slice(0, 10) >= today) return `AMC to ${dayLabel(asset.amc_until)}`
  return null
}

/** A fixed job in one line: whether it met its fix-by time, then what was done. */
export function fixedSummary(job: { fix_by?: string | null; restored_at?: string | null; work_done?: string | null }): string {
  const fixed = job.restored_at ? Date.parse(job.restored_at) : NaN
  const due = job.fix_by ? Date.parse(job.fix_by) : NaN
  const timing = Number.isNaN(fixed) || Number.isNaN(due) ? 'Fixed' : fixed <= due ? 'Fixed on time' : `Fixed ${span(fixed - due)} late`
  return job.work_done ? `${timing} · ${job.work_done}` : timing
}

/** Up to two initials for a person's avatar. */
export function initials(name: string): string {
  const letters = name.split(/[\s()]+/).filter(Boolean).map(word => word[0].toUpperCase())
  return letters.length ? letters.slice(0, 2).join('') : '?'
}

/** The site a place belongs to, following parents up. */
export function siteOf(id: string | null | undefined, places: PlaceNode[]): string | null {
  if (!id) return null
  const byId = new Map(places.map(place => [place.row_id, place]))
  const seen = new Set<string>()
  let current = byId.get(id)
  while (current?.parent_place && !seen.has(current.row_id)) {
    seen.add(current.row_id)
    const parent = byId.get(current.parent_place)
    if (!parent) break
    current = parent
  }
  return current?.row_id ?? id
}

/** A fixed job the store has confirmed reads as Closed. */
export function jobStage(job: { row_id: string; job_state: string }, confirmed: ReadonlySet<string>): string {
  return job.job_state === 'Fixed' && confirmed.has(job.row_id) ? 'Closed' : job.job_state
}

/** The workflow state, worked out from an asset's jobs rather than stored. */
export function workflowState(jobs: { row_id: string; job_state: string }[], confirmed: ReadonlySet<string>): string {
  if (jobs.some(job => isOpen(job.job_state))) return 'Repair job open'
  if (jobs.some(job => job.job_state === 'Fixed' && !confirmed.has(job.row_id))) return 'Waiting for the store to confirm'
  return 'No open work'
}

export function localDay(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

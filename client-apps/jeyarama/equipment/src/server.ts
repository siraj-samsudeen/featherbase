import { fixByFor, isOpen } from './jobRules'

// Featherbase runtime hook API v1. Structural contract; no core dependency.
export interface Context {
  user: string
  readonly now: string
  readonly timeZone: string
  isNew: boolean
  documents: {
    get(table: string, id: string): Promise<Record<string, unknown>>
  }
  row: Record<string, unknown>
  old?: Record<string, unknown>
  reject(message: string, fields?: Record<string, string>): never
}

function instant(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value)
}

/** A report becomes a job; the server, not the reporter, sets its place, stage and clock. */
async function prepareJob(ctx: Context): Promise<void> {
  const { row, old } = ctx
  if (!ctx.isNew && row.asset !== old?.asset) ctx.reject('A repair job stays with the asset it was reported on')
  const asset = await ctx.documents.get('equipment.asset', String(row.asset))
  row.place = asset.place ?? null
  if (!row.priority) row.priority = 'Normal'

  if (ctx.isNew) {
    row.reported_at = ctx.now
    row.job_state = row.assigned_to ? 'Assigned' : 'Reported'
    row.fixed_at = null
    row.work_done = null
    row.repair_cost = null
  } else {
    row.reported_at = old?.reported_at ?? ctx.now
    if (row.assigned_to && !old?.assigned_to && row.job_state === 'Reported') row.job_state = 'Assigned'
  }
  row.fix_by = fixByFor(instant(row.reported_at), String(row.priority))

  if (row.job_state === 'Fixed') {
    if (!String(row.work_done ?? '').trim())
      ctx.reject('Say what was done to fix it', { work_done: 'Say what was done to fix it' })
    row.fixed_at = old?.job_state === 'Fixed' ? old.fixed_at ?? ctx.now : ctx.now
  } else {
    row.fixed_at = null
  }
  if (!isOpen(String(row.job_state)) && !['Fixed', 'Cancelled'].includes(String(row.job_state)))
    ctx.reject('Choose a stage for this job')
}

export const platformVersion = '2026-10'
export const validators = { 'equipment.job': prepareJob }
export const actions = {}
export const jobs = {}

import { fixByFor, isOpen } from './jobRules'
import { countActions, prepareCount, prepareCounter, prepareDecision, prepareExpected, prepareScan } from './countServer'
import { custodyActions, prepareClearance, prepareCustody, prepareTransfer, prepareTransferLine } from './custodyServer'
import { inventoryActions, prepareAreaClose, prepareAsset, prepareException, prepareSapMatch, prepareTagEvent, prepareTagRoll } from './inventoryServer'

// Featherbase runtime hook API v1. Structural contract; no core dependency.
export interface Context {
  user: string
  readonly now: string
  readonly timeZone: string
  isNew: boolean
  documents: {
    members(table: string): Promise<{ row_id: string; full_name: string }[]>
    get(table: string, id: string): Promise<Record<string, unknown>>
    list(table: string, args?: { filters?: [string, string, unknown][]; fields?: string[]; limit_page_length?: number }): Promise<Record<string, unknown>[]>
  }
  row: Record<string, unknown>
  old?: Record<string, unknown>
  reject(message: string, fields?: Record<string, string>): never
}

function instant(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value)
}

/** A stamp is set the first time its moment happens, and then never moves. */
function stamp(ctx: Context, field: string, happened: boolean) {
  const before = ctx.old?.[field]
  ctx.row[field] = before ? before : happened ? ctx.now : null
}

async function confirmed(ctx: Context, job: unknown): Promise<boolean> {
  if (!job) return false
  const rows = await ctx.documents.list('equipment.restoration', { filters: [['job', '=', job]], fields: ['row_id'], limit_page_length: 1 })
  return rows.length > 0
}

/** A report becomes a job; the server, not the reporter, sets its place, stage, clock and timeline. */
async function prepareJob(ctx: Context): Promise<void> {
  const { row, old } = ctx
  if (!ctx.isNew && row.asset !== old?.asset) ctx.reject('A repair job stays with the asset it was reported on')
  const asset = await ctx.documents.get('equipment.asset', String(row.asset))
  row.place = asset.place ?? null
  if (!row.priority) row.priority = 'Normal'

  if (ctx.isNew) {
    row.reported_at = ctx.now
    row.job_state = row.assigned_to ? 'Assigned' : 'Reported'
    row.work_done = null
    row.repair_cost = null
  } else {
    row.reported_at = old?.reported_at ?? ctx.now
    if (row.assigned_to && !old?.assigned_to && row.job_state === 'Reported') row.job_state = 'Assigned'
    const changed = ['job_state', 'assigned_to', 'work_done'].some(field => (row[field] ?? null) !== (old?.[field] ?? null))
    if (old?.job_state === 'Fixed' && changed && await confirmed(ctx, row.row_id))
      ctx.reject('The store confirmed this repair; report a new fault instead')
  }
  // Whoever marks it fixed, not whoever it is assigned to, is kept apart from the confirmation.
  row.fixed_by = row.job_state !== 'Fixed' ? null : old?.job_state === 'Fixed' ? old.fixed_by ?? null : ctx.user
  const reported = instant(row.reported_at)
  row.fix_by = fixByFor(reported, String(row.priority))

  const failed = row.failure_started_at ? instant(row.failure_started_at) : reported
  if (Date.parse(failed) > Date.parse(reported))
    ctx.reject('It can’t have stopped working after it was reported', { failure_started_at: 'Choose when it stopped working, up to when it was reported' })
  row.failure_started_at = failed

  const stage = String(row.job_state)
  if (!isOpen(stage) && !['Fixed', 'Cancelled'].includes(stage)) ctx.reject('Choose a stage for this job')
  stamp(ctx, 'responded_at', Boolean(row.assigned_to) || stage !== 'Reported')
  stamp(ctx, 'repair_started_at', stage === 'In progress' || stage === 'Waiting for parts' || stage === 'Fixed')

  if (stage === 'Fixed') {
    if (!String(row.work_done ?? '').trim())
      ctx.reject('Say what was done to fix it', { work_done: 'Say what was done to fix it' })
    row.restored_at = old?.job_state === 'Fixed' && old.restored_at ? old.restored_at : ctx.now
  } else {
    row.restored_at = null
  }
}

/** Someone other than the technician confirms a fixed job works again. */
async function prepareRestoration(ctx: Context): Promise<void> {
  if (!ctx.isNew) ctx.reject('A confirmation is kept as it was made')
  const job = await ctx.documents.get('equipment.job', String(ctx.row.job))
  if (job.job_state !== 'Fixed') ctx.reject('Confirm a job only once it is Fixed')
  const fixer = job.fixed_by ?? job.assigned_to
  if (fixer && fixer === ctx.user) ctx.reject('Someone other than the technician who fixed it confirms the repair')
}

const LEVELS = ['Site', 'Building', 'Floor', 'Area'] as const

/** Places nest site › building › floor › area; an area may sit in any level above it. */
async function preparePlace(ctx: Context): Promise<void> {
  const level = String(ctx.row.place_level ?? 'Site')
  const parentId = ctx.row.parent_place
  if (level === 'Site') {
    if (parentId) ctx.reject('A site is not inside another place', { parent_place: 'A site is not inside another place' })
    return
  }
  if (!parentId) ctx.reject(`Choose the place this ${level.toLowerCase()} is inside`, { parent_place: 'Choose where it is' })
  if (parentId === ctx.row.row_id) ctx.reject('A place cannot be inside itself')
  const parent = await ctx.documents.get('equipment.place', String(parentId))
  const parentLevel = String(parent.place_level)
  const fits = level === 'Building' ? parentLevel === 'Site'
    : level === 'Floor' ? parentLevel === 'Building'
      : LEVELS.indexOf(parentLevel as typeof LEVELS[number]) < LEVELS.indexOf('Area')
  if (!fits) ctx.reject(level === 'Building' ? 'A building sits inside a site'
    : level === 'Floor' ? 'A floor sits inside a building'
      : 'An area sits inside a site, building or floor', { parent_place: 'Choose a place at the level above' })
}

export const platformVersion = '2026-10'
export const validators = {
  'equipment.job': prepareJob, 'equipment.restoration': prepareRestoration, 'equipment.place': preparePlace,
  'equipment.count': prepareCount, 'equipment.counter': prepareCounter, 'equipment.scan': prepareScan, 'equipment.count_decision': prepareDecision, 'equipment.count_expected': prepareExpected,
  'equipment.asset': prepareAsset, 'equipment.tag_event': prepareTagEvent, 'equipment.tag_roll': prepareTagRoll, 'equipment.area_close': prepareAreaClose,
  'equipment.sap_match': prepareSapMatch, 'equipment.exception': prepareException,
  'equipment.custody': prepareCustody, 'equipment.clearance': prepareClearance, 'equipment.transfer': prepareTransfer, 'equipment.transfer_line': prepareTransferLine,
}
export const actions = { ...countActions, ...custodyActions, ...inventoryActions }
export const jobs = {}

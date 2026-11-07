import { nextOccurrence, type RecurrenceSchedule } from './recurrence'

type Row = Record<string, unknown>
interface Documents {
  get(table: string, id: string): Promise<Row>
  list(table: string, args?: { filters?: [string, string, unknown][]; fields?: string[]; limit_page_length?: number; limit_start?: number }): Promise<Row[]>
  create(table: string, values: Row): Promise<Row>
  update(table: string, values: Row): Promise<Row>
}
interface OwnerScope { user: string; documents: Documents }
export interface RecurrenceJobContext {
  readonly now: string
  readonly timeZone: string
  readonly documents: { forEachOwner(callback: (scope: OwnerScope) => Promise<void>): Promise<void> }
  setResult(text: string): void
}
interface ActionContext { user: string; payload: unknown; documents: Documents; reject(message: string): never }
interface Snapshot { task: Row; subtasks: Row[] }
const TASK = 'tasker.task'
const SERIES = 'tasker.recurrence'
// Dates are not copied: an absolute date would make every new occurrence overdue at once.
const fields = ['task_title', 'description', 'assigned_to', 'urgent', 'project', 'store']
const snapshotTask = (row: Row) => Object.fromEntries(fields.map(field => [field, row[field] ?? null]))
async function all(documents: Documents, table: string, filters: [string, string, unknown][]) {
  const rows: Row[] = []
  for (;;) {
    const page = await documents.list(table, { filters, fields: table === TASK ? ['row_id', ...fields] : ['row_id'], limit_start: rows.length, limit_page_length: 200 })
    rows.push(...page)
    if (page.length < 200) return rows
  }
}
function schedule(row: Row): RecurrenceSchedule {
  const mode = String(row.schedule_mode)
  if (!['daily', 'weekly', 'monthly', 'after_completion'].includes(mode)) throw new Error('Choose how this task repeats')
  const value = { mode: mode as RecurrenceSchedule['mode'], interval: Number(row.interval), anchor: row.anchor_date instanceof Date ? row.anchor_date.toISOString().slice(0, 10) : String(row.anchor_date).slice(0, 10) }
  // Validate the same contract used by the scheduler, including the calendar date.
  nextOccurrence(value, '2000-01-01T00:00:00Z', 'UTC')
  return value
}
function snapshot(row: Row): Snapshot {
  const value = JSON.parse(String(row.snapshot)) as Snapshot
  if (!value || !value.task || !Array.isArray(value.subtasks) || typeof value.task.task_title !== 'string' ||
      value.subtasks.some(child => !child || typeof child.task_title !== 'string')) throw new Error('This recurring task has invalid instructions')
  return { task: snapshotTask(value.task), subtasks: value.subtasks.map(snapshotTask) }
}

/** Each callback is a creator-scoped transaction supplied by the declared job capability. */
export async function runRecurrence(ctx: RecurrenceJobContext) {
  let created = 0
  await ctx.documents.forEachOwner(async ({ user, documents }) => {
    const seriesRows = await all(documents, SERIES, [['created_by', '=', user], ['paused', '=', false]])
    for (const listed of seriesRows) {
      // The platform helper locks the series before reading its current state.
      let series = await documents.get(SERIES, String(listed.row_id))
      if (series.paused) continue
      const settings = schedule(series)
      let active: Row | undefined
      if (series.active_task) active = await documents.get(TASK, String(series.active_task))
      if (active?.shared && !series.shared) series = await documents.update(SERIES, {
        row_id: series.row_id, updated_at: series.updated_at, shared: true,
      })
      if (active && active.task_state === 'Cancelled') {
        await documents.update(SERIES, { row_id: series.row_id, updated_at: series.updated_at, paused: true, active_task: null, next_at: null })
        continue
      }
      if (active && active.task_state !== 'Done') continue
      if (active) {
        if (!active.completed_at) throw new Error('A completed recurring task needs its completion time')
        const due = nextOccurrence(settings, String(active.completed_at), ctx.timeZone)
        if ((!series.next_at || new Date(String(series.next_at)).toISOString() !== due) || Boolean(series.shared) !== Boolean(series.shared || active.shared)) series = await documents.update(SERIES, {
          row_id: series.row_id, updated_at: series.updated_at,
          next_at: due,
          shared: Boolean(series.shared || active.shared),
          // Instructions stay snapshotted, but deliberate sharing follows the current project.
          snapshot: JSON.stringify({ ...snapshot(series), task: { ...snapshot(series).task, project: active.project ?? null } }),
        })
      }
      if (!active && !series.next_at) {
        await documents.update(SERIES, { row_id: series.row_id, updated_at: series.updated_at, next_at: nextOccurrence(settings, ctx.now, ctx.timeZone) })
        continue
      }
      if (!series.next_at || Date.parse(String(series.next_at)) > Date.parse(ctx.now)) continue
      const instructions = snapshot(series)
      const key = `${series.row_id}:${new Date(String(series.next_at)).toISOString()}`
      // A unique occurrence_key and the locked series make retries atomic and idempotent.
      const next = await documents.create(TASK, {
        ...instructions.task, recurrence: series.row_id, occurrence_key: key,
        task_state: 'Not started', is_done: false, parent_task: null,
        shared: Boolean(series.shared), personal_tasks_owner: null,
      })
      for (const child of instructions.subtasks) await documents.create(TASK, {
        ...child, project: next.project ?? null, parent_task: next.row_id,
        task_state: 'Not started', is_done: false, shared: Boolean(series.shared),
        personal_tasks_owner: null,
      })
      await documents.update(SERIES, {
        row_id: series.row_id, updated_at: series.updated_at, active_task: next.row_id, next_at: null,
      })
      created++
    }
  })
  ctx.setResult(`Created ${created} recurring task occurrences`)
}

export const recurrenceActions = {
  async start_recurrence(ctx: ActionContext) {
    const input = ctx.payload as Row | null
    if (!input || typeof input.row_id !== 'string' || typeof input.updated_at !== 'string') ctx.reject('Choose a task and its current revision')
    const task = await ctx.documents.get(TASK, input.row_id)
    if (task.updated_at !== input.updated_at) ctx.reject('This task changed. Reopen it before scheduling repeats.')
    if (task.parent_task) ctx.reject('Repeat the parent task with its subtasks')
    if (task.recurrence) ctx.reject('This task already belongs to a recurring series')
    const settings = schedule(input)
    const children = await all(ctx.documents, TASK, [['parent_task', '=', task.row_id]])
    const series = await ctx.documents.create(SERIES, {
      schedule_mode: settings.mode, interval: settings.interval, anchor_date: settings.anchor,
      paused: false, active_task: task.row_id, next_at: null, shared: Boolean(task.shared),
      snapshot: JSON.stringify({ task: snapshotTask(task), subtasks: children.map(snapshotTask) }),
    })
    await ctx.documents.update(TASK, { row_id: task.row_id, updated_at: task.updated_at, recurrence: series.row_id })
    return { seriesId: String(series.row_id) }
  },
  async resume_recurrence(ctx: ActionContext) {
    const input = ctx.payload as Row | null
    if (!input || typeof input.row_id !== 'string') ctx.reject('Choose a recurring series')
    const series = await ctx.documents.get(SERIES, input.row_id)
    await ctx.documents.update(SERIES, { row_id: series.row_id, updated_at: series.updated_at, paused: false })
    return { paused: false }
  },
  async pause_recurrence(ctx: ActionContext) {
    const input = ctx.payload as Row | null
    if (!input || typeof input.row_id !== 'string') ctx.reject('Choose a recurring series')
    const series = await ctx.documents.get(SERIES, input.row_id)
    await ctx.documents.update(SERIES, { row_id: series.row_id, updated_at: series.updated_at, paused: true })
    return { paused: true }
  },
}


interface ValidationContext {
  readonly now: string
  readonly timeZone: string
  user: string
  isNew: boolean
  row: Row
  old?: Row
  documents: Pick<Documents, 'get' | 'list'>
  reject(message: string): never
}
/** Protect the series' snapshot and its one active occurrence on direct saves too. */
export async function prepareRecurrence(ctx: ValidationContext) {
  try { schedule(ctx.row); snapshot(ctx.row) } catch (error) { ctx.reject((error as Error).message) }
  if (!ctx.row.active_task && ctx.isNew) ctx.reject('Choose the first task in this series')
  if (ctx.isNew) {
    const task = await ctx.documents.get(TASK, String(ctx.row.active_task))
    if (task.parent_task || task.recurrence) ctx.reject('Choose a parent task that is not already recurring')
    const children = await all(ctx.documents as Documents, TASK, [['parent_task', '=', task.row_id]])
    ctx.row.snapshot = JSON.stringify({ task: snapshotTask(task), subtasks: children.map(snapshotTask) })
    ctx.row.shared = Boolean(task.shared)
    ctx.row.next_at = null
  } else {
    const old = ctx.old!
    if (old.shared && ctx.row.shared === false) ctx.reject('A shared recurring series cannot become private')
    const oldInstructions = snapshot(old)
    let active: Row | undefined
    if (old.active_task) active = await ctx.documents.get(TASK, String(old.active_task))
    if (ctx.row.active_task !== old.active_task) {
      if (active && !['Done', 'Cancelled'].includes(String(active.task_state))) ctx.reject('Finish the active occurrence before starting another')
      if (ctx.row.active_task) {
        const next = await ctx.documents.get(TASK, String(ctx.row.active_task))
        if (next.recurrence !== ctx.row.row_id || !String(next.occurrence_key).startsWith(`${ctx.row.row_id}:`)) ctx.reject('The active task must be an occurrence of this series')
        active = next
      }
    }
    if (ctx.row.active_task && active?.task_state === 'Done') {
      if (!active.completed_at) ctx.reject('A completed occurrence needs its completion time')
      ctx.row.next_at = nextOccurrence(schedule(ctx.row), String(active.completed_at), ctx.timeZone)
    } else if (active?.task_state === 'Cancelled') {
      ctx.row.paused = true
      ctx.row.next_at = null
    } else if (!ctx.row.active_task) {
      ctx.row.next_at = ctx.row.paused ? null : old.next_at || nextOccurrence(schedule(ctx.row), ctx.now, ctx.timeZone)
    } else ctx.row.next_at = null
    ctx.row.shared = Boolean(old.shared || active?.shared)
    ctx.row.snapshot = JSON.stringify({ ...oldInstructions, task: { ...oldInstructions.task, project: active?.project ?? oldInstructions.task.project ?? null } })
  }
}

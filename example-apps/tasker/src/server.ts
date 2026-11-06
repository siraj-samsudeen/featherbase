import { prepareRecurrence, recurrenceActions, runRecurrence } from './recurrence-server'
import { actions as taskActions } from './actions'
import { prepareSubtaskIdentity, validateSubtaskCompletion } from './subtasks-server'
import { prepareDiscussion } from './discussion-server'
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
export const platformVersion = '2026-10'
export const validators = { 'tasker.task': prepareTask, 'tasker.discussion': prepareDiscussion, 'tasker.recurrence': prepareRecurrence }
export const actions = { ...taskActions, ...recurrenceActions }
export const jobs = { repeat_tasks: runRecurrence }

// A stored date arrives as midnight UTC, a proposed one as 'YYYY-MM-DD'; both start with the day.
function calendarDay(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

async function prepareTask(ctx: Context): Promise<void> {
  let recurrenceSeries: Record<string, unknown> | undefined
  if (!ctx.isNew && (ctx.row.occurrence_key || null) !== (ctx.old?.occurrence_key || null))
    ctx.reject('An occurrence keeps its original identity')
  if (ctx.row.occurrence_key && !ctx.row.recurrence) ctx.reject('An occurrence belongs to its recurring series')
  if (ctx.isNew) ctx.row.shared = Boolean(ctx.row.project)
  else {
    if (ctx.old?.shared && ctx.row.shared === false)
      ctx.reject('Shared work cannot become private again')
    ctx.row.shared = Boolean(ctx.old?.shared || ctx.row.project)
  }
  if (!ctx.isNew && ctx.old?.shared && ctx.old.project && !ctx.row.project && !ctx.row.parent_task)
    ctx.reject('Shared work stays in a shared project; it cannot return to your private Inbox')
  if (ctx.row.recurrence) {
    const series = recurrenceSeries = await ctx.documents.get('tasker.recurrence', String(ctx.row.recurrence))
    if (!ctx.isNew && ctx.old?.recurrence && ctx.row.recurrence !== ctx.old.recurrence)
      ctx.reject('An occurrence stays in its original recurring series')
    if (ctx.isNew) {
      if (ctx.row.parent_task || !series.next_at || Date.parse(String(series.next_at)) > Date.now() || ctx.row.occurrence_key !== `${series.row_id}:${new Date(String(series.next_at)).toISOString()}`)
        ctx.reject('Choose the next scheduled occurrence of this series')
      if (series.active_task) {
        const active = await ctx.documents.get('tasker.task', String(series.active_task))
        if (!['Done', 'Cancelled'].includes(String(active.task_state))) ctx.reject('This series already has active work')
      }
      ctx.row.shared = Boolean(series.shared)
    } else if (!ctx.old?.recurrence && series.active_task !== ctx.row.row_id) ctx.reject('This series belongs to another task')
  } else if (ctx.old?.recurrence) ctx.reject('An occurrence stays in its original recurring series')
  await prepareSubtaskIdentity(ctx)
  if (ctx.row.start_date && ctx.row.due_date && calendarDay(ctx.row.due_date) < calendarDay(ctx.row.start_date))
    ctx.reject('The due date can’t be before the start date', { due_date: 'Choose the start date or a later day' })
  if (!ctx.row.shared) {
    if (ctx.row.personal_tasks_owner && ctx.row.personal_tasks_owner !== ctx.user)
      ctx.reject('Private tasks belong only to their creator')
    if (ctx.row.assigned_to && ctx.row.assigned_to !== ctx.user)
      ctx.reject('Share this task in a project before assigning it to someone else')
  }

  if (ctx.row.project && ctx.row.personal_tasks_owner)
    ctx.reject('Choose either a project or Personal tasks, not both', {
      personal_tasks_owner: 'Remove the project before choosing Personal tasks',
    })
  if (!ctx.row.shared && ctx.row.personal_tasks_owner)
    ctx.row.assigned_to = ctx.row.personal_tasks_owner
  else if (ctx.old && !ctx.old.shared && ctx.old.personal_tasks_owner && ctx.row.assigned_to === ctx.old.personal_tasks_owner)
    ctx.row.assigned_to = null

  const oldDone = Boolean(ctx.old?.is_done)
  const nextDone = Boolean(ctx.row.is_done)
  const oldState = String(ctx.old?.task_state ?? 'Not started')
  const nextState = String(ctx.row.task_state ?? 'Not started')
  const doneChanged = nextDone !== oldDone
  const stateChanged = nextState !== oldState
  if (doneChanged && nextDone) {
    ctx.row.state_before_done = nextState === 'Done' ? oldState : nextState
    ctx.row.task_state = 'Done'
  } else if (doneChanged) {
    ctx.row.task_state = stateChanged ? nextState : String(ctx.old?.state_before_done ?? 'Not started')
    ctx.row.state_before_done = null
  } else if (stateChanged && nextState === 'Done') {
    ctx.row.is_done = true
    ctx.row.state_before_done = oldState
  } else if (stateChanged) {
    ctx.row.is_done = false
    ctx.row.state_before_done = null
  }
  if (recurrenceSeries) {
    const settled = ['Done', 'Cancelled'].includes(String(ctx.row.task_state))
    const wasSettled = ['Done', 'Cancelled'].includes(String(ctx.old?.task_state))
    if (ctx.isNew && settled) ctx.reject('A new occurrence starts unfinished')
    if (!ctx.isNew && wasSettled && !settled && recurrenceSeries.active_task !== ctx.row.row_id)
      ctx.reject('This series has moved on; open its current occurrence')
    if (!settled && (ctx.isNew || wasSettled)) {
      const filters: [string, string, unknown][] = [['recurrence', '=', recurrenceSeries.row_id]]
      if (!ctx.isNew) filters.push(['row_id', '!=', ctx.row.row_id])
      const open = await ctx.documents.list('tasker.task', { filters: [...filters, ['task_state', '!=', 'Done'], ['task_state', '!=', 'Cancelled']], fields: ['row_id'], limit_page_length: 1 })
      const noState = open.length ? [] : await ctx.documents.list('tasker.task', { filters: [...filters, ['task_state', '=', null]], fields: ['row_id'], limit_page_length: 1 })
      if (open.length || noState.length) ctx.reject('This series already has unfinished work')
    }
  }
  if (ctx.row.task_state === 'Done') ctx.row.completed_at = ctx.old?.task_state === 'Done' ? ctx.old.completed_at ?? ctx.now : ctx.now
  else ctx.row.completed_at = null
  await validateSubtaskCompletion(ctx)
}

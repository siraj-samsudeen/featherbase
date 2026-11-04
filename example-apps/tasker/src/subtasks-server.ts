import type { Context } from './server'

const settled = (row: Record<string, unknown>) => row.task_state === 'Done' || row.task_state === 'Cancelled'

/** Locks the parent before checking inherited identity or completion. */
export async function prepareSubtaskIdentity(ctx: Context): Promise<void> {
  const parentId = ctx.row.parent_task
  if (!ctx.isNew && (parentId || null) !== (ctx.old?.parent_task || null))
    ctx.reject('A subtask cannot be moved to another parent')
  if (!parentId) return
  if (parentId === ctx.row.row_id) ctx.reject('A task cannot be its own parent')
  const parent = await ctx.documents.get('tasker.task', String(parentId))
  if (parent.parent_task) ctx.reject('Subtasks cannot contain another level of subtasks')
  const projectChanged = ctx.isNew ? Boolean(ctx.row.project) : ctx.row.project !== ctx.old?.project
  if (projectChanged && (ctx.row.project || null) !== (parent.project || null))
    ctx.reject('A subtask belongs to its parent’s project')
  if (ctx.row.personal_tasks_owner && ctx.row.personal_tasks_owner !== parent.created_by)
    ctx.reject('A subtask inherits its parent’s privacy')
  ctx.row.project = parent.project || null
  ctx.row.personal_tasks_owner = null
  ctx.row.shared = Boolean(parent.shared)
  if (!parent.shared && ctx.row.assigned_to && ctx.row.assigned_to !== parent.created_by)
    ctx.reject('Share the parent before assigning a subtask to someone else')
  if (parent.shared && ctx.row.assigned_to) {
    const members = await ctx.documents.members('tasker.task')
    if (!members.some(member => member.row_id === ctx.row.assigned_to))
      ctx.reject('Choose a Tasker member for this subtask')
  }
}

/** Called after task state/Done normalization. Parent locks serialize child changes. */
export async function validateSubtaskCompletion(ctx: Context): Promise<void> {
  if (ctx.row.parent_task) {
    const parent = await ctx.documents.get('tasker.task', String(ctx.row.parent_task))
    if (parent.task_state === 'Done' && !settled(ctx.row))
      ctx.reject('Reopen the parent before opening this subtask')
    return
  }
  if (ctx.isNew || !ctx.row.row_id) return
  await ctx.documents.get('tasker.task', String(ctx.row.row_id))
  if (ctx.row.task_state !== 'Done') return
  const open = await ctx.documents.list('tasker.task', {
    filters: [['parent_task', '=', ctx.row.row_id], ['task_state', '!=', 'Done'], ['task_state', '!=', 'Cancelled']],
    fields: ['row_id', 'task_title'], limit_page_length: 1,
  })
  const noState = open.length ? [] : await ctx.documents.list('tasker.task', {
    filters: [['parent_task', '=', ctx.row.row_id], ['task_state', '=', null]],
    fields: ['row_id', 'task_title'], limit_page_length: 1,
  })
  const unfinished = open[0] || noState[0]
  if (unfinished) ctx.reject(`Finish or cancel the open subtask first: ${String(unfinished.task_title)}`)
}

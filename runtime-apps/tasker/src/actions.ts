type Row = Record<string, unknown>
interface Documents {
  get(table: string, id: string): Promise<Row>
  create(table: string, values: Row): Promise<Row>
  update(table: string, values: Row): Promise<Row>
  delete(table: string, id: string, updatedAt: string): Promise<void>
  deletionState(table: string, id: string): Promise<{ comments: number; versions: number; references: number }>
}
interface Context {
  payload: unknown
  documents: Documents
  reject(message: string, fields?: Record<string, string>): never
}

function input(ctx: Context) {
  const value = ctx.payload as Record<string, unknown> | null
  if (!value || typeof value !== 'object' || typeof value.row_id !== 'string' || !value.row_id ||
      typeof value.updated_at !== 'string' || !value.updated_at ||
      (value.confirm !== undefined && typeof value.confirm !== 'boolean'))
    ctx.reject('Choose a task and its current revision')
  return value as { row_id: string; updated_at: string; confirm?: boolean }
}

export const actions = {
  async promote(ctx: Context) {
    const request = input(ctx)
    const task = await ctx.documents.get('tasker.task', request.row_id)
    if (String(task.updated_at) !== request.updated_at) ctx.reject('This task changed. Close and reopen its details before promoting.')
    const counts = await ctx.documents.deletionState('tasker.task', request.row_id)
    // @spec promotion_preserves_work_history
    // Creation has no recorded update; references also require retaining the identity.
    const rich = Boolean(task.assigned_to || task.urgent || task.is_done || task.task_state !== 'Not started' ||
      counts.comments || counts.versions || counts.references)
    if (rich && !request.confirm) return { confirmationRequired: true }
    // @spec promotion_is_atomic_retryable
    // These host documents share one transaction and durable request-key receipt.
    const project = await ctx.documents.create('tasker.project', {
      project_name: task.task_title, description: task.description ?? null,
    })
    if (rich) {
      const moved = await ctx.documents.update('tasker.task', {
        row_id: request.row_id, updated_at: request.updated_at, project: project.row_id,
        personal_tasks_owner: null, assigned_to: task.assigned_to,
      })
      // Ordinary departure from Personal clears its implied assignment. Promotion
      // restores responsibility inside this same transaction, before publication.
      if (task.personal_tasks_owner && task.assigned_to) await ctx.documents.update('tasker.task', {
        row_id: request.row_id, updated_at: moved.updated_at, assigned_to: task.assigned_to,
      })
    } else await ctx.documents.delete('tasker.task', request.row_id, request.updated_at)
    return { projectId: String(project.row_id), retainedTask: rich }
  },

  async delete_accidental(ctx: Context) {
    const request = input(ctx)
    if (!request.confirm) ctx.reject('Confirm permanent deletion of this accidental task')
    const task = await ctx.documents.get('tasker.task', request.row_id)
    if (String(task.updated_at) !== request.updated_at) ctx.reject('This task changed. Close and reopen its details before deleting.')
    // @spec task_activity_stays_in_tasker
    const counts = await ctx.documents.deletionState('tasker.task', request.row_id)
    if (counts.comments || counts.versions || counts.references || task.assigned_to || task.urgent || task.task_state !== 'Not started')
      return { deleted: false, message: 'This task has retained work or references. Choose Cancelled to keep its context.', counts }
    await ctx.documents.delete('tasker.task', request.row_id, request.updated_at)
    return { deleted: true }
  },
}

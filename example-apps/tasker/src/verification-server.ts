import type { Context } from './server'

export const SUBMITTED = 'Submitted for verification'

// Only these rules write these fields; whatever a client sends for them is ignored.
const STAMPED = ['acknowledged_at', 'submitted_at', 'submitted_by', 'verified_by', 'verified_at', 'return_reason',
  'return_count', 'original_due_date', 'extension_count', 'extension_reason', 'cancel_reason'] as const
const COUNTS = new Set(['return_count', 'extension_count'])

const day = (value: unknown) => value ? (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10) : null
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

/** Verifiers, acknowledgement, submit/accept/return, and reasons for due date moves and cancelling.
 * Runs after the Done/state normalisation, so `task_state` is the state being saved. */
export async function prepareVerification(ctx: Context): Promise<void> {
  const old = ctx.old ?? {}
  const reason = text(ctx.row.change_reason)
  ctx.row.change_reason = null
  const wantsAcknowledge = Boolean(ctx.row.acknowledged_at) && !old.acknowledged_at
  for (const field of STAMPED) ctx.row[field] = ctx.isNew ? (COUNTS.has(field) ? 0 : null) : old[field] ?? (COUNTS.has(field) ? 0 : null)

  if (ctx.isNew && !ctx.row.verifier && ctx.row.project && !ctx.row.parent_task) {
    const project = await ctx.documents.get('tasker.project', String(ctx.row.project))
    if (project.default_verifier && project.default_verifier !== ctx.row.assigned_to) ctx.row.verifier = project.default_verifier
  }

  const from = ctx.isNew ? 'Not started' : String(old.task_state ?? 'Not started')
  // Undoing Done returns to the state before it; a closed check starts over in progress.
  if (from === 'Done' && ctx.row.task_state === SUBMITTED) ctx.row.task_state = 'In progress'
  const to = String(ctx.row.task_state ?? 'Not started')
  const verifier = ctx.row.verifier ? String(ctx.row.verifier) : null

  if (verifier) {
    if (!ctx.row.shared) ctx.reject('Share this task in a project before asking someone to verify it', { verifier: 'Move the task into a project first' })
    if (verifier === ctx.row.assigned_to) ctx.reject('The verifier can’t be the person doing the task', { verifier: 'Choose someone other than the assignee' })
    if (verifier !== old.verifier) {
      const members = await ctx.documents.members('tasker.task')
      if (!members.some(member => member.row_id === verifier)) ctx.reject('Choose a Tasker member to verify this task', { verifier: 'Choose a Tasker member' })
      if (from === SUBMITTED && to === SUBMITTED && verifier === ctx.row.submitted_by) ctx.reject('Nobody verifies a task they submitted', { verifier: 'Choose someone other than the person who submitted it' })
    }
  }

  if (ctx.isNew || ctx.row.assigned_to !== old.assigned_to)
    ctx.row.acknowledged_at = ctx.row.assigned_to && ctx.row.assigned_to === ctx.user ? ctx.now : null
  else if (wantsAcknowledge) {
    if (ctx.row.assigned_to !== ctx.user) ctx.reject('Only the assignee can acknowledge this task')
    ctx.row.acknowledged_at = ctx.now
  }

  if (to === SUBMITTED && !verifier) ctx.reject('Choose a verifier before submitting this task', { verifier: 'Choose who verifies it' })
  if (to === SUBMITTED && from !== SUBMITTED) {
    if (!text(ctx.row.evidence_note)) ctx.reject('Add a note on what was done', { evidence_note: 'Say what was done' })
    if (verifier === ctx.user) ctx.reject('The verifier can’t submit a task they verify')
    ctx.row.submitted_at = ctx.now
    ctx.row.submitted_by = ctx.user
    ctx.row.return_reason = null
  } else if (from === SUBMITTED && to !== SUBMITTED && to !== 'Cancelled') {
    if (to === 'Done') {
      if (ctx.user !== verifier) ctx.reject('Only the verifier can accept this task')
      if (ctx.user === ctx.row.submitted_by) ctx.reject('Nobody verifies a task they submitted')
      ctx.row.verified_by = ctx.user
      ctx.row.verified_at = ctx.now
    } else {
      if (ctx.user !== verifier) ctx.reject('Waiting for the verifier to accept or return this task')
      if (!reason) ctx.reject('Give a reason for returning this task', { change_reason: 'Say what still needs doing' })
      ctx.row.task_state = 'In progress'
      ctx.row.is_done = false
      ctx.row.return_reason = reason
      ctx.row.return_count = Number(old.return_count) + 1
    }
  } else if (to === 'Done' && from !== 'Done' && verifier)
    ctx.reject('Submit this task for verification; its verifier closes it')
  if (from === 'Done' && to !== 'Done') {
    ctx.row.verified_by = null
    ctx.row.verified_at = null
  }

  const oldDue = day(old.due_date), nextDue = day(ctx.row.due_date)
  if (!ctx.isNew && oldDue && nextDue !== oldDue) {
    if (!reason) ctx.reject('Give a reason for moving the due date', { due_date: 'Say why the date moves' })
    ctx.row.original_due_date = old.original_due_date ?? old.due_date
    ctx.row.extension_count = Number(old.extension_count) + 1
    ctx.row.extension_reason = reason
  }

  if (to === 'Cancelled' && from !== 'Cancelled') {
    if (!reason) ctx.reject('Give a reason for cancelling', { change_reason: 'Say why it is cancelled' })
    ctx.row.cancel_reason = reason
  } else if (to !== 'Cancelled') ctx.row.cancel_reason = null
}

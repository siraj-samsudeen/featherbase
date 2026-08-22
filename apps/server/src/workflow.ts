import { randomBytes } from 'node:crypto'
import { sql } from './db'
import { AppError } from './errors'
import { getMeta, invalidateMeta, physicalRowKey } from './meta'
import { tableName } from './table-engine'
import { getRoles } from './permissions'
import { getDoc } from './document'
import { runHooks } from './controllers'
import { queueEmail } from './email'
import { evaluateEmailRules } from './email-rules'
import { publishDocEvent } from './realtime'
import { evalCondition } from './server-scripts'

// WF-001/002/003: workflow definition, execution, and server-side
// transition enforcement.

export interface WorkflowState {
  state: string
  // Renamed from Frappe's doc_status: the row's *lifecycle* status while in
  // this named state (distinct from the sub_table's own reserved `status`
  // column, which every Table gets and which isn't what this represents).
  target_status: 'draft' | 'submitted' | 'cancelled'
}
export interface WorkflowTransition {
  state: string
  action: string
  next_state: string
  allowed: string
  // A boolean expression over `row` that must hold for the transition to be
  // available and applied. Empty = always allowed.
  condition?: string | null
}
export interface Workflow {
  row_id: string
  ref_table: string
  // The column on the target Table that carries the state. Defaults to the
  // auto-added `workflow_state`; set it to an existing column (e.g. a
  // Choice column) to make the workflow drive that column directly.
  state_field?: string | null
  states: WorkflowState[]
  transitions: WorkflowTransition[]
}

export function stateField(wf: Workflow): string {
  return (wf.state_field ?? '').trim() || 'workflow_state'
}

// The Workflow tables arrive in migration 0015 and `state_field` only in 0048,
// but earlier bootstrap migrations already save rows — and every save asks
// for the active workflow. Probe for the newest column this query needs, which
// covers both the missing table and the not-yet-added column on a fresh
// database. Only the positive is cached, so a migration that completes the
// schema mid-process is picked up.
let workflowSchemaReady = false
async function hasWorkflowSchema(): Promise<boolean> {
  if (workflowSchemaReady) return true
  const [row] = await sql`
    select 1 as ok from information_schema.columns
    where table_name = 'workflow' and column_name = 'state_field'`
  workflowSchemaReady = Boolean(row)
  return workflowSchemaReady
}

// The active workflow for a Table (at most one), with its child rows.
export async function getActiveWorkflow(table: string): Promise<Workflow | null> {
  if (!(await hasWorkflowSchema())) return null
  const [wf] = await sql`
    select row_id, ref_table, state_field from workflow
    where ref_table = ${table} and is_active = true
    order by updated_at desc limit 1`
  if (!wf) return null
  const states = await sql<WorkflowState[]>`
    select state, target_status from workflow_document_state
    where parent = ${wf.row_id as string} and parenttype = 'Workflow' order by position`
  const transitions = await sql<WorkflowTransition[]>`
    select state, action, next_state, allowed, "condition" from workflow_transition
    where parent = ${wf.row_id as string} and parenttype = 'Workflow' order by position`
  return {
    row_id: wf.row_id as string,
    ref_table: wf.ref_table as string,
    state_field: (wf.state_field as string | null) ?? null,
    states,
    transitions,
  }
}

// WF-001: reject a definition whose transitions reference undefined states.
export function validateWorkflow(states: WorkflowState[], transitions: WorkflowTransition[]) {
  const known = new Set(states.map((s) => s.state))
  if (!states.length)
    throw new AppError('ValidationError', 'A workflow needs at least one state', {
      states: 'Required',
    })
  for (const t of transitions) {
    if (!known.has(t.state))
      throw new AppError('ValidationError', `Transition from unknown state "${t.state}"`, {
        transitions: `Unknown state ${t.state}`,
      })
    if (!known.has(t.next_state))
      throw new AppError('ValidationError', `Transition to unknown state "${t.next_state}"`, {
        transitions: `Unknown state ${t.next_state}`,
      })
  }
}

// WF-002: the target Table needs a column to carry the state on each row.
// When the workflow binds an existing column (state_field), nothing is
// added; otherwise the default `workflow_state` column is created on
// demand, inside the given txn.
export async function ensureStateField(
  table: string,
  tx: typeof sql = sql,
  field = 'workflow_state',
): Promise<void> {
  const meta = await getMeta(table)
  if (meta.columns.some((f) => f.column_name === field)) return
  if (field !== 'workflow_state')
    throw new AppError(
      'ValidationError',
      `Workflow state field "${field}" does not exist on ${table}`,
    )
  const tbl = tableName(table)
  await tx.unsafe(`alter table "${tbl}" add column if not exists "workflow_state" varchar(140)`)
  const position = meta.columns.length + 1
  await tx`
    insert into column_def ${tx({
      parent: table,
      position,
      column_name: 'workflow_state',
      label: 'Workflow State',
      column_type: 'Data',
      read_only: true,
      in_list_view: true,
    })}`
  invalidateMeta(table)
}

// The row's current state, defaulting to the workflow's first state.
export function currentState(wf: Workflow, row: Record<string, unknown>): string {
  const v = row[stateField(wf)]
  if (typeof v === 'string' && v) return v
  return wf.states[0]?.state ?? ''
}

// Transitions available from a state for a user holding the given roles.
// Administrator / System Manager bypass the ROLE gate, but the CONDITION gate
// still applies to everyone (a condition is a property of the row, not the
// user). When `row` is omitted, conditions are not evaluated (role-only view).
export function availableActions(
  wf: Workflow,
  state: string,
  roles: string[],
  row?: Record<string, unknown>,
): WorkflowTransition[] {
  const roleSet = new Set(roles)
  const privileged = roleSet.has('Administrator') || roleSet.has('System Manager')
  return wf.transitions.filter((t) => {
    if (t.state !== state) return false
    if (!privileged && !roleSet.has(t.allowed)) return false
    if (row && !evalCondition(t.condition, row, `${t.state}→${t.action}`)) return false
    return true
  })
}

// WF-002/003: apply an action. Enforces the transition exists from the
// current state and that the user holds the required role (Administrator
// bypasses). Updates workflow_state + status and logs the audit trail.
export async function applyWorkflowAction(
  table: string,
  name: string,
  action: string,
  user: string,
): Promise<Record<string, unknown>> {
  const wf = await getActiveWorkflow(table)
  if (!wf) throw new AppError('ValidationError', `No active workflow for ${table}`)
  const field = stateField(wf)
  await ensureStateField(table, sql, field)

  const row = await getDoc(table, name, user)
  const from = currentState(wf, row)
  const transition = wf.transitions.find((t) => t.state === from && t.action === action)
  if (!transition)
    throw new AppError('ValidationError', `Action "${action}" is not allowed from state "${from}"`)

  const roles = await getRoles(user)
  const privileged = roles.includes('Administrator') || roles.includes('System Manager')
  if (!privileged && !roles.includes(transition.allowed))
    throw new AppError(
      'PermissionError',
      `Your roles cannot perform "${action}" (requires ${transition.allowed})`,
    )

  // Conditional transitions: the condition is a property of the ROW, so it
  // is enforced for everyone (Administrator included) and independently of the
  // UI — a transition whose condition is false cannot be applied even by API.
  if (!evalCondition(transition.condition, row, `${from}→${action}`))
    throw new AppError(
      'ValidationError',
      `Action "${action}" is not allowed: its condition is not met`,
    )

  const target = wf.states.find((s) => s.state === transition.next_state)
  const status = target ? target.target_status : ((row.status as 'draft' | 'submitted' | 'cancelled') ?? 'draft')

  // Persist via a direct update (bypasses the submitted-row write lock — a
  // workflow legitimately moves a submitted row between states/statuses).
  // One transaction with the audit row, and — spec 0007 BUD-H1 — a
  // transition that CHANGES the row's status is that status change: the
  // same submit/cancel controller hooks setStatus runs fire here too, in
  // the same order (before_* pre-write and able to abort the transition,
  // on_* post-write). Without this, a workflow-approved row would reach
  // 'submitted' without its on-submit obligations (e.g. a Budget Change
  // would flip approved without applying).
  const meta = await getMeta(table)
  let statusEvent: 'submit' | 'cancel' | null = null
  await sql.begin(async (tx) => {
    const stx = tx as unknown as typeof sql
    const [existing] = await tx`
      select * from ${tx(tableName(table))}
      where ${tx(physicalRowKey(table))} = ${name} for update`
    if (!existing) throw new AppError('NotFoundError', `${table} ${name} not found`)
    const fromStatus = String(existing.status ?? 'draft')
    statusEvent =
      fromStatus === status ? null : status === 'submitted' ? 'submit' : status === 'cancelled' ? 'cancel' : null
    const preCtx = {
      row: { ...(existing as Record<string, unknown>) },
      old: existing as Record<string, unknown>,
      meta,
      user,
      isNew: false,
      tx: stx,
    }
    if (statusEvent === 'submit') await runHooks('before_submit', preCtx)
    else if (statusEvent === 'cancel') await runHooks('before_cancel', preCtx)
    const [updated] = await tx`
      update ${tx(tableName(table))}
      set ${tx(field)} = ${transition.next_state}, status = ${status}, updated_at = now()
      where ${tx(physicalRowKey(table))} = ${name} returning *`
    const postCtx = { ...preCtx, row: updated as Record<string, unknown> }
    if (statusEvent === 'submit') await runHooks('on_submit', postCtx)
    else if (statusEvent === 'cancel') await runHooks('on_cancel', postCtx)

    await tx`
      insert into workflow_action ${tx({
        row_id: randomBytes(5).toString('hex'),
        created_by: user,
        updated_by: user,
        ref_table: table,
        ref_name: name,
        action,
        from_state: from,
        to_state: transition.next_state,
        actor: user,
      })}`
  })

  // WF-004: entering a state that still has outgoing transitions means the
  // row is now pending someone's action. Email every user who could take
  // one of those actions (holders of the transitions' allowed roles), with a
  // link to the row and the actions they can take.
  await notifyPendingApprovers(wf, table, name, transition.next_state, user)

  const result = await getDoc(table, name, user)
  // A transition is a save of the state field: conditional on_save Email
  // Rules (e.g. "email the requester when status becomes Resolved") fire on
  // it, and list subscribers get the update over realtime.
  await evaluateEmailRules('on_save', table, result, row)
  // BUD-H1 continued: a transition that submitted/cancelled the row is that
  // lifecycle event for Email Rules too — the same rules setStatus fires
  // (e.g. "notify the CFO on every approved Budget Change" must fire on the
  // fast lane, which is exactly the path that skips setStatus).
  if (statusEvent === 'submit') await evaluateEmailRules('on_submit', table, result)
  else if (statusEvent === 'cancel') await evaluateEmailRules('on_cancel', table, result)
  publishDocEvent(table, name, 'updated')
  return result
}

// WF-004: notify the users who can act on a row that has just entered a
// pending state. Approvers are the holders of the roles named on the outgoing
// transitions from `state`. The acting user is skipped (no self-notification),
// as are disabled users. Each email references the row so it threads to
// the record, and carries a deep link plus the list of available actions.
async function notifyPendingApprovers(
  wf: Workflow,
  table: string,
  name: string,
  state: string,
  actingUser: string,
): Promise<void> {
  const outgoing = wf.transitions.filter((t) => t.state === state)
  if (outgoing.length === 0) return // terminal state — nobody left to act

  const roles = [...new Set(outgoing.map((t) => t.allowed))]
  if (roles.length === 0) return

  const holders = await sql<{ parent: string; email: string | null }[]>`
    select distinct hr.parent, u.email from has_role hr
    join "user" u on u.row_id = hr.parent
    where hr.parenttype = 'User' and hr.role in ${sql(roles)}
      and u.enabled = true`
  const approvers = holders
    .filter((h) => h.parent !== actingUser)
    .map((h) => ({ user: h.parent, email: h.email ?? h.parent }))
  if (approvers.length === 0) return

  const actions = outgoing.map((t) => t.action).join(', ')
  const link = `/admin/${encodeURIComponent(table)}/${encodeURIComponent(name)}`
  const subject = `Approval required: ${table} ${name}`
  const body =
    `${table} ${name} has entered the "${state}" state and is awaiting your action.\n\n` +
    `Available actions: ${actions}\n` +
    `Open the row: ${link}`

  for (const approver of approvers) {
    await queueEmail({
      to: approver.email,
      subject,
      body,
      ref_table: table,
      reference_name: name,
    })
  }
}

// Ensure any existing row without a state starts at the first state.
export async function initDocState(table: string): Promise<void> {
  const wf = await getActiveWorkflow(table)
  if (!wf || !wf.states.length) return
  const field = stateField(wf)
  await ensureStateField(table, sql, field)
  await sql`
    update ${sql(tableName(table))}
    set ${sql(field)} = ${wf.states[0].state}
    where ${sql(field)} is null`
}

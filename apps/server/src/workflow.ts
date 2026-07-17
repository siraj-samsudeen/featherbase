import { randomBytes } from 'node:crypto'
import { sql } from './db'
import { AppError } from './errors'
import { getMeta, invalidateMeta } from './meta'
import { tableName } from './doctype-engine'
import { getRoles } from './permissions'
import { getDoc } from './document'
import { queueEmail } from './email'
import { evalCondition } from './server-scripts'

// WF-001/002/003: workflow definition, execution, and server-side
// transition enforcement.

export interface WorkflowState {
  state: string
  doc_status: string
}
export interface WorkflowTransition {
  state: string
  action: string
  next_state: string
  allowed: string
  // A boolean expression over `doc` that must hold for the transition to be
  // available and applied. Empty = always allowed.
  condition?: string | null
}
export interface Workflow {
  name: string
  document_type: string
  // The field on the target DocType that carries the state. Defaults to the
  // auto-added `workflow_state`; set it to an existing field (e.g. a `status`
  // Select) to make the workflow drive that field directly, Frappe-style.
  state_field?: string | null
  states: WorkflowState[]
  transitions: WorkflowTransition[]
}

export function stateField(wf: Workflow): string {
  return (wf.state_field ?? '').trim() || 'workflow_state'
}

// The active workflow for a DocType (at most one), with its child rows.
export async function getActiveWorkflow(doctype: string): Promise<Workflow | null> {
  const [wf] = await sql`
    select name, document_type, state_field from tab_workflow
    where document_type = ${doctype} and is_active = true
    order by modified desc limit 1`
  if (!wf) return null
  const states = await sql<WorkflowState[]>`
    select state, doc_status from tab_workflow_document_state
    where parent = ${wf.name as string} and parenttype = 'Workflow' order by idx`
  const transitions = await sql<WorkflowTransition[]>`
    select state, action, next_state, allowed, "condition" from tab_workflow_transition
    where parent = ${wf.name as string} and parenttype = 'Workflow' order by idx`
  return {
    name: wf.name as string,
    document_type: wf.document_type as string,
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

// WF-002: the target DocType needs a field to carry the state on each
// document. When the workflow binds an existing field (state_field), nothing
// is added; otherwise the default `workflow_state` field is created on
// demand, inside the given txn.
export async function ensureStateField(
  doctype: string,
  tx: typeof sql = sql,
  field = 'workflow_state',
): Promise<void> {
  const meta = await getMeta(doctype)
  if (meta.fields.some((f) => f.fieldname === field)) return
  if (field !== 'workflow_state')
    throw new AppError(
      'ValidationError',
      `Workflow state field "${field}" does not exist on ${doctype}`,
    )
  const table = tableName(doctype)
  await tx.unsafe(`alter table "${table}" add column if not exists "workflow_state" varchar(140)`)
  const idx = meta.fields.length + 1
  await tx`
    insert into tab_docfield ${tx({
      parent: doctype,
      idx,
      fieldname: 'workflow_state',
      label: 'Workflow State',
      fieldtype: 'Data',
      read_only: true,
      in_list_view: true,
    })}`
  invalidateMeta(doctype)
}

// The document's current state, defaulting to the workflow's first state.
export function currentState(wf: Workflow, doc: Record<string, unknown>): string {
  const v = doc[stateField(wf)]
  if (typeof v === 'string' && v) return v
  return wf.states[0]?.state ?? ''
}

// Transitions available from a state for a user holding the given roles.
// Administrator / System Manager bypass the ROLE gate, but the CONDITION gate
// still applies to everyone (a condition is a property of the document, not the
// user). When `doc` is omitted, conditions are not evaluated (role-only view).
export function availableActions(
  wf: Workflow,
  state: string,
  roles: string[],
  doc?: Record<string, unknown>,
): WorkflowTransition[] {
  const roleSet = new Set(roles)
  const privileged = roleSet.has('Administrator') || roleSet.has('System Manager')
  return wf.transitions.filter((t) => {
    if (t.state !== state) return false
    if (!privileged && !roleSet.has(t.allowed)) return false
    if (doc && !evalCondition(t.condition, doc, `${t.state}→${t.action}`)) return false
    return true
  })
}

// WF-002/003: apply an action. Enforces the transition exists from the
// current state and that the user holds the required role (Administrator
// bypasses). Updates workflow_state + docstatus and logs the audit trail.
export async function applyWorkflowAction(
  doctype: string,
  name: string,
  action: string,
  user: string,
): Promise<Record<string, unknown>> {
  const wf = await getActiveWorkflow(doctype)
  if (!wf) throw new AppError('ValidationError', `No active workflow for ${doctype}`)
  const field = stateField(wf)
  await ensureStateField(doctype, sql, field)

  const doc = await getDoc(doctype, name, user)
  const from = currentState(wf, doc)
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

  // Conditional transitions: the condition is a property of the DOCUMENT, so it
  // is enforced for everyone (Administrator included) and independently of the
  // UI — a transition whose condition is false cannot be applied even by API.
  if (!evalCondition(transition.condition, doc, `${from}→${action}`))
    throw new AppError(
      'ValidationError',
      `Action "${action}" is not allowed: its condition is not met`,
    )

  const target = wf.states.find((s) => s.state === transition.next_state)
  const docstatus = target ? Number(target.doc_status) : Number(doc.docstatus ?? 0)

  // Persist via a direct update (bypasses the submitted-doc write lock — a
  // workflow legitimately moves a submitted doc between states/statuses).
  await sql`
    update ${sql(tableName(doctype))}
    set ${sql(field)} = ${transition.next_state}, docstatus = ${docstatus}, modified = now()
    where name = ${name}`

  await sql`
    insert into tab_workflow_action ${sql({
      name: randomBytes(5).toString('hex'),
      owner: user,
      modified_by: user,
      ref_doctype: doctype,
      ref_name: name,
      action,
      from_state: from,
      to_state: transition.next_state,
      actor: user,
    })}`

  // WF-004: entering a state that still has outgoing transitions means the
  // document is now pending someone's action. Email every user who could take
  // one of those actions (holders of the transitions' allowed roles), with a
  // link to the document and the actions they can take.
  await notifyPendingApprovers(wf, doctype, name, transition.next_state, user)

  return getDoc(doctype, name, user)
}

// WF-004: notify the users who can act on a document that has just entered a
// pending state. Approvers are the holders of the roles named on the outgoing
// transitions from `state`. The acting user is skipped (no self-notification),
// as are disabled users. Each email references the document so it threads to
// the record, and carries a deep link plus the list of available actions.
async function notifyPendingApprovers(
  wf: Workflow,
  doctype: string,
  name: string,
  state: string,
  actingUser: string,
): Promise<void> {
  const outgoing = wf.transitions.filter((t) => t.state === state)
  if (outgoing.length === 0) return // terminal state — nobody left to act

  const roles = [...new Set(outgoing.map((t) => t.allowed))]
  if (roles.length === 0) return

  const holders = await sql<{ parent: string; email: string | null }[]>`
    select distinct hr.parent, u.email from tab_has_role hr
    join tab_user u on u.name = hr.parent
    where hr.parenttype = 'User' and hr.role in ${sql(roles)}
      and u.enabled = true`
  const approvers = holders
    .filter((h) => h.parent !== actingUser)
    .map((h) => ({ user: h.parent, email: h.email ?? h.parent }))
  if (approvers.length === 0) return

  const actions = outgoing.map((t) => t.action).join(', ')
  const link = `/desk/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`
  const subject = `Approval required: ${doctype} ${name}`
  const body =
    `${doctype} ${name} has entered the "${state}" state and is awaiting your action.\n\n` +
    `Available actions: ${actions}\n` +
    `Open the document: ${link}`

  for (const approver of approvers) {
    await queueEmail({
      to: approver.email,
      subject,
      body,
      reference_doctype: doctype,
      reference_name: name,
    })
  }
}

// Ensure any existing document without a state starts at the first state.
export async function initDocState(doctype: string): Promise<void> {
  const wf = await getActiveWorkflow(doctype)
  if (!wf || !wf.states.length) return
  const field = stateField(wf)
  await ensureStateField(doctype, sql, field)
  await sql`
    update ${sql(tableName(doctype))}
    set ${sql(field)} = ${wf.states[0].state}
    where ${sql(field)} is null`
}

import { randomBytes } from 'node:crypto'
import { sql } from './db'
import { AppError } from './errors'
import { getMeta, invalidateMeta } from './meta'
import { tableName } from './doctype-engine'
import { getRoles } from './permissions'
import { getDoc } from './document'

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
}
export interface Workflow {
  name: string
  document_type: string
  states: WorkflowState[]
  transitions: WorkflowTransition[]
}

// The active workflow for a DocType (at most one), with its child rows.
export async function getActiveWorkflow(doctype: string): Promise<Workflow | null> {
  const [wf] = await sql`
    select name, document_type from tab_workflow
    where document_type = ${doctype} and is_active = true
    order by modified desc limit 1`
  if (!wf) return null
  const states = await sql<WorkflowState[]>`
    select state, doc_status from tab_workflow_document_state
    where parent = ${wf.name as string} and parenttype = 'Workflow' order by idx`
  const transitions = await sql<WorkflowTransition[]>`
    select state, action, next_state, allowed from tab_workflow_transition
    where parent = ${wf.name as string} and parenttype = 'Workflow' order by idx`
  return { name: wf.name as string, document_type: wf.document_type as string, states, transitions }
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

// WF-002: the target DocType needs a `workflow_state` field so the state
// lives on each document. Added once, on demand, inside the given txn.
export async function ensureStateField(doctype: string, tx: typeof sql = sql): Promise<void> {
  const meta = await getMeta(doctype)
  if (meta.fields.some((f) => f.fieldname === 'workflow_state')) return
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
  const v = doc.workflow_state
  if (typeof v === 'string' && v) return v
  return wf.states[0]?.state ?? ''
}

// Transitions available from a state for a user holding the given roles.
// Administrator / System Manager see every transition from the state.
export function availableActions(
  wf: Workflow,
  state: string,
  roles: string[],
): WorkflowTransition[] {
  const roleSet = new Set(roles)
  const privileged = roleSet.has('Administrator') || roleSet.has('System Manager')
  return wf.transitions.filter(
    (t) => t.state === state && (privileged || roleSet.has(t.allowed)),
  )
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
  await ensureStateField(doctype)

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

  const target = wf.states.find((s) => s.state === transition.next_state)
  const docstatus = target ? Number(target.doc_status) : Number(doc.docstatus ?? 0)

  // Persist via a direct update (bypasses the submitted-doc write lock — a
  // workflow legitimately moves a submitted doc between states/statuses).
  await sql`
    update ${sql(tableName(doctype))}
    set workflow_state = ${transition.next_state}, docstatus = ${docstatus}, modified = now()
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

  return getDoc(doctype, name, user)
}

// Ensure any existing document without a state starts at the first state.
export async function initDocState(doctype: string): Promise<void> {
  const wf = await getActiveWorkflow(doctype)
  if (!wf || !wf.states.length) return
  await ensureStateField(doctype)
  await sql`
    update ${sql(tableName(doctype))}
    set workflow_state = ${wf.states[0].state}
    where workflow_state is null`
}

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { areq } from './helpers'
import { getActiveWorkflow, availableActions, applyWorkflowAction } from '../src/workflow'
import { evalCondition } from '../src/server-scripts'
import { getDoc } from '../src/document'
import { getRoles } from '../src/permissions'

// Conditional transitions: a transition's `condition` (a boolean expression over
// `doc`) gates whether it is offered and whether it can be applied — enforced
// server-side for everyone, Administrator included.

const DT = 'Cond Wf Task'
const ROLE = 'Cond Wf Approver'
const FLOW = 'Cond Wf Flow'

async function cleanup() {
  await sql`delete from tab_workflow_transition where parent = ${FLOW}`
  await sql`delete from tab_workflow_document_state where parent = ${FLOW}`
  await sql`delete from tab_workflow where name = ${FLOW}`
  await sql`delete from tab_workflow_action where ref_doctype = ${DT}`
  await sql`delete from tab_docperm where role = ${ROLE}`
  await sql`delete from tab_role where name = ${ROLE}`
  await sql`delete from tab_docfield where parent = ${DT}`
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_cond_wf_task')
}

beforeAll(async () => {
  await cleanup()
  await areq('/api/doctype', {
    method: 'POST',
    body: JSON.stringify({
      name: DT,
      autoname: 'prompt',
      fields: [
        { fieldname: 'title', fieldtype: 'Data' },
        { fieldname: 'amount', fieldtype: 'Int' },
      ],
    }),
  })
  await areq('/api/save_doc', { method: 'POST', body: JSON.stringify({ doctype: 'Role', doc: { name: ROLE } }) })

  // Draft can EITHER auto-approve (small amounts) OR need approval (large ones).
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({
      doctype: 'Workflow',
      doc: {
        name: FLOW,
        document_type: DT,
        is_active: true,
        states: [
          { state: 'Draft', doc_status: '0' },
          { state: 'Approved', doc_status: '1' },
          { state: 'Auto Approved', doc_status: '1' },
        ],
        transitions: [
          { state: 'Draft', action: 'Approve', next_state: 'Approved', allowed: ROLE, condition: 'doc.amount > 1000' },
          { state: 'Draft', action: 'Auto Approve', next_state: 'Auto Approved', allowed: ROLE, condition: 'doc.amount <= 1000' },
        ],
      },
    }),
  })
})

afterAll(cleanup)

describe('conditional workflow transitions', () => {
  it('evalCondition reads doc but is sandboxed from the host', () => {
    expect(evalCondition('doc.amount > 1000', { amount: 5000 })).toBe(true)
    expect(evalCondition('doc.amount > 1000', { amount: 10 })).toBe(false)
    expect(evalCondition('', { amount: 10 })).toBe(true) // blank = always
    // The host realm is not reachable from a condition.
    expect(evalCondition('typeof process === "undefined"', {})).toBe(true)
    expect(evalCondition('typeof require === "undefined"', {})).toBe(true)
  })

  it('offers only the transition whose condition holds (per document)', async () => {
    await areq(`/api/resource/${encodeURIComponent(DT)}`, { method: 'POST', body: JSON.stringify({ name: 'small', title: 'a', amount: 500 }) })
    await areq(`/api/resource/${encodeURIComponent(DT)}`, { method: 'POST', body: JSON.stringify({ name: 'big', title: 'b', amount: 5000 }) })

    const wf = (await getActiveWorkflow(DT))!
    const roles = await getRoles('Administrator')

    const small = await getDoc(DT, 'small')
    const bigDoc = await getDoc(DT, 'big')
    const smallActions = availableActions(wf, 'Draft', roles, small).map((t) => t.action)
    const bigActions = availableActions(wf, 'Draft', roles, bigDoc).map((t) => t.action)

    expect(smallActions).toEqual(['Auto Approve']) // amount 500 → only auto
    expect(bigActions).toEqual(['Approve']) // amount 5000 → only manual approve
  })

  it('rejects applying a transition whose condition is not met (even for admin)', async () => {
    // 'small' (amount 500) cannot take the high-value Approve path.
    await expect(applyWorkflowAction(DT, 'small', 'Approve', 'Administrator')).rejects.toMatchObject({
      type: 'ValidationError',
    })
    // But it CAN auto-approve.
    const out = await applyWorkflowAction(DT, 'small', 'Auto Approve', 'Administrator')
    expect(out.workflow_state).toBe('Auto Approved')
    expect(out.docstatus).toBe(1)
  })

  it('applies the transition whose condition holds', async () => {
    const out = await applyWorkflowAction(DT, 'big', 'Approve', 'Administrator')
    expect(out.workflow_state).toBe('Approved')
    // And the wrong branch is refused for the big doc.
    await expect(applyWorkflowAction(DT, 'big', 'Auto Approve', 'Administrator')).rejects.toBeTruthy()
  })
})

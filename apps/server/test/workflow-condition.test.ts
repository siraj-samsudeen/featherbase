import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
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

// Each test rebuilds the DocType + workflow inside its own rolled-back tx.
async function setup(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: DT,
    autoname: 'prompt',
    fields: [
      { fieldname: 'title', fieldtype: 'Data' },
      { fieldname: 'amount', fieldtype: 'Int' },
    ],
  })
  await admin.post('/api/save_doc', { doctype: 'Role', doc: { name: ROLE } })

  // Draft can EITHER auto-approve (small amounts) OR need approval (large ones).
  await admin.post('/api/save_doc', {
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
  })
}

async function seedDocs(admin: TestClient) {
  await admin.post(`/api/resource/${encodeURIComponent(DT)}`, { name: 'small', title: 'a', amount: 500 })
  await admin.post(`/api/resource/${encodeURIComponent(DT)}`, { name: 'big', title: 'b', amount: 5000 })
}

describe('conditional workflow transitions', () => {
  test('evalCondition reads doc but is sandboxed from the host', () => {
    expect(evalCondition('doc.amount > 1000', { amount: 5000 })).toBe(true)
    expect(evalCondition('doc.amount > 1000', { amount: 10 })).toBe(false)
    expect(evalCondition('', { amount: 10 })).toBe(true) // blank = always
    // The host realm is not reachable from a condition.
    expect(evalCondition('typeof process === "undefined"', {})).toBe(true)
    expect(evalCondition('typeof require === "undefined"', {})).toBe(true)
  })

  test('offers only the transition whose condition holds (per document)', async ({ admin }) => {
    await setup(admin)
    await seedDocs(admin)

    const wf = (await getActiveWorkflow(DT))!
    const roles = await getRoles('Administrator')

    const small = await getDoc(DT, 'small')
    const bigDoc = await getDoc(DT, 'big')
    const smallActions = availableActions(wf, 'Draft', roles, small).map((t) => t.action)
    const bigActions = availableActions(wf, 'Draft', roles, bigDoc).map((t) => t.action)

    expect(smallActions).toEqual(['Auto Approve']) // amount 500 → only auto
    expect(bigActions).toEqual(['Approve']) // amount 5000 → only manual approve
  })

  test('rejects applying a transition whose condition is not met (even for admin)', async ({
    admin,
  }) => {
    await setup(admin)
    await seedDocs(admin)
    // 'small' (amount 500) cannot take the high-value Approve path.
    await expect(applyWorkflowAction(DT, 'small', 'Approve', 'Administrator')).rejects.toMatchObject({
      type: 'ValidationError',
    })
    // But it CAN auto-approve.
    const out = await applyWorkflowAction(DT, 'small', 'Auto Approve', 'Administrator')
    expect(out.workflow_state).toBe('Auto Approved')
    expect(out.docstatus).toBe(1)
  })

  test('applies the transition whose condition holds', async ({ admin }) => {
    await setup(admin)
    await seedDocs(admin)
    const out = await applyWorkflowAction(DT, 'big', 'Approve', 'Administrator')
    expect(out.workflow_state).toBe('Approved')
    // And the wrong branch is refused for the big doc.
    await expect(applyWorkflowAction(DT, 'big', 'Auto Approve', 'Administrator')).rejects.toBeTruthy()
  })
})

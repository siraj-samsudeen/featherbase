import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'

// WF-001/002/003: workflow definition, execution, and server-side role
// enforcement.

const DT = 'Wf Srv Task'
const APPROVER = 'Wf Srv Approver'
const VIEWER = 'Wf Srv Viewer'
const FLOW = 'Wf Srv Flow'

const FLOW_DOC = {
  name: FLOW,
  document_type: DT,
  is_active: true,
  states: [
    { state: 'Draft', doc_status: '0' },
    { state: 'Pending', doc_status: '0' },
    { state: 'Approved', doc_status: '1' },
  ],
  transitions: [
    { state: 'Draft', action: 'Submit', next_state: 'Pending', allowed: APPROVER },
    { state: 'Pending', action: 'Approve', next_state: 'Approved', allowed: APPROVER },
  ],
}

// Each test rebuilds its world inside its own rolled-back transaction.
async function setup(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: DT,
    autoname: 'prompt',
    fields: [{ fieldname: 'title', fieldtype: 'Data' }],
  })
  for (const r of [APPROVER, VIEWER])
    await admin.post('/api/save_doc', { doctype: 'Role', doc: { name: r } })
  // Viewer can read+write the doc but is NOT the approver.
  await admin.post('/api/save_doc', {
    doctype: 'DocPerm',
    doc: { ref_doctype: DT, role: VIEWER, permlevel: 0, can_read: true, can_write: true },
  })
}

async function makeFlow(admin: TestClient) {
  await admin.post('/api/save_doc', { doctype: 'Workflow', doc: FLOW_DOC })
}

async function makeDoc(admin: TestClient) {
  await admin.post(`/api/resource/${encodeURIComponent(DT)}`, { name: 'wf-srv-1', title: 'x' })
}

// Replay of the WF-002 drive (Submit → Approve) without its assertions.
async function drive(admin: TestClient) {
  await admin.post('/api/apply_workflow_action', { doctype: DT, name: 'wf-srv-1', action: 'Submit' })
  await admin.post('/api/apply_workflow_action', { doctype: DT, name: 'wf-srv-1', action: 'Approve' })
}

describe('WF-001: workflow definition', () => {
  test('persists and adds a workflow_state field to the target DocType', async ({ admin }) => {
    await setup(admin)
    const res = await admin.fetch('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({ doctype: 'Workflow', doc: FLOW_DOC }),
    })
    expect(res.status).toBe(201)
    const meta = await admin.get<{ fields: { fieldname: string }[] }>(
      `/api/meta/${encodeURIComponent(DT)}`,
    )
    expect(meta.fields.some((f) => f.fieldname === 'workflow_state')).toBe(true)
  })

  test('rejects transitions that reference undefined states', async ({ admin }) => {
    await setup(admin)
    await expect(
      admin.post('/api/save_doc', {
        doctype: 'Workflow',
        doc: {
          name: 'Wf Srv Orphan',
          document_type: DT,
          is_active: false,
          states: [{ state: 'A', doc_status: '0' }],
          transitions: [{ state: 'A', action: 'Go', next_state: 'Ghost', allowed: APPROVER }],
        },
      }),
    ).rejects.toMatchObject({ status: 417, type: 'ValidationError' })
  })
})

describe('WF-002/003: execution + server-side enforcement', () => {
  test('a role-less user is refused (403) and the state is unchanged', async ({
    admin,
    createUser,
  }) => {
    await setup(admin)
    await makeFlow(admin)
    await makeDoc(admin)
    const viewer = await createUser({ roles: [VIEWER] })
    await expect(
      viewer.post('/api/apply_workflow_action', { doctype: DT, name: 'wf-srv-1', action: 'Submit' }),
    ).rejects.toMatchObject({ status: 403 })
    const doc = await admin.get<{ workflow_state: string | null; docstatus: number }>(
      `/api/resource/${encodeURIComponent(DT)}/wf-srv-1`,
    )
    expect(doc.workflow_state).toBeNull()
    expect(doc.docstatus).toBe(0)
  })

  test('an authorized user (admin) drives states and the audit trail records who/what', async ({
    admin,
  }) => {
    await setup(admin)
    await makeFlow(admin)
    await makeDoc(admin)
    const submit = await admin.post<{ workflow_state: string; docstatus: number }>(
      '/api/apply_workflow_action',
      { doctype: DT, name: 'wf-srv-1', action: 'Submit' },
    )
    expect(submit.workflow_state).toBe('Pending')
    expect(submit.docstatus).toBe(0)

    const approve = await admin.post<{ workflow_state: string; docstatus: number }>(
      '/api/apply_workflow_action',
      { doctype: DT, name: 'wf-srv-1', action: 'Approve' },
    )
    expect(approve.workflow_state).toBe('Approved')
    expect(approve.docstatus).toBe(1)

    const trail = await sql`
      select action, from_state, to_state, actor from tab_workflow_action
      where ref_doctype = ${DT} and ref_name = 'wf-srv-1' order by creation asc`
    expect(trail.map((t) => t.action)).toEqual(['Submit', 'Approve'])
    expect(trail.map((t) => t.to_state)).toEqual(['Pending', 'Approved'])
    expect(trail.every((t) => t.actor === 'Administrator')).toBe(true)
  })

  test('rejects an action that is not valid from the current state', async ({ admin }) => {
    await setup(admin)
    await makeFlow(admin)
    await makeDoc(admin)
    await drive(admin)
    // wf-srv-1 is now Approved with no outgoing transitions.
    await expect(
      admin.post('/api/apply_workflow_action', { doctype: DT, name: 'wf-srv-1', action: 'Submit' }),
    ).rejects.toMatchObject({ status: 417 })
  })
})

import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'

// WF-004: transitioning a document INTO a state that still has outgoing
// transitions makes it pending someone's action. The holders of those
// transitions' allowed roles are emailed a pending-approval message that
// references the document and links to it.

const DT = 'Wf Notify Task'
const APPROVER_ROLE = 'Wf Notify Approver'
const APPROVER = 'wf-notify-approver@x.com'
const FLOW = 'Wf Notify Flow'

// Per-test setup inside the sandbox transaction: the DocType, role, perms,
// approver user (via the createUser fixture — its minted token replaces the
// legacy password login), and workflow. Returns the approver's client.
async function setup(admin: TestClient, createUser: CreateUserFn): Promise<TestClient> {
  await admin.post('/api/doctype', {
    name: DT,
    autoname: 'prompt',
    fields: [{ fieldname: 'title', fieldtype: 'Data' }],
  })
  await admin.post('/api/save_doc', { doctype: 'Role', doc: { name: APPROVER_ROLE } })
  await admin.post('/api/save_doc', {
    doctype: 'DocPerm',
    doc: { ref_doctype: DT, role: APPROVER_ROLE, permlevel: 0, can_read: true, can_write: true },
  })
  const approver = await createUser({ email: APPROVER, roles: [APPROVER_ROLE] })

  // Draft --Submit(anyone)--> Pending --Approve(Approver)--> Approved.
  await admin.post('/api/save_doc', {
    doctype: 'Workflow',
    doc: {
      name: FLOW,
      document_type: DT,
      is_active: true,
      states: [
        { state: 'Draft', doc_status: '0' },
        { state: 'Pending', doc_status: '0' },
        { state: 'Approved', doc_status: '1' },
      ],
      transitions: [
        { state: 'Draft', action: 'Submit', next_state: 'Pending', allowed: 'All' },
        { state: 'Pending', action: 'Approve', next_state: 'Approved', allowed: APPROVER_ROLE },
      ],
    },
  })
  return approver
}

describe('WF-004: pending-approval notifications', () => {
  test('entering a pending state queues an email to the approvers referencing the doc', async ({
    admin,
    createUser,
  }) => {
    await setup(admin, createUser)
    await admin.post(`/api/resource/${encodeURIComponent(DT)}`, {
      name: 'wf-notify-1',
      title: 'Widget order',
    })

    // Administrator submits: Draft -> Pending. Pending's outgoing "Approve" is
    // allowed by APPROVER_ROLE, so the approver should be emailed.
    const res = await admin.post<{ workflow_state: string }>('/api/apply_workflow_action', {
      doctype: DT,
      name: 'wf-notify-1',
      action: 'Submit',
    })
    expect(res.workflow_state).toBe('Pending')

    const emails = await sql`
      select recipient, subject, body, reference_doctype, reference_name, status
      from tab_email_queue where reference_doctype = ${DT} and reference_name = 'wf-notify-1'`
    expect(emails.length).toBe(1)
    const mail = emails[0]
    expect(mail.recipient).toBe(APPROVER)
    expect(String(mail.subject)).toContain('Approval required')
    expect(String(mail.subject)).toContain('wf-notify-1')
    // The body links to the document and lists the actions the approver can take.
    expect(String(mail.body)).toContain(`/desk/${encodeURIComponent(DT)}/wf-notify-1`)
    expect(String(mail.body)).toContain('Approve')
    expect(mail.reference_doctype).toBe(DT)
    expect(mail.status).toBe('queued')
  })

  test('entering a terminal state notifies no one (no outgoing transitions)', async ({
    admin,
    createUser,
  }) => {
    const approver = await setup(admin, createUser)
    // Legacy relied on the previous test's document sitting in Pending;
    // recreate that state explicitly: create the doc and submit it.
    await admin.post(`/api/resource/${encodeURIComponent(DT)}`, {
      name: 'wf-notify-1',
      title: 'Widget order',
    })
    await admin.post('/api/apply_workflow_action', {
      doctype: DT,
      name: 'wf-notify-1',
      action: 'Submit',
    })

    // The approver approves: Pending -> Approved (terminal). No further email.
    const before = (
      await sql`select count(*)::int as n from tab_email_queue where reference_doctype = ${DT}`
    )[0].n as number

    const res = await approver.post<{ workflow_state: string }>('/api/apply_workflow_action', {
      doctype: DT,
      name: 'wf-notify-1',
      action: 'Approve',
    })
    expect(res.workflow_state).toBe('Approved')

    const after = (
      await sql`select count(*)::int as n from tab_email_queue where reference_doctype = ${DT}`
    )[0].n as number
    expect(after).toBe(before) // no new email on entering a terminal state
  })
})

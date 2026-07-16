import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { setUserPassword } from '../src/auth'
import { app } from '../src/index'
import { areq } from './helpers'

// WF-004: transitioning a document INTO a state that still has outgoing
// transitions makes it pending someone's action. The holders of those
// transitions' allowed roles are emailed a pending-approval message that
// references the document and links to it.

const DT = 'Wf Notify Task'
const APPROVER_ROLE = 'Wf Notify Approver'
const APPROVER = 'wf-notify-approver@x.com'
const FLOW = 'Wf Notify Flow'

async function cleanup() {
  await sql`delete from tab_email_queue where reference_doctype = ${DT}`
  await sql`delete from tab_workflow_document_state where parent = ${FLOW}`
  await sql`delete from tab_workflow_transition where parent = ${FLOW}`
  await sql`delete from tab_workflow where name = ${FLOW}`
  await sql`delete from tab_workflow_action where ref_doctype = ${DT}`
  await sql`delete from tab_docperm where role = ${APPROVER_ROLE}`
  await sql`delete from tab_has_role where parent = ${APPROVER}`
  await sql`delete from tab_user where name = ${APPROVER}`
  await sql`delete from tab_role where name = ${APPROVER_ROLE}`
  await sql`delete from tab_docfield where parent = ${DT}`
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_wf_notify_task')
}

beforeAll(async () => {
  await cleanup()
  await areq('/api/doctype', {
    method: 'POST',
    body: JSON.stringify({
      name: DT,
      autoname: 'prompt',
      fields: [{ fieldname: 'title', fieldtype: 'Data' }],
    }),
  })
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({ doctype: 'Role', doc: { name: APPROVER_ROLE } }),
  })
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({
      doctype: 'DocPerm',
      doc: { ref_doctype: DT, role: APPROVER_ROLE, permlevel: 0, can_read: true, can_write: true },
    }),
  })
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({
      doctype: 'User',
      doc: { name: APPROVER, email: APPROVER, enabled: true, roles: [{ role: APPROVER_ROLE }] },
    }),
  })
  await setUserPassword(APPROVER, 'wfnotifypw1')

  // Draft --Submit(anyone)--> Pending --Approve(Approver)--> Approved.
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
          { state: 'Pending', doc_status: '0' },
          { state: 'Approved', doc_status: '1' },
        ],
        transitions: [
          { state: 'Draft', action: 'Submit', next_state: 'Pending', allowed: 'All' },
          { state: 'Pending', action: 'Approve', next_state: 'Approved', allowed: APPROVER_ROLE },
        ],
      },
    }),
  })
})

afterAll(cleanup)

describe('WF-004: pending-approval notifications', () => {
  it('entering a pending state queues an email to the approvers referencing the doc', async () => {
    await areq(`/api/resource/${encodeURIComponent(DT)}`, {
      method: 'POST',
      body: JSON.stringify({ name: 'wf-notify-1', title: 'Widget order' }),
    })

    // Administrator submits: Draft -> Pending. Pending's outgoing "Approve" is
    // allowed by APPROVER_ROLE, so the approver should be emailed.
    const res = await areq('/api/apply_workflow_action', {
      method: 'POST',
      body: JSON.stringify({ doctype: DT, name: 'wf-notify-1', action: 'Submit' }),
    })
    expect(((await res.json()) as { workflow_state: string }).workflow_state).toBe('Pending')

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

  it('entering a terminal state notifies no one (no outgoing transitions)', async () => {
    // The approver approves: Pending -> Approved (terminal). No further email.
    const before = (
      await sql`select count(*)::int as n from tab_email_queue where reference_doctype = ${DT}`
    )[0].n as number

    const login = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usr: APPROVER, pwd: 'wfnotifypw1' }),
    })
    const tok = ((await login.json()) as { token: string }).token
    const res = await app.request('/api/apply_workflow_action', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
      body: JSON.stringify({ doctype: DT, name: 'wf-notify-1', action: 'Approve' }),
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { workflow_state: string }).workflow_state).toBe('Approved')

    const after = (
      await sql`select count(*)::int as n from tab_email_queue where reference_doctype = ${DT}`
    )[0].n as number
    expect(after).toBe(before) // no new email on entering a terminal state
  })
})

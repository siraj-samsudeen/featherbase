import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
import type { WorkflowState } from '../src/workflow'

// WF-004: only a state explicitly marked as waiting for approval emails
// the roles on its outgoing transitions. The holders of those
// transitions' allowed roles are emailed a pending-approval message that
// references the document and links to it.

const DT = 'Wf Notify Task'
const APPROVER_ROLE = 'Wf Notify Approver'
const APPROVER = 'wf-notify-approver@x.com'
const FLOW = 'Wf Notify Flow'

// Per-test setup inside the sandbox transaction: the Table, role, perms,
// approver user (via the createUser fixture — its minted token replaces the
// legacy password login), and workflow. Returns the approver's client.
async function setup(admin: TestClient, createUser: CreateUserFn, waitsForApproval = true): Promise<TestClient> {
  await admin.post('/api/table_def', {
    name: DT,
    id_pattern: 'prompt',
    columns: [{ column_name: 'title', column_type: 'Data' }],
  })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: APPROVER_ROLE } })
  await admin.post('/api/save_row', {
    table: 'Permission',
    row: { ref_table: DT, role: APPROVER_ROLE, tier: 'basic', can_read: true, can_write: true },
  })
  const approver = await createUser({ email: APPROVER, roles: [APPROVER_ROLE] })

  // Draft --Submit(anyone)--> Pending --Approve(Approver)--> Approved.
  await admin.post('/api/save_row', {
    table: 'Workflow',
    row: {
      row_id: FLOW,
      ref_table: DT,
      is_active: true,
      states: [
        { state: 'Draft', target_status: 'draft' },
        { state: 'Pending', target_status: 'draft', waits_for_approval: waitsForApproval },
        { state: 'Approved', target_status: 'submitted' },
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
  test('an unmarked state with role-restricted actions sends no approval email', async ({ admin, createUser }) => {
    await setup(admin, createUser, false)
    await admin.post(`/api/table/${encodeURIComponent(DT)}`, { row_id: 'unmarked', title: 'Ordinary work' })
    await admin.post(`/api/table/${encodeURIComponent(DT)}/unmarked:apply_workflow_action`, { action: 'Submit' })
    const emails = await sql`select recipient from email_queue where ref_table = ${DT} and reference_name = 'unmarked'`
    expect(emails).toHaveLength(0)
  })

  test('approval marks default off and survive saving and reopening a workflow', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    const path = `/api/table/Workflow/${encodeURIComponent(FLOW)}`
    const saved = await admin.get<{ row_id: string; states: WorkflowState[] }>(path)
    expect(saved.states.map((s) => s.waits_for_approval)).toEqual([false, true, false])
    saved.states[1].waits_for_approval = false
    await admin.post('/api/save_row', { table: 'Workflow', row: saved })
    const reopened = await admin.get<{ states: WorkflowState[] }>(path)
    expect(reopened.states.map((s) => s.waits_for_approval)).toEqual([false, false, false])
  })

  test('entering a pending state queues an email to the approvers referencing the doc', async ({
    admin,
    createUser,
  }) => {
    await setup(admin, createUser)
    await admin.post(`/api/table/${encodeURIComponent(DT)}`, {
      row_id: 'wf-notify-1',
      title: 'Widget order',
    })

    // Administrator submits: Draft -> Pending. Pending's outgoing "Approve" is
    // allowed by APPROVER_ROLE, so the approver should be emailed.
    const res = await admin.post<{ workflow_state: string }>(
      `/api/table/${encodeURIComponent(DT)}/wf-notify-1:apply_workflow_action`,
      { action: 'Submit' },
    )
    expect(res.workflow_state).toBe('Pending')

    const emails = await sql`
      select recipient, subject, body, ref_table, reference_name, send_status
      from email_queue where ref_table = ${DT} and reference_name = 'wf-notify-1'`
    expect(emails.length).toBe(1)
    const mail = emails[0]
    expect(mail.recipient).toBe(APPROVER)
    expect(String(mail.subject)).toContain('Approval required')
    expect(String(mail.subject)).toContain('wf-notify-1')
    // The body links to the document and lists the actions the approver can take.
    expect(String(mail.body)).toContain(`/admin/${encodeURIComponent(DT)}/wf-notify-1`)
    expect(String(mail.body)).toContain('Approve')
    expect(mail.ref_table).toBe(DT)
    expect(mail.send_status).toBe('queued')
  })

  test('entering a terminal state notifies no one (no outgoing transitions)', async ({
    admin,
    createUser,
  }) => {
    const approver = await setup(admin, createUser)
    // Legacy relied on the previous test's document sitting in Pending;
    // recreate that state explicitly: create the doc and submit it.
    await admin.post(`/api/table/${encodeURIComponent(DT)}`, {
      row_id: 'wf-notify-1',
      title: 'Widget order',
    })
    await admin.post(`/api/table/${encodeURIComponent(DT)}/${encodeURIComponent('wf-notify-1')}:apply_workflow_action`, { action: 'Submit' })

    // The approver approves: Pending -> Approved (terminal). No further email.
    const before = (
      await sql`select count(*)::int as n from email_queue where ref_table = ${DT}`
    )[0].n as number

    const res = await approver.post<{ workflow_state: string }>(
      `/api/table/${encodeURIComponent(DT)}/wf-notify-1:apply_workflow_action`,
      { action: 'Approve' },
    )
    expect(res.workflow_state).toBe('Approved')

    const after = (
      await sql`select count(*)::int as n from email_queue where ref_table = ${DT}`
    )[0].n as number
    expect(after).toBe(before) // no new email on entering a terminal state
  })

  // person-identities: an approver with no email is skipped, never mailed at
  // their user id.
  test('an approver without an email is skipped', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    await saveDoc('Person', { full_name: 'RR-wf-noemail', enabled: true, roles: [{ role: APPROVER_ROLE }] }, 'Administrator', 'insert')
    await admin.post(`/api/table/${encodeURIComponent(DT)}`, { row_id: 'wf-notify-2', title: 'No-mail approver' })
    await admin.post(`/api/table/${encodeURIComponent(DT)}/wf-notify-2:apply_workflow_action`, { action: 'Submit' })
    const emails = await sql`select recipient from email_queue where ref_table = ${DT} and reference_name = 'wf-notify-2'`
    expect(emails.map((e) => e.recipient)).toEqual([APPROVER])
  })

  test('the person who took the action and anyone switched off are not emailed', async ({ admin, createUser }) => {
    const approver = await setup(admin, createUser)
    await createUser({ email: 'wf-notify-other@x.com', roles: [APPROVER_ROLE] })
    const gone = await createUser({ email: 'wf-notify-gone@x.com', roles: [APPROVER_ROLE] })
    await sql`update person set enabled = false where row_id = ${gone.user}`
    await admin.post(`/api/table/${encodeURIComponent(DT)}`, { row_id: 'wf-notify-3', title: 'Self submitted' })

    // The approver submits it themselves: they already know, and one approver has left.
    await approver.post(`/api/table/${encodeURIComponent(DT)}/wf-notify-3:apply_workflow_action`, { action: 'Submit' })
    const emails = await sql`select recipient from email_queue where ref_table = ${DT} and reference_name = 'wf-notify-3'`
    expect(emails.map((e) => e.recipient)).toEqual(['wf-notify-other@x.com'])
  })
})

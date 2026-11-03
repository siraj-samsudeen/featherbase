import { describe, expect, vi } from 'vitest'
import { test } from './pg-test'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
import { notifyApproversOfNewRow, type WorkflowState } from '../src/workflow'

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

  test('entering an approval-marked terminal state notifies no one (no outgoing transitions)', async ({
    admin,
    createUser,
  }) => {
    const approver = await setup(admin, createUser)
    const flowPath = `/api/table/Workflow/${encodeURIComponent(FLOW)}`
    const flow = await admin.get<{ states: WorkflowState[] }>(flowPath)
    flow.states[2].waits_for_approval = true
    await admin.post('/api/save_row', { table: 'Workflow', row: flow })
    const savedFlow = await admin.get(flowPath)
    await admin.post(`/api/table/${encodeURIComponent(DT)}`, { row_id: 'unrelated-draft', title: 'Keep this draft' })
    const unrelated = await admin.get(`/api/table/${encodeURIComponent(DT)}/unrelated-draft`)
    await admin.post(`/api/table/${encodeURIComponent(DT)}`, {
      row_id: 'wf-notify-1',
      title: 'Widget order',
    })
    await admin.post(`/api/table/${encodeURIComponent(DT)}/${encodeURIComponent('wf-notify-1')}:apply_workflow_action`, { action: 'Submit' })

    const before = await sql`select * from email_queue where ref_table = ${DT} order by row_id`
    expect(before).toHaveLength(1)
    expect(before[0]).toMatchObject({
      recipient: APPROVER, subject: `Approval required: ${DT} wf-notify-1`,
      body: `${DT} wf-notify-1 has entered the "Pending" state and is awaiting your action.\n\nAvailable actions: Approve\nOpen the row: /featherbase/admin/${encodeURIComponent(DT)}/wf-notify-1`,
      ref_table: DT, reference_name: 'wf-notify-1', send_status: 'queued',
    })

    const res = await approver.post<{ workflow_state: string }>(
      `/api/table/${encodeURIComponent(DT)}/wf-notify-1:apply_workflow_action`,
      { action: 'Approve' },
    )
    expect(res.workflow_state).toBe('Approved')
    expect(await admin.get(`/api/table/${encodeURIComponent(DT)}/wf-notify-1`))
      .toMatchObject({ row_id: 'wf-notify-1', title: 'Widget order', workflow_state: 'Approved', status: 'submitted' })
    expect(await sql`select * from email_queue where ref_table = ${DT} order by row_id`).toEqual(before)
    expect(await admin.get(flowPath)).toEqual(savedFlow)
    expect(await admin.get(`/api/table/${encodeURIComponent(DT)}/unrelated-draft`)).toEqual(unrelated)
  })

  test('a waiting state with only acting disabled and email-less approvers queues no mail until a distinct recipient exists', async ({ admin, createUser }) => {
    const actor = await setup(admin, createUser)
    await admin.post('/api/save_row', { table: 'Person', row: {
      full_name: 'Disabled approver', email: 'wf-disabled@x.com', enabled: false, roles: [{ role: APPROVER_ROLE }],
    } })
    await admin.post('/api/save_row', { table: 'Person', row: {
      full_name: 'Email-less approver', enabled: true, roles: [{ role: APPROVER_ROLE }],
    } })
    const holders = await sql`select * from person where row_id in
      (select parent from has_role where parenttype = 'Person' and role = ${APPROVER_ROLE}) order by row_id`
    expect(holders).toHaveLength(3)
    expect(holders).toEqual(expect.arrayContaining([
      expect.objectContaining({ row_id: actor.user, email: APPROVER, enabled: true }),
      expect.objectContaining({ full_name: 'Disabled approver', email: 'wf-disabled@x.com', enabled: false }),
      expect.objectContaining({ full_name: 'Email-less approver', email: null, enabled: true }),
    ]))
    expect(holders.filter(p => p.enabled && p.email && p.row_id !== actor.user)).toEqual([])
    const flowPath = `/api/table/Workflow/${encodeURIComponent(FLOW)}`
    const flow = await admin.get(flowPath)
    await admin.post(`/api/table/${encodeURIComponent(DT)}`, { row_id: 'unrelated-draft', title: 'Unrelated request' })
    const unrelated = await admin.get(`/api/table/${encodeURIComponent(DT)}/unrelated-draft`)
    await admin.post(`/api/table/${encodeURIComponent(DT)}`, { row_id: 'no-recipient', title: 'Only ineligible holders' })
    expect(await actor.post(`/api/table/${encodeURIComponent(DT)}/no-recipient:apply_workflow_action`, { action: 'Submit' }))
      .toMatchObject({ title: 'Only ineligible holders', workflow_state: 'Pending', status: 'draft' })
    const waiting = await admin.get(`/api/table/${encodeURIComponent(DT)}/no-recipient`)
    expect(await sql`select * from email_queue where ref_table = ${DT}`).toEqual([])

    await createUser({ email: 'wf-distinct@x.com', roles: [APPROVER_ROLE] })
    await admin.post(`/api/table/${encodeURIComponent(DT)}`, { row_id: 'has-recipient', title: 'Another request' })
    expect(await actor.post(`/api/table/${encodeURIComponent(DT)}/has-recipient:apply_workflow_action`, { action: 'Submit' }))
      .toMatchObject({ title: 'Another request', workflow_state: 'Pending', status: 'draft' })
    expect(await sql`select recipient, subject, body, ref_table, reference_name, send_status from email_queue where ref_table = ${DT}`)
      .toEqual([{
        recipient: 'wf-distinct@x.com', subject: `Approval required: ${DT} has-recipient`,
        body: `${DT} has-recipient has entered the "Pending" state and is awaiting your action.\n\nAvailable actions: Approve\nOpen the row: /featherbase/admin/${encodeURIComponent(DT)}/has-recipient`,
        ref_table: DT, reference_name: 'has-recipient', send_status: 'queued',
      }])
    expect(await admin.get(`/api/table/${encodeURIComponent(DT)}/no-recipient`)).toEqual(waiting)
    expect(await admin.get(`/api/table/${encodeURIComponent(DT)}/unrelated-draft`)).toEqual(unrelated)
    expect(await admin.get(flowPath)).toEqual(flow)
    expect(await sql`select * from person where row_id in ${sql(holders.map(p => p.row_id))} order by row_id`).toEqual(holders)
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

  // #336 (owner decision 26-Sep-2026): a row created straight into a state
  // that waits on someone notifies them, as moving it there would.
  describe('a row created in a pending state', () => {
    async function setupStartsPending(admin: TestClient, createUser: CreateUserFn, waitsForApproval = true): Promise<TestClient> {
      const approver = await setup(admin, createUser)
      const flow = await admin.get<Record<string, unknown>>(`/api/table/Workflow/${encodeURIComponent(FLOW)}`)
      // The first state now awaits the Approver: a new row is pending at once.
      await admin.post('/api/save_row', {
        table: 'Workflow',
        row: {
          ...flow,
          states: [
            { state: 'Pending', target_status: 'draft', waits_for_approval: waitsForApproval },
            { state: 'Approved', target_status: 'submitted' },
          ],
          transitions: [{ state: 'Pending', action: 'Approve', next_state: 'Approved', allowed: APPROVER_ROLE }],
        },
      })
      return approver
    }

    test('emails the approvers, linking to the row', async ({ admin, createUser }) => {
      await setupStartsPending(admin, createUser)
      const created = await admin.post<{ workflow_state: string }>(`/api/table/${encodeURIComponent(DT)}`, {
        row_id: 'wf-notify-new',
        title: 'Created pending',
      })
      expect(created.workflow_state).toBe('Pending')

      const emails = await sql`
        select recipient, subject, body from email_queue
        where ref_table = ${DT} and reference_name = 'wf-notify-new'`
      expect(emails.map((e) => e.recipient)).toEqual([APPROVER])
      expect(String(emails[0].subject)).toContain('Approval required')
      expect(String(emails[0].body)).toContain(`/admin/${encodeURIComponent(DT)}/wf-notify-new`)
      expect(String(emails[0].body)).toContain('Approve')
    })

    test('a notification storage outage is logged against the saved row without undoing it', async ({ admin, createUser }) => {
      await setupStartsPending(admin, createUser)
      const row = await admin.post<Record<string, unknown>>(`/api/table/${encodeURIComponent(DT)}`, { row_id: 'mail-outage', title: 'Keep this row' })
      const errors = vi.spyOn(console, 'error')
      const rollback = new Error('restore notification storage')
      try {
        // The exported post-save operation runs after the document commit.
        // Isolate the outage in a savepoint, restoring its schema afterwards.
        await expect(sql.begin(async tx => {
          await tx`drop table featherbase.email_account`
          await notifyApproversOfNewRow(DT, row, 'Administrator')
          expect(errors.mock.calls).toContainEqual([
            `[workflow] ${DT} mail-outage: approvers not notified:`, expect.objectContaining({ code: '42P01' }),
          ])
          throw rollback
        })).rejects.toBe(rollback)
      } finally {
        errors.mockRestore()
      }
      expect(await admin.get(`/api/table/${encodeURIComponent(DT)}/mail-outage`)).toMatchObject({ title: 'Keep this row', workflow_state: 'Pending' })
    })

    test('the approver who creates it is not emailed', async ({ admin, createUser }) => {
      const approver = await setupStartsPending(admin, createUser)
      await admin.post('/api/save_row', {
        table: 'Permission',
        row: { ref_table: DT, role: APPROVER_ROLE, tier: 'basic', can_read: true, can_create: true },
      })
      await createUser({ email: 'wf-notify-peer@x.com', roles: [APPROVER_ROLE] })
      await approver.post(`/api/table/${encodeURIComponent(DT)}`, { row_id: 'wf-notify-own', title: 'Own request' })
      const emails = await sql`select recipient from email_queue where ref_table = ${DT} and reference_name = 'wf-notify-own'`
      expect(emails.map((e) => e.recipient)).toEqual(['wf-notify-peer@x.com'])
    })

    test('a row created in an unmarked state emails no one, even with role-restricted actions', async ({ admin, createUser }) => {
      await setupStartsPending(admin, createUser, false)
      await admin.post(`/api/table/${encodeURIComponent(DT)}`, { row_id: 'wf-notify-unmarked', title: 'Ordinary draft' })
      const emails = await sql`select recipient from email_queue where ref_table = ${DT} and reference_name = 'wf-notify-unmarked'`
      expect(emails).toEqual([])
    })

    test('a row created in a state with no further actions emails no one', async ({ admin, createUser }) => {
      await setup(admin, createUser)
      const flow = await admin.get<Record<string, unknown>>(`/api/table/Workflow/${encodeURIComponent(FLOW)}`)
      await admin.post('/api/save_row', {
        table: 'Workflow',
        row: { ...flow, states: [{ state: 'Logged', target_status: 'draft' }], transitions: [] },
      })
      await admin.post(`/api/table/${encodeURIComponent(DT)}`, { row_id: 'wf-notify-final', title: 'Nothing to decide' })
      const emails = await sql`select recipient from email_queue where ref_table = ${DT} and reference_name = 'wf-notify-final'`
      expect(emails).toEqual([])
    })
  })
})

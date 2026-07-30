import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { enqueue, loadJobs, drainJobs } from '../src/jobs'
import { saveDoc } from '../src/document'

// Service Level Agreements: deadline stamping on insert (per-priority windows)
// and the check_sla escalation sweep (Overdue + email to the escalation role).

const DT = 'Sla Ticket'
const SLA = 'Sla Ticket Policy'
const ROLE = 'Sla Escalation Mgr'
const MGR = 'sla-mgr@x.com'
const FLOW = 'Sla Ticket Flow'

// Sandbox gotcha: inside the test transaction `now()` is frozen at BEGIN,
// while enqueue() stamps run_at from the wall clock — nudge fresh jobs due.
async function nudgeDueJobs() {
  await sql`
    update background_job set run_at = now()
    where job_status = 'queued' and run_at > now() and run_at <= clock_timestamp()`
}

async function setup(admin: TestClient) {
  await loadJobs()
  await admin.post('/api/save_doc', { doctype: 'Role', doc: { name: ROLE } })
  await sql`insert into "user" ${sql({
    name: MGR, created_by: 'Administrator', updated_by: 'Administrator', email: MGR, enabled: true,
  })}`
  await sql`insert into has_role ${sql({
    name: 'sla-hr-1', created_by: 'Administrator', updated_by: 'Administrator',
    parent: MGR, parenttype: 'User', parentfield: 'roles', position: 1, role: ROLE,
  })}`
  await admin.post('/api/doctype', {
    name: DT,
    columns: [
      { column_name: 'title', column_type: 'Data' },
      // 'status' is now the standard lifecycle column, so this Table's own
      // business status lives in 'ticket_status' (same convention as the
      // real HD Ticket, src/sample-apps/helpdesk.ts) — bound below as the
      // workflow's state_field so the SLA's fulfilled_states can be checked
      // against it.
      { column_name: 'ticket_status', column_type: 'Choice', choices: 'Open\nResolved', default_value: 'Open' },
      { column_name: 'priority', column_type: 'Choice', choices: 'Low\nHigh', default_value: 'Low' },
      { column_name: 'response_by', column_type: 'Datetime', read_only: true },
      { column_name: 'resolution_by', column_type: 'Datetime', read_only: true },
      { column_name: 'sla_status', column_type: 'Data', read_only: true },
    ],
  })
  await saveDoc('Workflow', {
    name: FLOW,
    ref_table: DT,
    is_active: true,
    state_field: 'ticket_status',
    states: [
      { state: 'Open', target_status: 'draft' },
      { state: 'Resolved', target_status: 'draft' },
    ],
    transitions: [
      { state: 'Open', action: 'Resolve', next_state: 'Resolved', allowed: 'All' },
    ],
  })
  await saveDoc('Service Level Agreement', {
    name: SLA,
    ref_table: DT,
    enabled: true,
    priority_field: 'priority',
    fulfilled_states: 'Resolved',
    escalation_role: ROLE,
    priorities: [
      { priority: 'High', response_hours: 1, resolution_hours: 4 },
      { priority: 'Low', response_hours: 8, resolution_hours: 48 },
    ],
  })
}

describe('SLA: deadline stamping + escalation', () => {
  test('stamps response_by / resolution_by from the priority window on insert', async ({
    admin,
  }) => {
    await setup(admin)
    const before = Date.now()
    const doc = await saveDoc(DT, { title: 'urgent', priority: 'High' }, 'Administrator')
    const response = new Date(String(doc.response_by)).getTime()
    const resolution = new Date(String(doc.resolution_by)).getTime()
    expect(response).toBeGreaterThan(before)
    expect(response).toBeLessThan(before + 1.1 * 3600 * 1000)
    expect(resolution).toBeGreaterThan(before + 3.9 * 3600 * 1000)
    expect(resolution).toBeLessThan(before + 4.1 * 3600 * 1000)
    expect(doc.sla_status).toBe('On Track')
  })

  test('check_sla escalates overdue open documents and emails the escalation role', async ({
    admin,
  }) => {
    await setup(admin)
    const doc = await saveDoc(DT, { title: 'late', priority: 'High' }, 'Administrator')
    const done = await saveDoc(DT, { title: 'done in time', priority: 'High' }, 'Administrator')
    // Force both past their deadline; mark one Resolved via the workflow (the
    // real lifecycle path — a direct write to a workflow-bound field is
    // rejected, see workflow-state-field.test.ts).
    await sql`update sla_ticket set resolution_by = now() - interval '1 hour'
      where name in (${String(doc.name)}, ${String(done.name)})`
    await admin.post(`/api/table/${encodeURIComponent(DT)}/${encodeURIComponent(String(done.name))}:apply_workflow_action`, { action: 'Resolve' })

    await enqueue('check_sla', {})
    await nudgeDueJobs()
    await drainJobs()

    const [late] = await sql`select sla_status from sla_ticket where name = ${String(doc.name)}`
    expect(late.sla_status).toBe('Overdue')
    const [ok] = await sql`select sla_status from sla_ticket where name = ${String(done.name)}`
    expect(ok.sla_status).toBe('On Track') // fulfilled state — never escalated

    const mails = await sql`
      select recipient from email_queue
      where ref_table = ${DT} and reference_name = ${String(doc.name)}`
    expect(mails.map((m) => m.recipient)).toContain(MGR)

    // A second sweep must not escalate (or email) the same document again.
    await enqueue('check_sla', {})
    await nudgeDueJobs()
    await drainJobs()
    const again = await sql`
      select count(*)::int as c from email_queue
      where ref_table = ${DT} and reference_name = ${String(doc.name)}`
    expect(again[0].c).toBe(1)
  })
})

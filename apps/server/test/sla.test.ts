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

// Sandbox gotcha: inside the test transaction `now()` is frozen at BEGIN,
// while enqueue() stamps run_at from the wall clock — nudge fresh jobs due.
async function nudgeDueJobs() {
  await sql`
    update tab_background_job set run_at = now()
    where status = 'queued' and run_at > now() and run_at <= clock_timestamp()`
}

async function setup(admin: TestClient) {
  await loadJobs()
  await admin.post('/api/save_doc', { doctype: 'Role', doc: { name: ROLE } })
  await sql`insert into tab_user ${sql({
    name: MGR, owner: 'Administrator', modified_by: 'Administrator', email: MGR, enabled: true,
  })}`
  await sql`insert into tab_has_role ${sql({
    name: 'sla-hr-1', owner: 'Administrator', modified_by: 'Administrator',
    parent: MGR, parenttype: 'User', parentfield: 'roles', idx: 1, role: ROLE,
  })}`
  await admin.post('/api/doctype', {
    name: DT,
    fields: [
      { fieldname: 'title', fieldtype: 'Data' },
      { fieldname: 'status', fieldtype: 'Select', options: 'Open\nResolved', default_value: 'Open' },
      { fieldname: 'priority', fieldtype: 'Select', options: 'Low\nHigh', default_value: 'Low' },
      { fieldname: 'response_by', fieldtype: 'Datetime', read_only: true },
      { fieldname: 'resolution_by', fieldtype: 'Datetime', read_only: true },
      { fieldname: 'sla_status', fieldtype: 'Data', read_only: true },
    ],
  })
  await saveDoc('Service Level Agreement', {
    name: SLA,
    document_type: DT,
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
    // Force both past their deadline; mark one fulfilled.
    await sql`update tab_sla_ticket set resolution_by = now() - interval '1 hour'
      where name in (${String(doc.name)}, ${String(done.name)})`
    await sql`update tab_sla_ticket set status = 'Resolved' where name = ${String(done.name)}`

    await enqueue('check_sla', {})
    await nudgeDueJobs()
    await drainJobs()

    const [late] = await sql`select sla_status from tab_sla_ticket where name = ${String(doc.name)}`
    expect(late.sla_status).toBe('Overdue')
    const [ok] = await sql`select sla_status from tab_sla_ticket where name = ${String(done.name)}`
    expect(ok.sla_status).toBe('On Track') // fulfilled state — never escalated

    const mails = await sql`
      select recipient from tab_email_queue
      where reference_doctype = ${DT} and reference_name = ${String(doc.name)}`
    expect(mails.map((m) => m.recipient)).toContain(MGR)

    // A second sweep must not escalate (or email) the same document again.
    await enqueue('check_sla', {})
    await nudgeDueJobs()
    await drainJobs()
    const again = await sql`
      select count(*)::int as c from tab_email_queue
      where reference_doctype = ${DT} and reference_name = ${String(doc.name)}`
    expect(again[0].c).toBe(1)
  })
})

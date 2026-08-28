import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { enqueue, loadJobs, drainJobs } from '../src/jobs'
import { saveDoc } from '../src/document'
import { applySla, getActiveSla } from '../src/sla'
import { getMeta } from '../src/meta'

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
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: ROLE } })
  await sql`insert into "user" ${sql({
    row_id: MGR, created_by: 'Administrator', updated_by: 'Administrator', email: MGR, enabled: true,
  })}`
  await sql`insert into has_role ${sql({
    row_id: 'sla-hr-1', created_by: 'Administrator', updated_by: 'Administrator',
    parent: MGR, parenttype: 'User', parentfield: 'roles', position: 1, role: ROLE,
  })}`
  await admin.post('/api/table_def', {
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
    row_id: FLOW,
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
    row_id: SLA,
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
      where row_id in (${String(doc.row_id)}, ${String(done.row_id)})`
    await admin.post(`/api/table/${encodeURIComponent(DT)}/${encodeURIComponent(String(done.row_id))}:apply_workflow_action`, { action: 'Resolve' })

    await enqueue('check_sla', {})
    await nudgeDueJobs()
    await drainJobs()

    const [late] = await sql`select sla_status from sla_ticket where row_id = ${String(doc.row_id)}`
    expect(late.sla_status).toBe('Overdue')
    const [ok] = await sql`select sla_status from sla_ticket where row_id = ${String(done.row_id)}`
    expect(ok.sla_status).toBe('On Track') // fulfilled state — never escalated

    const mails = await sql`
      select recipient from email_queue
      where ref_table = ${DT} and reference_name = ${String(doc.row_id)}`
    expect(mails.map((m) => m.recipient)).toContain(MGR)

    // A second sweep must not escalate (or email) the same document again.
    await enqueue('check_sla', {})
    await nudgeDueJobs()
    await drainJobs()
    const again = await sql`
      select count(*)::int as c from email_queue
      where ref_table = ${DT} and reference_name = ${String(doc.row_id)}`
    expect(again[0].c).toBe(1)
  })
})

// Moved from coverage-gaps.test.ts (#221): applySla's no-match paths (no
// active policy, a disabled policy, an unmatched priority) and escalation
// with no escalation role configured. Exercises applySla directly (a
// deliberate exception to the HTTP-first idiom) since the point is the
// SLA-stamping function's edge paths, not the save request around it.
async function makeSlaTable(admin: TestClient, name: string) {
  await admin.post('/api/table_def', {
    name,
    columns: [
      { column_name: 'title', column_type: 'Data' },
      { column_name: 'priority', column_type: 'Choice', choices: 'Low\nHigh', default_value: 'Low' },
      { column_name: 'response_by', column_type: 'Datetime' },
      { column_name: 'resolution_by', column_type: 'Datetime' },
      { column_name: 'sla_status', column_type: 'Data' },
    ],
  })
}

describe('SLA: non-matching paths', () => {
  test('no active SLA, disabled SLA, and unmatched priority all leave values alone', async ({
    admin,
  }) => {
    const DT = 'Cov Sla Note'
    await makeSlaTable(admin, DT)
    expect(await getActiveSla(DT)).toBeNull()

    await saveDoc('Service Level Agreement', {
      row_id: 'Cov Sla Off',
      ref_table: DT,
      enabled: false,
      priorities: [{ priority: 'High', response_hours: 1, resolution_hours: 2 }],
    })
    const values: Record<string, unknown> = { title: 'x', priority: 'High' }
    await applySla(await getMeta(DT), values)
    expect(values.response_by).toBeUndefined() // disabled SLA never stamps

    await sql`update service_level_agreement set enabled = true where row_id = 'Cov Sla Off'`
    const unmatched: Record<string, unknown> = { title: 'y', priority: 'Low' } // no Low row
    await applySla(await getMeta(DT), unmatched)
    expect(unmatched.response_by).toBeUndefined()

    const matched: Record<string, unknown> = { title: 'z', priority: 'High' }
    await applySla(await getMeta(DT), matched)
    expect(matched.response_by).toBeInstanceOf(Date)
    expect(matched.sla_status).toBe('On Track')
  })

  test('escalation without an escalation role flips Overdue but sends no email', async ({
    admin,
  }) => {
    await loadJobs()
    const DT = 'Cov Sla NoRole'
    await makeSlaTable(admin, DT)
    await saveDoc('Service Level Agreement', {
      row_id: 'Cov Sla NoRole Policy',
      ref_table: DT,
      enabled: true,
      fulfilled_states: '',
      priorities: [{ priority: 'High', response_hours: 1, resolution_hours: 1 }],
    })
    const doc = await saveDoc(DT, { title: 'late', priority: 'High' }, 'Administrator')
    await sql`update cov_sla_norole set resolution_by = now() - interval '1 hour'
      where row_id = ${String(doc.row_id)}`
    await enqueue('check_sla', {})
    await nudgeDueJobs()
    await drainJobs()
    const [row] = await sql`select sla_status from cov_sla_norole where row_id = ${String(doc.row_id)}`
    expect(row.sla_status).toBe('Overdue')
    const mails = await sql`
      select 1 from email_queue where ref_table = ${DT}`
    expect(mails.length).toBe(0)
  })
})

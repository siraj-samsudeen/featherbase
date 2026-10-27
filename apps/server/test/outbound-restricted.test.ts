import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'

// #340: webhooks and email rules send a row out of the platform, to nobody
// in particular, so neither carries a restricted (sensitive) column — on the
// row or on its sub-table rows. A rule may still match on one, or address
// the email from one, since neither puts the value in what is sent.
const CHILD = 'Out Pay Line'
const DT = 'Out Payslip'

async function setup(admin: TestClient) {
  await admin.post('/api/table_def', {
    name: CHILD,
    kind: 'sub_table',
    columns: [
      { column_name: 'label', column_type: 'Data' },
      { column_name: 'amount', column_type: 'Currency', tier: 'restricted' },
    ],
  })
  await admin.post('/api/table_def', {
    name: DT,
    is_submittable: true,
    columns: [
      { column_name: 'employee', column_type: 'Data' },
      { column_name: 'band', column_type: 'Choice', choices: 'Junior\nSenior', tier: 'restricted' },
      { column_name: 'manager_email', column_type: 'Data', tier: 'restricted' },
      { column_name: 'salary', column_type: 'Currency', tier: 'restricted' },
      { column_name: 'lines', column_type: 'Sub-table', row_table: CHILD },
    ],
  })
}

const payslip = {
  employee: 'Meena',
  band: 'Senior',
  manager_email: 'lead@store.test',
  salary: 81234,
  lines: [{ label: 'Bonus', amount: 4567 }],
}

async function webhookRows(event: string): Promise<Record<string, any>[]> {
  const jobs = await sql`
    select payload from background_job
    where method = 'deliver_webhook' and payload->>'event' = ${event}`
  return jobs.map((j) => (j.payload as { row: Record<string, any> }).row)
}

describe('#340: webhooks leave restricted columns out', () => {
  for (const event of ['after_insert', 'on_update', 'on_submit', 'on_cancel'] as const)
    test(`the ${event} body has no restricted column`, async ({ admin }) => {
      await setup(admin)
      await admin.post('/api/save_row', {
        table: 'Webhook',
        row: { webhook_table: DT, webhook_event: event, request_url: 'http://127.0.0.1:9/hook', webhook_secret: 's', enabled: true },
      })
      const doc = await admin.post<Record<string, any>>('/api/save_row', { table: DT, row: payslip })
      const url = `/api/table/${encodeURIComponent(DT)}/${doc.row_id}`
      const saved = await admin.post<Record<string, any>>('/api/save_row', {
        table: DT,
        row: { row_id: doc.row_id, updated_at: doc.updated_at, employee: 'Meena K' },
      })
      expect(saved.row_id).toBe(doc.row_id)
      await admin.post(`${url}:submit`, {})
      await admin.post(`${url}:cancel`, {})

      const [row] = await webhookRows(event)
      expect(row.employee).toMatch(/^Meena/)
      expect(row.lines[0].label).toBe('Bonus')
      for (const hidden of ['band', 'manager_email', 'salary']) expect(hidden in row).toBe(false)
      expect('amount' in row.lines[0]).toBe(false)
      expect(JSON.stringify(row)).not.toMatch(/81234|4567|Senior|lead@store/)
    })
})

describe('#340: email rules leave restricted columns out', () => {
  test('a rule matched and addressed by restricted columns sends only the basic ones', async ({ admin }) => {
    await setup(admin)
    await admin.post('/api/save_row', {
      table: 'Email Rule',
      row: {
        row_id: 'Out Payslip Ready',
        ref_table: DT,
        event: 'on_create',
        condition_field: 'band',
        condition_value: 'Senior',
        recipient: '{{ doc.manager_email }}',
        subject: 'Payslip for {{ doc.employee }} ({{ doc.salary }})',
        message: 'Band {{ doc.band }}, salary {{ doc.salary }} for {{ doc.employee }}',
        enabled: true,
      },
    })
    await admin.post('/api/save_row', { table: DT, row: payslip })
    const [mail] = await sql`select recipient, subject, body from email_queue where ref_table = ${DT}`
    expect(mail.recipient).toBe('lead@store.test')
    expect(mail.subject).toBe('Payslip for Meena ()')
    expect(mail.body).toBe('Band , salary  for Meena')
  })

  test('a rule addressed from a restricted column still reaches its recipient when a basic-tier person moves the row', async ({ admin, createUser }) => {
    await setup(admin)
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Out Clerk' } })
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: DT, role: 'Out Clerk', tier: 'basic', can_read: true, can_write: true } })
    const clerk = await createUser({ roles: ['Out Clerk'] })
    await admin.post('/api/save_row', {
      table: 'Workflow',
      row: {
        row_id: 'Out Flow', ref_table: DT, is_active: true,
        states: [{ state: 'Draft', target_status: 'draft' }, { state: 'Checked', target_status: 'draft' }],
        transitions: [{ state: 'Draft', action: 'Check', next_state: 'Checked', allowed: 'All' }],
      },
    })
    await admin.post('/api/save_row', {
      table: 'Email Rule',
      row: {
        row_id: 'Out Checked', ref_table: DT, event: 'on_save', condition_field: 'workflow_state', condition_value: 'Checked',
        recipient: '{{ doc.manager_email }}', subject: 'Checked {{ doc.employee }}', message: 'salary {{ doc.salary }}', enabled: true,
      },
    })
    const doc = await admin.post<Record<string, any>>('/api/save_row', { table: DT, row: payslip })
    await clerk.post(`/api/table/${encodeURIComponent(DT)}/${doc.row_id}:apply_workflow_action`, { action: 'Check' })
    const mails = await sql`select recipient, body from email_queue where ref_table = ${DT} and subject = 'Checked Meena'`
    expect(mails.map((m) => [m.recipient, m.body])).toEqual([['lead@store.test', 'salary ']])
  })
})

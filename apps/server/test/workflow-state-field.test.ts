import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
import { applyWorkflowAction, getActiveWorkflow, stateField } from '../src/workflow'

// Workflow state binding: a Workflow with `state_field` drives an EXISTING
// column on the target Table (e.g. a `ticket_status` Choice — 'status' itself
// is reserved for the standard lifecycle column) instead of adding the
// parallel workflow_state column — so the document's real business status and
// its workflow state are one and the same. Direct saves cannot change the
// bound column; inserts are forced to the initial state.

const DT = 'Wf Bind Ticket'
const WF = 'Wf Bind Flow'

async function setup(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: DT,
    columns: [
      { column_name: 'title', column_type: 'Data' },
      { column_name: 'ticket_status', column_type: 'Choice', choices: 'Open\nClosed', default_value: 'Open' },
    ],
  })
  await admin.post('/api/save_doc', {
    doctype: 'Workflow',
    doc: {
      name: WF,
      ref_table: DT,
      is_active: true,
      state_field: 'ticket_status',
      states: [
        { state: 'Open', target_status: 'draft' },
        { state: 'Closed', target_status: 'draft' },
      ],
      transitions: [
        { state: 'Open', action: 'Close', next_state: 'Closed', allowed: 'System Manager' },
      ],
    },
  })
}

describe('Workflow state_field binding', () => {
  test('binds to the existing column instead of adding workflow_state', async ({ admin }) => {
    await setup(admin)
    const wf = await getActiveWorkflow(DT)
    expect(wf && stateField(wf)).toBe('ticket_status')
    const columns = await sql`select column_name from column_def where parent = ${DT}`
    expect(columns.some((f) => f.column_name === 'workflow_state')).toBe(false)
  })

  test('applying an action updates the bound column and fires on_save email rules', async ({
    admin,
  }) => {
    await setup(admin)
    await sql`insert into email_rule ${sql({
      name: 'WfBind Closed Rule', created_by: 'Administrator', updated_by: 'Administrator',
      ref_table: DT, event: 'on_save',
      condition_field: 'ticket_status', condition_value: 'Closed',
      recipient: 'watcher@x.com', subject: 'WfBind closed', message: 'closed',
      enabled: true,
    })}`
    const doc = await saveDoc(DT, { title: 'bind me' }, 'Administrator')
    expect(doc.ticket_status).toBe('Open')
    const after = await applyWorkflowAction(DT, String(doc.name), 'Close', 'Administrator')
    expect(after.ticket_status).toBe('Closed')
    const [row] = await sql`select ticket_status from wf_bind_ticket where name = ${String(doc.name)}`
    expect(row.ticket_status).toBe('Closed')
    // The transition counted as a save: the conditional on_save rule fired.
    const mails = await sql`select 1 from email_queue where subject = 'WfBind closed'`
    expect(mails.length).toBe(1)
  })

  test('a direct save cannot change the workflow-bound column', async ({ admin }) => {
    await setup(admin)
    const doc = await saveDoc(DT, { title: 'locked' }, 'Administrator')
    const res = await saveDoc(
      DT,
      { name: doc.name, updated_at: (doc.updated_at as Date).toISOString(), ticket_status: 'Closed' },
      'Administrator',
    ).catch((e) => e)
    expect(res).toBeInstanceOf(Error)
    expect(String((res as Error).message)).toContain('workflow')
  })

  test('inserts are forced to the initial state', async ({ admin }) => {
    await setup(admin)
    const doc = await saveDoc(DT, { title: 'smuggle', ticket_status: 'Closed' }, 'Administrator')
    expect(doc.ticket_status).toBe('Open')
  })

  test('rejects a workflow that binds a nonexistent column', async ({ admin }) => {
    await setup(admin)
    await expect(
      admin.post('/api/save_doc', {
        doctype: 'Workflow',
        doc: {
          name: WF + ' Bad',
          ref_table: DT,
          is_active: true,
          state_field: 'no_such_field',
          states: [{ state: 'Open', target_status: 'draft' }],
          transitions: [],
        },
      }),
    ).rejects.toMatchObject({ status: 417 })
  })
})

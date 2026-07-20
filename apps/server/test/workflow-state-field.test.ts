import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
import { applyWorkflowAction, getActiveWorkflow, stateField } from '../src/workflow'

// Workflow state binding: a Workflow with `state_field` drives an EXISTING
// field on the target DocType (e.g. a `status` Select) instead of adding the
// parallel workflow_state field — so the document's real status and its
// workflow state are one and the same. Direct saves cannot change the bound
// field; inserts are forced to the initial state.

const DT = 'Wf Bind Ticket'
const WF = 'Wf Bind Flow'

async function setup(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: DT,
    fields: [
      { fieldname: 'title', fieldtype: 'Data' },
      { fieldname: 'status', fieldtype: 'Select', options: 'Open\nClosed', default_value: 'Open' },
    ],
  })
  await admin.post('/api/save_doc', {
    doctype: 'Workflow',
    doc: {
      name: WF,
      document_type: DT,
      is_active: true,
      state_field: 'status',
      states: [
        { state: 'Open', doc_status: '0' },
        { state: 'Closed', doc_status: '0' },
      ],
      transitions: [
        { state: 'Open', action: 'Close', next_state: 'Closed', allowed: 'System Manager' },
      ],
    },
  })
}

describe('Workflow state_field binding', () => {
  test('binds to the existing field instead of adding workflow_state', async ({ admin }) => {
    await setup(admin)
    const wf = await getActiveWorkflow(DT)
    expect(wf && stateField(wf)).toBe('status')
    const fields = await sql`select fieldname from tab_docfield where parent = ${DT}`
    expect(fields.some((f) => f.fieldname === 'workflow_state')).toBe(false)
  })

  test('applying an action updates the bound field and fires on_save email rules', async ({
    admin,
  }) => {
    await setup(admin)
    await sql`insert into tab_email_rule ${sql({
      name: 'WfBind Closed Rule', owner: 'Administrator', modified_by: 'Administrator',
      document_type: DT, event: 'on_save',
      condition_field: 'status', condition_value: 'Closed',
      recipient: 'watcher@x.com', subject: 'WfBind closed', message: 'closed',
      enabled: true,
    })}`
    const doc = await saveDoc(DT, { title: 'bind me' }, 'Administrator')
    expect(doc.status).toBe('Open')
    const after = await applyWorkflowAction(DT, String(doc.name), 'Close', 'Administrator')
    expect(after.status).toBe('Closed')
    const [row] = await sql`select status from tab_wf_bind_ticket where name = ${String(doc.name)}`
    expect(row.status).toBe('Closed')
    // The transition counted as a save: the conditional on_save rule fired.
    const mails = await sql`select 1 from tab_email_queue where subject = 'WfBind closed'`
    expect(mails.length).toBe(1)
  })

  test('a direct save cannot change the workflow-bound field', async ({ admin }) => {
    await setup(admin)
    const doc = await saveDoc(DT, { title: 'locked' }, 'Administrator')
    const res = await saveDoc(
      DT,
      { name: doc.name, modified: (doc.modified as Date).toISOString(), status: 'Closed' },
      'Administrator',
    ).catch((e) => e)
    expect(res).toBeInstanceOf(Error)
    expect(String((res as Error).message)).toContain('workflow')
  })

  test('inserts are forced to the initial state', async ({ admin }) => {
    await setup(admin)
    const doc = await saveDoc(DT, { title: 'smuggle', status: 'Closed' }, 'Administrator')
    expect(doc.status).toBe('Open')
  })

  test('rejects a workflow that binds a nonexistent field', async ({ admin }) => {
    await setup(admin)
    await expect(
      admin.post('/api/save_doc', {
        doctype: 'Workflow',
        doc: {
          name: WF + ' Bad',
          document_type: DT,
          is_active: true,
          state_field: 'no_such_field',
          states: [{ state: 'Open', doc_status: '0' }],
          transitions: [],
        },
      }),
    ).rejects.toMatchObject({ status: 417 })
  })
})

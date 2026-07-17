import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { loadControllers } from '../src/controllers'
import { createDocType } from '../src/doctype-engine'
import { saveDoc } from '../src/document'
import { applyWorkflowAction, getActiveWorkflow, stateField } from '../src/workflow'

// Workflow state binding: a Workflow with `state_field` drives an EXISTING
// field on the target DocType (e.g. a `status` Select) instead of adding the
// parallel workflow_state field — so the document's real status and its
// workflow state are one and the same.

const DT = 'Wf Bind Ticket'
const WF = 'Wf Bind Flow'

async function cleanup() {
  await sql`delete from tab_workflow_document_state where parent in (${WF}, ${WF + ' Bad'})`
  await sql`delete from tab_workflow_transition where parent in (${WF}, ${WF + ' Bad'})`
  await sql`delete from tab_workflow where name in (${WF}, ${WF + ' Bad'})`
  await sql`delete from tab_workflow_action where ref_doctype = ${DT}`
  await sql`delete from tab_docfield where parent = ${DT}`
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_wf_bind_ticket')
}

beforeAll(async () => {
  await loadControllers() // the Workflow controller validates state_field on save
  await cleanup()
  await createDocType({
    name: DT,
    fields: [
      { fieldname: 'title', fieldtype: 'Data' },
      { fieldname: 'status', fieldtype: 'Select', options: 'Open\nClosed', default_value: 'Open' },
    ],
  })
  await saveDoc('Workflow', {
    name: WF,
    document_type: DT,
    is_active: true,
    state_field: 'status',
    states: [
      { state: 'Open', doc_status: '0' },
      { state: 'Closed', doc_status: '0' },
    ],
    transitions: [{ state: 'Open', action: 'Close', next_state: 'Closed', allowed: 'System Manager' }],
  })
})

afterAll(cleanup)

describe('Workflow state_field binding', () => {
  it('binds to the existing field instead of adding workflow_state', async () => {
    const wf = await getActiveWorkflow(DT)
    expect(wf && stateField(wf)).toBe('status')
    const fields = await sql`select fieldname from tab_docfield where parent = ${DT}`
    expect(fields.some((f) => f.fieldname === 'workflow_state')).toBe(false)
  })

  it('applying an action updates the bound field on the document', async () => {
    const doc = await saveDoc(DT, { title: 'bind me' }, 'Administrator')
    expect(doc.status).toBe('Open')
    const after = await applyWorkflowAction(DT, String(doc.name), 'Close', 'Administrator')
    expect(after.status).toBe('Closed')
    const [row] = await sql`select status from tab_wf_bind_ticket where name = ${String(doc.name)}`
    expect(row.status).toBe('Closed')
  })

  it('rejects a workflow that binds a nonexistent field', async () => {
    const res = await saveDoc(
      'Workflow',
      {
        name: WF + ' Bad',
        document_type: DT,
        is_active: true,
        state_field: 'no_such_field',
        states: [{ state: 'Open', doc_status: '0' }],
        transitions: [],
      },
      'Administrator',
    ).catch((e) => e)
    expect(res).toBeInstanceOf(Error)
    expect(String((res as Error).message)).toContain('no_such_field')
  })
})

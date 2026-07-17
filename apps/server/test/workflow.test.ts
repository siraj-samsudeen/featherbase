import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { setUserPassword } from '../src/auth'
import { app } from '../src/index'
import { areq } from './helpers'

// WF-001/002/003: workflow definition, execution, and server-side role
// enforcement.

const DT = 'Wf Srv Task'
const APPROVER = 'Wf Srv Approver'
const VIEWER = 'Wf Srv Viewer'
const USER = 'wf-srv-user@x.com'

async function userToken(): Promise<string> {
  const res = await app.request('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usr: USER, pwd: 'wfsrvpw1' }),
  })
  return ((await res.json()) as { token: string }).token
}

async function cleanup() {
  await sql`delete from tab_workflow_document_state where parent = 'Wf Srv Flow'`
  await sql`delete from tab_workflow_transition where parent = 'Wf Srv Flow'`
  await sql`delete from tab_workflow where name = 'Wf Srv Flow'`
  await sql`delete from tab_workflow_action where ref_doctype = ${DT}`
  await sql`delete from tab_docperm where role in (${APPROVER}, ${VIEWER})`
  await sql`delete from tab_has_role where parent = ${USER}`
  await sql`delete from tab_user where name = ${USER}`
  await sql`delete from tab_role where name in (${APPROVER}, ${VIEWER})`
  await sql`delete from tab_docfield where parent = ${DT}`
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_wf_srv_task')
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
  for (const r of [APPROVER, VIEWER])
    await areq('/api/save_doc', { method: 'POST', body: JSON.stringify({ doctype: 'Role', doc: { name: r } }) })
  // Viewer can read+write the doc but is NOT the approver.
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({
      doctype: 'DocPerm',
      doc: { ref_doctype: DT, role: VIEWER, permlevel: 0, can_read: true, can_write: true },
    }),
  })
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({
      doctype: 'User',
      doc: { name: USER, email: USER, roles: [{ role: VIEWER }] },
    }),
  })
  await setUserPassword(USER, 'wfsrvpw1')
})

afterAll(cleanup)

describe('WF-001: workflow definition', () => {
  it('persists and adds a workflow_state field to the target DocType', async () => {
    const res = await areq('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({
        doctype: 'Workflow',
        doc: {
          name: 'Wf Srv Flow',
          document_type: DT,
          is_active: true,
          states: [
            { state: 'Draft', doc_status: '0' },
            { state: 'Pending', doc_status: '0' },
            { state: 'Approved', doc_status: '1' },
          ],
          transitions: [
            { state: 'Draft', action: 'Submit', next_state: 'Pending', allowed: APPROVER },
            { state: 'Pending', action: 'Approve', next_state: 'Approved', allowed: APPROVER },
          ],
        },
      }),
    })
    expect(res.status).toBe(201)
    const meta = (await (await areq(`/api/meta/${encodeURIComponent(DT)}`)).json()) as {
      fields: { fieldname: string }[]
    }
    expect(meta.fields.some((f) => f.fieldname === 'workflow_state')).toBe(true)
  })

  it('rejects transitions that reference undefined states', async () => {
    const res = await areq('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({
        doctype: 'Workflow',
        doc: {
          name: 'Wf Srv Orphan',
          document_type: DT,
          is_active: false,
          states: [{ state: 'A', doc_status: '0' }],
          transitions: [{ state: 'A', action: 'Go', next_state: 'Ghost', allowed: APPROVER }],
        },
      }),
    })
    expect(res.status).toBe(417)
    expect(((await res.json()) as { error: { type: string } }).error.type).toBe('ValidationError')
  })
})

describe('WF-002/003: execution + server-side enforcement', () => {
  it('a role-less user is refused (403) and the state is unchanged', async () => {
    await areq(`/api/resource/${encodeURIComponent(DT)}`, {
      method: 'POST',
      body: JSON.stringify({ name: 'wf-srv-1', title: 'x' }),
    })
    const tok = await userToken()
    const res = await app.request('/api/apply_workflow_action', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
      body: JSON.stringify({ doctype: DT, name: 'wf-srv-1', action: 'Submit' }),
    })
    expect(res.status).toBe(403)
    const doc = (await (
      await areq(`/api/resource/${encodeURIComponent(DT)}/wf-srv-1`)
    ).json()) as { workflow_state: string | null; docstatus: number }
    expect(doc.workflow_state).toBeNull()
    expect(doc.docstatus).toBe(0)
  })

  it('an authorized user (admin) drives states and the audit trail records who/what', async () => {
    const submit = (await (
      await areq('/api/apply_workflow_action', {
        method: 'POST',
        body: JSON.stringify({ doctype: DT, name: 'wf-srv-1', action: 'Submit' }),
      })
    ).json()) as { workflow_state: string; docstatus: number }
    expect(submit.workflow_state).toBe('Pending')
    expect(submit.docstatus).toBe(0)

    const approve = (await (
      await areq('/api/apply_workflow_action', {
        method: 'POST',
        body: JSON.stringify({ doctype: DT, name: 'wf-srv-1', action: 'Approve' }),
      })
    ).json()) as { workflow_state: string; docstatus: number }
    expect(approve.workflow_state).toBe('Approved')
    expect(approve.docstatus).toBe(1)

    const trail = await sql`
      select action, from_state, to_state, actor from tab_workflow_action
      where ref_doctype = ${DT} and ref_name = 'wf-srv-1' order by creation asc`
    expect(trail.map((t) => t.action)).toEqual(['Submit', 'Approve'])
    expect(trail.map((t) => t.to_state)).toEqual(['Pending', 'Approved'])
    expect(trail.every((t) => t.actor === 'Administrator')).toBe(true)
  })

  it('rejects an action that is not valid from the current state', async () => {
    // wf-srv-1 is now Approved with no outgoing transitions.
    const res = await areq('/api/apply_workflow_action', {
      method: 'POST',
      body: JSON.stringify({ doctype: DT, name: 'wf-srv-1', action: 'Submit' }),
    })
    expect(res.status).toBe(417)
  })
})

import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
import { initDocState } from '../src/workflow'

// WF-001/002/003: workflow definition, execution, and server-side role
// enforcement.

const DT = 'Wf Srv Task'
const APPROVER = 'Wf Srv Approver'
const VIEWER = 'Wf Srv Viewer'
const FLOW = 'Wf Srv Flow'

const FLOW_DOC = {
  row_id: FLOW,
  ref_table: DT,
  is_active: true,
  states: [
    { state: 'Draft', target_status: 'draft' },
    { state: 'Pending', target_status: 'draft' },
    { state: 'Approved', target_status: 'submitted' },
  ],
  transitions: [
    { state: 'Draft', action: 'Submit', next_state: 'Pending', allowed: APPROVER },
    { state: 'Pending', action: 'Approve', next_state: 'Approved', allowed: APPROVER },
  ],
}

// Each test rebuilds its world inside its own rolled-back transaction.
async function setup(admin: TestClient) {
  await admin.post('/api/table_def', {
    name: DT,
    id_pattern: 'prompt',
    columns: [{ column_name: 'title', column_type: 'Data' }],
  })
  for (const r of [APPROVER, VIEWER])
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: r } })
  // Viewer can read+write the doc but is NOT the approver.
  await admin.post('/api/save_row', {
    table: 'Permission',
    row: { ref_table: DT, role: VIEWER, tier: 'basic', can_read: true, can_write: true },
  })
}

async function makeFlow(admin: TestClient) {
  await admin.post('/api/save_row', { table: 'Workflow', row: FLOW_DOC })
}

async function makeDoc(admin: TestClient) {
  await admin.post(`/api/table/${encodeURIComponent(DT)}`, { row_id: 'wf-srv-1', title: 'x' })
}

// Replay of the WF-002 drive (Submit → Approve) without its assertions.
async function drive(admin: TestClient) {
  await admin.post(`/api/table/${encodeURIComponent(DT)}/${encodeURIComponent('wf-srv-1')}:apply_workflow_action`, { action: 'Submit' })
  await admin.post(`/api/table/${encodeURIComponent(DT)}/${encodeURIComponent('wf-srv-1')}:apply_workflow_action`, { action: 'Approve' })
}

describe('WF-001: workflow definition', () => {
  test('persists and adds a workflow_state column to the target Table', async ({ admin }) => {
    await setup(admin)
    const res = await admin.fetch('/api/save_row', {
      method: 'POST',
      body: JSON.stringify({ table: 'Workflow', row: FLOW_DOC }),
    })
    expect(res.status).toBe(201)
    const meta = await admin.get<{ columns: { column_name: string }[] }>(
      `/api/table/${encodeURIComponent(DT)}:meta`,
    )
    expect(meta.columns.some((f) => f.column_name === 'workflow_state')).toBe(true)
  })

  test('rejects transitions that reference undefined states', async ({ admin }) => {
    await setup(admin)
    await expect(
      admin.post('/api/save_row', {
        table: 'Workflow',
        row: {
          row_id: 'Wf Srv Orphan',
          ref_table: DT,
          is_active: false,
          states: [{ state: 'A', target_status: 'draft' }],
          transitions: [{ state: 'A', action: 'Go', next_state: 'Ghost', allowed: APPROVER }],
        },
      }),
    ).rejects.toMatchObject({ status: 417, type: 'ValidationError' })
  })
})

describe('WF-002/003: execution + server-side enforcement', () => {
  test('a role-less user is refused (403) and the state is unchanged', async ({
    admin,
    createUser,
  }) => {
    await setup(admin)
    await makeFlow(admin)
    await makeDoc(admin)
    const viewer = await createUser({ roles: [VIEWER] })
    await expect(
      viewer.post(`/api/table/${encodeURIComponent(DT)}/${encodeURIComponent('wf-srv-1')}:apply_workflow_action`, { action: 'Submit' }),
    ).rejects.toMatchObject({ status: 403 })
    const doc = await admin.get<{ workflow_state: string | null; status: string }>(
      `/api/table/${encodeURIComponent(DT)}/wf-srv-1`,
    )
    // New documents start at the workflow's initial state (WF-003) — the
    // refused action must leave them there.
    expect(doc.workflow_state).toBe('Draft')
    expect(doc.status).toBe('draft')
  })

  test('an authorized user (admin) drives states and the audit trail records who/what', async ({
    admin,
  }) => {
    await setup(admin)
    await makeFlow(admin)
    await makeDoc(admin)
    const submit = await admin.post<{ workflow_state: string; status: string }>(
      `/api/table/${encodeURIComponent(DT)}/wf-srv-1:apply_workflow_action`,
      { action: 'Submit' },
    )
    expect(submit.workflow_state).toBe('Pending')
    expect(submit.status).toBe('draft')

    const approve = await admin.post<{ workflow_state: string; status: string }>(
      `/api/table/${encodeURIComponent(DT)}/wf-srv-1:apply_workflow_action`,
      { action: 'Approve' },
    )
    expect(approve.workflow_state).toBe('Approved')
    expect(approve.status).toBe('submitted')

    const trail = await sql`
      select action, from_state, to_state, actor from workflow_action
      where ref_table = ${DT} and ref_name = 'wf-srv-1' order by created_at asc`
    expect(trail.map((t) => t.action)).toEqual(['Submit', 'Approve'])
    expect(trail.map((t) => t.to_state)).toEqual(['Pending', 'Approved'])
    expect(trail.every((t) => t.actor === 'Administrator')).toBe(true)
  })

  test('rejects an action that is not valid from the current state', async ({ admin }) => {
    await setup(admin)
    await makeFlow(admin)
    await makeDoc(admin)
    await drive(admin)
    // wf-srv-1 is now Approved with no outgoing transitions.
    await expect(
      admin.post(`/api/table/${encodeURIComponent(DT)}/${encodeURIComponent('wf-srv-1')}:apply_workflow_action`, { action: 'Submit' }),
    ).rejects.toMatchObject({ status: 417 })
  })
})

// Moved from coverage-gaps.test.ts (#221): workflow definition edges and the
// initDocState backfill for pre-existing documents.
describe('workflow: definition validation edges', () => {
  test('a workflow with no states and a transition FROM an unknown state are rejected', async ({
    admin,
  }) => {
    const DT = 'Cov WfDef Note'
    await admin.post('/api/table_def', {
      name: DT,
      columns: [{ column_name: 'title', column_type: 'Data' }],
    })
    await expect(
      admin.post('/api/save_row', {
        table: 'Workflow',
        row: { row_id: 'Cov Empty Flow', ref_table: DT, is_active: false, states: [], transitions: [] },
      }),
    ).rejects.toMatchObject({ status: 417 })
    await expect(
      admin.post('/api/save_row', {
        table: 'Workflow',
        row: {
          row_id: 'Cov From Ghost Flow',
          ref_table: DT,
          is_active: false,
          states: [{ state: 'A', target_status: 'draft' }],
          transitions: [{ state: 'Ghost', action: 'Go', next_state: 'A', allowed: 'System Manager' }],
        },
      }),
    ).rejects.toMatchObject({ status: 417 })
  })
})

describe('workflow: initDocState backfill', () => {
  test('existing docs without a state are pointed at the initial state', async ({ admin }) => {
    const DT = 'Cov Init Note'
    await admin.post('/api/table_def', {
      name: DT,
      columns: [
        { column_name: 'title', column_type: 'Data' },
        { column_name: 'note_status', column_type: 'Choice', choices: 'Open\nDone', default_value: 'Open' },
      ],
    })
    const doc = await saveDoc(DT, { title: 'pre-workflow' }, 'Administrator')
    await sql`update featherbase.cov_init_note set note_status = null where row_id = ${String(doc.row_id)}`
    await admin.post('/api/save_row', {
      table: 'Workflow',
      row: {
        row_id: 'Cov Init Flow',
        ref_table: DT,
        is_active: true,
        state_field: 'note_status',
        states: [
          { state: 'Open', target_status: 'draft' },
          { state: 'Done', target_status: 'draft' },
        ],
        transitions: [{ state: 'Open', action: 'Finish', next_state: 'Done', allowed: 'System Manager' }],
      },
    })
    await initDocState(DT)
    const [row] = await sql`select note_status from featherbase.cov_init_note where row_id = ${String(doc.row_id)}`
    expect(row.note_status).toBe('Open')
  })
})

describe('Move a row forward with an allowed action', () => {
  const url = (suffix = '') => `/api/table/${encodeURIComponent(DT)}/wf-srv-1${suffix}`

  test('opening a row shows its state and only the actions the roles allow from it', async ({
    admin,
    createUser,
  }) => {
    await setup(admin)
    await makeFlow(admin)
    await makeDoc(admin)
    const approver = await createUser({ roles: [APPROVER, VIEWER] })
    const viewer = await createUser({ roles: [VIEWER] })

    const asApprover = await approver.get<{ state: string; actions: { action: string }[] }>(
      `/api/workflow/${encodeURIComponent(DT)}/wf-srv-1`,
    )
    expect(asApprover.state).toBe('Draft')
    expect(asApprover.actions.map((a) => a.action)).toEqual(['Submit'])

    // Someone who can edit the row but holds no workflow role sees the state and no actions.
    const asViewer = await viewer.get<{ state: string; actions: unknown[] }>(
      `/api/workflow/${encodeURIComponent(DT)}/wf-srv-1`,
    )
    expect(asViewer.state).toBe('Draft')
    expect(asViewer.actions).toEqual([])
  })

  test('a user holding the approver role takes the action and is recorded as who did it', async ({
    admin,
    createUser,
  }) => {
    await setup(admin)
    await makeFlow(admin)
    await makeDoc(admin)
    await admin.post('/api/save_row', {
      table: 'Permission',
      row: { ref_table: DT, role: APPROVER, tier: 'basic', can_read: true },
    })
    const approver = await createUser({ roles: [APPROVER] })
    await admin.post(url(':apply_workflow_action'), { action: 'Submit' })

    const approved = await approver.post<{ workflow_state: string }>(url(':apply_workflow_action'), { action: 'Approve' })
    expect(approved.workflow_state).toBe('Approved')

    const [entry] = await sql`
      select actor from workflow_action where ref_table = ${DT} and ref_name = 'wf-srv-1' and action = 'Approve'`
    expect(entry.actor).toBe(approver.user)
  })

  test('a user who can edit the row but does not hold the approver role cannot approve it', async ({
    admin,
    createUser,
  }) => {
    await setup(admin)
    await makeFlow(admin)
    await makeDoc(admin)
    await admin.post(url(':apply_workflow_action'), { action: 'Submit' })
    const viewer = await createUser({ roles: [VIEWER] })

    // The viewer can change the row's other fields…
    const doc = await admin.get<{ updated_at: string }>(url())
    const edit = await viewer.fetch('/api/save_row', {
      method: 'POST',
      body: JSON.stringify({ table: DT, row: { row_id: 'wf-srv-1', updated_at: doc.updated_at, title: 'edited' } }),
    })
    expect(edit.status).toBe(201)
    // …but Approve is refused, and the row stays Pending.
    await expect(viewer.post(url(':apply_workflow_action'), { action: 'Approve' })).rejects.toMatchObject({ status: 403 })
    const after = await admin.get<{ workflow_state: string }>(url())
    expect(after.workflow_state).toBe('Pending')
  })
})

describe('Finalise a row instead of leaving it open to change', () => {
  test('a submitted row cannot be edited and the user is told to cancel it first', async ({ admin }) => {
    await admin.post('/api/table_def', {
      name: 'Wf Fin Invoice',
      is_submittable: true,
      id_pattern: 'prompt',
      columns: [{ column_name: 'title', column_type: 'Data' }],
    })
    const doc = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Wf Fin Invoice', row: { row_id: 'fin-1', title: 'v1' } })
    const submitted = await admin.post<{ updated_at: string }>(`/api/table/Wf%20Fin%20Invoice/${doc.row_id}:submit`)

    await expect(
      admin.post('/api/save_row', {
        table: 'Wf Fin Invoice',
        row: { row_id: 'fin-1', updated_at: submitted.updated_at, title: 'sneaky' },
      }),
    ).rejects.toMatchObject({ status: 417, message: expect.stringContaining('cancel it first') })
    const [row] = await sql`select title from featherbase.wf_fin_invoice where row_id = 'fin-1'`
    expect(row.title).toBe('v1')
  })
})

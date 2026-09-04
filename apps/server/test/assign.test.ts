import { describe, expect } from 'vitest'
import { sql } from '../src/db'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { saveDoc } from '../src/document'
import { createAssignment } from '../src/assign'

// EML-006: assigning a document creates a ToDo for the assignee and a
// notification.

const DT = 'Asg Srv DT'
const ASSIGNEE = 'asg-srv@x.com'

// Each test builds its Table, assignee user, and document inside its own
// sandbox transaction.
async function setup(admin: TestClient) {
  await admin.post('/api/table_def', {
    name: DT,
    id_pattern: 'prompt',
    columns: [{ column_name: 'title', column_type: 'Data' }],
  })
  await admin.post('/api/save_row', {
    table: 'User',
    row: { row_id: ASSIGNEE, email: ASSIGNEE },
  })
  await admin.post(`/api/table/${encodeURIComponent(DT)}`, { row_id: 'asg-1', title: 'x' })
}

describe('EML-006: assignment', () => {
  test('creates a ToDo for the assignee and a notification', async ({ admin }) => {
    await setup(admin)
    const res = await admin.fetch('/api/assign', {
      method: 'POST',
      body: JSON.stringify({
        table: DT,
        row_id: 'asg-1',
        assign_to: ASSIGNEE,
        description: 'please handle',
      }),
    })
    expect(res.status).toBe(201)

    const todos = await sql`
      select allocated_to, reference_name, todo_status, description from todo
      where ref_table = ${DT} and reference_name = 'asg-1'`
    expect(todos).toHaveLength(1)
    expect(todos[0].allocated_to).toBe(ASSIGNEE)
    expect(todos[0].todo_status).toBe('Open')
    expect(todos[0].description).toBe('please handle')

    const notifs = await sql`
      select subject from notification_log where for_user = ${ASSIGNEE}`
    expect(notifs.length).toBeGreaterThanOrEqual(1)
    expect(notifs[0].subject).toContain('assigned you')
  })

  test('rejects assigning to a non-existent user', async ({ admin }) => {
    await setup(admin)
    const res = await admin.fetch('/api/assign', {
      method: 'POST',
      body: JSON.stringify({ table: DT, row_id: 'asg-1', assign_to: 'ghost@x.com' }),
    })
    expect(res.status).toBe(404)
  })

  test('requires table, name, and assign_to', async ({ admin }) => {
    await setup(admin)
    const res = await admin.fetch('/api/assign', {
      method: 'POST',
      body: JSON.stringify({ table: DT }),
    })
    expect(res.status).toBe(417)
  })

  test('an unauthenticated request is rejected', async ({ admin, api }) => {
    await setup(admin)
    const res = await api.fetch('/api/assign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ table: DT, row_id: 'asg-1', assign_to: ASSIGNEE }),
    })
    expect(res.status).toBe(401)
  })
})

// Moved from coverage-gaps.test.ts (#221): createAssignment's default
// description when the caller supplies none. Exercises createAssignment
// directly (a deliberate exception to the HTTP-first idiom) since the point
// is the RPC's default, not the /api/assign route around it.
describe('assignment + RPC edges', () => {
  test('createAssignment defaults its description', async ({ admin, createUser }) => {
    const DT = 'Cov Assign Note'
    await admin.post('/api/table_def', {
      name: DT,
      columns: [{ column_name: 'title', column_type: 'Data' }],
    })
    const user = await createUser({ roles: [] })
    const doc = await saveDoc(DT, { title: 'x' }, 'Administrator')
    await createAssignment(DT, String(doc.row_id), String(user.user), 'Administrator')
    const [todo] = await sql`
      select description from todo
      where ref_table = ${DT} and reference_name = ${String(doc.row_id)}`
    expect(todo.description).toBe(`Assigned ${DT} ${String(doc.row_id)}`)
  })
})

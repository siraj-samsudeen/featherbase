import { describe, expect } from 'vitest'
import { sql } from '../src/db'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { saveDoc } from '../src/document'
import { createAssignment } from '../src/assign'
import { onEvent } from '../src/realtime'

// EML-006: assigning a document creates a ToDo for the assignee and a
// notification.

const DT = 'Asg Srv DT'
const ASSIGNEE_EMAIL = 'asg-srv@x.com'
// The assignee's minted id (`psn_…`), set by setup().
let ASSIGNEE = ''

// Each test builds its Table, assignee user, and document inside its own
// sandbox transaction.
async function setup(admin: TestClient) {
  await admin.post('/api/table_def', {
    name: DT,
    id_pattern: 'prompt',
    columns: [{ column_name: 'title', column_type: 'Data' }],
  })
  ASSIGNEE = (await admin.post<{ row_id: string }>('/api/save_row', {
    table: 'Person',
    row: { email: ASSIGNEE_EMAIL },
  })).row_id
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

describe('Assign a row to someone', () => {
  async function world(admin: TestClient) {
    await admin.post('/api/table_def', { name: 'Asg Req Doc', columns: [{ column_name: 'title', column_type: 'Data' }] })
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Asg Req Reader' } })
    await admin.post('/api/save_row', {
      table: 'Permission',
      row: { ref_table: 'Asg Req Doc', role: 'Asg Req Reader', tier: 'basic', can_read: true },
    })
    // Assigning writes the assignee's to-do, so a role that assigns also holds
    // create on the to-do list.
    await admin.post('/api/save_row', {
      table: 'Permission',
      row: { ref_table: 'ToDo', role: 'Asg Req Reader', tier: 'basic', can_read: true, can_create: true, can_write: true },
    })
    return admin.post<{ row_id: string }>('/api/save_row', { table: 'Asg Req Doc', row: { title: 'work' } })
  }

  test('someone who can read the row assigns it to a person, and it shows on that person\'s own list', async ({
    admin,
    createUser,
  }) => {
    const doc = await world(admin)
    const reader = await createUser({ roles: ['Asg Req Reader'] })
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Asg Req Assignee' } })
    await admin.post('/api/save_row', {
      table: 'Permission',
      row: { ref_table: 'ToDo', role: 'Asg Req Assignee', tier: 'basic', can_read: true },
    })
    const priya = await createUser({ roles: ['Asg Req Assignee'] })
    const res = await reader.fetch('/api/assign', {
      method: 'POST',
      body: JSON.stringify({ table: 'Asg Req Doc', row_id: doc.row_id, assign_to: priya.user }),
    })
    expect(res.status).toBe(201)

    const mine = await priya.get<{ data: { reference_name: string }[] }>(
      `/api/table/ToDo?fields=%5B%22reference_name%22%5D&filters=${encodeURIComponent(JSON.stringify([['allocated_to', '=', priya.user]]))}`,
    )
    expect(mine.data.map((t) => t.reference_name)).toEqual([doc.row_id])
  })

  test('a row can be assigned to more than one person at once', async ({ admin, createUser }) => {
    const doc = await world(admin)
    const alex = await createUser({ roles: [] })
    const priya = await createUser({ roles: [] })
    for (const who of [alex, priya])
      await admin.post('/api/assign', { table: 'Asg Req Doc', row_id: doc.row_id, assign_to: who.user })
    const todos = await sql`select allocated_to from todo where ref_table = 'Asg Req Doc' and reference_name = ${doc.row_id}`
    expect(todos.map((t) => t.allocated_to).sort()).toEqual([alex.user, priya.user].sort())
  })

  test('someone who cannot read the row cannot assign it', async ({ admin, createUser }) => {
    const doc = await world(admin)
    const outsider = await createUser({ roles: [] })
    const priya = await createUser({ roles: [] })
    const res = await outsider.fetch('/api/assign', {
      method: 'POST',
      body: JSON.stringify({ table: 'Asg Req Doc', row_id: doc.row_id, assign_to: priya.user }),
    })
    expect(res.status).toBe(403)
    expect((await sql`select 1 from todo where reference_name = ${doc.row_id}`).length).toBe(0)
  })

  test('the assignee gets a notification that links to the row, and their unread count goes up live', async ({
    admin,
    createUser,
  }) => {
    const doc = await world(admin)
    const priya = await createUser({ roles: [] })
    expect((await priya.get<{ count: number }>('/api/unread_count')).count).toBe(0)
    const heard: { channel: string; event: string }[] = []
    const stop = onEvent((e) => heard.push(e))
    await admin.post('/api/assign', { table: 'Asg Req Doc', row_id: doc.row_id, assign_to: priya.user })
    stop()

    expect(heard).toContainEqual(expect.objectContaining({ channel: `user:${priya.user}`, event: 'notification' }))
    expect((await priya.get<{ count: number }>('/api/unread_count')).count).toBe(1)
    const [note] = await sql`select ref_table, ref_name from notification_log where for_user = ${priya.user}`
    expect(note).toMatchObject({ ref_table: 'Asg Req Doc', ref_name: doc.row_id })
  })

  // SPEC: Assign a row to someone — suspected defect, see report. The assign box
  // on a row's form invites an email address (its placeholder is an address),
  // but the server only knows a person by their opaque id, so an address is
  // refused as "not found".
  test.fails('a row can be assigned to a person by the email address the form invites', async ({ admin }) => {
    const doc = await world(admin)
    const [priya] = await sql`insert into person ${sql({ row_id: 'psn_asgreqpriya', created_by: 'Administrator', updated_by: 'Administrator', email: 'priya-asg@x.com', enabled: true })} returning row_id`
    expect(priya.row_id).toBe('psn_asgreqpriya')
    const res = await admin.fetch('/api/assign', {
      method: 'POST',
      body: JSON.stringify({ table: 'Asg Req Doc', row_id: doc.row_id, assign_to: 'priya-asg@x.com' }),
    })
    expect(res.status).toBe(201)
  })
})

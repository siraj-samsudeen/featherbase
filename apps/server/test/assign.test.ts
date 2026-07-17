import { describe, expect } from 'vitest'
import { sql } from '../src/db'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

// EML-006: assigning a document creates a ToDo for the assignee and a
// notification.

const DT = 'Asg Srv DT'
const ASSIGNEE = 'asg-srv@x.com'

// Each test builds its DocType, assignee user, and document inside its own
// sandbox transaction.
async function setup(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: DT,
    autoname: 'prompt',
    fields: [{ fieldname: 'title', fieldtype: 'Data' }],
  })
  await admin.post('/api/save_doc', {
    doctype: 'User',
    doc: { name: ASSIGNEE, email: ASSIGNEE },
  })
  await admin.post(`/api/resource/${encodeURIComponent(DT)}`, { name: 'asg-1', title: 'x' })
}

describe('EML-006: assignment', () => {
  test('creates a ToDo for the assignee and a notification', async ({ admin }) => {
    await setup(admin)
    const res = await admin.fetch('/api/assign', {
      method: 'POST',
      body: JSON.stringify({
        doctype: DT,
        name: 'asg-1',
        assign_to: ASSIGNEE,
        description: 'please handle',
      }),
    })
    expect(res.status).toBe(201)

    const todos = await sql`
      select allocated_to, reference_name, status, description from tab_todo
      where reference_doctype = ${DT} and reference_name = 'asg-1'`
    expect(todos).toHaveLength(1)
    expect(todos[0].allocated_to).toBe(ASSIGNEE)
    expect(todos[0].status).toBe('Open')
    expect(todos[0].description).toBe('please handle')

    const notifs = await sql`
      select subject from tab_notification_log where for_user = ${ASSIGNEE}`
    expect(notifs.length).toBeGreaterThanOrEqual(1)
    expect(notifs[0].subject).toContain('assigned you')
  })

  test('rejects assigning to a non-existent user', async ({ admin }) => {
    await setup(admin)
    const res = await admin.fetch('/api/assign', {
      method: 'POST',
      body: JSON.stringify({ doctype: DT, name: 'asg-1', assign_to: 'ghost@x.com' }),
    })
    expect(res.status).toBe(404)
  })

  test('requires doctype, name, and assign_to', async ({ admin }) => {
    await setup(admin)
    const res = await admin.fetch('/api/assign', {
      method: 'POST',
      body: JSON.stringify({ doctype: DT }),
    })
    expect(res.status).toBe(417)
  })

  test('an unauthenticated request is rejected', async ({ admin, api }) => {
    await setup(admin)
    const res = await api.fetch('/api/assign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ doctype: DT, name: 'asg-1', assign_to: ASSIGNEE }),
    })
    expect(res.status).toBe(401)
  })
})

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { sql } from '../src/db'
import { areq } from './helpers'

// EML-006: assigning a document creates a ToDo for the assignee and a
// notification.

const DT = 'Asg Srv DT'
const ASSIGNEE = 'asg-srv@x.com'

async function cleanup() {
  await sql`delete from tab_todo where reference_doctype = ${DT}`
  await sql`delete from tab_notification_log where for_user = ${ASSIGNEE}`
  await sql`delete from tab_user where name = ${ASSIGNEE}`
  await sql`delete from tab_docfield where parent = ${DT}`
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_asg_srv_dt')
}

beforeAll(async () => {
  await cleanup()
  await areq('/api/doctype', {
    method: 'POST',
    body: JSON.stringify({ name: DT, autoname: 'prompt', fields: [{ fieldname: 'title', fieldtype: 'Data' }] }),
  })
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({ doctype: 'User', doc: { name: ASSIGNEE, email: ASSIGNEE } }),
  })
  await areq(`/api/resource/${encodeURIComponent(DT)}`, {
    method: 'POST',
    body: JSON.stringify({ name: 'asg-1', title: 'x' }),
  })
})

afterAll(cleanup)

describe('EML-006: assignment', () => {
  it('creates a ToDo for the assignee and a notification', async () => {
    const res = await areq('/api/assign', {
      method: 'POST',
      body: JSON.stringify({ doctype: DT, name: 'asg-1', assign_to: ASSIGNEE, description: 'please handle' }),
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

  it('rejects assigning to a non-existent user', async () => {
    const res = await areq('/api/assign', {
      method: 'POST',
      body: JSON.stringify({ doctype: DT, name: 'asg-1', assign_to: 'ghost@x.com' }),
    })
    expect(res.status).toBe(404)
  })

  it('requires doctype, name, and assign_to', async () => {
    const res = await areq('/api/assign', { method: 'POST', body: JSON.stringify({ doctype: DT }) })
    expect(res.status).toBe(417)
  })

  it('an unauthenticated request is rejected', async () => {
    const res = await app.request('/api/assign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ doctype: DT, name: 'asg-1', assign_to: ASSIGNEE }),
    })
    expect(res.status).toBe(401)
  })
})

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { sql } from '../src/db'
import { setUserPassword } from '../src/auth'
import { areq } from './helpers'

// WEB-002/003: a logged-in web-form submitter becomes the document's owner —
// closing the portal loop (their if_owner portal now shows what they filed).
// Anonymous submissions still create as Administrator.

const DT = 'Wf Owner Req'
const ROLE = 'Wf Owner Customer'
const CUST = 'wfown-cust@x.com'
const ROUTE = 'wfown-request'

async function cleanup() {
  await sql`delete from tab_web_form where route = ${ROUTE}`
  await sql`delete from tab_docperm where ref_doctype = ${DT}`
  await sql`delete from tab_has_role where parent = ${CUST}`
  await sql`delete from tab_user where name = ${CUST}`
  await sql`delete from tab_role where name = ${ROLE}`
  await sql`delete from tab_docfield where parent = ${DT}`
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_wf_owner_req')
}

beforeAll(async () => {
  await cleanup()
  await areq('/api/doctype', {
    method: 'POST',
    body: JSON.stringify({ name: DT, fields: [{ fieldname: 'subject', fieldtype: 'Data', reqd: true }] }),
  })
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({ doctype: 'Role', doc: { name: ROLE } }),
  })
  // The customer role holds NO create DocPerm — the web form is the only door.
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({
      doctype: 'DocPerm',
      doc: { ref_doctype: DT, role: ROLE, if_owner: true, can_read: true },
    }),
  })
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({
      doctype: 'User',
      doc: { name: CUST, email: CUST, enabled: true, roles: [{ role: ROLE }] },
    }),
  })
  await setUserPassword(CUST, 'wfownpw1')
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({
      doctype: 'Web Form',
      doc: {
        name: 'WfOwn Request Form',
        title: 'Request',
        route: ROUTE,
        document_type: DT,
        published: true,
        web_fields: JSON.stringify(['subject']),
      },
    }),
  })
})

afterAll(cleanup)

describe('WEB-002/003: web-form owner attribution', () => {
  it('an anonymous submit creates as Administrator', async () => {
    const res = await app.request(`/api/web_form/${ROUTE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ values: { subject: 'anon' } }),
    })
    expect(res.status).toBe(201)
    const { name } = (await res.json()) as { name: string }
    const [row] = await sql`select owner from tab_wf_owner_req where name = ${name}`
    expect(row.owner).toBe('Administrator')
  })

  it('a logged-in submit is owned by the session user and visible in their portal list', async () => {
    const login = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usr: CUST, pwd: 'wfownpw1' }),
    })
    const { token } = (await login.json()) as { token: string }
    const res = await app.request(`/api/web_form/${ROUTE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ values: { subject: 'mine' } }),
    })
    expect(res.status).toBe(201)
    const { name } = (await res.json()) as { name: string }
    const [row] = await sql`select owner from tab_wf_owner_req where name = ${name}`
    expect(row.owner).toBe(CUST)

    // The if_owner read grant now surfaces exactly this document.
    const list = await app.request(`/api/resource/${encodeURIComponent(DT)}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(list.status).toBe(200)
    const body = (await list.json()) as { data: { name: string }[]; total: number }
    expect(body.total).toBe(1)
    expect(body.data[0].name).toBe(name)
  })
})

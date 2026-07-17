import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { sql } from '../src/db'
import { setUserPassword } from '../src/auth'
import { areq } from './helpers'

// PERM-005 regression: a User Permission narrows lists by every Link field
// pointing at the restricted DocType, but a row whose link is UNSET must still
// be visible — plain `IN` excludes NULLs, which used to empty out lists (and
// disagreed with the detail-read check, which passes null values).

const DT = 'Upn Ticket'
const ROLE = 'Upn Agent'
const AGENT = 'upn-agent@x.com'
const CUST_A = 'upn-cust-a@x.com'
const CUST_B = 'upn-cust-b@x.com'

async function cleanup() {
  await sql`delete from tab_user_permission where "user" = ${AGENT}`
  await sql`delete from tab_docperm where ref_doctype = ${DT}`
  for (const u of [AGENT, CUST_A, CUST_B]) {
    await sql`delete from tab_has_role where parent = ${u}`
    await sql`delete from tab_user where name = ${u}`
  }
  await sql`delete from tab_role where name = ${ROLE}`
  await sql`delete from tab_docfield where parent = ${DT}`
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_upn_ticket')
}

beforeAll(async () => {
  await cleanup()
  for (const u of [CUST_A, CUST_B])
    await sql`insert into tab_user ${sql({
      name: u, owner: 'Administrator', modified_by: 'Administrator', email: u, enabled: true,
    })}`
  await areq('/api/doctype', {
    method: 'POST',
    body: JSON.stringify({
      name: DT,
      fields: [
        { fieldname: 'subject', fieldtype: 'Data' },
        { fieldname: 'customer', fieldtype: 'Link', options: 'User' },
      ],
    }),
  })
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({ doctype: 'Role', doc: { name: ROLE } }),
  })
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({
      doctype: 'DocPerm',
      doc: { ref_doctype: DT, role: ROLE, can_read: true },
    }),
  })
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({
      doctype: 'User',
      doc: { name: AGENT, email: AGENT, enabled: true, roles: [{ role: ROLE }] },
    }),
  })
  await setUserPassword(AGENT, 'upnpw123')
  // Restrict the agent to customer A (User values).
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({
      doctype: 'User Permission',
      doc: { user: AGENT, allow: 'User', for_value: CUST_A },
    }),
  })
  for (const [subject, customer] of [
    ['for A', CUST_A],
    ['for B', CUST_B],
    ['unlinked', null],
  ] as const)
    await areq('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({ doctype: DT, doc: { subject, customer } }),
    })
})

afterAll(cleanup)

describe('PERM-005: NULL links pass user-permission list narrowing', () => {
  it('the list shows in-scope and unlinked rows, hides out-of-scope rows', async () => {
    const login = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usr: AGENT, pwd: 'upnpw123' }),
    })
    const { token } = (await login.json()) as { token: string }
    const res = await app.request(
      `/api/resource/${encodeURIComponent(DT)}?fields=${encodeURIComponent(JSON.stringify(['name', 'subject']))}`,
      { headers: { authorization: `Bearer ${token}` } },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { subject: string }[]; total: number }
    const subjects = body.data.map((d) => d.subject).sort()
    expect(subjects).toEqual(['for A', 'unlinked'])
    expect(body.total).toBe(2)
  })
})

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { sql } from '../src/db'
import { setUserPassword } from '../src/auth'
import { areq } from './helpers'

// SET-003: the permission-manager endpoints edit the DocPerm matrix, gated to
// System Managers, upserting one row per (doctype, role) at permlevel 0.

const DT = 'PM Srv Doc'
const ROLE = 'PM Srv Role'
const NONSM = 'pm-srv-nonsm@x.com'
const PWD = 'pmsrv12345'

async function cleanup() {
  await sql`delete from tab_docperm where ref_doctype = ${DT}`
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_pm_srv_doc')
  await sql`delete from tab_has_role where parent = ${NONSM}`
  await sql`delete from tab_user where name = ${NONSM}`
  await sql`delete from tab_role where name = ${ROLE}`
}

async function save(doctype: string, doc: Record<string, unknown>) {
  const res = await areq('/api/save_doc', { method: 'POST', body: JSON.stringify({ doctype, doc }) })
  if (res.status !== 201) throw new Error(`save ${doctype}: ${res.status} ${await res.text()}`)
}

async function userToken(): Promise<string> {
  const res = await app.request('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usr: NONSM, pwd: PWD }),
  })
  return ((await res.json()) as { token: string }).token
}

beforeAll(async () => {
  await cleanup()
  await areq('/api/doctype', {
    method: 'POST',
    body: JSON.stringify({ name: DT, fields: [{ fieldname: 'title', fieldtype: 'Data' }] }),
  })
  await save('Role', { name: ROLE })
  await save('User', { name: NONSM, email: NONSM, enabled: true }) // no System Manager
  await setUserPassword(NONSM, PWD)
})

afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('SET-003: permission manager endpoints', () => {
  it('GET returns roles and perms for a System Manager', async () => {
    const res = await areq(`/api/permissions/${encodeURIComponent(DT)}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { roles: string[]; perms: unknown[] }
    expect(body.roles).toContain(ROLE)
    expect(Array.isArray(body.perms)).toBe(true)
  })

  it('POST upserts a single DocPerm row per role (no duplicates)', async () => {
    const post = (flags: Record<string, boolean>) =>
      areq(`/api/permissions/${encodeURIComponent(DT)}`, {
        method: 'POST',
        body: JSON.stringify({ role: ROLE, ...flags }),
      })

    expect((await post({ can_read: true, can_write: true })).status).toBe(200)
    expect((await post({ can_read: true, can_write: false })).status).toBe(200)

    const rows = await sql`
      select can_read, can_write from tab_docperm
      where ref_doctype = ${DT} and role = ${ROLE} and permlevel = 0`
    expect(rows).toHaveLength(1) // upsert, not insert
    expect(rows[0].can_write).toBe(false)
    expect(rows[0].can_read).toBe(true)
  })

  it('is gated to System Managers (non-SM gets 403 on read and write)', async () => {
    const token = await userToken()
    const auth = { authorization: `Bearer ${token}` }
    const get = await app.request(`/api/permissions/${encodeURIComponent(DT)}`, { headers: auth })
    expect(get.status).toBe(403)
    const post = await app.request(`/api/permissions/${encodeURIComponent(DT)}`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ role: ROLE, can_read: true }),
    })
    expect(post.status).toBe(403)
  })
})

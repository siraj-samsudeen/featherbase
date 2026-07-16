import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { sql } from '../src/db'
import { setUserPassword } from '../src/auth'
import { logActivity, logAccess } from '../src/audit'
import { areq } from './helpers'

// PLAT-007: Activity Log records logins; Access Log records exports/prints.
// Both carry the user and a timestamp, and are written even during login.

const USER = 'audit-srv@x.com'

async function cleanup() {
  await sql`delete from tab_activity_log where "user" = ${USER}`
  await sql`delete from tab_access_log where "user" = ${USER}`
  await sql`delete from tab_user where name = ${USER}`
}

beforeAll(async () => {
  await cleanup()
  const res = await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({ doctype: 'User', doc: { name: USER, email: USER, enabled: true, roles: [{ role: 'System Manager' }] } }),
  })
  if (res.status !== 201) throw new Error(`create user: ${res.status}`)
  await setUserPassword(USER, 'auditpw12345')
})

afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('PLAT-007: audit logs', () => {
  it('records a login in the Activity Log with user + timestamp', async () => {
    const before = new Date()
    const res = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usr: USER, pwd: 'auditpw12345' }),
    })
    expect(res.status).toBe(200)

    const [row] = await sql`
      select "user", operation, creation from tab_activity_log
      where "user" = ${USER} and operation = 'login' order by creation desc limit 1`
    expect(row).toBeDefined()
    expect(row.user).toBe(USER)
    expect(new Date(row.creation as string).getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000)
  })

  it('records an export via /api/access_log (read permission required)', async () => {
    const res = await areq('/api/access_log', {
      method: 'POST',
      body: JSON.stringify({ doctype: 'User', method: 'csv' }),
    })
    expect(res.status).toBe(200)
    const [row] = await sql`
      select operation, reference_doctype, method from tab_access_log
      where operation = 'export' and reference_doctype = 'User' order by creation desc limit 1`
    expect(row.operation).toBe('export')
    expect(row.method).toBe('csv')
  })

  it('rejects logging an export of a DocType the caller cannot read', async () => {
    // A fresh doctype with no grants: the audit user (System Manager) CAN read
    // everything, so use a genuinely unreadable target for a plain user.
    await areq('/api/doctype', {
      method: 'POST',
      body: JSON.stringify({ name: 'Audit Sekret', fields: [{ fieldname: 'x', fieldtype: 'Data' }] }),
    })
    await setUserPassword(USER, 'auditpw12345')
    // Downgrade check: a user with no System Manager role.
    const plain = 'audit-plain@x.com'
    await sql`delete from tab_user where name = ${plain}`
    await areq('/api/save_doc', { method: 'POST', body: JSON.stringify({ doctype: 'User', doc: { name: plain, email: plain, enabled: true } }) })
    await setUserPassword(plain, 'plainpw12345')
    const token = ((await (await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usr: plain, pwd: 'plainpw12345' }),
    })).json()) as { token: string }).token
    const res = await app.request('/api/access_log', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ doctype: 'Audit Sekret', method: 'csv' }),
    })
    expect(res.status).toBe(403)
    await sql`delete from tab_user where name = ${plain}`
    await sql`delete from tab_doctype where name = 'Audit Sekret'`
    await sql.unsafe('drop table if exists tab_audit_sekret')
  })

  it('logAccess/logActivity write directly with the user as owner', async () => {
    await logActivity(USER, 'logout')
    await logAccess(USER, 'print', { doctype: 'User', name: USER, method: 'pdf' })
    const [a] = await sql`select owner from tab_activity_log where "user" = ${USER} and operation = 'logout' limit 1`
    const [b] = await sql`select owner, reference_name from tab_access_log where "user" = ${USER} and operation = 'print' limit 1`
    expect(a.owner).toBe(USER)
    expect(b.owner).toBe(USER)
    expect(b.reference_name).toBe(USER)
  })
})

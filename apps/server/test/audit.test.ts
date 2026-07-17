import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { setUserPassword } from '../src/auth'
import { logActivity, logAccess } from '../src/audit'

// PLAT-007: Activity Log records logins; Access Log records exports/prints.
// Both carry the user and a timestamp, and are written even during login.

const USER = 'audit-srv@x.com'

// Real password + real /api/login — this suite is about the audit trail of
// authentication itself, so no token-minting shortcut.
async function setup(admin: TestClient) {
  await admin.post('/api/save_doc', {
    doctype: 'User',
    doc: { name: USER, email: USER, enabled: true, roles: [{ role: 'System Manager' }] },
  })
  await setUserPassword(USER, 'auditpw12345')
}

describe('PLAT-007: audit logs', () => {
  test('records a login in the Activity Log with user + timestamp', async ({ admin, api }) => {
    await setup(admin)
    const before = new Date()
    const res = await api.fetch('/api/login', {
      method: 'POST',
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

  test('records an export via /api/access_log (read permission required)', async ({ admin }) => {
    await setup(admin)
    const res = await admin.fetch('/api/access_log', {
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

  test('rejects logging an export of a DocType the caller cannot read', async ({ admin, api }) => {
    await setup(admin)
    // A fresh doctype with no grants: the audit user (System Manager) CAN read
    // everything, so use a genuinely unreadable target for a plain user.
    await admin.post('/api/doctype', {
      name: 'Audit Sekret',
      fields: [{ fieldname: 'x', fieldtype: 'Data' }],
    })
    // Downgrade check: a user with no System Manager role.
    const plain = 'audit-plain@x.com'
    await admin.post('/api/save_doc', {
      doctype: 'User',
      doc: { name: plain, email: plain, enabled: true },
    })
    await setUserPassword(plain, 'plainpw12345')
    const login = await api.fetch('/api/login', {
      method: 'POST',
      body: JSON.stringify({ usr: plain, pwd: 'plainpw12345' }),
    })
    const token = ((await login.json()) as { token: string }).token
    const res = await api.fetch('/api/access_log', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ doctype: 'Audit Sekret', method: 'csv' }),
    })
    expect(res.status).toBe(403)
  })

  test('logAccess/logActivity write directly with the user as owner', async ({ admin }) => {
    await setup(admin)
    await logActivity(USER, 'logout')
    await logAccess(USER, 'print', { doctype: 'User', name: USER, method: 'pdf' })
    const [a] = await sql`select owner from tab_activity_log where "user" = ${USER} and operation = 'logout' limit 1`
    const [b] = await sql`select owner, reference_name from tab_access_log where "user" = ${USER} and operation = 'print' limit 1`
    expect(a.owner).toBe(USER)
    expect(b.owner).toBe(USER)
    expect(b.reference_name).toBe(USER)
  })
})

import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { setUserPassword } from '../src/auth'
import { logActivity, logAccess } from '../src/audit'

// PLAT-007: Activity Log records logins; Access Log records exports/prints.
// Both carry the user and a timestamp, and are written even during login.

const USER = 'audit-srv@x.com'
// The person's minted id (`psn_…`): logs carry the id, sign-in uses the address.
let ID = ''

// Real password + real /api/login — this suite is about the audit trail of
// authentication itself, so no token-minting shortcut.
async function setup(admin: TestClient) {
  const saved = await admin.post<{ row_id: string }>('/api/save_row', {
    table: 'Person',
    row: { email: USER, enabled: true, roles: [{ role: 'System Manager' }] },
  })
  ID = saved.row_id
  await setUserPassword(ID, 'auditpw12345')
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
      select "user", operation, created_at from activity_log
      where "user" = ${ID} and operation = 'login' order by created_at desc limit 1`
    expect(row).toMatchObject({ operation: 'login' })
    expect(row.user).toBe(ID)
    expect(new Date(row.created_at as string).getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000)
  })

  test('records an export via /api/access_log (read permission required)', async ({ admin }) => {
    await setup(admin)
    const res = await admin.fetch('/api/access_log', {
      method: 'POST',
      body: JSON.stringify({ table: 'Person', method: 'csv' }),
    })
    expect(res.status).toBe(200)
    const [row] = await sql`
      select operation, ref_table, method from access_log
      where operation = 'export' and ref_table = 'Person' order by created_at desc limit 1`
    expect(row.operation).toBe('export')
    expect(row.method).toBe('csv')
  })

  test('rejects logging an export of a Table the caller cannot read', async ({ admin, api }) => {
    await setup(admin)
    // A fresh table with no grants: the audit user (System Manager) CAN read
    // everything, so use a genuinely unreadable target for a plain user.
    await admin.post('/api/table_def', {
      name: 'Audit Sekret',
      columns: [{ column_name: 'x', column_type: 'Data' }],
    })
    // Downgrade check: a user with no System Manager role.
    const plain = 'audit-plain@x.com'
    const plainRow = await admin.post<{ row_id: string }>('/api/save_row', {
      table: 'Person',
      row: { email: plain, enabled: true },
    })
    await setUserPassword(plainRow.row_id, 'plainpw12345')
    const login = await api.fetch('/api/login', {
      method: 'POST',
      body: JSON.stringify({ usr: plain, pwd: 'plainpw12345' }),
    })
    const token = ((await login.json()) as { token: string }).token
    const res = await api.fetch('/api/access_log', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ table: 'Audit Sekret', method: 'csv' }),
    })
    expect(res.status).toBe(403)
  })

  test('logAccess/logActivity write directly with the user as owner', async ({ admin }) => {
    await setup(admin)
    await logActivity(ID, 'logout')
    await logAccess(ID, 'print', { table: 'Person', row_id: ID, method: 'pdf' })
    const [a] = await sql`select created_by from activity_log where "user" = ${ID} and operation = 'logout' limit 1`
    const [b] = await sql`select created_by, reference_name from access_log where "user" = ${ID} and operation = 'print' limit 1`
    expect(a.created_by).toBe(ID)
    expect(b.created_by).toBe(ID)
    expect(b.reference_name).toBe(ID)
  })
})

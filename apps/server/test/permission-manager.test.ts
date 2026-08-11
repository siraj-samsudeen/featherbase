import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import type { TestClient } from 'feather-testing-postgres'

// SET-003: the permission-manager endpoints edit the Permission matrix, gated to
// System Managers, upserting one row per (table, role) at tier 'basic'.

const DT = 'PM Srv Doc'
const ROLE = 'PM Srv Role'

// Per-test world: the Table and the role, rolled back with the test.
async function setup(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: DT,
    columns: [{ column_name: 'title', column_type: 'Data' }],
  })
  await admin.post('/api/save_doc', { doctype: 'Role', doc: { row_id: ROLE } })
}

describe('SET-003: permission manager endpoints', () => {
  test('GET returns roles and perms for a System Manager', async ({ admin }) => {
    await setup(admin)
    const res = await admin.fetch(`/api/permissions/${encodeURIComponent(DT)}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { roles: string[]; perms: unknown[] }
    expect(body.roles).toContain(ROLE)
    expect(Array.isArray(body.perms)).toBe(true)
  })

  test('POST upserts a single Permission row per role (no duplicates)', async ({ admin }) => {
    await setup(admin)
    const post = (flags: Record<string, boolean>) =>
      admin.fetch(`/api/permissions/${encodeURIComponent(DT)}`, {
        method: 'POST',
        body: JSON.stringify({ role: ROLE, ...flags }),
      })

    expect((await post({ can_read: true, can_write: true })).status).toBe(200)
    expect((await post({ can_read: true, can_write: false })).status).toBe(200)

    const rows = await sql`
      select can_read, can_write from permission
      where ref_table = ${DT} and role = ${ROLE} and tier = 'basic'`
    expect(rows).toHaveLength(1) // upsert, not insert
    expect(rows[0].can_write).toBe(false)
    expect(rows[0].can_read).toBe(true)
  })

  test('is gated to System Managers (non-SM gets 403 on read and write)', async ({
    admin,
    createUser,
  }) => {
    await setup(admin)
    const nonSm = await createUser({ roles: [] }) // no System Manager
    const get = await nonSm.fetch(`/api/permissions/${encodeURIComponent(DT)}`)
    expect(get.status).toBe(403)
    const post = await nonSm.fetch(`/api/permissions/${encodeURIComponent(DT)}`, {
      method: 'POST',
      body: JSON.stringify({ role: ROLE, can_read: true }),
    })
    expect(post.status).toBe(403)
  })
})

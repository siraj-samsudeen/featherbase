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
  await admin.post('/api/table_def', {
    name: DT,
    columns: [{ column_name: 'title', column_type: 'Data' }],
  })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: ROLE } })
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

  test('POST keeps one contribution per enabled operation', async ({ admin }) => {
    await setup(admin)
    const post = (flags: Record<string, boolean>) =>
      admin.fetch(`/api/permissions/${encodeURIComponent(DT)}`, {
        method: 'POST',
        body: JSON.stringify({ role: ROLE, ...flags }),
      })

    expect((await post({ can_read: true, can_write: true })).status).toBe(200)
    expect((await post({ can_read: true, can_write: false })).status).toBe(200)

    const rows = await sql`
      select operation from permission
      where ref_table = ${DT} and role = ${ROLE}`
    expect(rows).toHaveLength(1) // upsert, not insert
    expect(rows[0].operation).toBe('read')
  })

  test('the simple matrix cannot replace a scoped grant with unrestricted access', async ({ admin }) => {
    await setup(admin)
    const grant = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Permission', row: {
      ref_table: DT, role: ROLE, operation: 'read', scope_mode: 'creator',
    } })
    // The matrix edits the role's one flag Row as before: an added operation
    // keeps that Row's creator restriction, never all rows.
    await admin.post(`/api/permissions/${encodeURIComponent(DT)}`, { role: ROLE, can_read: true, can_write: true })
    const rows = await sql`select row_id, operation, scope_mode from permission where ref_table = ${DT} and role = ${ROLE} order by operation`
    expect(rows).toEqual([
      { row_id: grant.row_id, operation: 'read', scope_mode: 'creator' },
      { row_id: expect.any(String), operation: 'update', scope_mode: 'creator' },
    ])
  })

  test('the simple matrix leaves a grant of listed Columns to its own Row', async ({ admin }) => {
    await setup(admin)
    await admin.post('/api/save_row', { table: 'Permission', row: {
      ref_table: DT, role: ROLE, operation: 'read', column_rule: 'every',
    } })
    await expect(admin.post(`/api/permissions/${encodeURIComponent(DT)}`, {
      role: ROLE, can_read: false,
    })).rejects.toMatchObject({ status: 417 })
    expect(await sql`select operation, column_rule from permission where ref_table = ${DT} and role = ${ROLE}`)
      .toEqual([{ operation: 'read', column_rule: 'every' }])
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

describe("Set a table's grants in one place", () => {
  test("a grant set by a System Manager applies to the role's holders on their very next request", async ({
    admin,
    createUser,
  }) => {
    await setup(admin)
    const holder = await createUser({ roles: [ROLE] })
    const list = `/api/table/${encodeURIComponent(DT)}`
    expect((await holder.fetch(list)).status).toBe(403)
    await admin.post(`/api/permissions/${encodeURIComponent(DT)}`, { role: ROLE, can_read: true })
    expect((await holder.fetch(list)).status).toBe(200)
    await admin.post(`/api/permissions/${encodeURIComponent(DT)}`, { role: ROLE, can_read: false })
    expect((await holder.fetch(list)).status).toBe(403)
  })
})

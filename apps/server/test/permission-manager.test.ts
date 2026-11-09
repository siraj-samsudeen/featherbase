import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import type { TestClient } from 'feather-testing-postgres'
import { expectStatus } from './fixtures'

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
    await expectStatus(res, 200)
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

    await expectStatus(await post({ can_read: true, can_write: true }), 200)
    await expectStatus(await post({ can_read: true, can_write: false }), 200)

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

  test('clearing the last tick cannot forget a creator restriction', async ({ admin }) => {
    await setup(admin)
    await admin.post('/api/save_row', { table: 'Permission', row: {
      ref_table: DT, role: ROLE, operation: 'read', scope_mode: 'creator',
    } })
    const cleared = await admin.fetch(`/api/permissions/${encodeURIComponent(DT)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: ROLE }),
    })
    await expectStatus(cleared, 417)
    expect(await sql`select operation, scope_mode from permission where ref_table = ${DT} and role = ${ROLE}`)
      .toEqual([{ operation: 'read', scope_mode: 'creator' }])
  })

  test("an operation added beside an app's grant is on that app's install ledger", async ({ admin }) => {
    await setup(admin)
    const grant = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Permission', row: {
      ref_table: DT, role: ROLE, operation: 'read',
    } })
    await sql`insert into installed_app (name, tables, roles, perms, fixtures, sources) values
      ('ledger_app', '[]', '[]', ${sql.json([grant.row_id])}, '[]', '[]')`
    await sql`update permission set owner_app = 'ledger_app' where row_id = ${grant.row_id}`
    await admin.post(`/api/permissions/${encodeURIComponent(DT)}`, { role: ROLE, can_read: true, can_write: true })
    const [added] = await sql`select row_id, owner_app from permission where ref_table = ${DT} and role = ${ROLE} and operation = 'update'`
    expect(added.owner_app).toBe('ledger_app')
    const [{ perms }] = await sql`select perms from installed_app where name = 'ledger_app'`
    expect(perms).toEqual([grant.row_id, added.row_id])
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

  test('the matrix shows only basic Rows and will not revoke a grant another depends on', async ({ admin }) => {
    await setup(admin)
    const base = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Permission', row: { ref_table: DT, role: ROLE, operation: 'read' } })
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Matrix Detail' } })
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: DT, role: 'Matrix Detail', operation: 'read', column_rule: 'every', requires_permission: base.row_id } })
    const matrix = await admin.get<{ perms: { role: string; can_read: boolean }[] }>(`/api/permissions/${encodeURIComponent(DT)}`)
    expect(matrix.perms.find((p) => p.role === 'Matrix Detail')).toMatchObject({ can_read: false })
    const revoked = await admin.fetch(`/api/permissions/${encodeURIComponent(DT)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: ROLE, can_read: false }),
    })
    await expectStatus(revoked, 417)
    expect(((await revoked.json()) as { error: { message: string } }).error.message).toMatch(/Deeper access of Matrix Detail/)
    expect((await sql`select role from permission where ref_table = ${DT} order by role`).map((row) => row.role)).toEqual(['Matrix Detail', ROLE].sort())
  })

  test('is gated to System Managers (non-SM gets 403 on read and write)', async ({
    admin,
    createUser,
  }) => {
    await setup(admin)
    const nonSm = await createUser({ roles: [] }) // no System Manager
    const get = await nonSm.fetch(`/api/permissions/${encodeURIComponent(DT)}`)
    await expectStatus(get, 403)
    const post = await nonSm.fetch(`/api/permissions/${encodeURIComponent(DT)}`, {
      method: 'POST',
      body: JSON.stringify({ role: ROLE, can_read: true }),
    })
    await expectStatus(post, 403)
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
    await expectStatus(await holder.fetch(list), 403)
    await admin.post(`/api/permissions/${encodeURIComponent(DT)}`, { role: ROLE, can_read: true })
    await expectStatus(await holder.fetch(list), 200)
    await admin.post(`/api/permissions/${encodeURIComponent(DT)}`, { role: ROLE, can_read: false })
    await expectStatus(await holder.fetch(list), 403)
  })
})

import { describe, expect } from 'vitest'
import { test, patchDoc } from './pg-test'
import { createUserWithRole, expectApiError, makeTable, type TableRef } from './fixtures'
import type { TestClient } from 'feather-testing-postgres'

const DT = 'Perm Widget'
const ROLE = 'Perm Tester Role'

// Each test builds its world inside its own rolled-back transaction: the
// Table and one seeded row (as admin, for read tests). The role and its
// grants come from createUserWithRole, per test, because the grant IS what
// each test varies.
async function setup(admin: TestClient): Promise<TableRef> {
  const dt = await makeTable(admin, { name: DT, columns: ['title'] })
  await admin.post('/api/save_row', { table: DT, row: { title: 'seeded' } })
  return dt
}

describe('PERM-002/003: Permission grants enforced server-side', () => {
  test('no Permission rows -> restricted user gets 403 on read, create, list', async ({
    admin,
    createUser,
  }) => {
    const dt = await setup(admin)
    const user = await createUserWithRole(admin, createUser, { role: ROLE, table: [] })
    await expectApiError(user.get(dt.url), { status: 403 })
    await expectApiError(user.post(dt.url, { title: 'x' }), { status: 403 })
    await expectApiError(user.get(dt.metaUrl), { status: 403 })
  })

  test('read-only grant: GET works, POST/PUT/DELETE still 403', async ({ admin, createUser }) => {
    const dt = await setup(admin)
    const user = await createUserWithRole(admin, createUser, {
      role: ROLE,
      table: DT,
      can_read: true,
    })
    const list = await user.fetch(dt.listUrl({ fields: ['row_id', 'title'] }))
    expect(list.status).toBe(200)
    const { data } = (await list.json()) as { data: { row_id: string; title: string }[] }
    expect(data.length).toBeGreaterThan(0)
    const name = data[0].row_id

    await expectApiError(user.post(dt.url, { title: 'nope' }), { status: 403 })
    const doc = await user.get<Record<string, unknown>>(dt.rowUrl(name))
    await expectApiError(
      patchDoc(user, dt.rowUrl(name), { updated_at: doc.updated_at, title: 'edited' }),
      { status: 403 },
    )
    await expectApiError(user.delete(dt.rowUrl(name)), { status: 403 })
  })

  test('adding write+create grants unlocks exactly those actions', async ({
    admin,
    createUser,
  }) => {
    const dt = await setup(admin)
    const user = await createUserWithRole(admin, createUser, {
      role: ROLE,
      table: DT,
      can_read: true,
      can_write: true,
      can_create: true,
    })
    const created = await user.fetch(dt.url, {
      method: 'POST',
      body: JSON.stringify({ title: 'mine' }),
    })
    expect(created.status).toBe(201)
    const doc = (await created.json()) as Record<string, unknown>
    expect(doc.created_by).toBe(user.user)
    const put = await user.fetch(dt.rowUrl(String(doc.row_id)), {
      method: 'PATCH',
      body: JSON.stringify({ updated_at: doc.updated_at, title: 'mine2' }),
    })
    expect(put.status).toBe(200)
    // still no delete
    await expectApiError(user.delete(dt.rowUrl(String(doc.row_id))), { status: 403 })
  })

  test('restricted users cannot create Tables', async ({ admin, createUser }) => {
    await setup(admin)
    const user = await createUserWithRole(admin, createUser, { role: ROLE, table: [] })
    await expectApiError(
      user.post('/api/table_def', {
        name: 'Hax DT',
        columns: [{ column_name: 'x', column_type: 'Data' }],
      }),
      { status: 403 },
    )
  })
})

describe('PERM-009: Administrator bypass', () => {
  test('admin passes all checks on a Table with zero Permission rows', async ({ admin }) => {
    const dt = await setup(admin)
    const res = await admin.fetch(dt.url, {
      method: 'POST',
      body: JSON.stringify({ title: 'admin can' }),
    })
    expect(res.status).toBe(201)
    expect((await admin.fetch(dt.url)).status).toBe(200)
  })
})

describe("Roles decide what's possible", () => {
  test('a System Manager who is not the built-in Administrator can read, create, edit and delete on a table with no permissions', async ({
    admin,
    createUser,
  }) => {
    const dt = await setup(admin)
    const manager = await createUser({ roles: ['System Manager'] })
    const created = await manager.post<Record<string, unknown>>(dt.url, { title: 'by a manager' })
    const name = String(created.row_id)
    const list = await manager.get<{ data: { row_id: string }[] }>(dt.listUrl({ fields: ['row_id'] }))
    expect(list.data.map((r) => r.row_id)).toContain(name)
    const row = await manager.get<Record<string, unknown>>(dt.rowUrl(name))
    await patchDoc(manager, dt.rowUrl(name), { updated_at: row.updated_at, title: 'edited' })
    expect((await manager.get<Record<string, unknown>>(dt.rowUrl(name))).title).toBe('edited')
    // The edited row now has history, which blocks deleting it (#321); a
    // second, unedited row shows the manager may delete.
    const spare = String((await manager.post<Record<string, unknown>>(dt.url, { title: 'spare' })).row_id)
    expect((await manager.fetch(dt.rowUrl(spare), { method: 'DELETE' })).status).toBe(200)
    await expectApiError(manager.get(dt.rowUrl(spare)), { status: 404 })
  })
})

describe('Stored passwords and secrets never leave the server', () => {
  test("a System Manager opening or listing people never sees a stored password, and cannot ask for or set one", async ({
    admin,
  }) => {
    const { setUserPassword } = await import('../src/auth')
    const { sql } = await import('../src/db')
    const person = await admin.post<{ row_id: string }>('/api/save_row', {
      table: 'Person',
      row: { email: 'secret-holder@example.com' },
    })
    await setUserPassword(person.row_id, 'hunter2-secret')
    const [{ password_hash: stored }] = await sql`select password_hash from person where row_id = ${person.row_id}`

    const row = await admin.get<Record<string, unknown>>(`/api/table/Person/${person.row_id}`)
    expect(row).not.toHaveProperty('password_hash')
    expect(JSON.stringify(row)).not.toContain(String(stored))
    const list = await admin.get<{ data: Record<string, unknown>[] }>('/api/table/Person?limit_page_length=500')
    expect(JSON.stringify(list)).not.toContain(String(stored))
    await expect(
      admin.get(`/api/table/Person?fields=${encodeURIComponent('["row_id","password_hash"]')}`),
    ).rejects.toMatchObject({ status: 417 })
    await expect(
      admin.get(`/api/table/Person?filters=${encodeURIComponent('[["password_hash","is","set"]]')}`),
    ).rejects.toMatchObject({ status: 417 })

    // A write naming it is dropped, not saved.
    await patchDoc(admin, `/api/table/Person/${person.row_id}`, { updated_at: row.updated_at, password_hash: 'forged' })
    const [{ password_hash: after }] = await sql`select password_hash from person where row_id = ${person.row_id}`
    expect(after).toBe(stored)
  })
})

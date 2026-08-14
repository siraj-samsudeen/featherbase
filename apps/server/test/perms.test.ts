import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

const DT = 'Perm Widget'
const ROLE = 'Perm Tester Role'

// Each test builds its world inside its own rolled-back transaction: the
// Table, the role, and one seeded row (as admin, for read tests).
async function setup(admin: TestClient) {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [{ column_name: 'title', column_type: 'Data' }],
  })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: ROLE } })
  // seed one row as admin for read tests
  await admin.post('/api/save_row', { table: DT, row: { title: 'seeded' } })
}

async function grant(admin: TestClient, perms: Record<string, boolean>) {
  const doc = await admin.post<{ row_id: string }>('/api/save_row', {
    table: 'Permission',
    row: { ref_table: DT, role: ROLE, ...perms },
  })
  return doc.row_id
}

describe('PERM-002/003: Permission grants enforced server-side', () => {
  test('no Permission rows -> restricted user gets 403 on read, create, list', async ({
    admin,
    createUser,
  }) => {
    await setup(admin)
    const user = await createUser({ roles: [ROLE] })
    expect((await user.fetch(`/api/table/${encodeURIComponent(DT)}`)).status).toBe(403)
    expect(
      (
        await user.fetch(`/api/table/${encodeURIComponent(DT)}`, {
          method: 'POST',
          body: JSON.stringify({ title: 'x' }),
        })
      ).status,
    ).toBe(403)
    expect((await user.fetch(`/api/table/${encodeURIComponent(DT)}:meta`)).status).toBe(403)
  })

  test('read-only grant: GET works, POST/PUT/DELETE still 403', async ({ admin, createUser }) => {
    await setup(admin)
    const user = await createUser({ roles: [ROLE] })
    await grant(admin, { can_read: true })
    const list = await user.fetch(
      `/api/table/${encodeURIComponent(DT)}?fields=${encodeURIComponent('["row_id","title"]')}`,
    )
    expect(list.status).toBe(200)
    const { data } = (await list.json()) as { data: { row_id: string; title: string }[] }
    expect(data.length).toBeGreaterThan(0)
    const name = data[0].row_id

    expect(
      (
        await user.fetch(`/api/table/${encodeURIComponent(DT)}`, {
          method: 'POST',
          body: JSON.stringify({ title: 'nope' }),
        })
      ).status,
    ).toBe(403)
    const doc = (await (await user.fetch(`/api/table/${encodeURIComponent(DT)}/${name}`)).json()) as
      Record<string, unknown>
    expect(
      (
        await user.fetch(`/api/table/${encodeURIComponent(DT)}/${name}`, {
          method: 'PATCH',
          body: JSON.stringify({ updated_at: doc.updated_at, title: 'edited' }),
        })
      ).status,
    ).toBe(403)
    expect(
      (await user.fetch(`/api/table/${encodeURIComponent(DT)}/${name}`, { method: 'DELETE' }))
        .status,
    ).toBe(403)
  })

  test('adding write+create grants unlocks exactly those actions', async ({
    admin,
    createUser,
  }) => {
    await setup(admin)
    const user = await createUser({ roles: [ROLE] })
    await grant(admin, { can_read: true, can_write: true, can_create: true })
    const created = await user.fetch(`/api/table/${encodeURIComponent(DT)}`, {
      method: 'POST',
      body: JSON.stringify({ title: 'mine' }),
    })
    expect(created.status).toBe(201)
    const doc = (await created.json()) as Record<string, unknown>
    expect(doc.created_by).toBe(user.user)
    const put = await user.fetch(`/api/table/${encodeURIComponent(DT)}/${doc.row_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ updated_at: doc.updated_at, title: 'mine2' }),
    })
    expect(put.status).toBe(200)
    // still no delete
    expect(
      (await user.fetch(`/api/table/${encodeURIComponent(DT)}/${doc.row_id}`, { method: 'DELETE' }))
        .status,
    ).toBe(403)
  })

  test('restricted users cannot create Tables', async ({ admin, createUser }) => {
    await setup(admin)
    const user = await createUser({ roles: [ROLE] })
    const res = await user.fetch('/api/table_def', {
      method: 'POST',
      body: JSON.stringify({ name: 'Hax DT', columns: [{ column_name: 'x', column_type: 'Data' }] }),
    })
    expect(res.status).toBe(403)
  })
})

describe('PERM-009: Administrator bypass', () => {
  test('admin passes all checks on a Table with zero Permission rows', async ({ admin }) => {
    await setup(admin)
    const res = await admin.fetch(`/api/table/${encodeURIComponent(DT)}`, {
      method: 'POST',
      body: JSON.stringify({ title: 'admin can' }),
    })
    expect(res.status).toBe(201)
    expect((await admin.fetch(`/api/table/${encodeURIComponent(DT)}`)).status).toBe(200)
  })
})

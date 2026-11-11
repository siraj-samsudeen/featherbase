import { describe, expect } from 'vitest'
import { test, patchDoc } from './pg-test'
import { createUserWithRole, expectApiError, expectRefused, expectStatus, makeTable, type TableRef } from './fixtures'
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
    await expectRefused(user.get(dt.url), 403)
    await expectRefused(user.post(dt.url, { title: 'x' }), 403)
    await expectRefused(user.get(dt.metaUrl), 403)
  })

  test('read-only grant: GET works, POST/PUT/DELETE still 403', async ({ admin, createUser }) => {
    const dt = await setup(admin)
    const user = await createUserWithRole(admin, createUser, {
      role: ROLE,
      table: DT,
      can_read: true,
    })
    const list = await user.fetch(dt.listUrl({ fields: ['row_id', 'title'] }))
    await expectStatus(list, 200)
    const { data } = (await list.json()) as { data: { row_id: string; title: string }[] }
    expect(data.length).toBeGreaterThan(0)
    const name = data[0].row_id

    await expectRefused(user.post(dt.url, { title: 'nope' }), 403)
    const doc = await user.get<Record<string, unknown>>(dt.rowUrl(name))
    await expectApiError(
      patchDoc(user, dt.rowUrl(name), { updated_at: doc.updated_at, title: 'edited' }),
      { status: 403 },
    )
    await expectRefused(user.delete(dt.rowUrl(name)), 403)
  })

  test('adding write+create grants unlocks creating and editing', async ({
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
    await expectStatus(created, 201)
    const doc = (await created.json()) as Record<string, unknown>
    expect(doc.created_by).toBe(user.user)
    const put = await user.fetch(dt.rowUrl(String(doc.row_id)), {
      method: 'PATCH',
      body: JSON.stringify({ updated_at: doc.updated_at, title: 'mine2' }),
    })
    await expectStatus(put, 200)
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
    await expectStatus(res, 201)
    await expectStatus(await admin.fetch(dt.url), 200)
  })
})

describe('Stored passwords and secrets never leave the server', () => {
  test('a write naming the stored password is dropped, not saved', async ({
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
    await patchDoc(admin, `/api/table/Person/${person.row_id}`, { updated_at: row.updated_at, password_hash: 'forged' })
    const [{ password_hash: after }] = await sql`select password_hash from person where row_id = ${person.row_id}`
    expect(after).toBe(stored)
  })
})

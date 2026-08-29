import { describe, expect } from 'vitest'
import { test, patchDoc } from './pg-test'
import { createUserWithRole, expectApiError, grantRole, makeTable, type TableRef } from './fixtures'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'

const DT = 'Own Note'
const ROLE = 'Own Role'

// Per-test world: Table, role, the own_rows_only grant (read/write/create/
// delete only on own docs), and two users — all rolled back with the test.
async function setup(
  admin: TestClient,
  createUser: CreateUserFn,
): Promise<{ dt: TableRef; alice: TestClient; bob: TestClient }> {
  const dt = await makeTable(admin, { name: DT, columns: ['t'] })
  // own_rows_only grant: read/write/create/delete only on own docs
  const alice = await createUserWithRole(admin, createUser, {
    role: ROLE,
    table: DT,
    own_rows_only: true,
    can_read: true,
    can_write: true,
    can_create: true,
    can_delete: true,
  })
  const bob = await createUser({ roles: [ROLE] })
  return { dt, alice, bob }
}

describe('PERM-007: own_rows_only permissions', () => {
  test('users see only their own docs in lists and detail; cannot touch others', async ({
    admin,
    createUser,
  }) => {
    const { dt, alice, bob } = await setup(admin, createUser)

    const mine = await alice.post<Record<string, unknown>>(dt.url, { t: 'alice doc' })
    expect(mine.created_by).toBe(alice.user)
    await bob.post(dt.url, { t: 'bob doc' })

    // List: alice sees exactly her one doc
    const list = await alice.get<{ data: { created_by: string }[]; total: number }>(
      dt.listUrl({ fields: ['row_id', 'created_by'] }),
    )
    expect(list.total).toBe(1)
    expect(list.data[0].created_by).toBe(alice.user)

    // Detail: own doc 200, other's 403
    expect((await alice.fetch(dt.rowUrl(String(mine.row_id)))).status).toBe(200)
    const bobList = await bob.get<{ data: { row_id: string }[] }>(
      dt.listUrl({ fields: ['row_id'] }),
    )
    const bobDoc = bobList.data[0].row_id
    await expectApiError(alice.get(dt.rowUrl(bobDoc)), { status: 403 })

    // Write/delete on other's doc 403; on own doc allowed
    await expectApiError(
      patchDoc(alice, dt.rowUrl(bobDoc), { updated_at: new Date().toISOString(), t: 'hax' }),
      { status: 403 },
    )
    await expectApiError(alice.delete(dt.rowUrl(bobDoc)), { status: 403 })
    const own = await alice.get<Record<string, unknown>>(dt.rowUrl(String(mine.row_id)))
    expect(
      (
        await alice.fetch(dt.rowUrl(String(mine.row_id)), {
          method: 'PATCH',
          body: JSON.stringify({ updated_at: own.updated_at, t: 'mine v2' }),
        })
      ).status,
    ).toBe(200)
    expect(
      (await alice.fetch(dt.rowUrl(String(mine.row_id)), { method: 'DELETE' })).status,
    ).toBe(200)
  })

  test('an unconditional grant overrides own_rows_only rows', async ({ admin, createUser }) => {
    const { dt, alice, bob } = await setup(admin, createUser)
    await bob.post(dt.url, { t: 'bob doc' })
    await grantRole(admin, { role: ROLE, table: DT, can_read: true })
    const list = await alice.get<{ total: number }>(
      dt.listUrl({ fields: ['row_id', 'created_by'] }),
    )
    expect(list.total).toBeGreaterThanOrEqual(1) // sees bob's doc now too
  })
})

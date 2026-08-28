import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { expectApiError, grantRole, makeTable, type TableRef } from './fixtures'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'

const TARGET = 'Ls Target'
const ROLE = 'Ls Role'

// The exact query shape a Link autocomplete issues.
const searchQs = (target: TableRef, q: string) =>
  target.listUrl({
    filters: [['row_id', 'like', `%${q}%`]],
    fields: ['row_id'],
    limit_page_length: 10,
  })

// Per-test world: the target Table, the role, and two users.
async function setup(
  admin: TestClient,
  createUser: CreateUserFn,
): Promise<{ target: TableRef; alice: TestClient; bob: TestClient }> {
  const target = await makeTable(admin, {
    name: TARGET,
    id_pattern: 'prompt',
    columns: ['note'],
  })
  await grantRole(admin, { role: ROLE, table: [] })
  const alice = await createUser({ roles: [ROLE] })
  const bob = await createUser({ roles: [ROLE] })
  return { target, alice, bob }
}

// The own_rows_only grant plus one doc owned by each user.
async function grantOwnRowsOnlyAndSeed(
  admin: TestClient,
  target: TableRef,
  alice: TestClient,
  bob: TestClient,
) {
  await grantRole(admin, {
    role: ROLE,
    table: TARGET,
    own_rows_only: true,
    can_read: true,
    can_create: true,
  })
  await alice.post(target.url, { row_id: 'doc-alice', note: 'a' })
  await bob.post(target.url, { row_id: 'doc-bob', note: 'b' })
}

describe('PERM-010: link-field search is permission-filtered', () => {
  test('no read permission -> search is 403, not an empty leak-free 200 pretending', async ({
    admin,
    createUser,
  }) => {
    const { target, alice } = await setup(admin, createUser)
    await expectApiError(alice.get(searchQs(target, 'doc')), { status: 403 })
  })

  test('own_rows_only read -> search returns only own docs', async ({ admin, createUser }) => {
    const { target, alice, bob } = await setup(admin, createUser)
    await grantOwnRowsOnlyAndSeed(admin, target, alice, bob)
    const res = await alice.get<{ data: { row_id: string }[]; total: number }>(
      searchQs(target, 'doc'),
    )
    expect(res.total).toBe(1)
    expect(res.data[0].row_id).toBe('doc-alice')
  })

  test('data scopes further restrict search results', async ({ admin, createUser }) => {
    const { target, alice, bob } = await setup(admin, createUser)
    await grantOwnRowsOnlyAndSeed(admin, target, alice, bob)
    // lift own_rows_only: grant unconditional read, then pin BOB to doc-alice only
    await grantRole(admin, { role: ROLE, table: TARGET, can_read: true })
    await admin.post('/api/save_row', {
      table: 'Data Scope',
      row: { user: bob.user, allow_table: TARGET, for_value: 'doc-alice' },
    })
    const bobRes = await bob.get<{ data: { row_id: string }[]; total: number }>(
      searchQs(target, 'doc'),
    )
    expect(bobRes.total).toBe(1)
    expect(bobRes.data[0].row_id).toBe('doc-alice')

    // alice (no data scopes, unconditional read) sees both
    const aliceRes = await alice.get<{ total: number }>(searchQs(target, 'doc'))
    expect(aliceRes.total).toBe(2)
  })
})

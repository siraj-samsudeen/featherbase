import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

const TARGET = 'Ls Target'
const ROLE = 'Ls Role'

// The exact query shape a Link autocomplete issues.
const searchQs = (q: string) =>
  `/api/table/${encodeURIComponent(TARGET)}?${new URLSearchParams({
    filters: JSON.stringify([['row_id', 'like', `%${q}%`]]),
    fields: JSON.stringify(['row_id']),
    limit_page_length: '10',
  })}`

// Per-test world: the target Table, the role, and two users.
async function setup(
  admin: TestClient,
  createUser: (o?: { roles?: string[] }) => Promise<TestClient>,
) {
  await admin.post('/api/table_def', {
    name: TARGET,
    id_pattern: 'prompt',
    columns: [{ column_name: 'note', column_type: 'Data' }],
  })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: ROLE } })
  const alice = await createUser({ roles: [ROLE] })
  const bob = await createUser({ roles: [ROLE] })
  return { alice, bob }
}

// The own_rows_only grant plus one doc owned by each user.
async function grantOwnRowsOnlyAndSeed(admin: TestClient, alice: TestClient, bob: TestClient) {
  await admin.post('/api/save_row', {
    table: 'Permission',
    row: { ref_table: TARGET, role: ROLE, own_rows_only: true, can_read: true, can_create: true },
  })
  await alice.fetch(`/api/table/${encodeURIComponent(TARGET)}`, {
    method: 'POST',
    body: JSON.stringify({ row_id: 'doc-alice', note: 'a' }),
  })
  await bob.fetch(`/api/table/${encodeURIComponent(TARGET)}`, {
    method: 'POST',
    body: JSON.stringify({ row_id: 'doc-bob', note: 'b' }),
  })
}

describe('PERM-010: link-field search is permission-filtered', () => {
  test('no read permission -> search is 403, not an empty leak-free 200 pretending', async ({
    admin,
    createUser,
  }) => {
    const { alice } = await setup(admin, createUser)
    expect((await alice.fetch(searchQs('doc'))).status).toBe(403)
  })

  test('own_rows_only read -> search returns only own docs', async ({ admin, createUser }) => {
    const { alice, bob } = await setup(admin, createUser)
    await grantOwnRowsOnlyAndSeed(admin, alice, bob)
    const res = (await (await alice.fetch(searchQs('doc'))).json()) as {
      data: { row_id: string }[]
      total: number
    }
    expect(res.total).toBe(1)
    expect(res.data[0].row_id).toBe('doc-alice')
  })

  test('data scopes further restrict search results', async ({ admin, createUser }) => {
    const { alice, bob } = await setup(admin, createUser)
    await grantOwnRowsOnlyAndSeed(admin, alice, bob)
    // lift own_rows_only: grant unconditional read, then pin BOB to doc-alice only
    await admin.post('/api/save_row', {
      table: 'Permission',
      row: { ref_table: TARGET, role: ROLE, can_read: true },
    })
    await admin.post('/api/save_row', {
      table: 'Data Scope',
      row: { user: bob.user, allow_table: TARGET, for_value: 'doc-alice' },
    })
    const bobRes = (await (await bob.fetch(searchQs('doc'))).json()) as {
      data: { row_id: string }[]
      total: number
    }
    expect(bobRes.total).toBe(1)
    expect(bobRes.data[0].row_id).toBe('doc-alice')

    // alice (no data scopes, unconditional read) sees both
    const aliceRes = (await (await alice.fetch(searchQs('doc'))).json()) as { total: number }
    expect(aliceRes.total).toBe(2)
  })
})

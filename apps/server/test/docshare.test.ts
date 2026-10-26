import { describe, expect } from 'vitest'
import { test, patchDoc } from './pg-test'
import { expectApiError, makeTable, tableRef, type TableRef } from './fixtures'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'

const DT = 'Sh Memo'
const SHARE = tableRef('Share')

// Per-test world. NOTE: no Permission rows for DT at all -> user has zero role
// access; only Share rows can grant anything.
async function setup(
  admin: TestClient,
  createUser: CreateUserFn,
): Promise<{ user: TestClient; dt: TableRef; docName: string }> {
  const dt = await makeTable(admin, { name: DT, columns: ['body'] })
  const user = await createUser({ roles: [] })
  const doc = await admin.post<Record<string, unknown>>(dt.url, { body: 'secret memo' })
  return { user, dt, docName: String(doc.row_id) }
}

async function share(
  admin: TestClient,
  user: TestClient,
  docName: string,
  perms: Record<string, boolean>,
) {
  const doc = await admin.post<{ row_id: string }>('/api/save_row', {
    table: SHARE.name,
    row: { share_table: DT, share_name: docName, person: user.user, ...perms },
  })
  return String(doc.row_id)
}

describe('PERM-008: Share', () => {
  test('without a share, the user cannot read the doc (no role perms)', async ({
    admin,
    createUser,
  }) => {
    const { user, dt, docName } = await setup(admin, createUser)
    await expectApiError(user.get(dt.rowUrl(docName)), { status: 403 })
  })

  test('a read-share grants access to that one doc without role changes', async ({
    admin,
    createUser,
  }) => {
    const { user, dt, docName } = await setup(admin, createUser)
    await share(admin, user, docName, { read: true })

    const res = await user.fetch(dt.rowUrl(docName))
    expect(res.status).toBe(200)
    expect(((await res.json()) as Record<string, unknown>).body).toBe('secret memo')

    // read-only share: cannot write
    const doc = await admin.get<Record<string, unknown>>(dt.rowUrl(docName))
    await expectApiError(
      patchDoc(user, dt.rowUrl(docName), { updated_at: doc.updated_at, body: 'hacked' }),
      { status: 403 },
    )
  })

  test('a write-share allows editing that doc', async ({ admin, createUser }) => {
    const { user, dt, docName } = await setup(admin, createUser)
    const shareName = await share(admin, user, docName, { read: true })
    await patchDoc(admin, SHARE.rowUrl(shareName), {
      updated_at: (await admin.get<{ updated_at: string }>(SHARE.rowUrl(shareName))).updated_at,
      write: true,
    })
    const doc = await admin.get<Record<string, unknown>>(dt.rowUrl(docName))
    const write = await user.fetch(dt.rowUrl(docName), {
      method: 'PATCH',
      body: JSON.stringify({ updated_at: doc.updated_at, body: 'edited by sharee' }),
    })
    expect(write.status).toBe(200)
    const after = await admin.get<Record<string, unknown>>(dt.rowUrl(docName))
    expect(after.body).toBe('edited by sharee')
  })

  test('unsharing revokes access', async ({ admin, createUser }) => {
    const { user, dt, docName } = await setup(admin, createUser)
    const shareName = await share(admin, user, docName, { read: true, write: true })
    await admin.delete(SHARE.rowUrl(shareName))
    await expectApiError(user.get(dt.rowUrl(docName)), { status: 403 })
  })
})

describe('A single row can be shared beyond its role grants', () => {
  test('a write-share opens that one row for editing and no other row on the table', async ({
    admin,
    createUser,
  }) => {
    const { user, dt, docName } = await setup(admin, createUser)
    const other = await admin.post<Record<string, unknown>>(dt.url, { body: 'another memo' })
    await share(admin, user, docName, { read: true, write: true })

    const shared = await admin.get<Record<string, unknown>>(dt.rowUrl(docName))
    await patchDoc(user, dt.rowUrl(docName), { updated_at: shared.updated_at, body: 'edited by sharee' })
    expect((await admin.get<Record<string, unknown>>(dt.rowUrl(docName))).body).toBe('edited by sharee')

    await expectApiError(user.get(dt.rowUrl(String(other.row_id))), { status: 403 })
    await expectApiError(
      patchDoc(user, dt.rowUrl(String(other.row_id)), { updated_at: other.updated_at, body: 'not mine' }),
      { status: 403 },
    )
    expect((await admin.get<Record<string, unknown>>(dt.rowUrl(String(other.row_id)))).body).toBe('another memo')
  })
})

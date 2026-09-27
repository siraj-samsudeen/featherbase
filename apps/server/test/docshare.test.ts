import { describe, expect } from 'vitest'
import { test, patchDoc } from './pg-test'
import { expectApiError, grantRole, makeTable, tableRef, type TableRef } from './fixtures'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'

const DT = 'Sh Memo'
const SHARE = tableRef('Share')

// Per-test world. NOTE: no Permission rows for DT at all -> user has zero role
// access; only Share rows can grant anything.
async function setup(
  admin: TestClient,
  createUser: CreateUserFn,
): Promise<{ user: TestClient; dt: TableRef; docName: string }> {
  const dt = await makeTable(admin, {
    name: DT,
    columns: [
      'body',
      { column_name: 'private_note', column_type: 'Data', tier: 'restricted' },
    ],
  })
  const user = await createUser({ roles: [] })
  const doc = await admin.post<Record<string, unknown>>(dt.url, {
    body: 'shared memo',
    private_note: 'directors only',
  })
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
    row: { share_table: DT, share_name: docName, user: user.user, ...perms },
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
    expect(((await res.json()) as Record<string, unknown>).body).toBe('shared memo')

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

  test('a share grants basic fields but neither reads nor writes restricted fields', async ({
    admin,
    createUser,
  }) => {
    const { user, dt, docName } = await setup(admin, createUser)
    await share(admin, user, docName, { read: true, write: true })

    const shared = await user.get<Record<string, unknown>>(dt.rowUrl(docName))
    expect(shared.body).toBe('shared memo')
    expect('private_note' in shared).toBe(false)

    const response = await patchDoc<Record<string, unknown>>(user, dt.rowUrl(docName), {
      updated_at: shared.updated_at,
      body: 'sharee edit',
      private_note: 'sharee leak',
    })
    expect(response.body).toBe('sharee edit')
    expect('private_note' in response).toBe(false)
    const after = await admin.get<Record<string, unknown>>(dt.rowUrl(docName))
    expect(after.body).toBe('sharee edit')
    expect(after.private_note).toBe('directors only')
  })

  test('a share preserves a restricted tier granted independently by role', async ({
    admin,
    createUser,
  }) => {
    const { dt, docName } = await setup(admin, createUser)
    await grantRole(admin, {
      role: 'Sh Restricted Role',
      table: DT,
      tier: 'restricted',
      can_read: true,
      can_write: true,
    })
    const elevated = await createUser({ roles: ['Sh Restricted Role'] })
    await share(admin, elevated, docName, { read: true, write: true })

    const shared = await elevated.get<Record<string, unknown>>(dt.rowUrl(docName))
    expect(shared.private_note).toBe('directors only')
    await patchDoc(elevated, dt.rowUrl(docName), {
      updated_at: shared.updated_at,
      private_note: 'approved update',
    })
    const after = await admin.get<Record<string, unknown>>(dt.rowUrl(docName))
    expect(after.private_note).toBe('approved update')
  })

  test('unsharing revokes access', async ({ admin, createUser }) => {
    const { user, dt, docName } = await setup(admin, createUser)
    const shareName = await share(admin, user, docName, { read: true, write: true })
    await admin.delete(SHARE.rowUrl(shareName))
    await expectApiError(user.get(dt.rowUrl(docName)), { status: 403 })
  })
})

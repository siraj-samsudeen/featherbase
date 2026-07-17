import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

const TARGET = 'Ls Target'
const ROLE = 'Ls Role'

// The exact query shape a Link autocomplete issues.
const searchQs = (q: string) =>
  `/api/resource/${encodeURIComponent(TARGET)}?${new URLSearchParams({
    filters: JSON.stringify([['name', 'like', `%${q}%`]]),
    fields: JSON.stringify(['name']),
    limit_page_length: '10',
  })}`

// Per-test world: the target DocType, the role, and two users.
async function setup(
  admin: TestClient,
  createUser: (o?: { roles?: string[] }) => Promise<TestClient>,
) {
  await admin.post('/api/doctype', {
    name: TARGET,
    autoname: 'prompt',
    fields: [{ fieldname: 'note', fieldtype: 'Data' }],
  })
  await admin.post('/api/save_doc', { doctype: 'Role', doc: { name: ROLE } })
  const alice = await createUser({ roles: [ROLE] })
  const bob = await createUser({ roles: [ROLE] })
  return { alice, bob }
}

// The if_owner grant plus one doc owned by each user.
async function grantIfOwnerAndSeed(admin: TestClient, alice: TestClient, bob: TestClient) {
  await admin.post('/api/save_doc', {
    doctype: 'DocPerm',
    doc: { ref_doctype: TARGET, role: ROLE, if_owner: true, can_read: true, can_create: true },
  })
  await alice.fetch(`/api/resource/${encodeURIComponent(TARGET)}`, {
    method: 'POST',
    body: JSON.stringify({ name: 'doc-alice', note: 'a' }),
  })
  await bob.fetch(`/api/resource/${encodeURIComponent(TARGET)}`, {
    method: 'POST',
    body: JSON.stringify({ name: 'doc-bob', note: 'b' }),
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

  test('if_owner read -> search returns only own docs', async ({ admin, createUser }) => {
    const { alice, bob } = await setup(admin, createUser)
    await grantIfOwnerAndSeed(admin, alice, bob)
    const res = (await (await alice.fetch(searchQs('doc'))).json()) as {
      data: { name: string }[]
      total: number
    }
    expect(res.total).toBe(1)
    expect(res.data[0].name).toBe('doc-alice')
  })

  test('user permissions further restrict search results', async ({ admin, createUser }) => {
    const { alice, bob } = await setup(admin, createUser)
    await grantIfOwnerAndSeed(admin, alice, bob)
    // lift if_owner: grant unconditional read, then pin BOB to doc-alice only
    await admin.post('/api/save_doc', {
      doctype: 'DocPerm',
      doc: { ref_doctype: TARGET, role: ROLE, can_read: true },
    })
    await admin.post('/api/save_doc', {
      doctype: 'User Permission',
      doc: { user: bob.user, allow: TARGET, for_value: 'doc-alice' },
    })
    const bobRes = (await (await bob.fetch(searchQs('doc'))).json()) as {
      data: { name: string }[]
      total: number
    }
    expect(bobRes.total).toBe(1)
    expect(bobRes.data[0].name).toBe('doc-alice')

    // alice (no user perms, unconditional read) sees both
    const aliceRes = (await (await alice.fetch(searchQs('doc'))).json()) as { total: number }
    expect(aliceRes.total).toBe(2)
  })
})

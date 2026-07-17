import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

const DT = 'Own Note'
const ROLE = 'Own Role'

// Per-test world: DocType, role, the if_owner grant (read/write/create/delete
// only on own docs), and two users — all rolled back with the test.
async function setup(admin: TestClient, createUser: (o?: { roles?: string[] }) => Promise<TestClient>) {
  await admin.post('/api/doctype', {
    name: DT,
    fields: [{ fieldname: 't', fieldtype: 'Data' }],
  })
  await admin.post('/api/save_doc', { doctype: 'Role', doc: { name: ROLE } })
  // if_owner grant: read/write/create/delete only on own docs
  await admin.post('/api/save_doc', {
    doctype: 'DocPerm',
    doc: {
      ref_doctype: DT,
      role: ROLE,
      if_owner: true,
      can_read: true,
      can_write: true,
      can_create: true,
      can_delete: true,
    },
  })
  const alice = await createUser({ roles: [ROLE] })
  const bob = await createUser({ roles: [ROLE] })
  return { alice, bob }
}

describe('PERM-007: if_owner permissions', () => {
  test('users see only their own docs in lists and detail; cannot touch others', async ({
    admin,
    createUser,
  }) => {
    const { alice, bob } = await setup(admin, createUser)

    const mine = (await (
      await alice.fetch(`/api/resource/${encodeURIComponent(DT)}`, {
        method: 'POST',
        body: JSON.stringify({ t: 'alice doc' }),
      })
    ).json()) as Record<string, unknown>
    expect(mine.owner).toBe(alice.user)
    await bob.fetch(`/api/resource/${encodeURIComponent(DT)}`, {
      method: 'POST',
      body: JSON.stringify({ t: 'bob doc' }),
    })

    // List: alice sees exactly her one doc
    const list = (await (
      await alice.fetch(
        `/api/resource/${encodeURIComponent(DT)}?fields=${encodeURIComponent('["name","owner"]')}`,
      )
    ).json()) as { data: { owner: string }[]; total: number }
    expect(list.total).toBe(1)
    expect(list.data[0].owner).toBe(alice.user)

    // Detail: own doc 200, other's 403
    expect((await alice.fetch(`/api/resource/${encodeURIComponent(DT)}/${mine.name}`)).status).toBe(200)
    const bobList = (await (
      await bob.fetch(`/api/resource/${encodeURIComponent(DT)}?fields=${encodeURIComponent('["name"]')}`)
    ).json()) as { data: { name: string }[] }
    const bobDoc = bobList.data[0].name
    expect((await alice.fetch(`/api/resource/${encodeURIComponent(DT)}/${bobDoc}`)).status).toBe(403)

    // Write/delete on other's doc 403; on own doc allowed
    expect(
      (
        await alice.fetch(`/api/resource/${encodeURIComponent(DT)}/${bobDoc}`, {
          method: 'PUT',
          body: JSON.stringify({ modified: new Date().toISOString(), t: 'hax' }),
        })
      ).status,
    ).toBe(403)
    expect(
      (await alice.fetch(`/api/resource/${encodeURIComponent(DT)}/${bobDoc}`, { method: 'DELETE' }))
        .status,
    ).toBe(403)
    const own = (await (
      await alice.fetch(`/api/resource/${encodeURIComponent(DT)}/${mine.name}`)
    ).json()) as Record<string, unknown>
    expect(
      (
        await alice.fetch(`/api/resource/${encodeURIComponent(DT)}/${mine.name}`, {
          method: 'PUT',
          body: JSON.stringify({ modified: own.modified, t: 'mine v2' }),
        })
      ).status,
    ).toBe(200)
    expect(
      (await alice.fetch(`/api/resource/${encodeURIComponent(DT)}/${mine.name}`, { method: 'DELETE' }))
        .status,
    ).toBe(200)
  })

  test('an unconditional grant overrides if_owner rows', async ({ admin, createUser }) => {
    const { alice, bob } = await setup(admin, createUser)
    await bob.fetch(`/api/resource/${encodeURIComponent(DT)}`, {
      method: 'POST',
      body: JSON.stringify({ t: 'bob doc' }),
    })
    await admin.post('/api/save_doc', {
      doctype: 'DocPerm',
      doc: { ref_doctype: DT, role: ROLE, can_read: true },
    })
    const list = (await (
      await alice.fetch(
        `/api/resource/${encodeURIComponent(DT)}?fields=${encodeURIComponent('["name","owner"]')}`,
      )
    ).json()) as { total: number }
    expect(list.total).toBeGreaterThanOrEqual(1) // sees bob's doc now too
  })
})

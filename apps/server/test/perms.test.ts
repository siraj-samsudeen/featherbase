import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

const DT = 'Perm Widget'
const ROLE = 'Perm Tester Role'

// Each test builds its world inside its own rolled-back transaction: the
// DocType, the role, and one seeded row (as admin, for read tests).
async function setup(admin: TestClient) {
  await admin.post('/api/doctype', {
    name: DT,
    fields: [{ fieldname: 'title', fieldtype: 'Data' }],
  })
  await admin.post('/api/save_doc', { doctype: 'Role', doc: { name: ROLE } })
  // seed one row as admin for read tests
  await admin.post('/api/save_doc', { doctype: DT, doc: { title: 'seeded' } })
}

async function grant(admin: TestClient, perms: Record<string, boolean>) {
  const doc = await admin.post<{ name: string }>('/api/save_doc', {
    doctype: 'DocPerm',
    doc: { ref_doctype: DT, role: ROLE, ...perms },
  })
  return doc.name
}

describe('PERM-002/003: DocPerm grants enforced server-side', () => {
  test('no DocPerm rows -> restricted user gets 403 on read, create, list', async ({
    admin,
    createUser,
  }) => {
    await setup(admin)
    const user = await createUser({ roles: [ROLE] })
    expect((await user.fetch(`/api/resource/${encodeURIComponent(DT)}`)).status).toBe(403)
    expect(
      (
        await user.fetch(`/api/resource/${encodeURIComponent(DT)}`, {
          method: 'POST',
          body: JSON.stringify({ title: 'x' }),
        })
      ).status,
    ).toBe(403)
    expect((await user.fetch(`/api/meta/${encodeURIComponent(DT)}`)).status).toBe(403)
  })

  test('read-only grant: GET works, POST/PUT/DELETE still 403', async ({ admin, createUser }) => {
    await setup(admin)
    const user = await createUser({ roles: [ROLE] })
    await grant(admin, { can_read: true })
    const list = await user.fetch(
      `/api/resource/${encodeURIComponent(DT)}?fields=${encodeURIComponent('["name","title"]')}`,
    )
    expect(list.status).toBe(200)
    const { data } = (await list.json()) as { data: { name: string; title: string }[] }
    expect(data.length).toBeGreaterThan(0)
    const name = data[0].name

    expect(
      (
        await user.fetch(`/api/resource/${encodeURIComponent(DT)}`, {
          method: 'POST',
          body: JSON.stringify({ title: 'nope' }),
        })
      ).status,
    ).toBe(403)
    const doc = (await (await user.fetch(`/api/resource/${encodeURIComponent(DT)}/${name}`)).json()) as
      Record<string, unknown>
    expect(
      (
        await user.fetch(`/api/resource/${encodeURIComponent(DT)}/${name}`, {
          method: 'PUT',
          body: JSON.stringify({ modified: doc.modified, title: 'edited' }),
        })
      ).status,
    ).toBe(403)
    expect(
      (await user.fetch(`/api/resource/${encodeURIComponent(DT)}/${name}`, { method: 'DELETE' }))
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
    const created = await user.fetch(`/api/resource/${encodeURIComponent(DT)}`, {
      method: 'POST',
      body: JSON.stringify({ title: 'mine' }),
    })
    expect(created.status).toBe(201)
    const doc = (await created.json()) as Record<string, unknown>
    expect(doc.owner).toBe(user.user)
    const put = await user.fetch(`/api/resource/${encodeURIComponent(DT)}/${doc.name}`, {
      method: 'PUT',
      body: JSON.stringify({ modified: doc.modified, title: 'mine2' }),
    })
    expect(put.status).toBe(200)
    // still no delete
    expect(
      (await user.fetch(`/api/resource/${encodeURIComponent(DT)}/${doc.name}`, { method: 'DELETE' }))
        .status,
    ).toBe(403)
  })

  test('restricted users cannot create DocTypes', async ({ admin, createUser }) => {
    await setup(admin)
    const user = await createUser({ roles: [ROLE] })
    const res = await user.fetch('/api/doctype', {
      method: 'POST',
      body: JSON.stringify({ name: 'Hax DT', fields: [{ fieldname: 'x', fieldtype: 'Data' }] }),
    })
    expect(res.status).toBe(403)
  })
})

describe('PERM-009: Administrator bypass', () => {
  test('admin passes all checks on a DocType with zero DocPerm rows', async ({ admin }) => {
    await setup(admin)
    const res = await admin.fetch(`/api/resource/${encodeURIComponent(DT)}`, {
      method: 'POST',
      body: JSON.stringify({ title: 'admin can' }),
    })
    expect(res.status).toBe(201)
    expect((await admin.fetch(`/api/resource/${encodeURIComponent(DT)}`)).status).toBe(200)
  })
})

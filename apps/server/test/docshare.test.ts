import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

const DT = 'Sh Memo'

// Per-test world. NOTE: no DocPerm rows for DT at all -> user has zero role
// access; only DocShare rows can grant anything.
async function setup(
  admin: TestClient,
  createUser: (o?: { roles?: string[] }) => Promise<TestClient>,
) {
  await admin.post('/api/doctype', {
    name: DT,
    fields: [{ fieldname: 'body', fieldtype: 'Data' }],
  })
  const user = await createUser({ roles: [] })
  const doc = (await (
    await admin.fetch(`/api/resource/${encodeURIComponent(DT)}`, {
      method: 'POST',
      body: JSON.stringify({ body: 'secret memo' }),
    })
  ).json()) as Record<string, unknown>
  return { user, docName: String(doc.name) }
}

async function share(admin: TestClient, user: TestClient, docName: string, perms: Record<string, boolean>) {
  const doc = await admin.post<{ name: string }>('/api/save_doc', {
    doctype: 'DocShare',
    doc: { share_doctype: DT, share_name: docName, user: user.user, ...perms },
  })
  return String(doc.name)
}

describe('PERM-008: DocShare', () => {
  test('without a share, the user cannot read the doc (no role perms)', async ({
    admin,
    createUser,
  }) => {
    const { user, docName } = await setup(admin, createUser)
    expect((await user.fetch(`/api/resource/${encodeURIComponent(DT)}/${docName}`)).status).toBe(403)
  })

  test('a read-share grants access to that one doc without role changes', async ({
    admin,
    createUser,
  }) => {
    const { user, docName } = await setup(admin, createUser)
    await share(admin, user, docName, { read: true })

    const res = await user.fetch(`/api/resource/${encodeURIComponent(DT)}/${docName}`)
    expect(res.status).toBe(200)
    expect(((await res.json()) as Record<string, unknown>).body).toBe('secret memo')

    // read-only share: cannot write
    const doc = await admin.get<Record<string, unknown>>(
      `/api/resource/${encodeURIComponent(DT)}/${docName}`,
    )
    const write = await user.fetch(`/api/resource/${encodeURIComponent(DT)}/${docName}`, {
      method: 'PUT',
      body: JSON.stringify({ modified: doc.modified, body: 'hacked' }),
    })
    expect(write.status).toBe(403)
  })

  test('a write-share allows editing that doc', async ({ admin, createUser }) => {
    const { user, docName } = await setup(admin, createUser)
    const shareName = await share(admin, user, docName, { read: true })
    await admin.put(`/api/resource/DocShare/${encodeURIComponent(shareName)}`, {
      modified: (
        await admin.get<{ modified: string }>(`/api/resource/DocShare/${encodeURIComponent(shareName)}`)
      ).modified,
      write: true,
    })
    const doc = await admin.get<Record<string, unknown>>(
      `/api/resource/${encodeURIComponent(DT)}/${docName}`,
    )
    const write = await user.fetch(`/api/resource/${encodeURIComponent(DT)}/${docName}`, {
      method: 'PUT',
      body: JSON.stringify({ modified: doc.modified, body: 'edited by sharee' }),
    })
    expect(write.status).toBe(200)
    const after = await admin.get<Record<string, unknown>>(
      `/api/resource/${encodeURIComponent(DT)}/${docName}`,
    )
    expect(after.body).toBe('edited by sharee')
  })

  test('unsharing revokes access', async ({ admin, createUser }) => {
    const { user, docName } = await setup(admin, createUser)
    const shareName = await share(admin, user, docName, { read: true, write: true })
    await admin.delete(`/api/resource/DocShare/${encodeURIComponent(shareName)}`)
    expect((await user.fetch(`/api/resource/${encodeURIComponent(DT)}/${docName}`)).status).toBe(403)
  })
})

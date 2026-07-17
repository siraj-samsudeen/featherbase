import { describe, expect } from 'vitest'
import { deleteStored } from '../src/storage'
import { test } from './pg-test'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'

// FILE-003: private files are served only after a permission check on the
// document they are attached to. A signed URL, minted after that check,
// then serves without a session; tampered or expired signatures are rejected.
//
// Sandbox note: all rows roll back; the uploaded disk object is removed in
// each test's finally block.

const DT = 'Sec Doc Srv'
const READER_ROLE = 'Sec Reader'

async function setup(admin: TestClient, createUser: CreateUserFn) {
  await admin.post('/api/doctype', {
    name: DT,
    fields: [{ fieldname: 'title', fieldtype: 'Data' }],
  })
  // A role that can read the doctype, and a document to attach the file to.
  await admin.post('/api/save_doc', { doctype: 'Role', doc: { name: READER_ROLE } })
  await admin.post('/api/save_doc', {
    doctype: 'DocPerm',
    doc: { ref_doctype: DT, role: READER_ROLE, can_read: true },
  })
  const docName = (
    await admin.post<{ name: string }>('/api/save_doc', {
      doctype: DT,
      doc: { title: 'secret' },
    })
  ).name

  // Two users: one holds the reader role, one holds nothing.
  const reader = await createUser({ roles: [READER_ROLE] })
  const outsider = await createUser({ roles: [] })

  // Admin uploads a private file attached to the document.
  const form = new FormData()
  form.append('file', new File(['classified'], 'sec.txt', { type: 'text/plain' }))
  form.append('is_private', '1')
  form.append('ref_doctype', DT)
  form.append('ref_name', docName)
  const up = await admin.fetch('/api/upload_file', { method: 'POST', body: form })
  const fileUrl = ((await up.json()) as { file_url: string }).file_url
  return { docName, reader, outsider, fileUrl }
}

describe('FILE-003: private files via signed URLs', () => {
  test('a user without read on the linked doc gets 403 for the private file', async ({
    admin,
    createUser,
    api,
  }) => {
    const { outsider, fileUrl } = await setup(admin, createUser)
    try {
      const res = await api.fetch(`${fileUrl}?token=${outsider.token}`)
      expect(res.status).toBe(403)
    } finally {
      await deleteStored(fileUrl).catch(() => {})
    }
  })

  test('that user also cannot mint a signed URL', async ({ admin, createUser }) => {
    const { outsider, fileUrl } = await setup(admin, createUser)
    try {
      await expect(
        outsider.get(`/api/signed_url?file_url=${encodeURIComponent(fileUrl)}`),
      ).rejects.toMatchObject({ status: 403 })
    } finally {
      await deleteStored(fileUrl).catch(() => {})
    }
  })

  test('a permitted (non-admin) user mints a signed URL that serves with no session', async ({
    admin,
    createUser,
    api,
  }) => {
    const { reader, fileUrl } = await setup(admin, createUser)
    try {
      const { signed_url } = await reader.get<{ signed_url: string }>(
        `/api/signed_url?file_url=${encodeURIComponent(fileUrl)}`,
      )
      expect(signed_url).toContain('signature=')

      // No Authorization header at all — the signature carries the grant.
      const served = await api.fetch(signed_url)
      expect(served.status).toBe(200)
      expect(await served.text()).toBe('classified')
    } finally {
      await deleteStored(fileUrl).catch(() => {})
    }
  })

  test('rejects a tampered or expired signature (falls back to auth, which is absent)', async ({
    admin,
    createUser,
    api,
  }) => {
    const { reader, fileUrl } = await setup(admin, createUser)
    try {
      const { signed_url } = await reader.get<{ signed_url: string }>(
        `/api/signed_url?file_url=${encodeURIComponent(fileUrl)}`,
      )
      expect((await api.fetch(`${signed_url}0`)).status).toBe(401) // tampered sig
      const expired = signed_url.replace(/expires=\d+/, 'expires=1')
      expect((await api.fetch(expired)).status).toBe(401) // past expiry
    } finally {
      await deleteStored(fileUrl).catch(() => {})
    }
  })
})

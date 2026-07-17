import { describe, expect } from 'vitest'
import { sql } from '../src/db'
import { deleteStored } from '../src/storage'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

// FILE-001: multipart upload writes a storage object and a File doc with
// size, type, and URL; public files serve without auth, private files
// require a session; unregistered paths 404.
//
// Sandbox note: File ROWS roll back with the test transaction, but storage
// objects are real disk files — each test deletes what it uploaded in a
// finally block (deleteStored is defensive about already-removed objects).

async function upload(
  as: TestClient,
  name: string,
  content: string,
  type: string,
  extra: Record<string, string> = {},
) {
  const form = new FormData()
  form.append('file', new File([content], name, { type }))
  for (const [k, v] of Object.entries(extra)) form.append(k, v)
  return as.fetch('/api/upload_file', { method: 'POST', body: form })
}

async function cleanupDisk(urls: string[]) {
  for (const url of urls) await deleteStored(url).catch(() => {})
}

describe('FILE-001: file upload + storage', () => {
  test('creates a storage object and a File doc with size, type, and URL', async ({
    admin,
    api,
  }) => {
    const uploaded: string[] = []
    try {
      const res = await upload(admin, 'hello.txt', 'hello world', 'text/plain')
      expect(res.status).toBe(201)
      const doc = (await res.json()) as Record<string, unknown>
      uploaded.push(doc.file_url as string)
      expect(doc.file_name).toBe('hello.txt')
      expect(doc.mime_type).toBe('text/plain')
      expect(Number(doc.file_size)).toBe(11)
      expect(doc.file_url).toMatch(/^\/files\/[0-9a-f]{16}_hello\.txt$/)
      expect(doc.is_private).toBe(false)

      const [row] = await sql`select name from tab_file where file_url = ${doc.file_url as string}`
      expect(row).toBeDefined()

      const served = await api.fetch(doc.file_url as string)
      expect(served.status).toBe(200)
      expect(served.headers.get('content-type')).toContain('text/plain')
      expect(await served.text()).toBe('hello world')
    } finally {
      await cleanupDisk(uploaded)
    }
  })

  test('private uploads require a session to read', async ({ admin, api }) => {
    const uploaded: string[] = []
    try {
      const res = await upload(admin, 'secret.txt', 'classified', 'text/plain', {
        is_private: '1',
      })
      expect(res.status).toBe(201)
      const doc = (await res.json()) as Record<string, unknown>
      uploaded.push(doc.file_url as string)
      expect(doc.file_url).toMatch(/^\/private\/files\//)

      const anon = await api.fetch(doc.file_url as string)
      expect(anon.status).toBe(401)

      const authed = await api.fetch(`${doc.file_url}?token=${admin.token}`)
      expect(authed.status).toBe(200)
      expect(await authed.text()).toBe('classified')
    } finally {
      await cleanupDisk(uploaded)
    }
  })

  test('rejects uploads without a session', async ({ api }) => {
    const form = new FormData()
    form.append('file', new File(['x'], 'x.txt', { type: 'text/plain' }))
    const res = await api.fetch('/api/upload_file', { method: 'POST', body: form })
    expect(res.status).toBe(401)
  })

  test('rejects a body with no file part', async ({ admin }) => {
    const form = new FormData()
    form.append('nope', 'not a file')
    const res = await admin.fetch('/api/upload_file', { method: 'POST', body: form })
    expect(res.status).toBe(417)
  })

  test('unregistered storage paths 404 even if a file existed on disk', async ({ api }) => {
    const res = await api.fetch('/files/0000000000000000_ghost.txt')
    expect(res.status).toBe(404)
  })

  test('records ref_doctype/ref_name when attaching to a document', async ({ admin }) => {
    const uploaded: string[] = []
    try {
      const res = await upload(admin, 'attach.txt', 'attached', 'text/plain', {
        ref_doctype: 'User',
        ref_name: 'Administrator',
      })
      expect(res.status).toBe(201)
      const doc = (await res.json()) as Record<string, unknown>
      uploaded.push(doc.file_url as string)
      expect(doc.ref_doctype).toBe('User')
      expect(doc.ref_name).toBe('Administrator')
    } finally {
      await cleanupDisk(uploaded)
    }
  })
})

describe('FILE-002: attachments listing + delete cleanup', () => {
  test('attachments are listable per document and deleting the File doc removes the storage object', async ({
    admin,
    api,
  }) => {
    const uploaded: string[] = []
    try {
      const target = { ref_doctype: 'User', ref_name: 'Guest' }
      const a = (await (await upload(admin, 'att-a.txt', 'AAA', 'text/plain', target)).json()) as
        Record<string, unknown>
      const b = (await (await upload(admin, 'att-b.txt', 'BBB', 'text/plain', target)).json()) as
        Record<string, unknown>
      uploaded.push(a.file_url as string, b.file_url as string)

      const filters = JSON.stringify([
        ['ref_doctype', '=', 'User'],
        ['ref_name', '=', 'Guest'],
      ])
      const fields = encodeURIComponent(JSON.stringify(['name', 'file_name', 'file_url']))
      const listed = await admin.get<{ data: { file_name: string }[] }>(
        `/api/resource/File?filters=${encodeURIComponent(filters)}&fields=${fields}`,
      )
      expect(listed.data.map((f) => f.file_name).sort()).toEqual(['att-a.txt', 'att-b.txt'])

      // Delete one File doc: the storage object must go with it…
      await admin.delete(`/api/resource/File/${a.name}`)
      expect((await api.fetch(a.file_url as string)).status).toBe(404)

      // …while the other file is untouched.
      const bServed = await api.fetch(b.file_url as string)
      expect(bServed.status).toBe(200)
      expect(await bServed.text()).toBe('BBB')

      const after = await admin.get<{ data: { file_name: string }[] }>(
        `/api/resource/File?filters=${encodeURIComponent(filters)}&fields=${fields}`,
      )
      expect(after.data.map((f) => f.file_name)).toEqual(['att-b.txt'])
    } finally {
      await cleanupDisk(uploaded)
    }
  })
})

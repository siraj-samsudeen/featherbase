import { afterAll, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { sql } from '../src/db'
import { deleteStored } from '../src/storage'
import { areq, token } from './helpers'

// FILE-001: multipart upload writes a storage object and a File doc with
// size, type, and URL; public files serve without auth, private files
// require a session; unregistered paths 404.

const uploaded: string[] = []

async function upload(
  name: string,
  content: string,
  type: string,
  extra: Record<string, string> = {},
) {
  const form = new FormData()
  form.append('file', new File([content], name, { type }))
  for (const [k, v] of Object.entries(extra)) form.append(k, v)
  const res = await app.request('/api/upload_file', {
    method: 'POST',
    headers: { authorization: `Bearer ${await token()}` },
    body: form,
  })
  return res
}

afterAll(async () => {
  for (const url of uploaded) {
    await deleteStored(url)
    await sql`delete from tab_file where file_url = ${url}`
  }
})

describe('FILE-001: file upload + storage', () => {
  it('creates a storage object and a File doc with size, type, and URL', async () => {
    const res = await upload('hello.txt', 'hello world', 'text/plain')
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

    const served = await app.request(doc.file_url as string)
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toContain('text/plain')
    expect(await served.text()).toBe('hello world')
  })

  it('private uploads require a session to read', async () => {
    const res = await upload('secret.txt', 'classified', 'text/plain', { is_private: '1' })
    expect(res.status).toBe(201)
    const doc = (await res.json()) as Record<string, unknown>
    uploaded.push(doc.file_url as string)
    expect(doc.file_url).toMatch(/^\/private\/files\//)

    const anon = await app.request(doc.file_url as string)
    expect(anon.status).toBe(401)

    const authed = await app.request(`${doc.file_url}?token=${await token()}`)
    expect(authed.status).toBe(200)
    expect(await authed.text()).toBe('classified')
  })

  it('rejects uploads without a session', async () => {
    const form = new FormData()
    form.append('file', new File(['x'], 'x.txt', { type: 'text/plain' }))
    const res = await app.request('/api/upload_file', { method: 'POST', body: form })
    expect(res.status).toBe(401)
  })

  it('rejects a body with no file part', async () => {
    const form = new FormData()
    form.append('nope', 'not a file')
    const res = await app.request('/api/upload_file', {
      method: 'POST',
      headers: { authorization: `Bearer ${await token()}` },
      body: form,
    })
    expect(res.status).toBe(417)
  })

  it('unregistered storage paths 404 even if a file existed on disk', async () => {
    const res = await app.request('/files/0000000000000000_ghost.txt')
    expect(res.status).toBe(404)
  })

  it('records ref_doctype/ref_name when attaching to a document', async () => {
    const res = await upload('attach.txt', 'attached', 'text/plain', {
      ref_doctype: 'User',
      ref_name: 'Administrator',
    })
    expect(res.status).toBe(201)
    const doc = (await res.json()) as Record<string, unknown>
    uploaded.push(doc.file_url as string)
    expect(doc.ref_doctype).toBe('User')
    expect(doc.ref_name).toBe('Administrator')
  })
})

describe('FILE-002: attachments listing + delete cleanup', () => {
  it('attachments are listable per document and deleting the File doc removes the storage object', async () => {
    // Idempotent: clear leftovers from any earlier aborted run.
    const stale = await sql`
      select file_url from tab_file where ref_doctype = 'User' and ref_name = 'Guest'`
    for (const row of stale) await deleteStored(row.file_url as string)
    await sql`delete from tab_file where ref_doctype = 'User' and ref_name = 'Guest'`

    const target = { ref_doctype: 'User', ref_name: 'Guest' }
    const a = (await (await upload('att-a.txt', 'AAA', 'text/plain', target)).json()) as Record<
      string,
      unknown
    >
    const b = (await (await upload('att-b.txt', 'BBB', 'text/plain', target)).json()) as Record<
      string,
      unknown
    >

    const filters = JSON.stringify([
      ['ref_doctype', '=', 'User'],
      ['ref_name', '=', 'Guest'],
    ])
    const fields = encodeURIComponent(JSON.stringify(['name', 'file_name', 'file_url']))
    const listed = (await (
      await areq(`/api/resource/File?filters=${encodeURIComponent(filters)}&fields=${fields}`)
    ).json()) as { data: { file_name: string }[] }
    expect(listed.data.map((f) => f.file_name).sort()).toEqual(['att-a.txt', 'att-b.txt'])

    // Delete one File doc: the storage object must go with it…
    const del = await areq(`/api/resource/File/${a.name}`, { method: 'DELETE' })
    expect(del.status).toBe(200)
    expect((await app.request(a.file_url as string)).status).toBe(404)

    // …while the other file is untouched.
    const bServed = await app.request(b.file_url as string)
    expect(bServed.status).toBe(200)
    expect(await bServed.text()).toBe('BBB')

    const after = (await (
      await areq(`/api/resource/File?filters=${encodeURIComponent(filters)}&fields=${fields}`)
    ).json()) as { data: { file_name: string }[] }
    expect(after.data.map((f) => f.file_name)).toEqual(['att-b.txt'])

    uploaded.push(b.file_url as string)
  })
})

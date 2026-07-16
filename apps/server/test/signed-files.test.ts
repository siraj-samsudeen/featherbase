import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { sql } from '../src/db'
import { setUserPassword } from '../src/auth'
import { deleteStored } from '../src/storage'
import { areq, token } from './helpers'

// FILE-003: private files are served only after a permission check on the
// document they are attached to. A signed URL, minted after that check,
// then serves without a session; tampered or expired signatures are rejected.

const DT = 'Sec Doc Srv'
const READER_ROLE = 'Sec Reader'
const READER = 'sec-reader@x.com'
const OUTSIDER = 'sec-outsider@x.com'
const PWD = 'secpw12345'

let fileUrl: string

async function loginToken(usr: string, pwd: string): Promise<string> {
  const res = await app.request('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usr, pwd }),
  })
  if (res.status !== 200) throw new Error(`login ${usr}: ${res.status}`)
  return ((await res.json()) as { token: string }).token
}

async function cleanup() {
  if (fileUrl) {
    await deleteStored(fileUrl)
    await sql`delete from tab_file where file_url = ${fileUrl}`
  }
  await sql`delete from tab_docperm where ref_doctype = ${DT}`
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_sec_doc_srv')
  for (const u of [READER, OUTSIDER]) {
    await sql`delete from tab_has_role where parent = ${u}`
    await sql`delete from tab_user where name = ${u}`
  }
  await sql`delete from tab_has_role where role = ${READER_ROLE}`
  await sql`delete from tab_role where name = ${READER_ROLE}`
}

async function save(doctype: string, doc: Record<string, unknown>) {
  const res = await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({ doctype, doc }),
  })
  if (res.status !== 201) throw new Error(`save ${doctype}: ${res.status} ${await res.text()}`)
  return (await res.json()) as { name: string }
}

let docName: string

beforeAll(async () => {
  await cleanup()
  const dt = await areq('/api/doctype', {
    method: 'POST',
    body: JSON.stringify({ name: DT, fields: [{ fieldname: 'title', fieldtype: 'Data' }] }),
  })
  if (![201, 409].includes(dt.status)) throw new Error(`doctype create: ${dt.status} ${await dt.text()}`)

  // A role that can read the doctype, and a document to attach the file to.
  await save('Role', { name: READER_ROLE })
  await save('DocPerm', { ref_doctype: DT, role: READER_ROLE, can_read: true })
  docName = (await save(DT, { title: 'secret' })).name

  // Two users: one holds the reader role, one holds nothing.
  await save('User', { name: READER, email: READER, enabled: true, roles: [{ role: READER_ROLE }] })
  await save('User', { name: OUTSIDER, email: OUTSIDER, enabled: true })
  await setUserPassword(READER, PWD)
  await setUserPassword(OUTSIDER, PWD)

  // Admin uploads a private file attached to the document.
  const admin = await token()
  const form = new FormData()
  form.append('file', new File(['classified'], 'sec.txt', { type: 'text/plain' }))
  form.append('is_private', '1')
  form.append('ref_doctype', DT)
  form.append('ref_name', docName)
  const up = await app.request('/api/upload_file', {
    method: 'POST',
    headers: { authorization: `Bearer ${admin}` },
    body: form,
  })
  fileUrl = ((await up.json()) as { file_url: string }).file_url
})

afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('FILE-003: private files via signed URLs', () => {
  it('a user without read on the linked doc gets 403 for the private file', async () => {
    const t = await loginToken(OUTSIDER, PWD)
    const res = await app.request(`${fileUrl}?token=${t}`)
    expect(res.status).toBe(403)
  })

  it('that user also cannot mint a signed URL', async () => {
    const t = await loginToken(OUTSIDER, PWD)
    const res = await app.request(`/api/signed_url?file_url=${encodeURIComponent(fileUrl)}`, {
      headers: { authorization: `Bearer ${t}` },
    })
    expect(res.status).toBe(403)
  })

  it('a permitted (non-admin) user mints a signed URL that serves with no session', async () => {
    const t = await loginToken(READER, PWD)
    const res = await app.request(`/api/signed_url?file_url=${encodeURIComponent(fileUrl)}`, {
      headers: { authorization: `Bearer ${t}` },
    })
    expect(res.status).toBe(200)
    const { signed_url } = (await res.json()) as { signed_url: string }
    expect(signed_url).toContain('signature=')

    // No Authorization header at all — the signature carries the grant.
    const served = await app.request(signed_url)
    expect(served.status).toBe(200)
    expect(await served.text()).toBe('classified')
  })

  it('rejects a tampered or expired signature (falls back to auth, which is absent)', async () => {
    const t = await loginToken(READER, PWD)
    const { signed_url } = (await (
      await app.request(`/api/signed_url?file_url=${encodeURIComponent(fileUrl)}`, {
        headers: { authorization: `Bearer ${t}` },
      })
    ).json()) as { signed_url: string }

    expect((await app.request(`${signed_url}0`)).status).toBe(401) // tampered sig
    const expired = signed_url.replace(/expires=\d+/, 'expires=1')
    expect((await app.request(expired)).status).toBe(401) // past expiry
  })
})

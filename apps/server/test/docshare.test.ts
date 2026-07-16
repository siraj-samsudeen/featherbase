import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { sql } from '../src/db'
import { setUserPassword } from '../src/auth'
import { areq } from './helpers'

const DT = 'Sh Memo'
const USER = 'shuser@x.com'

let token = ''
let shareName = ''
let docName = ''
const ureq = (path: string, init: RequestInit = {}) =>
  app.request(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...((init.headers as Record<string, string>) ?? {}),
    },
  })

async function cleanup() {
  await sql`delete from tab_docshare where share_doctype = ${DT}`
  await sql`delete from tab_user where name = ${USER}`
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_sh_memo')
}

beforeAll(async () => {
  await cleanup()
  // NOTE: no DocPerm rows for DT at all -> user has zero role access.
  await areq('/api/doctype', {
    method: 'POST',
    body: JSON.stringify({ name: DT, fields: [{ fieldname: 'body', fieldtype: 'Data' }] }),
  })
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({ doctype: 'User', doc: { name: USER, email: USER, enabled: true } }),
  })
  await setUserPassword(USER, 'shpw123')
  const login = await app.request('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usr: USER, pwd: 'shpw123' }),
  })
  token = ((await login.json()) as { token: string }).token
  const doc = (await (
    await areq(`/api/resource/${encodeURIComponent(DT)}`, {
      method: 'POST',
      body: JSON.stringify({ body: 'secret memo' }),
    })
  ).json()) as Record<string, unknown>
  docName = String(doc.name)
})

afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('PERM-008: DocShare', () => {
  it('without a share, the user cannot read the doc (no role perms)', async () => {
    expect((await ureq(`/api/resource/${encodeURIComponent(DT)}/${docName}`)).status).toBe(403)
  })

  it('a read-share grants access to that one doc without role changes', async () => {
    const share = (await (
      await areq('/api/save_doc', {
        method: 'POST',
        body: JSON.stringify({
          doctype: 'DocShare',
          doc: { share_doctype: DT, share_name: docName, user: USER, read: true },
        }),
      })
    ).json()) as Record<string, unknown>
    shareName = String(share.name)

    const res = await ureq(`/api/resource/${encodeURIComponent(DT)}/${docName}`)
    expect(res.status).toBe(200)
    expect(((await res.json()) as Record<string, unknown>).body).toBe('secret memo')

    // read-only share: cannot write
    const doc = (await (
      await areq(`/api/resource/${encodeURIComponent(DT)}/${docName}`)
    ).json()) as Record<string, unknown>
    const write = await ureq(`/api/resource/${encodeURIComponent(DT)}/${docName}`, {
      method: 'PUT',
      body: JSON.stringify({ modified: doc.modified, body: 'hacked' }),
    })
    expect(write.status).toBe(403)
  })

  it('a write-share allows editing that doc', async () => {
    await areq(`/api/resource/DocShare/${encodeURIComponent(shareName)}`, {
      method: 'PUT',
      body: JSON.stringify({
        modified: (
          (await (await areq(`/api/resource/DocShare/${encodeURIComponent(shareName)}`)).json()) as {
            modified: string
          }
        ).modified,
        write: true,
      }),
    })
    const doc = (await (
      await areq(`/api/resource/${encodeURIComponent(DT)}/${docName}`)
    ).json()) as Record<string, unknown>
    const write = await ureq(`/api/resource/${encodeURIComponent(DT)}/${docName}`, {
      method: 'PUT',
      body: JSON.stringify({ modified: doc.modified, body: 'edited by sharee' }),
    })
    expect(write.status).toBe(200)
    const after = (await (
      await areq(`/api/resource/${encodeURIComponent(DT)}/${docName}`)
    ).json()) as Record<string, unknown>
    expect(after.body).toBe('edited by sharee')
  })

  it('unsharing revokes access', async () => {
    await areq(`/api/resource/DocShare/${encodeURIComponent(shareName)}`, { method: 'DELETE' })
    expect((await ureq(`/api/resource/${encodeURIComponent(DT)}/${docName}`)).status).toBe(403)
  })
})

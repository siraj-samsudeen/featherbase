import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { sql } from '../src/db'
import { setUserPassword } from '../src/auth'
import { areq } from './helpers'

const DT = 'Perm Widget'
const USER = 'permuser@x.com'
const ROLE = 'Perm Tester Role'

let userToken = ''
const ureq = (path: string, init: RequestInit = {}) =>
  app.request(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${userToken}`,
      ...((init.headers as Record<string, string>) ?? {}),
    },
  })

async function grant(perms: Record<string, boolean>) {
  const res = await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({
      doctype: 'DocPerm',
      doc: { ref_doctype: DT, role: ROLE, ...perms },
    }),
  })
  if (res.status !== 201) throw new Error(`grant failed ${res.status}`)
  return ((await res.json()) as { name: string }).name
}

async function cleanup() {
  await sql`delete from tab_docperm where ref_doctype = ${DT}`
  await sql`delete from tab_has_role where parent = ${USER}`
  await sql`delete from tab_user where name = ${USER}`
  await sql`delete from tab_role where name = ${ROLE}`
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_perm_widget')
}

beforeAll(async () => {
  await cleanup()
  await areq('/api/doctype', {
    method: 'POST',
    body: JSON.stringify({
      name: DT,
      fields: [{ fieldname: 'title', fieldtype: 'Data' }],
    }),
  })
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({ doctype: 'Role', doc: { name: ROLE } }),
  })
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({
      doctype: 'User',
      doc: { name: USER, email: USER, enabled: true, roles: [{ role: ROLE }] },
    }),
  })
  await setUserPassword(USER, 'permpw1')
  const login = await app.request('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usr: USER, pwd: 'permpw1' }),
  })
  userToken = ((await login.json()) as { token: string }).token
  // seed one row as admin for read tests
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({ doctype: DT, doc: { title: 'seeded' } }),
  })
})

afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('PERM-002/003: DocPerm grants enforced server-side', () => {
  it('no DocPerm rows -> restricted user gets 403 on read, create, list', async () => {
    expect((await ureq(`/api/resource/${encodeURIComponent(DT)}`)).status).toBe(403)
    expect(
      (
        await ureq(`/api/resource/${encodeURIComponent(DT)}`, {
          method: 'POST',
          body: JSON.stringify({ title: 'x' }),
        })
      ).status,
    ).toBe(403)
    expect((await ureq(`/api/meta/${encodeURIComponent(DT)}`)).status).toBe(403)
  })

  it('read-only grant: GET works, POST/PUT/DELETE still 403', async () => {
    await grant({ can_read: true })
    const list = await ureq(
      `/api/resource/${encodeURIComponent(DT)}?fields=${encodeURIComponent('["name","title"]')}`,
    )
    expect(list.status).toBe(200)
    const { data } = (await list.json()) as { data: { name: string; title: string }[] }
    expect(data.length).toBeGreaterThan(0)
    const name = data[0].name

    expect(
      (
        await ureq(`/api/resource/${encodeURIComponent(DT)}`, {
          method: 'POST',
          body: JSON.stringify({ title: 'nope' }),
        })
      ).status,
    ).toBe(403)
    const doc = (await (await ureq(`/api/resource/${encodeURIComponent(DT)}/${name}`)).json()) as
      Record<string, unknown>
    expect(
      (
        await ureq(`/api/resource/${encodeURIComponent(DT)}/${name}`, {
          method: 'PUT',
          body: JSON.stringify({ modified: doc.modified, title: 'edited' }),
        })
      ).status,
    ).toBe(403)
    expect(
      (await ureq(`/api/resource/${encodeURIComponent(DT)}/${name}`, { method: 'DELETE' }))
        .status,
    ).toBe(403)
  })

  it('adding write+create grants unlocks exactly those actions', async () => {
    await grant({ can_read: true, can_write: true, can_create: true })
    const created = await ureq(`/api/resource/${encodeURIComponent(DT)}`, {
      method: 'POST',
      body: JSON.stringify({ title: 'mine' }),
    })
    expect(created.status).toBe(201)
    const doc = (await created.json()) as Record<string, unknown>
    expect(doc.owner).toBe(USER)
    const put = await ureq(`/api/resource/${encodeURIComponent(DT)}/${doc.name}`, {
      method: 'PUT',
      body: JSON.stringify({ modified: doc.modified, title: 'mine2' }),
    })
    expect(put.status).toBe(200)
    // still no delete
    expect(
      (await ureq(`/api/resource/${encodeURIComponent(DT)}/${doc.name}`, { method: 'DELETE' }))
        .status,
    ).toBe(403)
  })

  it('restricted users cannot create DocTypes', async () => {
    const res = await ureq('/api/doctype', {
      method: 'POST',
      body: JSON.stringify({ name: 'Hax DT', fields: [{ fieldname: 'x', fieldtype: 'Data' }] }),
    })
    expect(res.status).toBe(403)
  })
})

describe('PERM-009: Administrator bypass', () => {
  it('admin passes all checks on a DocType with zero DocPerm rows', async () => {
    await sql`delete from tab_docperm where ref_doctype = ${DT}`
    const res = await areq(`/api/resource/${encodeURIComponent(DT)}`, {
      method: 'POST',
      body: JSON.stringify({ title: 'admin can' }),
    })
    expect(res.status).toBe(201)
    expect((await areq(`/api/resource/${encodeURIComponent(DT)}`)).status).toBe(200)
  })
})

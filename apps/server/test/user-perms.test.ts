import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { sql } from '../src/db'
import { setUserPassword } from '../src/auth'
import { areq } from './helpers'

const COMPANY = 'Up Company'
const PROJECT = 'Up Project'
const ROLE = 'Up Role'
const USER = 'upuser@x.com'

let token = ''
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
  await sql`delete from tab_user_permission where "user" = ${USER}`
  await sql`delete from tab_docperm where ref_doctype in (${PROJECT}, ${COMPANY})`
  await sql`delete from tab_has_role where parent = ${USER}`
  await sql`delete from tab_user where name = ${USER}`
  await sql`delete from tab_role where name = ${ROLE}`
  await sql`delete from tab_doctype where name in (${PROJECT}, ${COMPANY})`
  await sql.unsafe('drop table if exists tab_up_project')
  await sql.unsafe('drop table if exists tab_up_company')
}

beforeAll(async () => {
  await cleanup()
  await areq('/api/doctype', {
    method: 'POST',
    body: JSON.stringify({
      name: COMPANY,
      autoname: 'prompt',
      fields: [{ fieldname: 'country', fieldtype: 'Data' }],
    }),
  })
  await areq('/api/doctype', {
    method: 'POST',
    body: JSON.stringify({
      name: PROJECT,
      fields: [
        { fieldname: 'title', fieldtype: 'Data' },
        { fieldname: 'company', fieldtype: 'Link', options: COMPANY },
      ],
    }),
  })
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({ doctype: 'Role', doc: { name: ROLE } }),
  })
  for (const dt of [PROJECT, COMPANY])
    await areq('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({
        doctype: 'DocPerm',
        doc: { ref_doctype: dt, role: ROLE, can_read: true, can_write: true, can_create: true },
      }),
    })
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({
      doctype: 'User',
      doc: { name: USER, email: USER, enabled: true, roles: [{ role: ROLE }] },
    }),
  })
  await setUserPassword(USER, 'uppw123')
  for (const c of ['Company A', 'Company B'])
    await areq('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({ doctype: COMPANY, doc: { name: c } }),
    })
  for (const [t, c] of [['pa', 'Company A'], ['pb', 'Company B']])
    await areq('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({ doctype: PROJECT, doc: { title: t, company: c } }),
    })
  // Restrict USER to Company A
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({
      doctype: 'User Permission',
      doc: { user: USER, allow: COMPANY, for_value: 'Company A' },
    }),
  })
  const login = await app.request('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usr: USER, pwd: 'uppw123' }),
  })
  token = ((await login.json()) as { token: string }).token
})

afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('PERM-005: user permissions', () => {
  it('lists exclude documents linked to non-permitted values', async () => {
    const res = (await (
      await ureq(
        `/api/resource/${encodeURIComponent(PROJECT)}?fields=${encodeURIComponent('["title","company"]')}`,
      )
    ).json()) as { data: { title: string; company: string }[]; total: number }
    expect(res.total).toBe(1)
    expect(res.data[0]).toMatchObject({ title: 'pa', company: 'Company A' })
  })

  it('lists of the restricted doctype itself only show permitted docs', async () => {
    const res = (await (
      await ureq(`/api/resource/${encodeURIComponent(COMPANY)}`)
    ).json()) as { data: { name: string }[]; total: number }
    expect(res.total).toBe(1)
    expect(res.data[0].name).toBe('Company A')
  })

  it('direct reads of non-permitted docs are 403 (linked and target)', async () => {
    const pb = await sql.unsafe(`select name from tab_up_project where title='pb'`)
    expect((await ureq(`/api/resource/${encodeURIComponent(PROJECT)}/${pb[0].name}`)).status).toBe(403)
    expect((await ureq(`/api/resource/${encodeURIComponent(COMPANY)}/Company%20B`)).status).toBe(403)
    expect((await ureq(`/api/resource/${encodeURIComponent(COMPANY)}/Company%20A`)).status).toBe(200)
  })

  it('creating/updating docs pointing at non-permitted values is rejected', async () => {
    const bad = await ureq(`/api/resource/${encodeURIComponent(PROJECT)}`, {
      method: 'POST',
      body: JSON.stringify({ title: 'nope', company: 'Company B' }),
    })
    expect(bad.status).toBe(403)
    const ok = await ureq(`/api/resource/${encodeURIComponent(PROJECT)}`, {
      method: 'POST',
      body: JSON.stringify({ title: 'fine', company: 'Company A' }),
    })
    expect(ok.status).toBe(201)
  })

  it('admins are unaffected', async () => {
    const res = (await (
      await areq(`/api/resource/${encodeURIComponent(PROJECT)}`)
    ).json()) as { total: number }
    expect(res.total).toBeGreaterThanOrEqual(2)
  })
})

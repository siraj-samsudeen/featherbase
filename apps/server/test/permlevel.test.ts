import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { sql } from '../src/db'
import { setUserPassword } from '../src/auth'
import { areq } from './helpers'

const DT = 'Pl Salary'
const ROLE = 'Pl Role'
const USER = 'pluser@x.com'

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
  await sql`delete from tab_docperm where ref_doctype = ${DT}`
  await sql`delete from tab_has_role where parent = ${USER}`
  await sql`delete from tab_user where name = ${USER}`
  await sql`delete from tab_role where name = ${ROLE}`
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_pl_salary')
}

beforeAll(async () => {
  await cleanup()
  await areq('/api/doctype', {
    method: 'POST',
    body: JSON.stringify({
      name: DT,
      fields: [
        { fieldname: 'employee', fieldtype: 'Data' },
        { fieldname: 'salary', fieldtype: 'Currency', permlevel: 1 },
      ],
    }),
  })
  await areq('/api/save_doc', { method: 'POST', body: JSON.stringify({ doctype: 'Role', doc: { name: ROLE } }) })
  // level 0 read+write only (no level-1 grant)
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({
      doctype: 'DocPerm',
      doc: { ref_doctype: DT, role: ROLE, permlevel: 0, can_read: true, can_write: true, can_create: true },
    }),
  })
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({
      doctype: 'User',
      doc: { name: USER, email: USER, enabled: true, roles: [{ role: ROLE }] },
    }),
  })
  await setUserPassword(USER, 'plpw123')
  const login = await app.request('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usr: USER, pwd: 'plpw123' }),
  })
  token = ((await login.json()) as { token: string }).token
  // admin seeds a doc with a salary
  await areq('/api/resource/' + encodeURIComponent(DT), {
    method: 'POST',
    body: JSON.stringify({ name: undefined, employee: 'Alice', salary: 5000 }),
  }).then(async (r) => {
    if (r.status !== 201) throw new Error('seed ' + r.status)
  })
})

afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('PERM-006: field-level (permlevel) permissions', () => {
  it('level-1 field is omitted from reads for a level-0 user', async () => {
    const list = (await (
      await ureq(`/api/resource/${encodeURIComponent(DT)}?fields=${encodeURIComponent('["name"]')}`)
    ).json()) as { data: { name: string }[] }
    const name = list.data[0].name
    const doc = (await (
      await ureq(`/api/resource/${encodeURIComponent(DT)}/${name}`)
    ).json()) as Record<string, unknown>
    expect(doc.employee).toBe('Alice')
    expect('salary' in doc).toBe(false)

    // admin still sees it
    const adminDoc = (await (
      await areq(`/api/resource/${encodeURIComponent(DT)}/${name}`)
    ).json()) as Record<string, unknown>
    expect(Number(adminDoc.salary)).toBe(5000)
  })

  it('level-0 user cannot write the level-1 field (silently ignored, not escalated)', async () => {
    const list = (await (
      await ureq(`/api/resource/${encodeURIComponent(DT)}?fields=${encodeURIComponent('["name"]')}`)
    ).json()) as { data: { name: string }[] }
    const name = list.data[0].name
    const cur = (await (
      await areq(`/api/resource/${encodeURIComponent(DT)}/${name}`)
    ).json()) as Record<string, unknown>

    // level-0 user tries to bump salary
    const res = await ureq(`/api/resource/${encodeURIComponent(DT)}/${name}`, {
      method: 'PUT',
      body: JSON.stringify({ modified: cur.modified, employee: 'Alice B', salary: 99999 }),
    })
    expect(res.status).toBe(200)
    // salary unchanged, employee changed
    const after = (await (
      await areq(`/api/resource/${encodeURIComponent(DT)}/${name}`)
    ).json()) as Record<string, unknown>
    expect(Number(after.salary)).toBe(5000)
    expect(after.employee).toBe('Alice B')
  })
})

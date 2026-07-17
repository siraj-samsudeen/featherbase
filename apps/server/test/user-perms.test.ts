import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import type { TestClient } from 'feather-testing-postgres'

const COMPANY = 'Up Company'
const PROJECT = 'Up Project'
const ROLE = 'Up Role'

// Per-test world: both DocTypes, the role + grants, two companies, two
// projects, and a user restricted to Company A — all rolled back afterwards.
async function setup(
  admin: TestClient,
  createUser: (o?: { roles?: string[] }) => Promise<TestClient>,
) {
  await admin.post('/api/doctype', {
    name: COMPANY,
    autoname: 'prompt',
    fields: [{ fieldname: 'country', fieldtype: 'Data' }],
  })
  await admin.post('/api/doctype', {
    name: PROJECT,
    fields: [
      { fieldname: 'title', fieldtype: 'Data' },
      { fieldname: 'company', fieldtype: 'Link', options: COMPANY },
    ],
  })
  await admin.post('/api/save_doc', { doctype: 'Role', doc: { name: ROLE } })
  for (const dt of [PROJECT, COMPANY])
    await admin.post('/api/save_doc', {
      doctype: 'DocPerm',
      doc: { ref_doctype: dt, role: ROLE, can_read: true, can_write: true, can_create: true },
    })
  const user = await createUser({ roles: [ROLE] })
  for (const c of ['Company A', 'Company B'])
    await admin.post('/api/save_doc', { doctype: COMPANY, doc: { name: c } })
  for (const [t, c] of [['pa', 'Company A'], ['pb', 'Company B']])
    await admin.post('/api/save_doc', { doctype: PROJECT, doc: { title: t, company: c } })
  // Restrict the user to Company A
  await admin.post('/api/save_doc', {
    doctype: 'User Permission',
    doc: { user: user.user, allow: COMPANY, for_value: 'Company A' },
  })
  return user
}

describe('PERM-005: user permissions', () => {
  test('lists exclude documents linked to non-permitted values', async ({ admin, createUser }) => {
    const user = await setup(admin, createUser)
    const res = await user.get<{ data: { title: string; company: string }[]; total: number }>(
      `/api/resource/${encodeURIComponent(PROJECT)}?fields=${encodeURIComponent('["title","company"]')}`,
    )
    expect(res.total).toBe(1)
    expect(res.data[0]).toMatchObject({ title: 'pa', company: 'Company A' })
  })

  test('lists of the restricted doctype itself only show permitted docs', async ({
    admin,
    createUser,
  }) => {
    const user = await setup(admin, createUser)
    const res = await user.get<{ data: { name: string }[]; total: number }>(
      `/api/resource/${encodeURIComponent(COMPANY)}`,
    )
    expect(res.total).toBe(1)
    expect(res.data[0].name).toBe('Company A')
  })

  test('direct reads of non-permitted docs are 403 (linked and target)', async ({
    admin,
    createUser,
  }) => {
    const user = await setup(admin, createUser)
    const pb = await sql.unsafe(`select name from tab_up_project where title='pb'`)
    expect((await user.fetch(`/api/resource/${encodeURIComponent(PROJECT)}/${pb[0].name}`)).status).toBe(403)
    expect((await user.fetch(`/api/resource/${encodeURIComponent(COMPANY)}/Company%20B`)).status).toBe(403)
    expect((await user.fetch(`/api/resource/${encodeURIComponent(COMPANY)}/Company%20A`)).status).toBe(200)
  })

  test('creating/updating docs pointing at non-permitted values is rejected', async ({
    admin,
    createUser,
  }) => {
    const user = await setup(admin, createUser)
    const bad = await user.fetch(`/api/resource/${encodeURIComponent(PROJECT)}`, {
      method: 'POST',
      body: JSON.stringify({ title: 'nope', company: 'Company B' }),
    })
    expect(bad.status).toBe(403)
    const ok = await user.fetch(`/api/resource/${encodeURIComponent(PROJECT)}`, {
      method: 'POST',
      body: JSON.stringify({ title: 'fine', company: 'Company A' }),
    })
    expect(ok.status).toBe(201)
  })

  test('admins are unaffected', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    const res = await admin.get<{ total: number }>(`/api/resource/${encodeURIComponent(PROJECT)}`)
    expect(res.total).toBeGreaterThanOrEqual(2)
  })
})

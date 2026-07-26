import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import type { TestClient } from 'feather-testing-postgres'

const COMPANY = 'Up Company'
const PROJECT = 'Up Project'
const ROLE = 'Up Role'

// Per-test world: both Tables, the role + grants, two companies, two
// projects, and a user restricted to Company A — all rolled back afterwards.
async function setup(
  admin: TestClient,
  createUser: (o?: { roles?: string[] }) => Promise<TestClient>,
) {
  await admin.post('/api/doctype', {
    name: COMPANY,
    id_pattern: 'prompt',
    columns: [{ column_name: 'country', column_type: 'Data' }],
  })
  await admin.post('/api/doctype', {
    name: PROJECT,
    columns: [
      { column_name: 'title', column_type: 'Data' },
      { column_name: 'company', column_type: 'Reference', reference_table: COMPANY },
    ],
  })
  await admin.post('/api/save_doc', { doctype: 'Role', doc: { name: ROLE } })
  for (const dt of [PROJECT, COMPANY])
    await admin.post('/api/save_doc', {
      doctype: 'Permission',
      doc: { ref_table: dt, role: ROLE, can_read: true, can_write: true, can_create: true },
    })
  const user = await createUser({ roles: [ROLE] })
  for (const c of ['Company A', 'Company B'])
    await admin.post('/api/save_doc', { doctype: COMPANY, doc: { name: c } })
  for (const [t, c] of [['pa', 'Company A'], ['pb', 'Company B']])
    await admin.post('/api/save_doc', { doctype: PROJECT, doc: { title: t, company: c } })
  // Restrict the user to Company A
  await admin.post('/api/save_doc', {
    doctype: 'Data Scope',
    doc: { user: user.user, allow_table: COMPANY, for_value: 'Company A' },
  })
  return user
}

describe('PERM-005: Data Scopes', () => {
  test('lists exclude documents linked to non-permitted values', async ({ admin, createUser }) => {
    const user = await setup(admin, createUser)
    const res = await user.get<{ data: { title: string; company: string }[]; total: number }>(
      `/api/table/${encodeURIComponent(PROJECT)}?fields=${encodeURIComponent('["title","company"]')}`,
    )
    expect(res.total).toBe(1)
    expect(res.data[0]).toMatchObject({ title: 'pa', company: 'Company A' })
  })

  test('lists of the restricted Table itself only show permitted docs', async ({
    admin,
    createUser,
  }) => {
    const user = await setup(admin, createUser)
    const res = await user.get<{ data: { name: string }[]; total: number }>(
      `/api/table/${encodeURIComponent(COMPANY)}`,
    )
    expect(res.total).toBe(1)
    expect(res.data[0].name).toBe('Company A')
  })

  test('direct reads of non-permitted docs are 403 (linked and target)', async ({
    admin,
    createUser,
  }) => {
    const user = await setup(admin, createUser)
    const pb = await sql.unsafe(`select name from up_project where title='pb'`)
    expect((await user.fetch(`/api/table/${encodeURIComponent(PROJECT)}/${pb[0].name}`)).status).toBe(403)
    expect((await user.fetch(`/api/table/${encodeURIComponent(COMPANY)}/Company%20B`)).status).toBe(403)
    expect((await user.fetch(`/api/table/${encodeURIComponent(COMPANY)}/Company%20A`)).status).toBe(200)
  })

  test('creating/updating docs pointing at non-permitted values is rejected', async ({
    admin,
    createUser,
  }) => {
    const user = await setup(admin, createUser)
    const bad = await user.fetch(`/api/table/${encodeURIComponent(PROJECT)}`, {
      method: 'POST',
      body: JSON.stringify({ title: 'nope', company: 'Company B' }),
    })
    expect(bad.status).toBe(403)
    const ok = await user.fetch(`/api/table/${encodeURIComponent(PROJECT)}`, {
      method: 'POST',
      body: JSON.stringify({ title: 'fine', company: 'Company A' }),
    })
    expect(ok.status).toBe(201)
  })

  test('admins are unaffected', async ({ admin, createUser }) => {
    await setup(admin, createUser)
    const res = await admin.get<{ total: number }>(`/api/table/${encodeURIComponent(PROJECT)}`)
    expect(res.total).toBeGreaterThanOrEqual(2)
  })
})

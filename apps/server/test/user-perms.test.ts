import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { createUserWithRole, expectApiError, makeTable, type TableRef } from './fixtures'
import { sql } from '../src/db'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'

const COMPANY = 'Up Company'
const PROJECT = 'Up Project'
const ROLE = 'Up Role'

// Per-test world: both Tables, the role + grants, two companies, two
// projects, and a user restricted to Company A — all rolled back afterwards.
async function setup(
  admin: TestClient,
  createUser: CreateUserFn,
): Promise<{ user: TestClient; company: TableRef; project: TableRef }> {
  const company = await makeTable(admin, {
    name: COMPANY,
    id_pattern: 'prompt',
    columns: ['country'],
  })
  const project = await makeTable(admin, {
    name: PROJECT,
    columns: ['title', { column_name: 'company', column_type: 'Reference', reference_table: COMPANY }],
  })
  const user = await createUserWithRole(admin, createUser, {
    role: ROLE,
    table: [PROJECT, COMPANY],
    can_read: true,
    can_write: true,
    can_create: true,
  })
  for (const c of ['Company A', 'Company B'])
    await admin.post('/api/save_row', { table: COMPANY, row: { row_id: c } })
  for (const [t, c] of [['pa', 'Company A'], ['pb', 'Company B']])
    await admin.post('/api/save_row', { table: PROJECT, row: { title: t, company: c } })
  // Restrict the user to Company A
  await admin.post('/api/save_row', {
    table: 'Data Scope',
    row: { user: user.user, allow_table: COMPANY, for_value: 'Company A' },
  })
  return { user, company, project }
}

describe('PERM-005: Data Scopes', () => {
  test('lists exclude documents linked to non-permitted values', async ({ admin, createUser }) => {
    const { user, project } = await setup(admin, createUser)
    const res = await user.get<{ data: { title: string; company: string }[]; total: number }>(
      project.listUrl({ fields: ['title', 'company'] }),
    )
    expect(res.total).toBe(1)
    expect(res.data[0]).toMatchObject({ title: 'pa', company: 'Company A' })
  })

  test('lists of the restricted Table itself only show permitted docs', async ({
    admin,
    createUser,
  }) => {
    const { user, company } = await setup(admin, createUser)
    const res = await user.get<{ data: { row_id: string }[]; total: number }>(company.url)
    expect(res.total).toBe(1)
    expect(res.data[0].row_id).toBe('Company A')
  })

  test('direct reads of non-permitted docs are 403 (linked and target)', async ({
    admin,
    createUser,
  }) => {
    const { user, company, project } = await setup(admin, createUser)
    const pb = await sql.unsafe(`select row_id from up_project where title='pb'`)
    await expectApiError(user.get(project.rowUrl(String(pb[0].row_id))), { status: 403 })
    await expectApiError(user.get(company.rowUrl('Company B')), { status: 403 })
    expect((await user.fetch(company.rowUrl('Company A'))).status).toBe(200)
  })

  test('creating/updating docs pointing at non-permitted values is rejected', async ({
    admin,
    createUser,
  }) => {
    const { user, project } = await setup(admin, createUser)
    await expectApiError(user.post(project.url, { title: 'nope', company: 'Company B' }), {
      status: 403,
    })
    const ok = await user.fetch(project.url, {
      method: 'POST',
      body: JSON.stringify({ title: 'fine', company: 'Company A' }),
    })
    expect(ok.status).toBe(201)
  })

  test('admins are unaffected', async ({ admin, createUser }) => {
    const { project } = await setup(admin, createUser)
    const res = await admin.get<{ total: number }>(project.url)
    expect(res.total).toBeGreaterThanOrEqual(2)
  })
})

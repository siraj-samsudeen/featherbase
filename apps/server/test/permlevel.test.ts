import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

const DT = 'Pl Salary'
const ROLE = 'Pl Role'

// Per-test world: the DocType (salary at permlevel 1), the role with a
// level-0 grant only, a restricted user, and one admin-seeded doc.
async function setup(
  admin: TestClient,
  createUser: (o?: { roles?: string[] }) => Promise<TestClient>,
) {
  await admin.post('/api/doctype', {
    name: DT,
    fields: [
      { fieldname: 'employee', fieldtype: 'Data' },
      { fieldname: 'salary', fieldtype: 'Currency', permlevel: 1 },
    ],
  })
  await admin.post('/api/save_doc', { doctype: 'Role', doc: { name: ROLE } })
  // level 0 read+write only (no level-1 grant)
  await admin.post('/api/save_doc', {
    doctype: 'DocPerm',
    doc: { ref_doctype: DT, role: ROLE, permlevel: 0, can_read: true, can_write: true, can_create: true },
  })
  const user = await createUser({ roles: [ROLE] })
  // admin seeds a doc with a salary
  const seedRes = await admin.fetch('/api/resource/' + encodeURIComponent(DT), {
    method: 'POST',
    body: JSON.stringify({ employee: 'Alice', salary: 5000 }),
  })
  if (seedRes.status !== 201) throw new Error('seed ' + seedRes.status)
  return user
}

describe('PERM-006: field-level (permlevel) permissions', () => {
  test('level-1 field is omitted from reads for a level-0 user', async ({ admin, createUser }) => {
    const user = await setup(admin, createUser)
    const list = await user.get<{ data: { name: string }[] }>(
      `/api/resource/${encodeURIComponent(DT)}?fields=${encodeURIComponent('["name"]')}`,
    )
    const name = list.data[0].name
    const doc = await user.get<Record<string, unknown>>(
      `/api/resource/${encodeURIComponent(DT)}/${name}`,
    )
    expect(doc.employee).toBe('Alice')
    expect('salary' in doc).toBe(false)

    // admin still sees it
    const adminDoc = await admin.get<Record<string, unknown>>(
      `/api/resource/${encodeURIComponent(DT)}/${name}`,
    )
    expect(Number(adminDoc.salary)).toBe(5000)
  })

  test('level-0 user cannot write the level-1 field (silently ignored, not escalated)', async ({
    admin,
    createUser,
  }) => {
    const user = await setup(admin, createUser)
    const list = await user.get<{ data: { name: string }[] }>(
      `/api/resource/${encodeURIComponent(DT)}?fields=${encodeURIComponent('["name"]')}`,
    )
    const name = list.data[0].name
    const cur = await admin.get<Record<string, unknown>>(
      `/api/resource/${encodeURIComponent(DT)}/${name}`,
    )

    // level-0 user tries to bump salary
    const res = await user.fetch(`/api/resource/${encodeURIComponent(DT)}/${name}`, {
      method: 'PUT',
      body: JSON.stringify({ modified: cur.modified, employee: 'Alice B', salary: 99999 }),
    })
    expect(res.status).toBe(200)
    // salary unchanged, employee changed
    const after = await admin.get<Record<string, unknown>>(
      `/api/resource/${encodeURIComponent(DT)}/${name}`,
    )
    expect(Number(after.salary)).toBe(5000)
    expect(after.employee).toBe('Alice B')
  })
})

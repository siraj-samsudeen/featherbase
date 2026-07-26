import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

const DT = 'Pl Salary'
const ROLE = 'Pl Role'

// Per-test world: the Table (salary at tier 'restricted'), the role with a
// basic-tier grant only, a restricted user, and one admin-seeded doc.
async function setup(
  admin: TestClient,
  createUser: (o?: { roles?: string[] }) => Promise<TestClient>,
) {
  await admin.post('/api/doctype', {
    name: DT,
    columns: [
      { column_name: 'employee', column_type: 'Data' },
      { column_name: 'salary', column_type: 'Currency', tier: 'restricted' },
    ],
  })
  await admin.post('/api/save_doc', { doctype: 'Role', doc: { name: ROLE } })
  // basic-tier read+write only (no restricted-tier grant)
  await admin.post('/api/save_doc', {
    doctype: 'Permission',
    doc: { ref_table: DT, role: ROLE, tier: 'basic', can_read: true, can_write: true, can_create: true },
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

describe('PERM-006: field-level (tier) permissions', () => {
  test('restricted-tier field is omitted from reads for a basic-tier user', async ({ admin, createUser }) => {
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

  test('basic-tier user cannot write the restricted-tier field (silently ignored, not escalated)', async ({
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

    // basic-tier user tries to bump salary
    const res = await user.fetch(`/api/resource/${encodeURIComponent(DT)}/${name}`, {
      method: 'PUT',
      body: JSON.stringify({ updated_at: cur.updated_at, employee: 'Alice B', salary: 99999 }),
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

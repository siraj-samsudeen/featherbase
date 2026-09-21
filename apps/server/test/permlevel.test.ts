import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { createUserWithRole, makeTable, patchDoc, type TableRef } from './fixtures'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'

const DT = 'Pl Salary'
const ROLE = 'Pl Role'

// Per-test world: the Table (salary at tier 'restricted'), the role with a
// basic-tier grant only, a restricted user, and one admin-seeded doc.
async function setup(
  admin: TestClient,
  createUser: CreateUserFn,
): Promise<{ user: TestClient; dt: TableRef }> {
  const dt = await makeTable(admin, {
    name: DT,
    columns: [
      'employee',
      { column_name: 'salary', column_type: 'Currency', tier: 'restricted' },
    ],
  })
  // basic-tier read+write only (no restricted-tier grant)
  const user = await createUserWithRole(admin, createUser, {
    role: ROLE,
    table: DT,
    tier: 'basic',
    can_read: true,
    can_write: true,
    can_create: true,
  })
  // admin seeds a doc with a salary (post() throws unless the insert lands)
  await admin.post(dt.url, { employee: 'Alice', salary: 5000 })
  return { user, dt }
}

describe('PERM-006: field-level (tier) permissions', () => {
  test('restricted-tier field is omitted from reads for a basic-tier user', async ({ admin, createUser }) => {
    const { user, dt } = await setup(admin, createUser)
    const list = await user.get<{ data: { row_id: string }[] }>(dt.listUrl({ fields: ['row_id'] }))
    const name = list.data[0].row_id
    const doc = await user.get<Record<string, unknown>>(dt.rowUrl(name))
    expect(doc.employee).toBe('Alice')
    expect('salary' in doc).toBe(false)

    // admin still sees it
    const adminDoc = await admin.get<Record<string, unknown>>(dt.rowUrl(name))
    expect(Number(adminDoc.salary)).toBe(5000)
  })

  test('basic-tier user cannot write the restricted-tier field (silently ignored, not escalated)', async ({
    admin,
    createUser,
  }) => {
    const { user, dt } = await setup(admin, createUser)
    const list = await user.get<{ data: { row_id: string }[] }>(dt.listUrl({ fields: ['row_id'] }))
    const name = list.data[0].row_id
    const cur = await admin.get<Record<string, unknown>>(dt.rowUrl(name))

    // basic-tier user tries to bump salary
    const res = await user.fetch(dt.rowUrl(name), {
      method: 'PATCH',
      body: JSON.stringify({ updated_at: cur.updated_at, employee: 'Alice B', salary: 99999 }),
    })
    expect(res.status).toBe(200)
    // salary unchanged, employee changed
    const after = await admin.get<Record<string, unknown>>(dt.rowUrl(name))
    expect(Number(after.salary)).toBe(5000)
    expect(after.employee).toBe('Alice B')
  })

  test('document activity omits restricted field values from a basic-tier reader', async ({
    admin,
    createUser,
  }) => {
    const { user, dt } = await setup(admin, createUser)
    const list = await admin.get<{ data: { row_id: string }[] }>(dt.listUrl({ fields: ['row_id'] }))
    const name = list.data[0].row_id
    const before = await admin.get<Record<string, unknown>>(dt.rowUrl(name))
    await patchDoc(admin, dt.rowUrl(name), {
      updated_at: before.updated_at,
      employee: 'Alice B',
      salary: 6500,
    })

    const activity = await user.get<{
      versions: { data: { changed: [string, unknown, unknown][] } }[]
    }>(`/api/activity/${encodeURIComponent(DT)}/${name}`)
    const changed = activity.versions.flatMap((version) => version.data.changed)
    expect(changed).toContainEqual(['employee', 'Alice', 'Alice B'])
    expect(changed.some(([field]) => field === 'salary')).toBe(false)
    expect(JSON.stringify(activity)).not.toContain('6500')
  })
})

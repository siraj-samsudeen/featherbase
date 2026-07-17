import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { getRoles } from '../src/permissions'
import type { TestClient } from 'feather-testing-postgres'

const USER = 'roletest@x.com'

// Each test creates the user inside its own rolled-back transaction — no
// shared beforeAll state and no cleanup.
async function makeUser(admin: TestClient) {
  await admin.post('/api/save_doc', {
    doctype: 'User',
    doc: { name: USER, email: USER, enabled: true },
  })
}

describe('PERM-001: role model', () => {
  test('a fresh user has only the implicit All role', async ({ admin }) => {
    await makeUser(admin)
    expect(await getRoles(USER)).toEqual(['All'])
  })

  test('assigning roles via the API changes get_roles output; removing reverts it', async ({
    admin,
  }) => {
    await makeUser(admin)
    const doc = await admin.get<Record<string, unknown>>(`/api/doc/User/${encodeURIComponent(USER)}`)
    const assign = await admin.fetch('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({
        doctype: 'User',
        doc: {
          name: USER,
          modified: doc.modified,
          roles: [{ role: 'System Manager' }, { role: 'Guest' }],
        },
      }),
    })
    expect(assign.status).toBe(201)
    expect(await getRoles(USER)).toEqual(['All', 'Guest', 'System Manager'])

    const doc2 = await admin.get<Record<string, unknown>>(
      `/api/doc/User/${encodeURIComponent(USER)}`,
    )
    const remove = await admin.fetch('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({
        doctype: 'User',
        doc: { name: USER, modified: doc2.modified, roles: [{ role: 'Guest' }] },
      }),
    })
    expect(remove.status).toBe(201)
    expect(await getRoles(USER)).toEqual(['All', 'Guest'])
  })

  test('assigning a nonexistent role fails link validation', async ({ admin }) => {
    await makeUser(admin)
    const doc = await admin.get<Record<string, unknown>>(`/api/doc/User/${encodeURIComponent(USER)}`)
    await expect(
      admin.post('/api/save_doc', {
        doctype: 'User',
        doc: { name: USER, modified: doc.modified, roles: [{ role: 'Fake Role' }] },
      }),
    ).rejects.toMatchObject({ status: 417 })
  })

  test('whoami reports roles', async ({ admin }) => {
    const me = await admin.get<{ roles: string[] }>('/api/whoami')
    expect(me.roles).toContain('System Manager')
    expect(me.roles).toContain('All')
  })
})

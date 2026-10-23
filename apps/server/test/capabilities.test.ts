// #410: /api/whoami carries a small `capabilities` object, computed on the
// server from the person's current roles and grants. The web shell draws only
// what the person can use from it; the server already refuses everything else.
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { VIEWER_ROLE } from '../src/sales-target'

type Caps = { manage: boolean; report: boolean; table_access: boolean; tables: string[] }
type Admin = TestClient

async function capsOf(client: { get: <T>(path: string) => Promise<T> }): Promise<Caps> {
  return (await client.get<{ capabilities: Caps }>('/api/whoami')).capabilities
}

async function seedRoleAndTable(admin: Admin) {
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: VIEWER_ROLE } })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Shelf Clerk' } })
  await admin.post('/api/table_def', {
    name: 'Shelf Note',
    columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }],
  })
}

describe('#410 capabilities in whoami', () => {
  test('a System Manager can manage and sees every table', async ({ admin }) => {
    await seedRoleAndTable(admin)
    const caps = await capsOf(admin)
    expect(caps).toMatchObject({ manage: true, report: false, table_access: true })
    expect(caps.tables).toContain('Shelf Note')
  })

  test('a person holding only the Sales Target Viewer role gets the report and nothing else', async ({ admin, createUser }) => {
    await seedRoleAndTable(admin)
    const tl = await createUser({ email: 'tl.viewer@example.com', roles: [VIEWER_ROLE] })
    expect(await capsOf(tl)).toEqual({ manage: false, report: true, table_access: false, tables: [] })
  })

  test('a person with a read grant sees exactly the tables they can read', async ({ admin, createUser }) => {
    await seedRoleAndTable(admin)
    await admin.post('/api/save_row', {
      table: 'Permission',
      row: { ref_table: 'Shelf Note', role: 'Shelf Clerk', can_read: true },
    })
    const clerk = await createUser({ email: 'clerk@example.com', roles: ['Shelf Clerk'] })
    expect(await capsOf(clerk)).toEqual({ manage: false, report: false, table_access: true, tables: ['Shelf Note'] })
  })

  test('a person with no role beyond the implicit one has no capability at all', async ({ admin, createUser }) => {
    await seedRoleAndTable(admin)
    const nobody = await createUser({ email: 'nobody@example.com' })
    expect(await capsOf(nobody)).toEqual({ manage: false, report: false, table_access: false, tables: [] })
  })

  test('a grant removed mid-session is reflected on the next call', async ({ admin, createUser }) => {
    await seedRoleAndTable(admin)
    const perm = await admin.post<{ row_id: string }>('/api/save_row', {
      table: 'Permission',
      row: { ref_table: 'Shelf Note', role: 'Shelf Clerk', can_read: true },
    })
    const clerk = await createUser({ email: 'clerk2@example.com', roles: ['Shelf Clerk'] })
    expect((await capsOf(clerk)).table_access).toBe(true)
    await admin.delete(`/api/table/Permission/${encodeURIComponent(perm.row_id)}`)
    expect(await capsOf(clerk)).toMatchObject({ table_access: false, tables: [] })
  })
})

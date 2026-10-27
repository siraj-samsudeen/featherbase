// #410: /api/whoami carries a small `capabilities` object, computed on the
// server from the person's current roles and grants. The web shell draws only
// what the person can use from it; the server already refuses everything else.
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { VIEWER_ROLE } from '../src/sales-target'

type Caps = { manage: boolean; report: boolean; admin: boolean; own_grant: boolean; tables: string[]; creatable: string[] }
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
  test('a System Manager can manage; the Table list is not repeated in whoami', async ({ admin }) => {
    await seedRoleAndTable(admin)
    expect(await capsOf(admin)).toEqual({ manage: true, report: false, admin: true, own_grant: true, tables: [], creatable: [] })
  })

  test('a person holding only the Sales Target Viewer role gets the report and nothing else', async ({ admin, createUser }) => {
    await seedRoleAndTable(admin)
    const tl = await createUser({ email: 'tl.viewer@example.com', roles: [VIEWER_ROLE] })
    expect(await capsOf(tl)).toEqual({ manage: false, report: true, admin: false, own_grant: false, tables: [], creatable: [] })
  })

  test('a person with a read grant sees exactly the tables they can read', async ({ admin, createUser }) => {
    await seedRoleAndTable(admin)
    await admin.post('/api/save_row', {
      table: 'Permission',
      row: { ref_table: 'Shelf Note', role: 'Shelf Clerk', can_read: true },
    })
    const clerk = await createUser({ email: 'clerk@example.com', roles: ['Shelf Clerk'] })
    expect(await capsOf(clerk)).toEqual({ manage: false, report: false, admin: true, own_grant: true, tables: ['Shelf Note'], creatable: [] })
  })

  test('a person with no role beyond the implicit one has no capability at all', async ({ admin, createUser }) => {
    await seedRoleAndTable(admin)
    const nobody = await createUser({ email: 'nobody@example.com' })
    expect(await capsOf(nobody)).toEqual({ manage: false, report: false, admin: false, own_grant: false, tables: [], creatable: [] })
  })

  test('a grant removed mid-session is reflected on the next call', async ({ admin, createUser }) => {
    await seedRoleAndTable(admin)
    const perm = await admin.post<{ row_id: string }>('/api/save_row', {
      table: 'Permission',
      row: { ref_table: 'Shelf Note', role: 'Shelf Clerk', can_read: true },
    })
    const clerk = await createUser({ email: 'clerk2@example.com', roles: ['Shelf Clerk'] })
    expect((await capsOf(clerk)).admin).toBe(true)
    await admin.delete(`/api/table/Permission/${encodeURIComponent(perm.row_id)}`)
    expect(await capsOf(clerk)).toMatchObject({ admin: false, tables: [] })
  })

  test('creatable names the Tables the person may add rows to', async ({ admin, createUser }) => {
    await seedRoleAndTable(admin)
    await admin.post('/api/save_row', {
      table: 'Permission',
      row: { ref_table: 'Shelf Note', role: 'Shelf Clerk', can_read: true, can_create: true },
    })
    const clerk = await createUser({ email: 'clerk3@example.com', roles: ['Shelf Clerk'] })
    expect(await capsOf(clerk)).toMatchObject({ tables: ['Shelf Note'], creatable: ['Shelf Note'] })
  })

  test('sub-tables and dropped Tables never count, so a grant on one earns nothing', async ({ admin, createUser }) => {
    await seedRoleAndTable(admin)
    await admin.post('/api/table_def', {
      name: 'Shelf Line',
      kind: 'sub_table',
      columns: [{ column_name: 'qty', column_type: 'Int', label: 'Qty' }],
    })
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Shelf Line', role: 'Shelf Clerk', can_read: true } })
    // A grant left behind for a Table that no longer exists.
    await sql`insert into permission (row_id, ref_table, role, tier, can_read) values ('ghost-grant', 'Gone Table', 'Shelf Clerk', 'basic', true)`
    const clerk = await createUser({ email: 'clerk4@example.com', roles: ['Shelf Clerk'] })
    expect(await capsOf(clerk)).toEqual({ manage: false, report: false, admin: false, own_grant: false, tables: [], creatable: [] })
  })

  test('a grant to the built-in All role lists the Table but does not earn the Admin shell', async ({ admin, createUser }) => {
    await seedRoleAndTable(admin)
    // Runtime apps write these straight to the table; `All` is implicit, not a Role row.
    await sql`insert into permission (row_id, ref_table, role, tier, can_read) values ('all-grant', 'Shelf Note', 'All', 'basic', true)`
    const viewer = await createUser({ email: 'viewer-all@example.com', roles: [VIEWER_ROLE] })
    expect(await capsOf(viewer)).toEqual({ manage: false, report: true, admin: false, own_grant: false, tables: ['Shelf Note'], creatable: [] })
    // With a grant of their own, the same person earns the shell and still sees the All-granted Table.
    await admin.post('/api/table_def', { name: 'Back Office', columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }] })
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Back Office', role: 'Shelf Clerk', can_read: true } })
    const clerk = await createUser({ email: 'clerk5@example.com', roles: ['Shelf Clerk'] })
    expect(await capsOf(clerk)).toMatchObject({ admin: true, tables: ['Back Office', 'Shelf Note'] })
  })

  test('own_grant is false for a shared row alone, true for a create-only grant', async ({ admin, createUser }) => {
    await seedRoleAndTable(admin)
    const row = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Shelf Note', row: { title: 'Hello' } })
    const guest = await createUser({ email: 'guest@example.com' })
    await admin.post('/api/save_row', { table: 'Share', row: { share_table: 'Shelf Note', share_name: row.row_id, person: guest.user, read: true } })
    expect(await capsOf(guest)).toMatchObject({ admin: true, own_grant: false, tables: [] })

    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Shelf Note', role: 'Shelf Clerk', can_create: true } })
    const writer = await createUser({ email: 'writer@example.com', roles: ['Shelf Clerk'] })
    expect(await capsOf(writer)).toMatchObject({ admin: true, own_grant: true, tables: [], creatable: ['Shelf Note'] })
  })
})

// #671: the shared top bar leads to an installed app, and names it on the
// account page, without asking the Admin's own endpoints: whoami says which
// installed apps the person can open.
describe('whoami lists the installed apps the person can open', () => {
  test('a person who can open an installed app finds it in whoami', async ({ admin, createUser }) => {
    const { discoverPackages } = await import('../src/runtime-packages')
    const { resolve } = await import('node:path')
    try {
      expect(await discoverPackages([resolve('../..', 'runtime-apps/fixtures/dash-stand-in')])).toEqual([])
      await admin.post('/api/install_app', { name: 'feather_dash' })
      const reader = await createUser({ email: 'dash.whoami@example.com' })
      expect((await reader.get<{ apps: unknown }>('/api/whoami')).apps).toEqual([{ name: 'feather_dash', title: 'Dash stand-in' }])
    } finally {
      // The installed app stays loaded in this process after its rows roll back.
      await discoverPackages([])
    }
  })

  // Codex round 1 on #672: a disabled app cannot be opened, so it names no
  // one's account page; it is still installed, so the bar still leads to it.
  test('a disabled app is installed but not among the apps the person can open', async ({ admin, createUser }) => {
    const { discoverPackages } = await import('../src/runtime-packages')
    const { resolve } = await import('node:path')
    try {
      expect(await discoverPackages([resolve('../..', 'runtime-apps/fixtures/dash-stand-in')])).toEqual([])
      await admin.post('/api/install_app', { name: 'feather_dash' })
      await admin.post('/api/set_app_enabled', { name: 'feather_dash', enabled: false })
      const reader = await createUser({ email: 'dash.whoami.disabled@example.com' })
      const whoami = await reader.get<{ apps: unknown; installed_apps: string[] }>('/api/whoami')
      expect({ apps: whoami.apps, installed: whoami.installed_apps?.includes('feather_dash') }).toEqual({ apps: [], installed: true })
    } finally {
      await discoverPackages([])
    }
  })
})

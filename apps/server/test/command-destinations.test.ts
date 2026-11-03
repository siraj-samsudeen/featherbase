import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'

// Public inventory contract: Table names stay canonical; pages carry their
// existing href. The browser never derives resource identities from slugs.
interface Inventory {
  tables: { row_id: string; label: string; kind: string; can_create: boolean }[]
  pages: { label: string; href: string; kind: string }[]
}
const PATH = '/api/command_destinations'

describe('#737 command destinations', () => {
  test('the inventory includes every standalone Table beyond the old limit', async ({ admin }) => {
    // Metadata is the discovery source: these rows deliberately need no
    // physical tables, so accidentally discovering records cannot pass.
    const names = Array.from({ length: 205 }, (_, i) => `Inventory Probe ${String(i).padStart(3, '0')}`)
    await sql`insert into table_def ${sql(names.map((name) => ({ name, module: 'Inventory', kind: 'table' })))}`
    await sql`insert into table_def (name, kind) values ('Inventory Child', 'sub_table')`
    await sql`insert into data_source (row_id, engine, url_env, access)
      values ('unconnected', 'postgres', 'INVENTORY_INTENTIONALLY_UNSET', 'read_only')`
    await sql`insert into table_def (name, kind, label, data_source, external_table, external_pk)
      values ('inventory_remote', 'table', 'Remote inventory', 'unconnected', 'items', 'id')`
    const inventory = await admin.get<Inventory>(PATH)
    expect(inventory.tables.filter((t) => t.row_id.startsWith('Inventory Probe')).map((t) => t.row_id)).toEqual(names)
    expect(inventory.tables.map((t) => t.row_id)).not.toContain('Inventory Child')
    expect(inventory.tables.find((t) => t.row_id === 'System Settings')).toMatchObject({ kind: 'settings', can_create: false })
    expect(inventory.tables.find((t) => t.row_id === 'inventory_remote')).toMatchObject({ label: 'Remote inventory', kind: 'table' })
    for (const name of ['App Setting', 'Sign In Method', 'Data Source'])
      expect(inventory.tables.map((t) => t.row_id)).toContain(name)
  })

  test('manager pages use openable destinations rather than route templates', async ({ admin }) => {
    const dashboardNames = Array.from({ length: 501 }, (_, i) => `Inventory board ${i}`)
    await sql`insert into dashboard ${sql(dashboardNames.map((row_id) => ({ row_id, config: '{}' })))}`
    const { pages } = await admin.get<Inventory>(PATH)
    for (const slug of ['access-tokens', 'jobs', 'instance-health', 'all-tables', 'import', 'imports', 'apps', 'glossary'])
      expect(pages.map((p) => p.href)).toContain(`/featherbase/admin/${slug}`)
    expect(pages.filter((p) => p.label.startsWith('Inventory board '))).toHaveLength(501)
    expect(pages.map((p) => p.href)).toContain('/featherbase/account/sign-in-methods')
    expect(pages.every((p) => !p.href.includes('$'))).toBe(true)
    expect(new Set(pages.map((p) => p.href)).size).toBe(pages.length)
  })

  test('a reader receives only permitted destinations', async ({ admin, createUser }) => {
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Inventory Reader' } })
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Person', role: 'Inventory Reader', can_read: true } })
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'System Settings', role: 'Inventory Reader', can_read: true } })
    await admin.post('/api/save_row', { table: 'Home Page', row: { row_id: 'inventory-hidden', label: 'Secret inventory page', roles: [{ role: 'System Manager' }] } })
    const reader = await createUser({ roles: ['Inventory Reader'] })
    const inventory = await reader.get<Inventory>(PATH)
    expect(inventory.tables.map((t) => t.row_id)).toEqual(['Glossary Term', 'Person', 'System Settings'])
    expect(inventory.tables.every((t) => !t.can_create)).toBe(true)
    for (const slug of ['jobs', 'instance-health', 'apps', 'import', 'imports', 'waiting-for-access', 'setup', 'setup/people', 'find-person'])
      expect(inventory.pages.map((p) => p.href)).not.toContain(`/featherbase/admin/${slug}`)
    expect(inventory.pages.map((p) => p.label)).not.toContain('Secret inventory page')
    expect(inventory.pages.map((p) => p.href)).toContain('/featherbase/admin/glossary')
    expect(inventory.pages.map((p) => p.href)).toContain('/featherbase/account/sign-in-methods')
  })

  test('people without Admin access cannot obtain the Admin inventory', async ({ createUser }) => {
    const outsider = await createUser({ roles: [] })
    const res = await outsider.fetch(PATH)
    expect(res.status).toBe(403)
  })

  test('unavailable app Tables are excluded even for Administrator', async ({ admin }) => {
    await sql`insert into table_def (name, kind, owner_app, physical_schema, physical_relation)
      values ('missing.Inventory', 'table', 'missing', 'missing', 'inventory')`
    const inventory = await admin.get<Inventory>(PATH)
    expect(inventory.tables.map((t) => t.row_id)).not.toContain('missing.Inventory')
  })

  test('a named page is narrowed by the same row scope as its underlying read', async ({ admin, createUser }) => {
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Inventory Author' } })
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Dashboard', role: 'Inventory Author', can_read: true, own_rows_only: true } })
    const reader = await createUser({ roles: ['Inventory Author'] })
    await admin.post('/api/save_row', { table: 'Dashboard', row: { row_id: 'Hidden inventory dashboard', config: '{}' } })
    await sql`insert into dashboard (row_id, created_by, config) values ('Own / Inventory', ${reader.user}, '{}')`
    const { pages } = await reader.get<Inventory>(PATH)
    expect(pages.map((p) => p.label)).toContain('Own / Inventory')
    expect(pages.map((p) => p.label)).not.toContain('Hidden inventory dashboard')
    expect(pages.find((p) => p.label === 'Own / Inventory')?.href).toBe('/featherbase/admin/dashboard/Own%20%2F%20Inventory')
  })
})

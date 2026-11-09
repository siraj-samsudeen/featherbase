import { describe, expect, vi } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'
import * as metadata from '../src/meta'
import * as query from '../src/query'
import * as reports from '../src/script-report'
import { AppError } from '../src/errors'
import { expectStatus, grantRole } from './fixtures'

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
    expect(pages.map((p) => p.href)).not.toContain('/featherbase/sales-target')
    expect(pages.every((p) => !p.href.includes('$'))).toBe(true)
    expect(new Set(pages.map((p) => p.href)).size).toBe(pages.length)
  })

  test('named destinations include only openable reports and published forms', async ({ admin }) => {
    for (const [name, type, script] of [
      ['Inventory / people', 'Script Report', 'Person Report'],
      ['Inventory missing script', 'Script Report', 'No inventory script'],
      ['Inventory builder', 'Report Builder', ''],
    ]) {
      await admin.post('/api/save_row', { table: 'Report', row: {
        row_id: name, ref_table: 'Person', report_type: type, report_script: script,
      } })
    }
    for (const [name, title, route, published] of [
      ['Inventory public', 'Inventory intake', 'inventory/intake', true],
      ['Inventory draft', 'Inventory draft', 'inventory-draft', false],
      ['Inventory untitled', 'Temporary title', 'inventory-untitled', true],
    ] as const) {
      await admin.post('/api/save_row', { table: 'Web Form', row: {
        row_id: name, title, route, published, ref_table: 'Person', web_fields: ['full_name'],
      } })
    }
    // Existing metadata may lack display labels; canonical identities remain
    // discoverable rather than producing an empty result label.
    await sql`update web_form set title = '' where row_id = 'Inventory untitled'`
    await sql`insert into home_page (row_id, label) values ('inventory-unlabelled', '')`
    const { pages } = await admin.get<Inventory>(PATH)
    expect(pages).toContainEqual({ label: 'Inventory / people', href: '/featherbase/admin/script-report/Inventory%20%2F%20people', kind: 'Report' })
    expect(pages).toContainEqual({ label: 'Inventory intake', href: '/featherbase/form/inventory%2Fintake', kind: 'Web Form' })
    expect(pages).toContainEqual({ label: 'Inventory untitled', href: '/featherbase/form/inventory-untitled', kind: 'Web Form' })
    expect(pages).toContainEqual({ label: 'inventory-unlabelled', href: '/featherbase/admin/home/inventory-unlabelled', kind: 'Home Page' })
    for (const label of ['Inventory missing script', 'Inventory builder', 'Inventory draft'])
      expect(pages.map((page) => page.label)).not.toContain(label)
  })

  test('a reader receives only permitted destinations', async ({ admin, createUser }) => {
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Inventory Reader' } })
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Sales Target Viewer' } })
    await grantRole(admin, { table: 'Person', role: 'Inventory Reader', can_read: true })
    await grantRole(admin, { table: 'System Settings', role: 'Inventory Reader', can_read: true })
    await admin.post('/api/save_row', { table: 'Home Page', row: { row_id: 'inventory-hidden', label: 'Secret inventory page', roles: [{ role: 'System Manager' }] } })
    const reader = await createUser({ roles: ['Inventory Reader', 'Sales Target Viewer'] })
    const inventory = await reader.get<Inventory>(PATH)
    expect(inventory.tables.map((t) => t.row_id)).toEqual(['Glossary Term', 'Person', 'System Settings'])
    expect(inventory.tables.every((t) => !t.can_create)).toBe(true)
    for (const slug of ['jobs', 'instance-health', 'apps', 'import', 'imports', 'waiting-for-access', 'setup', 'setup/person', 'find-person'])
      expect(inventory.pages.map((p) => p.href)).not.toContain(`/featherbase/admin/${slug}`)
    expect(inventory.pages.map((p) => p.label)).not.toContain('Secret inventory page')
    expect(inventory.pages.map((p) => p.href)).toContain('/featherbase/admin/glossary')
    expect(inventory.pages.map((p) => p.href)).toContain('/featherbase/account/sign-in-methods')
    expect(inventory.pages).toContainEqual({ label: 'Dash', href: '/featherbase/sales-target', kind: 'Report' })
  })

  test('people without Admin access cannot obtain the Admin inventory', async ({ createUser }) => {
    const outsider = await createUser({ roles: [] })
    const res = await outsider.fetch(PATH)
    await expectStatus(res, 403)
  })

  test('a legacy override refusal preserves the permitted navigation inventory', async ({ admin, createUser }) => {
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Legacy Inventory Reader' } })
    await grantRole(admin, { table: 'Person', role: 'Legacy Inventory Reader', can_read: true })
    const reader = await createUser({ roles: ['Legacy Inventory Reader'] })
    await sql`insert into metadata_override (row_id, table_name, property, value)
      values ('inventory-legacy-person', 'Person', 'autoname', 'legacy'),
             ('inventory-legacy-dashboard', 'Dashboard', 'autoname', 'legacy')`
    invalidateMeta('Person')
    invalidateMeta('Dashboard')

    const res = await admin.fetch(PATH)
    await expectStatus(res, 200)
    const inventory = await res.json() as Inventory
    for (const name of ['Person', 'Dashboard'])
      expect(inventory.tables.find((t) => t.row_id === name)).toMatchObject({ label: name, kind: 'table', can_create: false })
    expect(inventory.pages.map((p) => p.href)).toContain('/featherbase/admin/instance-health')
    const limited = await reader.get<Inventory>(PATH)
    expect(limited.tables.map((t) => t.row_id)).toEqual(['Glossary Term', 'Person'])
    expect(limited.tables.every((t) => !t.can_create)).toBe(true)
    expect(limited.pages.map((p) => p.href)).not.toContain('/featherbase/admin/instance-health')
    const meta = await admin.fetch('/api/table/Person:meta')
    await expectStatus(meta, 417)
    expect((await meta.json()).error.type).toBe('ValidationError')
  })

  test('unavailable app Tables are excluded even for Administrator', async ({ admin }) => {
    await sql`insert into table_def (name, kind, owner_app, physical_schema, physical_relation)
      values ('missing.Inventory', 'table', 'missing', 'missing', 'inventory')`
    const inventory = await admin.get<Inventory>(PATH)
    expect(inventory.tables.map((t) => t.row_id)).not.toContain('missing.Inventory')
  })

  test('unrelated metadata and named-read failures are not a successful partial inventory', async ({ admin }) => {
    const original = metadata.getMeta
    const metaFailure = vi.spyOn(metadata, 'getMeta').mockImplementation(async (name) => {
      if (name === 'Person') throw new AppError('ValidationError', 'Unrelated inventory validation')
      return original(name)
    })
    try {
      const response = await admin.fetch(PATH)
      await expectStatus(response, 417)
      expect((await response.json()).error).toMatchObject({ type: 'ValidationError', message: 'Unrelated inventory validation' })
    } finally { metaFailure.mockRestore() }

    const readFailure = vi.spyOn(query, 'getList').mockRejectedValue(new AppError('ValidationError', 'Unrelated named-read validation'))
    try {
      const response = await admin.fetch(PATH)
      await expectStatus(response, 417)
      expect((await response.json()).error).toMatchObject({ type: 'ValidationError', message: 'Unrelated named-read validation' })
    } finally { readFailure.mockRestore() }

    await admin.post('/api/save_row', { table: 'Report', row: {
      row_id: 'Inventory failing report', ref_table: 'Person', report_type: 'Script Report', report_script: 'Person Report',
    } })
    const reportFailure = vi.spyOn(reports, 'scriptReportMeta').mockRejectedValue(new AppError('InternalError', 'Report metadata failure'))
    try {
      const response = await admin.fetch(PATH)
      await expectStatus(response, 500)
      expect((await response.json()).error.type).toBe('InternalError')
    } finally { reportFailure.mockRestore() }
  })

  test('a refused named-resource read omits its pages without losing the other destinations', async ({ admin }) => {
    await admin.post('/api/save_row', { table: 'Dashboard', row: { row_id: 'Inventory denied board', config: '{}' } })
    const original = query.getList
    const refusal = vi.spyOn(query, 'getList').mockImplementation(async (table, ...args) => {
      if (table === 'Dashboard') throw new AppError('PermissionError', 'Dashboard access withdrawn')
      return original(table, ...args)
    })
    try {
      const inventory = await admin.get<Inventory>(PATH)
      expect(inventory.pages.some((page) => page.kind === 'Dashboard')).toBe(false)
      expect(inventory.pages.map((page) => page.href)).toContain('/featherbase/admin/instance-health')
      expect(inventory.tables.map((table) => table.row_id)).toContain('Person')
    } finally { refusal.mockRestore() }
  })

  test('a named page is narrowed by the same row scope as its underlying read', async ({ admin, createUser }) => {
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Inventory Author' } })
    await grantRole(admin, { table: 'Dashboard', role: 'Inventory Author', can_read: true, own_rows_only: true })
    const reader = await createUser({ roles: ['Inventory Author'] })
    await admin.post('/api/save_row', { table: 'Dashboard', row: { row_id: 'Hidden inventory dashboard', config: '{}' } })
    await sql`insert into dashboard (row_id, created_by, config) values ('Own / Inventory', ${reader.user}, '{}')`
    const { pages } = await reader.get<Inventory>(PATH)
    expect(pages.map((p) => p.label)).toContain('Own / Inventory')
    expect(pages.map((p) => p.label)).not.toContain('Hidden inventory dashboard')
    expect(pages.find((p) => p.label === 'Own / Inventory')?.href).toBe('/featherbase/admin/dashboard/Own%20%2F%20Inventory')
  })
})

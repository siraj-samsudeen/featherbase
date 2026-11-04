import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { installApp, registerApp, uninstallApp } from '../src/apps'
import { sameStoredValue } from '../src/permissions'
import { readLegacyPermission } from '../src/app-permission-format'

// #917: a Permission row names one operation and the Columns it reaches; the
// rows that would mean something else are refused when saved.
const DT = 'Pr Ledger'
const ROLE = 'Pr Clerk'

async function setup(admin: TestClient) {
  await admin.post('/api/table_def', { name: 'Pr Line', kind: 'sub_table', columns: [{ column_name: 'qty', column_type: 'Int' }] })
  await admin.post('/api/table_def', { name: DT, columns: [
    { column_name: 'title', column_type: 'Data' }, { column_name: 'lines', column_type: 'Sub-table', row_table: 'Pr Line' },
  ] })
  await admin.post('/api/table_def', { name: 'Pr Other', columns: [{ column_name: 'note', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: ROLE } })
  const columns = async (table: string) => (await admin.get<{ columns: { row_id: string; column_name: string }[] }>(
    `/api/table/Table/${encodeURIComponent(table)}`)).columns
  const id = async (table: string, name: string) => (await columns(table)).find((c) => c.column_name === name)!.row_id
  return { id }
}

const refuse = (admin: TestClient, row: Record<string, unknown>, message: string) =>
  expect(admin.post('/api/save_row', { table: 'Permission', row: { ref_table: DT, role: ROLE, ...row } }))
    .rejects.toMatchObject({ status: 417, message: expect.stringContaining(message) })

describe('a Permission row that would mean something else is refused', () => {
  test('identifier reading belongs to Person only', async ({ admin }) => {
    await setup(admin)
    await refuse(admin, { operation: 'read_identifiers' }, 'applies only to Person')
  })

  test('each listed Column once, from the target Table, for a Column operation of a listed rule', async ({ admin }) => {
    const { id } = await setup(admin)
    const title = await id(DT, 'title')
    await refuse(admin, { operation: 'read', column_rule: 'listed', columns: [{ target_column: title }, { target_column: title }] }, 'only once')
    await refuse(admin, { operation: 'read', column_rule: 'listed', columns: [{ target_column: await id('Pr Other', 'note') }] }, 'belong to the target Table')
    await refuse(admin, { operation: 'delete', column_rule: 'listed', columns: [{ target_column: title }] }, 'applies to a Row')
    await refuse(admin, { operation: 'read', column_rule: 'basic', columns: [{ target_column: title }] }, 'only when the permission reaches only the columns listed')
  })

  test('a prerequisite covers the same Table and operation, without a cycle', async ({ admin }) => {
    await setup(admin)
    const other = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Permission', row: { ref_table: 'Pr Other', role: ROLE, operation: 'read' } })
    await refuse(admin, { operation: 'read', column_rule: 'every', requires_permission: other.row_id }, 'same Table and operation')
    const base = await admin.post<{ row_id: string; updated_at: string }>('/api/save_row', { table: 'Permission', row: { ref_table: DT, role: ROLE, operation: 'read' } })
    const extension = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Permission', row: {
      ref_table: DT, role: ROLE, operation: 'read', column_rule: 'every', requires_permission: base.row_id } })
    const current = await admin.get<Record<string, unknown>>(`/api/table/Permission/${base.row_id}`)
    await expect(admin.post('/api/save_row', { table: 'Permission', row: { ...current, requires_permission: extension.row_id } }))
      .rejects.toMatchObject({ status: 417, message: expect.stringContaining('cycle') })
  })

  test('a line-item grant names a grid its parent reaches, for the same operation', async ({ admin }) => {
    const { id } = await setup(admin)
    const lines = await id(DT, 'lines')
    const parent = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Permission', row: {
      ref_table: DT, role: ROLE, operation: 'read', column_rule: 'listed', columns: [{ target_column: await id(DT, 'title') }] } })
    const child = { ref_table: 'Pr Line', role: ROLE, operation: 'read', parent_permission: parent.row_id, parent_column: lines }
    await expect(admin.post('/api/save_row', { table: 'Permission', row: child }))
      .rejects.toMatchObject({ status: 417, message: expect.stringContaining('selected parent Column') })
    await expect(admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Pr Line', role: ROLE, operation: 'read', parent_column: lines } }))
      .rejects.toMatchObject({ status: 417, message: expect.stringContaining('requires a parent permission') })
    const basic = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Permission', row: { ref_table: DT, role: ROLE, operation: 'update' } })
    expect(await admin.post('/api/save_row', { table: 'Permission', row: { ...child, operation: 'update', parent_permission: basic.row_id } }))
      .toMatchObject({ parent_permission: basic.row_id })
  })
})

describe('the grant matrix keeps a flag Row\'s app ownership', () => {
  test('an operation added to an app-owned basic grant is owned by that app', async ({ admin }) => {
    await setup(admin)
    const base = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Permission', row: { ref_table: DT, role: ROLE, operation: 'read' } })
    await sql`update permission set owner_app = 'pr_app' where row_id = ${base.row_id}`
    await admin.post(`/api/permissions/${encodeURIComponent(DT)}`, { role: ROLE, can_read: true, can_write: true })
    expect(await sql`select operation, owner_app from permission where ref_table = ${DT} and role = ${ROLE} order by operation`)
      .toEqual([{ operation: 'read', owner_app: 'pr_app' }, { operation: 'update', owner_app: 'pr_app' }])
  })
})

describe('an app grant naming Columns', () => {
  test('a listed Column the Table lacks refuses the install; a listed one is all it reaches', async () => {
    registerApp({ name: 'pr-bad-columns', tables: [], roles: ['Pr Lister'], permissions: [{ table: 'Comment', role: 'Pr Lister', operations: { read: ['no_such_column'] } }] })
    await expect(installApp('pr-bad-columns')).rejects.toMatchObject({ message: expect.stringContaining('unknown Column') })
    registerApp({ name: 'pr-columns', tables: [], roles: ['Pr Lister'], permissions: [{ table: 'Comment', role: 'Pr Lister', operations: { read: ['content'] } }] })
    await installApp('pr-columns')
    try {
      expect(await sql`select p.column_rule, c.column_name from permission p
        join featherbase.permission_column pc on pc.parent = p.row_id join column_def c on c.row_id = pc.target_column
        where p.role = 'Pr Lister'`).toEqual([{ column_rule: 'listed', column_name: 'content' }])
    } finally { await uninstallApp('pr-columns') }
  })
})

describe('a prerequisite that is not available', () => {
  test('a grant whose prerequisite belongs to an unavailable app contributes nothing', async ({ admin, createUser }) => {
    await setup(admin)
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Pr Detail' } })
    const base = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Permission', row: { ref_table: DT, role: 'Pr Detail', operation: 'read' } })
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: DT, role: 'Pr Detail', operation: 'read', column_rule: 'every', requires_permission: base.row_id } })
    await sql`update permission set owner_app = 'pr_missing_app' where row_id = ${base.row_id}`
    const user = await createUser({ roles: ['Pr Detail'] })
    expect((await user.fetch(`/api/table/${encodeURIComponent(DT)}`)).status).toBe(403)
  })
})

describe('how a released manifest grant is read', () => {
  test('flags become basic-level operations, creator-only becomes creator scope', () => {
    expect(readLegacyPermission({ table: 't.x', role: 'R', own_rows_only: true, can_read: true, can_write: true, can_delete: true }))
      .toEqual({ table: 't.x', role: 'R', scope_mode: 'creator', operations: { read: '@basic', update: '@basic', delete: true } })
  })

  test('a restricted-level declaration and a new-form declaration pass through for the schema to judge', () => {
    const restricted = { table: 't.x', role: 'R', tier: 'restricted', can_read: true }
    expect(readLegacyPermission(restricted)).toBe(restricted)
    const current = { table: 't.x', role: 'R', operations: { read: '*' } }
    expect(readLegacyPermission(current)).toBe(current)
    expect(readLegacyPermission(null)).toBeNull()
    const neither = { table: 't.x', role: 'R' }
    expect(readLegacyPermission(neither)).toBe(neither)
  })
})

describe('stored forms of the same value', () => {
  test.for([
    ['Time', '2026-11-04T10:00:00Z', new Date('2026-11-04T10:00:00Z'), true],
    ['JSON', { a: 1 }, '{"a":1}', true],
    ['JSON', '{"a":1}', '{"a":2}', false],
    ['JSON', 'not json', 'not json either', false],
    ['Date', 'not a date', 'not a date', true],
    ['Date', 'not a date', '2026-11-04', false],
    ['Float', 'x', 'y', false],
  ] as const)('%s %o vs %o', ([type, submitted, stored, same]) => {
    expect(sameStoredValue(type, submitted, stored)).toBe(same)
  })
})

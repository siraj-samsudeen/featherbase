import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { installApp, provisionGrants, registerApp, uninstallApp } from '../src/apps'
import { permittedColumns, sameStoredValue, tableAccessFor } from '../src/permissions'
import { childColumns } from '../src/row-readers'
import { enabledPeople } from '../src/people-directory'
import { getMeta, invalidateMeta } from '../src/meta'
import { checkRowForInsert } from '../src/document'
import { readLegacyPermission } from '../src/app-permission-format'
import { expectStatus } from './fixtures'

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
    registerApp({ name: 'pr-dotted-columns', tables: [], roles: ['Pr Lister'], permissions: [{ table: 'Comment', role: 'Pr Lister', operations: { read: ['content.nested'] } }] })
    await expect(installApp('pr-dotted-columns')).rejects.toMatchObject({ message: expect.stringContaining('unknown Column') })
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
    await expectStatus(await user.fetch(`/api/table/${encodeURIComponent(DT)}`), 403)
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

describe('a grant reaches only what its rows allow', () => {
  async function withLines(admin: TestClient) {
    await setup(admin)
    const [{ row_id }] = await sql`select row_id from column_def where parent = ${DT} and column_name = 'lines'`
    return String(row_id)
  }
  const insert = (row: Record<string, unknown>) => sql`insert into permission ${sql({ scope_mode: 'all', column_rule: 'basic', role: ROLE, ...row })}`
  async function holder() {
    await sql`insert into person (row_id, full_name, enabled) values ('psn_pr_holder', 'Holder', true)`
    await sql`insert into has_role (row_id, parent, parenttype, parentfield, role) values ('pr-held', 'psn_pr_holder', 'Person', 'roles', ${ROLE})`
    return 'psn_pr_holder'
  }

  test('an unknown Column rule reaches nothing', async ({ admin }) => {
    await withLines(admin)
    await insert({ row_id: 'pr-odd', ref_table: DT, operation: 'read', column_rule: 'someday' })
    expect([...await permittedColumns(await holder(), DT, 'read')]).toEqual([])
  })

  test('a link that is not on the Table lends nothing to its line items', async ({ admin }) => {
    await withLines(admin)
    await insert({ row_id: 'pr-base', ref_table: DT, operation: 'read' })
    expect([...await childColumns(await holder(), DT, 'Pr Line', 'no-such-link', 'read')]).toEqual([])
  })

  test("creator-only grants lend nothing on another person's row", async ({ admin }) => {
    const link = await withLines(admin)
    await insert({ row_id: 'pr-own', ref_table: DT, operation: 'read', scope_mode: 'creator' })
    await insert({ row_id: 'pr-all', ref_table: DT, operation: 'read' })
    await insert({ row_id: 'pr-line', ref_table: 'Pr Line', operation: 'read', scope_mode: 'creator', column_rule: 'every', parent_permission: 'pr-all', parent_column: link })
    const person = await holder()
    expect([...await childColumns(person, DT, 'Pr Line', link, 'read', 'someone-else')]).toEqual(['@basic'])
    expect((await childColumns(person, DT, 'Pr Line', link, 'read', person)).has('*')).toBe(true)
  })

  test('an insert rehearsal refuses what the real save would, line items included', async ({ admin }) => {
    await admin.post('/api/table_def', { name: 'Pr Cost Line', kind: 'sub_table', columns: [
      { column_name: 'note', column_type: 'Data' }, { column_name: 'cost', column_type: 'Data', tier: 'restricted' },
    ] })
    await admin.post('/api/table_def', { name: 'Pr Costed', columns: [
      { column_name: 'title', column_type: 'Data' }, { column_name: 'margin', column_type: 'Data', tier: 'restricted' },
      { column_name: 'lines', column_type: 'Sub-table', row_table: 'Pr Cost Line' },
    ] })
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: ROLE } })
    await insert({ row_id: 'pr-cost', ref_table: 'Pr Costed', operation: 'create' })
    const person = await holder()
    const meta = await getMeta('Pr Costed')
    expect(await checkRowForInsert(meta, { title: 'Fine', lines: [{ note: 'ok' }] }, person)).toBe('')
    await expect(checkRowForInsert(meta, { title: 'No', margin: '9' }, person)).rejects.toThrow(/No write permission on column margin/)
    await expect(checkRowForInsert(meta, { title: 'No', lines: [{ cost: '9' }] }, person)).rejects.toThrow(/No write permission on column cost/)
  })

  test('a grant to read identifiers alone opens no Admin', async ({ admin }) => {
    await setup(admin)
    await insert({ row_id: 'pr-ids', ref_table: 'Person', operation: 'read_identifiers', column_rule: 'every' })
    expect(await tableAccessFor(await holder(), [ROLE])).toMatchObject({ readable: expect.not.arrayContaining(['Person']), ownGrant: false, admin: false })
  })

  test('provisioning the same app grant again adds nothing', async ({ admin }) => {
    await setup(admin)
    const grant = [{ table: DT, role: ROLE, operations: { read: '*' as const } }]
    expect((await provisionGrants({ name: 'pr_rerun', roles: [], runtime_package: true }, grant)).perms).toHaveLength(1)
    expect((await provisionGrants({ name: 'pr_rerun', roles: [], runtime_package: true }, grant)).perms).toEqual([])
  })

  test('a related filter through a grid outside the listed Columns is refused', async ({ admin, createUser }) => {
    await admin.post('/api/table_def', { name: 'Pr Ref', columns: [{ column_name: 'code', column_type: 'Data' }] })
    await admin.post('/api/table_def', { name: 'Pr Ref Line', kind: 'sub_table', columns: [{ column_name: 'who', column_type: 'Reference', reference_table: 'Pr Ref' }] })
    await admin.post('/api/table_def', { name: 'Pr Holder', columns: [
      { column_name: 'title', column_type: 'Data' }, { column_name: 'lines', column_type: 'Sub-table', row_table: 'Pr Ref Line' },
    ] })
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Pr Lister' } })
    const [{ row_id: title }] = await sql`select row_id from column_def where parent = 'Pr Holder' and column_name = 'title'`
    await admin.post('/api/save_row', { table: 'Permission', row: {
      ref_table: 'Pr Holder', role: 'Pr Lister', operation: 'read', column_rule: 'listed', columns: [{ target_column: title }],
    } })
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Pr Ref', role: 'Pr Lister', operation: 'read' } })
    const reader = await createUser({ roles: ['Pr Lister'] })
    const filters = JSON.stringify([['row_id', 'related', { via: 'Pr Ref Line', column: 'who', table: 'Pr Ref', filters: [['row_id', '=', 'x']] }]])
    const response = await reader.fetch(`/api/table/${encodeURIComponent('Pr Holder')}?filters=${encodeURIComponent(filters)}`)
    await expectStatus(response, 403)
    expect(((await response.json()) as { error: { message: string } }).error.message).toMatch(/No read permission on Pr Ref Line.who/)
  })

  test('a blank listed Column and a missing parent Column are refused', async ({ admin }) => {
    const link = await withLines(admin)
    await expect(admin.post('/api/save_row', { table: 'Permission', row: {
      ref_table: DT, role: ROLE, operation: 'read', column_rule: 'listed', columns: [{}],
    } })).rejects.toMatchObject({ status: 417 })
    const parent = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Permission', row: { ref_table: DT, role: ROLE, operation: 'read' } })
    expect(link).toBeTruthy()
    await expect(admin.post('/api/save_row', { table: 'Permission', row: {
      ref_table: 'Pr Line', role: ROLE, operation: 'read', parent_permission: parent.row_id,
    } })).rejects.toMatchObject({ status: 417 })
  })

  test('a reader of listed Columns can list a Table sorted by one they cannot read', async ({ admin, createUser }) => {
    await admin.post('/api/table_def', { name: 'Pr Sorted', columns: [
      { column_name: 'title', column_type: 'Data' }, { column_name: 'unit_cost', column_type: 'Data' },
    ] })
    await sql`update table_def set sort_column = 'unit_cost', sort_order = 'asc' where name = 'Pr Sorted'`
    invalidateMeta()
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: ROLE } }).catch(() => {})
    await admin.post('/api/save_row', { table: 'Pr Sorted', row: { title: 'One', unit_cost: '5' } })
    const [{ row_id: title }] = await sql`select row_id from column_def where parent = 'Pr Sorted' and column_name = 'title'`
    await admin.post('/api/save_row', { table: 'Permission', row: {
      ref_table: 'Pr Sorted', role: ROLE, operation: 'read', column_rule: 'listed', columns: [{ target_column: title }],
    } })
    const reader = await createUser({ roles: [ROLE] })
    const path = `/api/table/${encodeURIComponent('Pr Sorted')}?fields=${encodeURIComponent('["title"]')}`
    expect(await reader.get<{ data: unknown[] }>(path)).toMatchObject({ data: [{ title: 'One' }] })
    await expectStatus(await reader.fetch(`${path}&order_by=unit_cost`), 417)
    // A reader who can read the sort Column gets the Table's own order.
    await admin.post('/api/save_row', { table: 'Pr Sorted', row: { title: 'Two', unit_cost: '3' } })
    expect(await admin.get<{ data: unknown[] }>(path)).toMatchObject({ data: [{ title: 'Two' }, { title: 'One' }] })
    await admin.post('/api/save_row', { table: 'Pr Sorted', row: { title: 'Three', unit_cost: '9' } })
    expect(await admin.get<{ data: unknown[] }>(path)).toMatchObject({ data: [{ title: 'Two' }, { title: 'One' }, { title: 'Three' }] })
  })

  test('a creator-only reader of Person can still ask who is enabled', async ({ admin }) => {
    await setup(admin)
    await insert({ row_id: 'pr-person', ref_table: 'Person', operation: 'read', scope_mode: 'creator' })
    const person = await holder()
    await sql`insert into person (row_id, full_name, enabled, created_by) values ('psn_pr_mine', 'Mine', true, ${person}), ('psn_pr_other', 'Other', true, 'Administrator')`
    expect(await enabledPeople(['psn_pr_mine', 'psn_pr_other'], person)).toEqual(['psn_pr_mine'])
  })

  test('an inherited grant naming a parent that does not exist is refused', async ({ admin }) => {
    const link = await withLines(admin)
    await expect(admin.post('/api/save_row', { table: 'Permission', row: {
      ref_table: 'Pr Line', role: ROLE, operation: 'read', parent_permission: 'no-such-grant', parent_column: link,
    } })).rejects.toMatchObject({ status: 417 })
  })
})

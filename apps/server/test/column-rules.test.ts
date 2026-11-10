import { describe, expect } from 'vitest'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { expectStatus, grantRole } from './fixtures'
import { sameStoredValue } from '../src/permissions'
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'

// #917: a Column reached only through a creator-scoped grant is read only on
// the caller's own rows, on every path that returns or matches its values.
const DT = 'Cr Note'
const ROLE = 'Cr Note Reader'

async function setup(admin: TestClient, createUser: CreateUserFn) {
  await admin.post('/api/table_def', { name: DT, title_column: 'secret', columns: [
    { column_name: 'code', column_type: 'Data' },
    { column_name: 'secret', column_type: 'Data', tier: 'restricted' },
  ] })
  await grantRole(admin, { table: DT, role: ROLE, can_read: true, can_create: true })
  await grantRole(admin, { table: DT, role: ROLE, tier: 'restricted', own_rows_only: true, can_read: true })
  const theirs = await admin.post<{ row_id: string }>('/api/save_row', { table: DT, row: { code: 'A-1', secret: 'hidden-alpha' } })
  const user = await createUser({ roles: [ROLE] })
  return { theirs: theirs.row_id, user }
}

describe('creator-scoped Columns', () => {
  test("another creator's restricted title is not a row title", async ({ admin, createUser }) => {
    const { theirs, user } = await setup(admin, createUser)
    const { titles } = await user.post<{ titles: { title: string }[] }>('/api/row_titles', { rows: [{ table: DT, row_id: theirs }] })
    expect(titles.map((t) => t.title)).not.toContain('hidden-alpha')
  })

  test("search neither shows nor matches another creator's restricted title", async ({ admin, createUser }) => {
    const { user } = await setup(admin, createUser)
    const { results } = await user.get<{ results: unknown[] }>('/api/search?q=hidden')
    expect(JSON.stringify(results)).not.toContain('hidden-alpha')
  })

  test("import key analysis cannot probe another creator's restricted values", async ({ admin, createUser }) => {
    const { user } = await setup(admin, createUser)
    const report = await user.post<{ key_candidates: { column: string }[] }>(`/api/table/${encodeURIComponent(DT)}:import`, {
      analyze_keys: true, columns: ['secret'], rows: [{ secret: 'hidden-alpha' }],
    })
    expect(report.key_candidates).toEqual([])
    // A guess that matches nothing answers the same as one matching a hidden value.
    const absent = await user.post<{ key_candidates: { column: string }[] }>(`/api/table/${encodeURIComponent(DT)}:import`, {
      analyze_keys: true, columns: ['secret'], rows: [{ secret: 'no-such-secret' }],
    })
    expect(absent).toEqual(report)
  })

  test('a listed line-item grant refuses a change to an unlisted line-item Column', async ({ admin, createUser }) => {
    await admin.post('/api/table_def', { name: 'Cr Line', kind: 'sub_table', columns: [
      { column_name: 'qty', column_type: 'Int' }, { column_name: 'unit_price', column_type: 'Float' },
    ] })
    await admin.post('/api/table_def', { name: 'Cr Order', columns: [
      { column_name: 'label', column_type: 'Data' }, { column_name: 'lines', column_type: 'Sub-table', row_table: 'Cr Line' },
    ] })
    const order = await admin.post<{ row_id: string; updated_at: string; lines: { row_id: string }[] }>('/api/save_row', {
      table: 'Cr Order', row: { label: 'O-1', lines: [{ qty: 1, unit_price: 5 }] } })
    const columns = await admin.get<{ columns: { row_id: string; column_name: string }[] }>('/api/table/Table/Cr%20Order')
    const childColumns = await admin.get<{ columns: { row_id: string; column_name: string }[] }>('/api/table/Table/Cr%20Line')
    const lines = columns.columns.find((c) => c.column_name === 'lines')!
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Cr Line Editor' } })
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Cr Order', role: 'Cr Line Editor', operation: 'read', column_rule: 'every' } })
    const update = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Permission', row: {
      ref_table: 'Cr Order', role: 'Cr Line Editor', operation: 'update', column_rule: 'listed', columns: [{ target_column: lines.row_id }] } })
    await admin.post('/api/save_row', { table: 'Permission', row: {
      ref_table: 'Cr Line', role: 'Cr Line Editor', operation: 'update', column_rule: 'listed',
      parent_permission: update.row_id, parent_column: lines.row_id,
      columns: [{ target_column: childColumns.columns.find((c) => c.column_name === 'qty')!.row_id }] } })
    const editor = await createUser({ roles: ['Cr Line Editor'] })
    const current = await editor.get<{ updated_at: string; lines: Record<string, unknown>[] }>(`/api/table/Cr%20Order/${order.row_id}`)
    const response = await editor.fetch('/api/save_row', { method: 'POST', body: JSON.stringify({ table: 'Cr Order', row: {
      row_id: order.row_id, updated_at: current.updated_at, lines: [{ ...current.lines[0], qty: 2, unit_price: 1 }] } }) })
    await expectStatus(response, 403)
    expect((await admin.get<{ lines: { qty: number; unit_price: number }[] }>(`/api/table/Cr%20Order/${order.row_id}`)).lines)
      .toMatchObject([{ qty: 1, unit_price: 5 }])
    const allowed = await editor.fetch('/api/save_row', { method: 'POST', body: JSON.stringify({ table: 'Cr Order', row: {
      row_id: order.row_id, updated_at: current.updated_at, lines: [{ ...current.lines[0], qty: 2 }] } }) })
    await expectStatus(allowed, 201)
  })
})

describe('line items outside a grant', () => {
  async function order(admin: TestClient) {
    await admin.post('/api/table_def', { name: 'Cg Person Ref', columns: [{ column_name: 'label', column_type: 'Data' }] })
    const who = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Cg Person Ref', row: { label: 'Known' } })
    await admin.post('/api/table_def', { name: 'Cg Line', kind: 'sub_table', columns: [
      { column_name: 'qty', column_type: 'Int' }, { column_name: 'who', column_type: 'Reference', reference_table: 'Cg Person Ref' },
    ] })
    await admin.post('/api/table_def', { name: 'Cg Order', columns: [
      { column_name: 'label', column_type: 'Data' }, { column_name: 'lines', column_type: 'Sub-table', row_table: 'Cg Line' },
    ] })
    const row = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Cg Order', row: { label: 'O-1', lines: [{ qty: 1, who: who.row_id }] } })
    const parent = await admin.get<{ columns: { row_id: string; column_name: string }[] }>('/api/table/Table/Cg%20Order')
    const child = await admin.get<{ columns: { row_id: string; column_name: string }[] }>('/api/table/Table/Cg%20Line')
    const id = (columns: { row_id: string; column_name: string }[], name: string) => columns.find((c) => c.column_name === name)!.row_id
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Cg Reader' } })
    await grantRole(admin, { table: 'Cg Person Ref', role: 'Cg Reader', can_read: true })
    const read = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Permission', row: {
      ref_table: 'Cg Order', role: 'Cg Reader', operation: 'read', column_rule: 'listed',
      columns: [{ target_column: id(parent.columns, 'label') }, { target_column: id(parent.columns, 'lines') }] } })
    await admin.post('/api/save_row', { table: 'Permission', row: {
      ref_table: 'Cg Line', role: 'Cg Reader', operation: 'read', column_rule: 'listed',
      parent_permission: read.row_id, parent_column: id(parent.columns, 'lines'),
      columns: [{ target_column: id(child.columns, 'qty') }] } })
    await admin.post('/api/save_row', { table: 'Permission', row: {
      ref_table: 'Cg Order', role: 'Cg Reader', operation: 'update', column_rule: 'listed',
      columns: [{ target_column: id(parent.columns, 'label') }] } })
    return { row: row.row_id, who: who.row_id }
  }

  test('a hidden line-item Reference cannot filter the rows', async ({ admin, createUser }) => {
    const { who } = await order(admin)
    const reader = await createUser({ roles: ['Cg Reader'] })
    const filters = JSON.stringify([['row_id', 'related', { via: 'Cg Line', column: 'who', table: 'Cg Person Ref', filters: [['row_id', '=', who]] }]])
    const response = await reader.fetch(`/api/table/Cg%20Order?filters=${encodeURIComponent(filters)}`)
    await expectStatus(response, 403)
  })

  test('a reader of only their own rows filters through their own line items', async ({ admin, createUser }) => {
    await order(admin)
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Cg Own' } })
    await grantRole(admin, { table: 'Cg Person Ref', role: 'Cg Own', can_read: true })
    await grantRole(admin, { table: 'Cg Order', role: 'Cg Own', can_read: true, can_create: true, own_rows_only: true })
    const own = await createUser({ roles: ['Cg Own'] })
    const [who] = await admin.get<{ data: { row_id: string }[] }>('/api/table/Cg%20Person%20Ref').then((r) => r.data)
    const mine = await own.post<{ row_id: string }>('/api/save_row', { table: 'Cg Order', row: { label: 'Mine', lines: [{ qty: 2, who: who.row_id }] } })
    const filters = JSON.stringify([['row_id', 'related', { via: 'Cg Line', column: 'who', table: 'Cg Person Ref', filters: [['row_id', '=', who.row_id]] }]])
    const { data } = await own.get<{ data: { row_id: string }[] }>(`/api/table/Cg%20Order?filters=${encodeURIComponent(filters)}`)
    expect(data.map((r) => r.row_id)).toEqual([mine.row_id])
  })

  test('a grid sent back unchanged does not block an edit; a changed one is refused', async ({ admin, createUser }) => {
    const { row } = await order(admin)
    const reader = await createUser({ roles: ['Cg Reader'] })
    const current = await reader.get<{ updated_at: string; lines: Record<string, unknown>[] }>(`/api/table/Cg%20Order/${row}`)
    const changed = await reader.fetch('/api/save_row', { method: 'POST', body: JSON.stringify({ table: 'Cg Order', row: {
      row_id: row, updated_at: current.updated_at, label: 'O-1b', lines: [{ ...current.lines[0], qty: 9 }] } }) })
    await expectStatus(changed, 403)
    const saved = await reader.post<{ label: string }>('/api/save_row', { table: 'Cg Order', row: {
      row_id: row, updated_at: current.updated_at, label: 'O-1b', lines: current.lines } })
    expect(saved).toMatchObject({ label: 'O-1b' })
    expect((await admin.get<{ lines: { qty: number }[] }>(`/api/table/Cg%20Order/${row}`)).lines).toMatchObject([{ qty: 1 }])
  })

  test('a grid row sent back without its row id is a new row, and refused', async ({ admin, createUser }) => {
    const { row } = await order(admin)
    const reader = await createUser({ roles: ['Cg Reader'] })
    const current = await reader.get<{ updated_at: string; lines: Record<string, unknown>[] }>(`/api/table/Cg%20Order/${row}`)
    const { row_id: _lineId, ...line } = current.lines[0]
    const res = await reader.fetch('/api/save_row', { method: 'POST', body: JSON.stringify({ table: 'Cg Order', row: {
      row_id: row, updated_at: current.updated_at, label: 'O-1b', lines: [line] } }) })
    await expectStatus(res, 403)
  })
})

describe('listed grants on platform Tables', () => {
  test('a person picker reader granted only names still finds people', async ({ admin, createUser }) => {
    const person = await admin.get<{ columns: { row_id: string; column_name: string }[] }>('/api/table/Table/Person')
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Name Reader' } })
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Person', role: 'Name Reader', operation: 'read', column_rule: 'listed',
      columns: [{ target_column: person.columns.find((c) => c.column_name === 'full_name')!.row_id }] } })
    const target = await createUser({ roles: [], fullName: 'Listed Lakshmi' })
    void target
    const reader = await createUser({ roles: ['Name Reader'] })
    const { people } = await reader.get<{ people: { label: string }[] }>('/api/people/pick?q=Lakshmi')
    expect(people.map((p) => p.label)).toContain('Listed Lakshmi')
  })

  test('an unchanged default Settings value does not block a permitted change', async ({ admin, createUser }) => {
    await admin.post('/api/table_def', { name: 'Cr Settings', kind: 'settings', columns: [
      { column_name: 'greeting', column_type: 'Data' }, { column_name: 'region', column_type: 'Data', default_value: 'South' },
    ] })
    const settings = await admin.get<{ columns: { row_id: string; column_name: string }[] }>('/api/table/Table/Cr%20Settings')
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Greeter' } })
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Cr Settings', role: 'Greeter', operation: 'read', column_rule: 'every' } })
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Cr Settings', role: 'Greeter', operation: 'update', column_rule: 'listed',
      columns: [{ target_column: settings.columns.find((c) => c.column_name === 'greeting')!.row_id }] } })
    const greeter = await createUser({ roles: ['Greeter'] })
    const shown = await greeter.get<Record<string, unknown>>('/api/table/Cr%20Settings/Cr%20Settings')
    expect(shown).toMatchObject({ region: 'South' })
    await greeter.post('/api/save_row', { table: 'Cr Settings', row: { ...shown, greeting: 'Vanakkam' } })
    await expect(greeter.post('/api/save_row', { table: 'Cr Settings', row: { ...shown, greeting: 'Hello', region: 'North' } }))
      .rejects.toMatchObject({ status: 403 })
  })
})

describe('history of a row with line items', () => {
  test('a reader who sees every Column and line-item Column reads its history; a hidden line-item Column withholds it', async ({ admin, createUser }) => {
    await admin.post('/api/table_def', { name: 'Hv Line', kind: 'sub_table', columns: [{ column_name: 'qty', column_type: 'Int' }] })
    await admin.post('/api/table_def', { name: 'Hv Order', columns: [
      { column_name: 'label', column_type: 'Data' }, { column_name: 'lines', column_type: 'Sub-table', row_table: 'Hv Line' },
    ] })
    const order = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Hv Order', row: { label: 'H-1', lines: [{ qty: 1 }] } })
    await grantRole(admin, { table: ['Hv Order', 'Version'], role: 'Hv Reader', can_read: true })
    const reader = await createUser({ roles: ['Hv Reader'] })
    await sql`insert into version (row_id, ref_table, ref_name, data) values ('hv-1', 'Hv Order', ${order.row_id}, ${sql.json({ changed: [['label', 'H-0', 'H-1']] })})`
    await expectStatus(await reader.fetch('/api/table/Version/hv-1'), 200)
    await sql`update column_def set tier = 'restricted' where parent = 'Hv Line' and column_name = 'qty'`
    await invalidateMeta()
    await expectStatus(await reader.fetch('/api/table/Version/hv-1'), 403)
  })
})

describe('an unchanged value is not a change', () => {
  test.for([
    ['Currency', 10, '10.00'],
    ['Int', '7', 7],
    ['Check', true, '1'],
    ['Date', '2026-11-04', new Date('2026-11-04T00:00:00Z')],
    ['Data', '', null],
  ] as const)('%s %o equals stored %o', ([type, submitted, stored]) => {
    expect(sameStoredValue(type, submitted, stored)).toBe(true)
  })

  test.for([
    ['Currency', 11, '10.00'],
    ['Check', false, '1'],
    ['Data', 'x', null],
    ['Data', 'x', undefined],
  ] as const)('%s %o differs from stored %o', ([type, submitted, stored]) => {
    expect(sameStoredValue(type, submitted, stored)).toBe(false)
  })
})

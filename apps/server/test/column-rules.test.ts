import { describe, expect } from 'vitest'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { grantRole } from './fixtures'
import { sameStoredValue } from '../src/permissions'

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
    expect(response.status).toBe(403)
    expect((await admin.get<{ lines: { qty: number; unit_price: number }[] }>(`/api/table/Cr%20Order/${order.row_id}`)).lines)
      .toMatchObject([{ qty: 1, unit_price: 5 }])
    const allowed = await editor.fetch('/api/save_row', { method: 'POST', body: JSON.stringify({ table: 'Cr Order', row: {
      row_id: order.row_id, updated_at: current.updated_at, lines: [{ ...current.lines[0], qty: 2 }] } }) })
    expect(allowed.status).toBe(201)
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

import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { createUserWithRole, expectApiError, makeTable, patchDoc, type TableRef } from './fixtures'
import { sql } from '../src/db'
import { getList } from '../src/query'

// #859 (ADR 0019): retire a row without deleting it, with a reason.
const PLANT = 'Rt Plant'
const ORDER = 'Rt Order'

async function plants(admin: TestClient): Promise<{ plant: TableRef; order: TableRef }> {
  const plant = await makeTable(admin, { name: PLANT, id_pattern: 'prompt', track_changes: false, columns: ['city', 'code', 'is_active:Check'] })
  const order = await makeTable(admin, {
    name: ORDER,
    columns: [{ column_name: 'plant', column_type: 'Reference', reference_table: PLANT }],
  })
  await admin.post(plant.url, { row_id: 'Riverside', code: 'P1', city: 'Kochi', is_active: true })
  await admin.post(plant.url, { row_id: 'Sample plant', code: 'P9', city: 'Nowhere', is_active: true })
  return { plant, order }
}

const retire = (admin: TestClient, plant: TableRef, id: string, reason?: unknown) =>
  admin.post<Record<string, unknown>>(`${plant.rowUrl(id)}:retire`, reason === undefined ? {} : { reason })
const reactivate = (admin: TestClient, plant: TableRef, id: string) =>
  admin.post<Record<string, unknown>>(`${plant.rowUrl(id)}:reactivate`, {})
const ids = async (admin: TestClient, url: string) =>
  (await admin.get<{ data: { row_id: string }[]; total: number }>(url))

describe('#859 retire and reactivate a row', () => {
  test('retiring records who, when and why on the row, and leaves its own values alone', async ({ admin }) => {
    const { plant } = await plants(admin)
    const row = await retire(admin, plant, 'Sample plant', '  Not a real location ')
    expect(row).toMatchObject({ retired_by: 'Administrator', retired_reason: 'Not a real location', is_active: true, city: 'Nowhere' })
    expect(Number.isFinite(Date.parse(String(row.retired_at)))).toBe(true)
    const read = await admin.get<Record<string, unknown>>(plant.rowUrl('Sample plant'))
    expect(read.retired_reason).toBe('Not a real location')
  })

  test('a reason is required, and nothing changes without one', async ({ admin }) => {
    const { plant } = await plants(admin)
    for (const reason of [undefined, '', '   ', 42])
      await expectApiError(retire(admin, plant, 'Sample plant', reason), { status: 417, fields: { retired_reason: 'Required' } })
    const read = await admin.get<Record<string, unknown>>(plant.rowUrl('Sample plant'))
    expect(read.retired_at).toBeNull()
  })

  test('only a row in use is retired, and only a retired row reactivated', async ({ admin }) => {
    const { plant } = await plants(admin)
    await expectApiError(reactivate(admin, plant, 'Sample plant'), { status: 417, message: expect.stringContaining('is not retired') })
    await retire(admin, plant, 'Sample plant', 'Not a real location')
    await expectApiError(retire(admin, plant, 'Sample plant', 'again'), { status: 417, message: expect.stringContaining('already retired') })
    const back = await reactivate(admin, plant, 'Sample plant')
    expect(back).toMatchObject({ retired_at: null, retired_by: null, retired_reason: null })
  })

  test('a caller cannot set retirement through an ordinary save', async ({ admin }) => {
    const { plant } = await plants(admin)
    const before = await admin.get<Record<string, unknown>>(plant.rowUrl('Riverside'))
    await patchDoc(admin, plant.rowUrl('Riverside'), { updated_at: before.updated_at, city: 'Kochi', retired_at: new Date().toISOString(), retired_reason: 'sneaky' })
    const read = await admin.get<Record<string, unknown>>(plant.rowUrl('Riverside'))
    expect(read).toMatchObject({ retired_at: null, retired_reason: null })
  })

  test('the history keeps each retirement and reactivation, even on a Table that does not track changes', async ({ admin }) => {
    const { plant } = await plants(admin)
    await retire(admin, plant, 'Sample plant', 'Not a real location')
    await reactivate(admin, plant, 'Sample plant')
    const activity = await admin.get<{ versions: { created_by: string; data: { retirement?: unknown } }[] }>(
      `/api/activity/${encodeURIComponent(PLANT)}/${encodeURIComponent('Sample plant')}`)
    expect(activity.versions.map((v) => v.data.retirement)).toEqual([
      { action: 'retired', reason: 'Not a real location' },
      { action: 'reactivated' },
    ])
  })

  test('sub-tables, Settings tables and engine Tables cannot retire rows', async ({ admin }) => {
    await expectApiError(admin.post('/api/table/Table/Role:retire', { reason: 'x' }), { status: 417, message: expect.stringContaining('cannot be retired') })
    const [settings] = await sql`select name from table_def where kind = 'settings' limit 1`
    await expectApiError(admin.post(`/api/table/${encodeURIComponent(String(settings.name))}/${encodeURIComponent(String(settings.name))}:retire`, { reason: 'x' }), { status: 417 })
  })
})

describe('#859 retired rows are not offered', () => {
  test('lists, counts and summaries leave retired rows out unless asked', async ({ admin }) => {
    const { plant } = await plants(admin)
    await retire(admin, plant, 'Sample plant', 'Not a real location')
    const shown = await ids(admin, plant.listUrl({ fields: ['row_id'] }))
    expect(shown.data.map((r) => r.row_id)).toEqual(['Riverside'])
    expect(shown.total).toBe(1)
    const all = await ids(admin, `${plant.listUrl({ fields: ['row_id', 'retired_at'], order_by: 'row_id asc' })}&with_retired=true`)
    expect(all.data.map((r) => r.row_id)).toEqual(['Riverside', 'Sample plant'])
    const onlyRetired = await ids(admin, plant.listUrl({ fields: ['row_id'], filters: [['retired_at', '!=', null]] }))
    expect(onlyRetired.data.map((r) => r.row_id)).toEqual(['Sample plant'])
    expect((await admin.get<{ count: number }>(`${plant.url}:count`)).count).toBe(1)
    expect((await admin.get<{ count: number }>(`${plant.url}:summary`)).count).toBe(1)
    expect((await admin.get<{ count: number }>(`${plant.url}:summary?with_retired=true`)).count).toBe(2)
  })

  test('a row pointing at a retired row keeps it, and related filters still reach it', async ({ admin }) => {
    const { plant, order } = await plants(admin)
    const o = await admin.post<{ row_id: string }>(order.url, { plant: 'Sample plant' })
    await retire(admin, plant, 'Sample plant', 'Not a real location')
    expect((await admin.get<Record<string, unknown>>(order.rowUrl(o.row_id))).plant).toBe('Sample plant')
    const linked = await ids(admin, order.listUrl({ fields: ['row_id'], filters: [['plant', 'related', { table: PLANT, filters: [['city', '=', 'Nowhere']] }]] }))
    expect(linked.data.map((r) => r.row_id)).toEqual([o.row_id])
  })

  test('comments on a retired row stay readable', async ({ admin }) => {
    const { plant } = await plants(admin)
    await admin.post('/api/table/Comment', { ref_table: PLANT, ref_name: 'Sample plant', content: 'sample, not real' })
    await retire(admin, plant, 'Sample plant', 'Not a real location')
    const comments = await ids(admin, tableUrl('Comment', { fields: ['row_id'], filters: [['ref_table', '=', PLANT], ['ref_name', '=', 'Sample plant']] }))
    expect(comments.total).toBe(1)
  })

  test('a scope provider read includes retired rows, so retiring changes no access', async ({ admin }) => {
    const { plant } = await plants(admin)
    await retire(admin, plant, 'Sample plant', 'Not a real location')
    expect((await getList(PLANT, { with_retired: true })).total).toBe(2)
  })
})

const tableUrl = (table: string, params: Record<string, unknown>) =>
  `/api/table/${encodeURIComponent(table)}?${Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(JSON.stringify(v))}`).join('&')}`

describe('#859 who may retire and reactivate', () => {
  test('retire needs the delete right; reactivate the write right', async ({ admin, createUser }) => {
    const { plant } = await plants(admin)
    const editor = await createUserWithRole(admin, createUser, { role: 'Rt Plant Editor', table: PLANT, can_read: true, can_write: true, can_delete: false })
    await expectApiError(retire(editor, plant, 'Sample plant', 'Not a real location'), { status: 403 })
    const caps = await editor.get<{ retire: boolean; reactivate: boolean }>(`${plant.rowUrl('Sample plant')}:capabilities`)
    expect(caps).toMatchObject({ retire: false, reactivate: false })
    await retire(admin, plant, 'Sample plant', 'Not a real location')
    expect((await editor.get<{ reactivate: boolean }>(`${plant.rowUrl('Sample plant')}:capabilities`)).reactivate).toBe(true)

    const reader = await createUserWithRole(admin, createUser, { role: 'Rt Plant Reader', table: PLANT, can_read: true, can_write: false }, { email: 'rt-reader@example.com' })
    await expectApiError(reactivate(reader, plant, 'Sample plant'), { status: 403 })
    await reactivate(editor, plant, 'Sample plant')

    const deleter = await createUserWithRole(admin, createUser, { role: 'Rt Plant Deleter', table: PLANT, can_read: true, can_delete: true }, { email: 'rt-deleter@example.com' })
    expect((await deleter.get<{ retire: boolean }>(`${plant.rowUrl('Sample plant')}:capabilities`)).retire).toBe(true)
    await retire(deleter, plant, 'Sample plant', 'Not a real location')
  })
})

describe('#859 imports keep a retired row retired', () => {
  test('the preview counts matched retired rows; the import updates them and they stay retired', async ({ admin }) => {
    const { plant } = await plants(admin)
    await retire(admin, plant, 'Sample plant', 'Not a real location')
    const rows = [{ code: 'P1', city: 'Kochi' }, { code: 'P9', city: 'Elsewhere' }]
    const preview = await admin.post<{ updated: number; retired: number }>(`${plant.url}:import`, { key_column: 'code', dry_run: true, rows })
    expect(preview).toMatchObject({ updated: 2, retired: 1 })
    await admin.post(`${plant.url}:import`, { key_column: 'code', rows })
    const read = await admin.get<Record<string, unknown>>(plant.rowUrl('Sample plant'))
    expect(read).toMatchObject({ city: 'Elsewhere', retired_reason: 'Not a real location' })
    expect(read.retired_at).not.toBeNull()
  })
})

describe('#859 a refused delete offers to retire', () => {
  test('the history rule and a link both name Retire as the way out', async ({ admin }) => {
    const { plant, order } = await plants(admin)
    await admin.post('/api/table/Comment', { ref_table: PLANT, ref_name: 'Sample plant', content: 'keep' })
    await expectApiError(admin.delete(plant.rowUrl('Sample plant')), {
      status: 417,
      message: expect.stringContaining('Retire it instead'),
      fields: { retire: 'available', comments: '1' },
    })
    await admin.post(order.url, { plant: 'Riverside' })
    await expectApiError(admin.delete(plant.rowUrl('Riverside')), {
      status: 417,
      message: expect.stringContaining('Retire it instead'),
      fields: { retire: 'available' },
    })
  })
})

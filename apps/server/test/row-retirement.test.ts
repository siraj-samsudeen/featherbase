import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { createUserWithRole, expectApiError, expectRefused, expectStatus, makeTable, patchDoc, type TableRef } from './fixtures'
import { sql } from '../src/db'
import { getList } from '../src/query'
import { invalidateMeta } from '../src/meta'

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
    await expectRefused(admin.post(`/api/table/${encodeURIComponent(String(settings.name))}/${encodeURIComponent(String(settings.name))}:retire`, { reason: 'x' }), 417)
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
    await expectRefused(retire(editor, plant, 'Sample plant', 'Not a real location'), 403)
    const caps = await editor.get<{ retire: boolean; reactivate: boolean }>(`${plant.rowUrl('Sample plant')}:capabilities`)
    expect(caps).toMatchObject({ retire: false, reactivate: false })
    await retire(admin, plant, 'Sample plant', 'Not a real location')
    expect((await editor.get<{ reactivate: boolean }>(`${plant.rowUrl('Sample plant')}:capabilities`)).reactivate).toBe(true)

    const reader = await createUserWithRole(admin, createUser, { role: 'Rt Plant Reader', table: PLANT, can_read: true, can_write: false }, { email: 'rt-reader@example.com' })
    await expectRefused(reactivate(reader, plant, 'Sample plant'), 403)
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

// #959: a refused delete names each row as people read it, not by its id.
describe('#959 a refused delete names rows readably', () => {
  const UNIT = 'Rt Named Unit'
  const STORE = 'Rt Named Store'
  async function units(admin: TestClient) {
    const unit = await makeTable(admin, { name: UNIT, id_pattern: 'prompt', title_column: 'unit_name', columns: ['unit_name'] })
    const store = await makeTable(admin, { name: STORE, id_pattern: 'prompt', title_column: 'store_name', columns: [
      'store_name', { column_name: 'unit', column_type: 'Reference', reference_table: UNIT },
    ] })
    await admin.post(unit.url, { row_id: 'U-HIST', unit_name: 'Historic unit' })
    await admin.post(unit.url, { row_id: 'U-LINK', unit_name: 'Linked unit' })
    await admin.post(store.url, { row_id: 'S-ONE', store_name: 'Store one', unit: 'U-LINK' })
    return { unit, store }
  }

  test('the row kept by its history and the row linking to it read by their titles', async ({ admin }) => {
    const { unit } = await units(admin)
    await admin.post('/api/table/Comment', { ref_table: UNIT, ref_name: 'U-HIST', content: 'keep' })
    await expectApiError(admin.delete(unit.rowUrl('U-HIST')), {
      status: 417, message: expect.stringContaining('Rt Named Unit "Historic unit" cannot be deleted: it has 1 comment.'),
    })
    await expectApiError(admin.delete(unit.rowUrl('U-LINK')), {
      status: 417, message: expect.stringContaining('Cannot delete Rt Named Unit "Linked unit": it is linked from Rt Named Store "Store one".'),
    })
  })

  test('a row with no title column, or the id as its title, keeps its id', async ({ admin }) => {
    const { unit } = await units(admin)
    await makeTable(admin, { name: 'Rt Named Shelf', id_pattern: 'prompt', columns: [
      { column_name: 'unit', column_type: 'Reference', reference_table: UNIT },
    ] })
    await admin.post('/api/table/Rt%20Named%20Shelf', { row_id: 'SH-1', unit: 'U-HIST' })
    // The migrated default: a title column of row_id means "show the id".
    await makeTable(admin, { name: 'Rt Named Bin', id_pattern: 'prompt', columns: ['bin_name'] })
    await sql`update table_def set title_column = 'row_id' where name = 'Rt Named Bin'`
    invalidateMeta('Rt Named Bin')
    await admin.post('/api/table/Rt%20Named%20Bin', { row_id: 'B-1', bin_name: 'Front bin' })
    await admin.post('/api/table/Comment', { ref_table: 'Rt Named Bin', ref_name: 'B-1', content: 'keep' })
    // A stand-in built from the shelf's values would read as the unit's own id.
    await expectApiError(admin.delete(unit.rowUrl('U-HIST')), {
      status: 417, message: expect.stringContaining('Cannot delete Rt Named Unit "Historic unit": it is linked from Rt Named Shelf SH-1.'),
    })
    // A title column holding the id itself says no more than the id.
    await admin.post('/api/table/Rt%20Named%20Unit', { row_id: 'U-SAME', unit_name: 'U-SAME' })
    await admin.post('/api/table/Comment', { ref_table: UNIT, ref_name: 'U-SAME', content: 'keep' })
    await expectApiError(admin.delete(unit.rowUrl('U-SAME')), {
      status: 417, message: expect.stringContaining('Rt Named Unit U-SAME cannot be deleted'),
    })
    await expectApiError(admin.delete('/api/table/Rt%20Named%20Bin/B-1'), {
      status: 417, message: expect.stringContaining('Rt Named Bin B-1 cannot be deleted'),
    })
  })

  test('a linking row the caller cannot read keeps its id, so its title is never shown', async ({ admin, createUser }) => {
    const { unit } = await units(admin)
    const deleter = await createUserWithRole(admin, createUser, { role: 'Rt Unit Only Deleter', table: UNIT, can_read: true, can_delete: true })
    await expectApiError(deleter.delete(unit.rowUrl('U-LINK')), {
      status: 417, message: expect.stringContaining('Cannot delete Rt Named Unit "Linked unit": it is linked from Rt Named Store S-ONE.'),
    })
  })
})

// #959: the Recent chips over a list leave a retired row out, as the list does.
describe('#959 row titles say which rows are retired', () => {
  test('a retired row is marked; a row in use is not', async ({ admin }) => {
    const { plant } = await plants(admin)
    await retire(admin, plant, 'Sample plant', 'Not a real location')
    const rows = [{ table: PLANT, row_id: 'Riverside' }, { table: PLANT, row_id: 'Sample plant' }]
    const { titles } = await admin.post<{ titles: Record<string, unknown>[] }>('/api/row_titles', { rows })
    expect(titles).toEqual(expect.arrayContaining([
      { table: PLANT, row_id: 'Riverside', title: 'Kochi' },
      { table: PLANT, row_id: 'Sample plant', title: 'Nowhere', retired: true },
    ]))
    expect(titles).toHaveLength(2)
  })
})

describe('#859 retirement respects the row a comment hangs on (Codex review)', () => {
  test('broad Comment rights cannot retire a comment on a row the caller cannot open', async ({ admin, createUser }) => {
    await makeTable(admin, { name: 'Rt Note', columns: ['subject'] })
    const agent = await createUserWithRole(admin, createUser, {
      role: 'Rt Note Agent', table: 'Rt Note', can_read: true, can_write: true, can_create: true, own_rows_only: true,
    }, { email: 'rt-agent@example.com' })
    await grantRoleOnComment(admin)
    const theirs = await admin.post<{ row_id: string }>('/api/table/Rt%20Note', { subject: 'Not yours' })
    const comment = await admin.post<{ row_id: string }>('/api/table/Comment', { ref_table: 'Rt Note', ref_name: theirs.row_id, content: 'private' })
    await expectRefused(agent.post(`/api/table/Comment/${comment.row_id}:retire`, { reason: 'hide it' }), 403)
    const [row] = await sql`select retired_at from comment where row_id = ${comment.row_id}`
    expect(row.retired_at).toBeNull()
  })
})

async function grantRoleOnComment(admin: TestClient) {
  const { grantRole } = await import('./fixtures')
  await grantRole(admin, { role: 'Rt Note Agent', table: 'Comment', can_read: true, can_write: true, can_create: true, can_delete: true })
}

describe('#859 migration 0147', () => {
  test('refuses a Table already using a retirement name for its own data, and changes nothing', async ({ admin }) => {
    const { up } = await import('../migrations/0147_row_retirement')
    const t = await makeTable(admin, { name: 'Rt Legacy', columns: ['title'] })
    const relation = await tableRelationOf(t.name)
    await sql.unsafe(`alter table ${relation} drop column retired_at, drop column retired_by, drop column retired_reason, add column retired_at text`)
    await expect(up()).rejects.toThrow(/Rt Legacy\.retired_at/)
    const cols = await sql`select column_name from information_schema.columns where table_name = 'rt_legacy' and column_name like 'retired%'`
    expect(cols.map((c) => c.column_name)).toEqual(['retired_at'])
  })

  test('adds the columns to a Table made before it, and reruns cleanly', async ({ admin }) => {
    const { up } = await import('../migrations/0147_row_retirement')
    const t = await makeTable(admin, { name: 'Rt Older', columns: ['title'] })
    const relation = await tableRelationOf(t.name)
    await sql.unsafe(`alter table ${relation} drop column retired_at, drop column retired_by, drop column retired_reason`)
    await up()
    await up()
    const cols = await sql`select column_name from information_schema.columns where table_name = 'rt_older' and column_name like 'retired%' order by 1`
    expect(cols.map((c) => c.column_name)).toEqual(['retired_at', 'retired_by', 'retired_reason'])
  })
})

async function tableRelationOf(name: string) {
  const { tableRelation, quoteRelation } = await import('../src/table-engine')
  return quoteRelation(await tableRelation(name))
}

describe('#859 reactivating is editing (Codex review round 2)', () => {
  test('a write share lets its holder reactivate, never retire', async ({ admin, createUser }) => {
    const { plant } = await plants(admin)
    const guest = await createUser({ roles: [] })
    const user = (guest as unknown as { user: string }).user
    await admin.post('/api/save_row', { table: 'Share', row: { share_table: PLANT, share_name: 'Sample plant', person: user, read: true, write: true } })
    expect(await guest.get(`${plant.rowUrl('Sample plant')}:capabilities`)).toMatchObject({ retire: false })
    await expectRefused(retire(guest, plant, 'Sample plant', 'mine now'), 403)
    await retire(admin, plant, 'Sample plant', 'Not a real location')
    expect(await guest.get(`${plant.rowUrl('Sample plant')}:capabilities`)).toMatchObject({ reactivate: true })
    expect(await reactivate(guest, plant, 'Sample plant')).toMatchObject({ retired_at: null })
  })

  test('a controller that refuses generic writes refuses retiring too', async ({ admin }) => {
    const svc = await admin.post<{ row_id: string }>('/api/service_accounts', { label: 'svc-rt-bot', roles: [] })
    await expectApiError(admin.post(`/api/table/Service%20Account/${encodeURIComponent(svc.row_id)}:retire`, { reason: 'x' }), {
      status: 417, message: expect.stringContaining('managed by the service-account API'),
    })
    const [after] = await sql`select retired_at from service_account where row_id = ${svc.row_id}`
    expect(after.retired_at).toBeNull()
  })
})

describe('#859 the Person picker leaves retired people out (Codex review round 3)', () => {
  test('a retired person is not offered; reactivated, they are again', async ({ admin }) => {
    const { makePerson } = await import('./fixtures')
    const id = await makePerson({ full_name: 'Rt Retiree Person', email: 'rt-retiree@example.com' })
    const pick = async () => (await admin.get<{ people: { row_id: string }[] }>('/api/people/pick?q=Rt%20Retiree')).people.map((p) => p.row_id)
    expect(await pick()).toEqual([id])
    await admin.post(`/api/table/Person/${id}:retire`, { reason: 'Left before go-live' })
    expect(await pick()).toEqual([])
    await admin.post(`/api/table/Person/${id}:reactivate`, {})
    expect(await pick()).toEqual([id])
  })
})

describe('#859 the rest of retirement', () => {
  test('the reason has a limit, and the names are reserved', async ({ admin }) => {
    const { plant } = await plants(admin)
    await expectApiError(retire(admin, plant, 'Sample plant', 'x'.repeat(1001)), { status: 417, fields: { retired_reason: 'Too long' } })
    await expectRefused(admin.post('/api/table_def', { name: 'Rt Reserved', columns: [{ column_name: 'retired_at', column_type: 'Data' }] }), 417)
    const { renameColumn } = await import('../src/table-engine')
    await expect(renameColumn(PLANT, 'city', 'retired_by')).rejects.toMatchObject({ type: 'ValidationError' })
  })

  test('a comment can be retired by someone who may open its row', async ({ admin }) => {
    const { plant } = await plants(admin)
    const c = await admin.post<{ row_id: string }>('/api/table/Comment', { ref_table: PLANT, ref_name: 'Riverside', content: 'out of date' })
    expect(await admin.post(`/api/table/Comment/${c.row_id}:retire`, { reason: 'Out of date' })).toMatchObject({ retired_reason: 'Out of date' })
    void plant
  })

  test('a row gone by the time it is locked is not found', async ({ admin }) => {
    const { plant } = await plants(admin)
    const { registerController, unregisterController } = await import('../src/controllers')
    const vanish = { table: PLANT, hooks: { before_lock: async ({ tx }: { tx: { unsafe: (q: string) => Promise<unknown> } }) => { await tx.unsafe("delete from featherbase.rt_plant where row_id = 'Sample plant'") } } }
    registerController(vanish as never)
    try {
      await expectRefused(retire(admin, plant, 'Sample plant', 'Too late'), 404)
    } finally { unregisterController(vanish as never) }
  })

  test('an import matching rows of a Table that cannot retire works without retirement', async ({ admin }) => {
    const res = await admin.post<{ dry_run: boolean; retired: number }>('/api/table/Table:import', { key_column: 'row_id', dry_run: true, rows: [{ row_id: 'Rt No Such Table' }] }).catch((err: { status: number }) => err)
    expect((res as { status?: number }).status ?? 200).toBeLessThan(500)
  })
})

describe('key analysis', () => {
  test('a matched row that cannot be read for another reason is a failure, not a skipped column', async ({ admin }) => {
    await makeTable(admin, { name: 'Rt Ka Line', kind: 'sub_table', columns: ['label'] })
    const doc = await makeTable(admin, { name: 'Rt Ka Doc', id_pattern: 'prompt', columns: ['code', { column_name: 'items', column_type: 'Sub-table', row_table: 'Rt Ka Line' }] })
    await admin.post(doc.url, { row_id: 'K-1', code: 'K1' })
    await sql.unsafe('drop table featherbase.rt_ka_line')
    const res = await admin.fetch(`${doc.url}:import`, { method: 'POST', body: JSON.stringify({ analyze_keys: true, columns: ['code'], rows: [{ code: 'K1' }] }) })
    await expectStatus(res, 500)
  })
})

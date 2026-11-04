import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { createUserWithRole, expectApiError, makeTable, type TableRef } from './fixtures'
import { sql } from '../src/db'
import { registerController, unregisterController, type TableController } from '../src/controllers'
import { AppError } from '../src/errors'

// #859 (design decisions 9-14): a System Manager deletes rows permanently,
// dependents shown first and either deleted too or unlinked.
const BU = 'Pg Business Unit'
const STORE = 'Pg Store'

async function setup(admin: TestClient): Promise<{ bu: TableRef; store: TableRef }> {
  const bu = await makeTable(admin, { name: BU, id_pattern: 'prompt', title_column: 'bu_name', columns: ['bu_name'] })
  const store = await makeTable(admin, {
    name: STORE, id_pattern: 'prompt', title_column: 'store_name',
    columns: ['store_name', { column_name: 'business_unit', column_type: 'Reference', reference_table: BU }],
  })
  await admin.post(bu.url, { row_id: 'BU-T', bu_name: 'Test BU' })
  await admin.post(bu.url, { row_id: 'BU-K', bu_name: 'Kept BU' })
  await admin.post(store.url, { row_id: 'S-A', store_name: 'Store A', business_unit: 'BU-T' })
  await admin.post(store.url, { row_id: 'S-B', store_name: 'Store B', business_unit: 'BU-T' })
  await admin.post(store.url, { row_id: 'S-K', store_name: 'Store Kept', business_unit: 'BU-K' })
  await admin.post('/api/table/Comment', { ref_table: BU, ref_name: 'BU-T', content: 'made by mistake' })
  return { bu, store }
}

const preview = (client: TestClient, t: TableRef, ids: string[], links = 'cascade') =>
  client.get<{ rows: { table: string; row_id: string; title: string }[]; groups: { table: string; count: number; action: string; rows: { title: string }[] }[]; blocked: boolean; activity: { comments: number } }>(
    `${t.url}:purge_preview?ids=${encodeURIComponent(JSON.stringify(ids))}&links=${links}`)
const purge = (client: TestClient, t: TableRef, body: Record<string, unknown>) =>
  client.post<{ deleted: number; cleared: number }>(`${t.url}:purge`, { reason: 'Created by mistake during setup', confirm: true, ...body })
const exists = async (table: string, id: string) =>
  (await sql.unsafe(`select 1 from featherbase.${table} where row_id = $1`, [id])).length > 0

describe('#859 delete permanently', () => {
  test('the preview names the dependent rows, grouped by table with counts and titles', async ({ admin }) => {
    const { bu } = await setup(admin)
    const plan = await preview(admin, bu, ['BU-T'])
    expect(plan.blocked).toBe(false)
    expect(plan.activity.comments).toBe(1)
    expect(plan.groups).toEqual([expect.objectContaining({ table: STORE, count: 2, action: 'delete' })])
    expect(plan.groups[0].rows.map((r) => r.title).sort()).toEqual(['Store A', 'Store B'])
    expect(plan.rows.map((r) => r.title)).toEqual(['Test BU', 'Store A', 'Store B'])
    const clearing = await preview(admin, bu, ['BU-T'], 'clear')
    expect(clearing.groups[0].action).toBe('clear')
    expect(clearing.rows.map((r) => r.title)).toEqual(['Test BU'])
  })

  test('cascade removes the row, its comments and its dependents, and records each one', async ({ admin }) => {
    const { bu } = await setup(admin)
    expect(await purge(admin, bu, { ids: ['BU-T'] })).toEqual({ deleted: 3, cleared: 0 })
    expect(await exists('pg_business_unit', 'BU-T')).toBe(false)
    expect(await exists('pg_store', 'S-A')).toBe(false)
    expect(await exists('pg_store', 'S-K')).toBe(true)
    expect(await sql`select 1 from comment where ref_table = ${BU} and ref_name = 'BU-T'`).toHaveLength(0)
    const records = await sql`select ref_table, reference_name, reason, snapshot, "user" from access_log where operation = 'purge' and ref_table in (${BU}, ${STORE}) order by reference_name`
    expect(records.map((r) => `${r.ref_table}/${r.reference_name}`)).toEqual([`${BU}/BU-T`, `${STORE}/S-A`, `${STORE}/S-B`])
    expect(records[0]).toMatchObject({ reason: 'Created by mistake during setup', user: 'Administrator', snapshot: expect.objectContaining({ bu_name: 'Test BU' }) })
  })

  test('clear keeps the dependents with an empty link, recorded in their history', async ({ admin }) => {
    const { bu, store } = await setup(admin)
    expect(await purge(admin, bu, { ids: ['BU-T'], links: 'clear' })).toEqual({ deleted: 1, cleared: 2 })
    expect((await admin.get<Record<string, unknown>>(store.rowUrl('S-A'))).business_unit).toBeNull()
    const versions = await sql`select data from version where ref_table = ${STORE} and ref_name = 'S-A'`
    expect(versions.map((v) => v.data)).toContainEqual(expect.objectContaining({ changed: [['business_unit', 'BU-T', null]] }))
  })

  test('only a System Manager may, whatever their delete rights; the refusal changes nothing', async ({ admin, createUser }) => {
    const { bu } = await setup(admin)
    const deleter = await createUserWithRole(admin, createUser, { role: 'Pg Deleter', table: BU, can_read: true, can_write: true, can_delete: true })
    await expectApiError(preview(deleter, bu, ['BU-T']), { status: 403 })
    await expectApiError(purge(deleter, bu, { ids: ['BU-T'] }), { status: 403 })
    expect(await exists('pg_business_unit', 'BU-T')).toBe(true)
    expect((await deleter.get<{ purge: boolean }>(`${bu.rowUrl('BU-T')}:capabilities`)).purge).toBe(false)
    expect((await admin.get<{ purge: boolean }>(`${bu.rowUrl('BU-T')}:capabilities`)).purge).toBe(true)
    // And the ordinary delete still refuses, offering Retire.
    await expectApiError(deleter.delete(bu.rowUrl('BU-T')), { status: 417, fields: { retire: 'available' } })
  })

  test('a reason and a confirmation are required', async ({ admin }) => {
    const { bu } = await setup(admin)
    await expectApiError(purge(admin, bu, { ids: ['BU-T'], reason: ' ' }), { status: 417, fields: { reason: 'Required' } })
    await expectApiError(purge(admin, bu, { ids: ['BU-T'], confirm: 'yes' }), { status: 417, fields: { confirm: 'Required' } })
    expect(await exists('pg_business_unit', 'BU-T')).toBe(true)
  })

  test('a dependent that can be neither deleted nor unlinked holds the delete', async ({ admin }) => {
    const { bu } = await setup(admin)
    const settings = await makeTable(admin, { name: 'Pg Defaults', kind: 'settings', columns: [{ column_name: 'default_bu', column_type: 'Reference', reference_table: BU }] })
    await admin.post('/api/save_row', { table: settings.name, row: { default_bu: 'BU-T' } })
    const plan = await preview(admin, bu, ['BU-T'])
    expect(plan.blocked).toBe(true)
    await expectApiError(purge(admin, bu, { ids: ['BU-T'] }), { status: 417, message: expect.stringContaining('Pg Defaults') })
    expect(await exists('pg_business_unit', 'BU-T')).toBe(true)
    expect(await exists('pg_store', 'S-A')).toBe(true)
  })

  test('all or nothing: a dependent that refuses rolls everything back', async ({ admin }) => {
    const { bu } = await setup(admin)
    const refuseStoreB: TableController = {
      table: STORE,
      hooks: { on_trash: ({ row }) => { if (row.row_id === 'S-B') throw new AppError('ValidationError', 'Store B is still trading') } },
    }
    registerController(refuseStoreB)
    try {
      await expectApiError(purge(admin, bu, { ids: ['BU-T'] }), { status: 417, message: expect.stringContaining('still trading') })
    } finally {
      unregisterController(refuseStoreB)
    }
    for (const [t, id] of [['pg_business_unit', 'BU-T'], ['pg_store', 'S-A'], ['pg_store', 'S-B']]) expect(await exists(t, id)).toBe(true)
    expect(await sql`select 1 from comment where ref_table = ${BU} and ref_name = 'BU-T'`).toHaveLength(1)
    expect(await sql`select 1 from access_log where operation = 'purge' and ref_table in (${BU}, ${STORE})`).toHaveLength(0)
  })

  test('selected rows, or the rows one import added, at once', async ({ admin }) => {
    const { bu } = await setup(admin)
    const run = await admin.post<{ run_id: string }>(`${bu.url}:import`, { rows: [{ row_id: 'BU-R1', bu_name: 'Rehearsal 1' }, { row_id: 'BU-R2', bu_name: 'Rehearsal 2' }] })
    const plan = await admin.get<{ rows: { row_id: string }[] }>(`${bu.url}:purge_preview?run_id=${run.run_id}`)
    expect(plan.rows.map((r) => r.row_id).sort()).toEqual(['BU-R1', 'BU-R2'])
    expect(await purge(admin, bu, { run_id: run.run_id })).toMatchObject({ deleted: 2 })
    expect(await exists('pg_business_unit', 'BU-R1')).toBe(false)
    expect(await purge(admin, bu, { ids: ['BU-K', 'BU-T'], links: 'clear' })).toMatchObject({ deleted: 2, cleared: 3 })
  })

  test('platform tables, people and settings are never deleted permanently', async ({ admin }) => {
    const { makePerson } = await import('./fixtures')
    const person = await makePerson({ full_name: 'Pg Person', email: 'pg-person@example.com' })
    await expectApiError(admin.post(`/api/table/Person:purge`, { ids: [person], reason: 'x', confirm: true }), { status: 417, message: expect.stringContaining('cannot be deleted permanently') })
    await expectApiError(admin.post(`/api/table/Role:purge`, { ids: ['Guest'], reason: 'x', confirm: true }), { status: 417, message: expect.stringContaining('cannot be deleted permanently') })
    await expectApiError(admin.post(`/api/table/Table:purge`, { ids: ['Role'], reason: 'x', confirm: true }), { status: 417 })
  })
})

describe('#859 delete permanently, Codex review round 4', () => {
  test('a private row is never previewed or deleted, even by a System Manager', async ({ admin, createUser }) => {
    const notebook = await makeTable(admin, {
      name: 'Pg Private Notebook',
      access_policy: { version: 1, roles: ['Pg Notebook Member'], shared_column: 'shared' },
      columns: ['title', 'shared:Check'],
    })
    const { grantRole } = await import('./fixtures')
    await grantRole(admin, { table: notebook.name, role: 'Pg Notebook Member', can_read: true, can_create: true, can_write: true })
    const owner = await createUser({ roles: ['Pg Notebook Member'] })
    const row = await owner.post<{ row_id: string }>('/api/save_row', { table: notebook.name, row: { title: 'Private draft' } })
    // Private work keeps its own lifecycle: its deletion record could not
    // stay readable once the row is gone (Codex round 6).
    await expectApiError(preview(admin, notebook, [row.row_id]), { status: 417, message: expect.stringContaining('cannot be deleted permanently') })
    await expectApiError(purge(admin, notebook, { ids: [row.row_id] }), { status: 417 })
    expect(await sql.unsafe('select 1 from featherbase.pg_private_notebook where row_id = $1', [row.row_id])).toHaveLength(1)
  })

  test('a reference to a line of a removed document is found too', async ({ admin }) => {
    await makeTable(admin, { name: 'Pg Line', kind: 'sub_table', columns: ['label'] })
    const order = await makeTable(admin, { name: 'Pg Order', id_pattern: 'prompt', columns: [{ column_name: 'lines', column_type: 'Sub-table', row_table: 'Pg Line' }] })
    const pick = await makeTable(admin, { name: 'Pg Pick', columns: [{ column_name: 'line', column_type: 'Reference', reference_table: 'Pg Line' }] })
    const saved = await admin.post<{ lines: { row_id: string }[] }>(order.url, { row_id: 'O-1', lines: [{ label: 'first' }] })
    const p = await admin.post<{ row_id: string }>(pick.url, { line: saved.lines[0].row_id })
    const plan = await preview(admin, order, ['O-1'])
    expect(plan.groups).toEqual([expect.objectContaining({ table: 'Pg Pick', count: 1, action: 'delete' })])
    await purge(admin, order, { ids: ['O-1'] })
    expect(await sql.unsafe('select 1 from featherbase.pg_pick where row_id = $1', [p.row_id])).toHaveLength(0)
    expect(await sql.unsafe('select 1 from featherbase.pg_line where parent = $1', ['O-1'])).toHaveLength(0)
  })

  test('the row limit counts every row, the asked-for ones included', async ({ admin }) => {
    const { bu } = await setup(admin)
    const rows = Array.from({ length: 1001 }, (_, i) => ({ row_id: `BU-M${i}`, bu_name: `Many ${i}` }))
    const run = await admin.post<{ run_id: string }>(`${bu.url}:import`, { rows })
    await expectApiError(admin.get(`${bu.url}:purge_preview?run_id=${run.run_id}`), { status: 417, message: expect.stringContaining('more than 1000') })
  }, 60_000)

  test('clearing a link runs the holder\'s save hooks, and a refusal rolls everything back', async ({ admin }) => {
    const { bu } = await setup(admin)
    const keepLinked: TableController = {
      table: STORE,
      hooks: { before_save: ({ row }) => { if (row.business_unit == null) throw new AppError('ValidationError', 'A store needs its business unit') } },
    }
    registerController(keepLinked)
    try {
      await expectApiError(purge(admin, bu, { ids: ['BU-T'], links: 'clear' }), { status: 417, message: expect.stringContaining('needs its business unit') })
    } finally {
      unregisterController(keepLinked)
    }
    expect(await exists('pg_business_unit', 'BU-T')).toBe(true)
    expect((await sql.unsafe("select business_unit from featherbase.pg_store where row_id = 'S-A'"))[0].business_unit).toBe('BU-T')
  })
})

describe('#859 delete permanently, Codex review round 5', () => {
  test('a cleared link is saved through the holder\'s own update: what its hooks change is kept', async ({ admin }) => {
    const { bu, store } = await setup(admin)
    const note: TableController = {
      table: STORE,
      hooks: { before_save: ({ row }) => { if (row.business_unit == null) row.store_name = `${String(row.store_name)} (no unit)` } },
    }
    registerController(note)
    try { await purge(admin, bu, { ids: ['BU-T'], links: 'clear' }) } finally { unregisterController(note) }
    expect(await admin.get<Record<string, unknown>>(store.rowUrl('S-A'))).toMatchObject({ business_unit: null, store_name: 'Store A (no unit)' })
  })

  test('a line removed from a document that stays goes through that document\'s update, which may refuse', async ({ admin }) => {
    const { bu } = await setup(admin)
    await makeTable(admin, { name: 'Pg Visit', kind: 'sub_table', columns: [{ column_name: 'unit', column_type: 'Reference', reference_table: BU }] })
    const plan = await makeTable(admin, { name: 'Pg Plan', id_pattern: 'prompt', columns: ['title', { column_name: 'visits', column_type: 'Sub-table', row_table: 'Pg Visit' }] })
    const before = await admin.post<{ updated_at: string }>(plan.url, { row_id: 'PL-1', title: 'Tour', visits: [{ unit: 'BU-T' }, { unit: 'BU-K' }] })
    const needsTwo: TableController = {
      table: 'Pg Plan',
      hooks: { before_save: ({ row }) => { if (Array.isArray(row.visits) && row.visits.length < 2) throw new AppError('ValidationError', 'A tour needs two visits') } },
    }
    registerController(needsTwo)
    try {
      await expectApiError(purge(admin, bu, { ids: ['BU-T'] }), { status: 417, message: expect.stringContaining('two visits') })
    } finally { unregisterController(needsTwo) }
    expect(await exists('pg_business_unit', 'BU-T')).toBe(true)
    await purge(admin, bu, { ids: ['BU-T'] })
    const kept = await admin.get<{ visits: { unit: string }[]; updated_at: string }>(plan.rowUrl('PL-1'))
    expect(kept.visits.map((v) => v.unit)).toEqual(['BU-K'])
    // Its revision moved, so a form left open on it knows it changed.
    expect(kept.updated_at).not.toBe(before.updated_at)
  })
})

describe('#859 delete permanently, Codex review round 6', () => {
  test('a document keeping a line with a date and time still saves when another line goes', async ({ admin }) => {
    const { bu } = await setup(admin)
    await makeTable(admin, { name: 'Pg Slot', kind: 'sub_table', columns: [{ column_name: 'unit', column_type: 'Reference', reference_table: BU }, 'at:Datetime', 'day:Date'] })
    const plan = await makeTable(admin, { name: 'Pg Rota', id_pattern: 'prompt', columns: [{ column_name: 'slots', column_type: 'Sub-table', row_table: 'Pg Slot' }] })
    await admin.post(plan.url, { row_id: 'R-1', slots: [{ unit: 'BU-T', at: '2026-11-04T10:00:00.000Z', day: '2026-11-04' }, { unit: 'BU-K', at: '2026-11-05T10:00:00.000Z', day: '2026-11-05' }] })
    await purge(admin, bu, { ids: ['BU-T'] })
    const kept = await admin.get<{ slots: { unit: string; at: string; day: string }[] }>(plan.rowUrl('R-1'))
    expect(kept.slots.map((s) => [s.unit, String(s.day).slice(0, 10)])).toEqual([['BU-K', '2026-11-05']])
    expect(Date.parse(kept.slots[0].at)).toBe(Date.parse('2026-11-05T10:00:00.000Z'))
  })

  test('a row being deleted keeps its own link in its deletion record', async ({ admin }) => {
    const { bu } = await setup(admin)
    // Self-links: BU-K points at BU-T; both go, so BU-K's link is not cleared first.
    await makeTable(admin, { name: 'Pg Node', id_pattern: 'prompt', columns: [{ column_name: 'next_node', column_type: 'Reference', reference_table: 'Pg Node' }] })
    const node = { url: '/api/table/Pg%20Node' } as TableRef
    await admin.post(node.url, { row_id: 'N-B' })
    await admin.post(node.url, { row_id: 'N-A', next_node: 'N-B' })
    await admin.post(node.url, { row_id: 'N-C', next_node: 'N-B' })
    await purge(admin, node, { ids: ['N-A', 'N-B'], links: 'clear' })
    const [rec] = await sql`select snapshot from access_log where operation = 'purge' and ref_table = 'Pg Node' and reference_name = 'N-A'`
    expect(rec.snapshot).toMatchObject({ next_node: 'N-B' })
    expect((await sql.unsafe("select next_node from featherbase.pg_node where row_id = 'N-C'"))[0].next_node).toBeNull()
    void bu
  })
})

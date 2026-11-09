import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { createUserWithRole, expectApiError, expectRefused, expectStatus, makeTable, type TableRef } from './fixtures'
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
    await expectRefused(preview(deleter, bu, ['BU-T']), 403)
    await expectRefused(purge(deleter, bu, { ids: ['BU-T'] }), 403)
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
    await expectRefused(admin.post(`/api/table/Table:purge`, { ids: ['Role'], reason: 'x', confirm: true }), 417)
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
    await expectRefused(purge(admin, notebook, { ids: [row.row_id] }), 417)
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

  test('the row limit counts every row: those asked for, and what cascades', async ({ admin }) => {
    const { bu } = await setup(admin)
    const many = Array.from({ length: 1001 }, (_, i) => `BU-M${i}`)
    await expectApiError(purge(admin, bu, { ids: many }), { status: 417, message: expect.stringContaining('more than 1000') })
    // One row asked for, a thousand and more reached through it.
    await sql.unsafe(`insert into featherbase.pg_store (row_id, store_name, business_unit)
      select 'S-M' || g, 'Many ' || g, 'BU-K' from generate_series(1, 1001) g`)
    await expectApiError(purge(admin, bu, { ids: ['BU-K'] }), { status: 417, message: expect.stringContaining('more than 1000') })
    expect(await exists('pg_business_unit', 'BU-K')).toBe(true)
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

describe('#859 delete permanently, Codex review round 7', () => {
  test('a private row pointing at the target is never named in the preview', async ({ admin, createUser }) => {
    const { bu } = await setup(admin)
    const diary = await makeTable(admin, {
      name: 'Pg Private Diary',
      access_policy: { version: 1, roles: ['Pg Diary Member'], shared_column: 'shared' },
      columns: ['title', 'shared:Check', { column_name: 'unit', column_type: 'Reference', reference_table: BU, reqd: true }],
    })
    const { grantRole } = await import('./fixtures')
    await grantRole(admin, { table: diary.name, role: 'Pg Diary Member', can_read: true, can_create: true, can_write: true })
    const owner = await createUser({ roles: ['Pg Diary Member'] })
    await owner.post('/api/save_row', { table: diary.name, row: { title: 'Secret visit', unit: 'BU-T' } })
    const err = await expectApiError(preview(admin, bu, ['BU-T']), { status: 403 })
    expect(JSON.stringify(err)).not.toContain('Secret visit')
  })

  test('comments and files on a removed comment go too', async ({ admin }) => {
    const { bu } = await setup(admin)
    const c = await admin.post<{ row_id: string }>('/api/table/Comment', { ref_table: BU, ref_name: 'BU-T', content: 'parent comment' })
    await admin.post('/api/table/Comment', { ref_table: 'Comment', ref_name: c.row_id, content: 'reply on the comment' })
    await purge(admin, bu, { ids: ['BU-T'] })
    expect(await sql`select 1 from comment where ref_table = 'Comment' and ref_name = ${c.row_id}`).toHaveLength(0)
  })
})

describe('#859 Codex review round 8', () => {
  test('retire hooks see the whole document, its lines included', async ({ admin }) => {
    await makeTable(admin, { name: 'Pg Step', kind: 'sub_table', columns: ['label'] })
    const flow = await makeTable(admin, { name: 'Pg Flow', id_pattern: 'prompt', columns: [{ column_name: 'steps', column_type: 'Sub-table', row_table: 'Pg Step' }] })
    await admin.post(flow.url, { row_id: 'F-1', steps: [{ label: 'one' }] })
    const needsSteps: TableController = {
      table: 'Pg Flow',
      hooks: { validate: ({ row }) => { if (!Array.isArray(row.steps) || !row.steps.length) throw new AppError('ValidationError', 'A flow needs a step') } },
    }
    registerController(needsSteps)
    try {
      expect(await admin.post<{ retired_reason: string }>(`${flow.rowUrl('F-1')}:retire`, { reason: 'Replaced' })).toMatchObject({ retired_reason: 'Replaced' })
    } finally { unregisterController(needsSteps) }
  })

  test('lines of a private document in a shared sub-table are never swept along', async ({ admin, createUser }) => {
    const { bu } = await setup(admin)
    await makeTable(admin, { name: 'Pg Shared Line', kind: 'sub_table', columns: [{ column_name: 'unit', column_type: 'Reference', reference_table: BU }] })
    const pub = await makeTable(admin, { name: 'Pg Pub Doc', id_pattern: 'prompt', columns: [{ column_name: 'items', column_type: 'Sub-table', row_table: 'Pg Shared Line' }] })
    const priv = await makeTable(admin, {
      name: 'Pg Priv Doc', access_policy: { version: 1, roles: ['Pg Priv Member'], shared_column: 'shared' },
      columns: ['shared:Check', { column_name: 'items', column_type: 'Sub-table', row_table: 'Pg Shared Line' }],
    })
    const { grantRole } = await import('./fixtures')
    await grantRole(admin, { table: priv.name, role: 'Pg Priv Member', can_read: true, can_create: true, can_write: true })
    const owner = await createUser({ roles: ['Pg Priv Member', 'System Manager'] })
    await admin.post(pub.url, { row_id: 'PUB-1', items: [{ unit: 'BU-T' }] })
    const mine = await owner.post<{ row_id: string }>('/api/save_row', { table: priv.name, row: { items: [{ unit: 'BU-T' }] } })
    const plan = await preview(owner, bu, ['BU-T'])
    const lineGroups = plan.groups.filter((g) => g.table === 'Pg Shared Line')
    expect(lineGroups.map((g) => [(g as unknown as { parent_table: string }).parent_table, g.action]).sort()).toEqual([['Pg Priv Doc', 'blocked'], ['Pg Pub Doc', 'delete']])
    await expectRefused(purge(owner, bu, { ids: ['BU-T'] }), 417)
    expect(await sql.unsafe('select 1 from featherbase.pg_shared_line where parent = $1', [mine.row_id])).toHaveLength(1)
  })
})

describe('#859 links to a row of any Table (#881)', () => {
  async function linkTable(admin: TestClient) {
    return makeTable(admin, { name: 'Pg Decision', columns: [
      { column_name: 'about_table', column_type: 'Reference', reference_table: 'Table' },
      { column_name: 'about_row', column_type: 'Reference', table_column: 'about_table' },
    ] })
  }

  test('are found, and deleted too or cleared, and only for the right Table', async ({ admin }) => {
    const { bu, store } = await setup(admin)
    const decision = await linkTable(admin)
    const onBu = await admin.post<{ row_id: string }>(decision.url, { about_table: BU, about_row: 'BU-T' })
    const onStore = await admin.post<{ row_id: string }>(decision.url, { about_table: STORE, about_row: 'S-K' })
    const plan = await preview(admin, bu, ['BU-T'], 'clear')
    expect(plan.groups.find((g) => g.table === 'Pg Decision')).toMatchObject({ count: 1, action: 'clear' })
    await purge(admin, bu, { ids: ['BU-T'], links: 'clear' })
    expect(await admin.get<Record<string, unknown>>(decision.rowUrl(onBu.row_id))).toMatchObject({ about_table: BU, about_row: null })
    expect(await admin.get<Record<string, unknown>>(decision.rowUrl(onStore.row_id))).toMatchObject({ about_table: STORE, about_row: 'S-K' })
    await purge(admin, store, { ids: ['S-K'] })
    await expectStatus(await admin.fetch(decision.rowUrl(onStore.row_id)), 404)
  })
})

describe('#859 delete permanently, Codex review round 9', () => {
  test('a Data Scope naming the row holds the delete, so no one\'s access widens', async ({ admin, createUser }) => {
    const { bu } = await setup(admin)
    const scoped = await createUser({ roles: [] })
    await admin.post('/api/save_row', { table: 'Data Scope', row: { person: scoped.user, allow_table: BU, for_value: 'BU-T' } })
    const plan = await preview(admin, bu, ['BU-T'])
    expect(plan.blocked).toBe(true)
    expect(plan.groups).toContainEqual(expect.objectContaining({ table: 'Data Scope', count: 1, action: 'blocked' }))
    await expectApiError(purge(admin, bu, { ids: ['BU-T'] }), { status: 417, message: expect.stringContaining('widen their access') })
    expect(await sql`select 1 from data_scope where allow_table = ${BU} and for_value = 'BU-T'`).toHaveLength(1)
    expect(await exists('pg_business_unit', 'BU-T')).toBe(true)
  })

  test('a link to a comment on the row is found and cleared, and the record keeps what the comment said', async ({ admin }) => {
    const { bu } = await setup(admin)
    const [c] = await sql`select row_id from comment where ref_table = ${BU} and ref_name = 'BU-T'`
    const decision = await makeTable(admin, { name: 'Pg Ruling', columns: [
      { column_name: 'about_table', column_type: 'Reference', reference_table: 'Table' },
      { column_name: 'about_row', column_type: 'Reference', table_column: 'about_table' },
    ] })
    const d = await admin.post<{ row_id: string }>(decision.url, { about_table: 'Comment', about_row: c.row_id })
    await purge(admin, bu, { ids: ['BU-T'], links: 'clear' })
    expect(await admin.get<Record<string, unknown>>(decision.rowUrl(d.row_id))).toMatchObject({ about_row: null })
    const [rec] = await sql`select snapshot from access_log where operation = 'purge' and ref_table = ${BU} and reference_name = 'BU-T'`
    expect(rec.snapshot._comments).toEqual([expect.objectContaining({ content: 'made by mistake' })])
  })

  test('other sessions hear about the deleted rows and the documents that changed', async ({ admin }) => {
    const { onEvent } = await import('../src/realtime')
    const { bu } = await setup(admin)
    const seen: string[] = []
    const stop = onEvent((e) => seen.push(`${e.channel} ${e.event}`))
    try { await purge(admin, bu, { ids: ['BU-T'], links: 'clear' }) } finally { stop() }
    expect(seen).toContain(`row:${BU}:BU-T deleted`)
    expect(seen).toContain(`list:${BU} deleted`)
    expect(seen).toContain(`row:${STORE}:S-A updated`)
  })
})

describe('#859 delete permanently, Codex review round 10', () => {
  test('the record keeps replies, and files on comments; a reply is removed too', async ({ admin }) => {
    const { bu } = await setup(admin)
    const [c] = await sql`select row_id from comment where ref_table = ${BU} and ref_name = 'BU-T'`
    await admin.post('/api/table/Comment', { ref_table: 'Comment', ref_name: c.row_id, content: 'a reply' })
    await purge(admin, bu, { ids: ['BU-T'] })
    const [rec] = await sql`select snapshot from access_log where operation = 'purge' and ref_table = ${BU} and reference_name = 'BU-T'`
    expect(rec.snapshot._comments[0]).toMatchObject({ content: 'made by mistake', _comments: [expect.objectContaining({ content: 'a reply' })] })
    expect(await sql`select 1 from comment where ref_table = 'Comment' and ref_name = ${c.row_id}`).toHaveLength(0)
  })

  test('two fields sharing a sub-table keep their own lines in the record', async ({ admin }) => {
    await makeTable(admin, { name: 'Pg Twin Line', kind: 'sub_table', columns: ['label'] })
    const doc = await makeTable(admin, { name: 'Pg Twin', id_pattern: 'prompt', columns: [
      { column_name: 'left_side', column_type: 'Sub-table', row_table: 'Pg Twin Line' },
      { column_name: 'right_side', column_type: 'Sub-table', row_table: 'Pg Twin Line' },
    ] })
    await admin.post(doc.url, { row_id: 'T-1', left_side: [{ label: 'L' }], right_side: [{ label: 'R' }] })
    await purge(admin, doc, { ids: ['T-1'] })
    const [rec] = await sql`select snapshot from access_log where operation = 'purge' and ref_table = 'Pg Twin' and reference_name = 'T-1'`
    expect(rec.snapshot.left_side.map((l: { label: string }) => l.label)).toEqual(['L'])
    expect(rec.snapshot.right_side.map((l: { label: string }) => l.label)).toEqual(['R'])
  })
})

describe('#859 delete permanently, Codex review round 11', () => {
  test('an old import run never reaches a later row that reuses an id', async ({ admin }) => {
    const { bu } = await setup(admin)
    const run = await admin.post<{ run_id: string }>(`${bu.url}:import`, { rows: [{ row_id: 'BU-Z', bu_name: 'Imported' }] })
    await purge(admin, bu, { run_id: run.run_id })
    await new Promise((r) => setTimeout(r, 5))
    await admin.post(bu.url, { row_id: 'BU-Z', bu_name: 'A different unit' })
    expect((await admin.get<{ rows: unknown[] }>(`${bu.url}:purge_preview?run_id=${run.run_id}`)).rows).toEqual([])
    expect(await purge(admin, bu, { run_id: run.run_id })).toEqual({ deleted: 0, cleared: 0 })
    expect(await exists('pg_business_unit', 'BU-Z')).toBe(true)
  })
})

describe('#859 Codex review round 13', () => {
  test('an ordinary delete refused by a link to any Table offers Retire too', async ({ admin }) => {
    const { bu } = await setup(admin)
    await admin.post(bu.url, { row_id: 'BU-L', bu_name: 'Linked' })
    const decision = await makeTable(admin, { name: 'Pg Mention', columns: [
      { column_name: 'about_table', column_type: 'Reference', reference_table: 'Table' },
      { column_name: 'about_row', column_type: 'Reference', table_column: 'about_table' },
    ] })
    await admin.post(decision.url, { about_table: BU, about_row: 'BU-L' })
    await expectApiError(admin.delete(bu.rowUrl('BU-L')), { status: 417, fields: { retire: 'available' } })
  })

  test('a Settings link to any Table holds only the Table it names', async ({ admin }) => {
    const { bu } = await setup(admin)
    const settings = await makeTable(admin, { name: 'Pg Any Default', kind: 'settings', columns: [
      { column_name: 'on_table', column_type: 'Reference', reference_table: 'Table' },
      { column_name: 'on_row', column_type: 'Reference', table_column: 'on_table' },
    ] })
    await admin.post(bu.url, { row_id: 'S-A', bu_name: 'Same id as a store' })
    await admin.post('/api/save_row', { table: settings.name, row: { on_table: STORE, on_row: 'S-A' } })
    expect((await preview(admin, bu, ['S-A'])).blocked).toBe(false)
  })

  test('how many of a run\'s rows remain, for a System Manager only', async ({ admin, createUser }) => {
    const { bu } = await setup(admin)
    const run = await admin.post<{ run_id: string }>(`${bu.url}:import`, { rows: [{ row_id: 'BU-Y', bu_name: 'Imported' }] })
    const url = `${bu.url}:purge_run_remaining?run_id=${run.run_id}`
    expect(await admin.get(url)).toEqual({ remaining: 1 })
    const plain = await createUser({ roles: [] })
    await expectRefused(plain.get(url), 403)
    await purge(admin, bu, { run_id: run.run_id })
    expect(await admin.get(url)).toEqual({ remaining: 0 })
  })
})

describe('#859 delete permanently: the rest of the paths', () => {
  test('bad requests are refused, and nothing changes', async ({ admin, createUser }) => {
    const { bu } = await setup(admin)
    await expectRefused(admin.get(`${bu.url}:purge_preview?ids=not-json`), 400)
    await expectApiError(admin.get(`${bu.url}:purge_preview`), { status: 417, message: expect.stringContaining('Expected') })
    await expectApiError(admin.get(`${bu.url}:purge_preview?ids=${encodeURIComponent('["BU-T"]')}&links=sideways`), { status: 417, message: expect.stringContaining("links must be") })
    await expectRefused(preview(admin, bu, ['BU-NOPE']), 404)
    await expectRefused(admin.get(`${bu.url}:purge_preview?run_id=no-such-run`), 404)
    await expectRefused(admin.get(`${bu.url}:purge_run_remaining`), 417)
    await expectApiError(purge(admin, bu, { ids: ['BU-T'], reason: 5 }), { status: 417, fields: { reason: 'Required' } })
    await expectApiError(purge(admin, bu, { ids: ['BU-T'], reason: 'x'.repeat(1001) }), { status: 417, fields: { reason: 'Too long' } })
    void createUser
    expect(await exists('pg_business_unit', 'BU-T')).toBe(true)
  })

  test('a run that recorded no rows has nothing to delete', async ({ admin }) => {
    const { bu } = await setup(admin)
    const run = await admin.post<{ run_id: string }>(`${bu.url}:import`, { rows: [{ row_id: 'BU-N', bu_name: 'Imported' }] })
    await sql`update import_log set touched = null where run_id = ${run.run_id}`
    expect(await admin.get(`${bu.url}:purge_run_remaining?run_id=${run.run_id}`)).toEqual({ remaining: 0 })
  })

  test('a chain through one Table is one group, and a row reached twice goes once', async ({ admin }) => {
    const node = await makeTable(admin, { name: 'Pg Chain', id_pattern: 'prompt', columns: [
      { column_name: 'next_node', column_type: 'Reference', reference_table: 'Pg Chain' },
      { column_name: 'other_node', column_type: 'Reference', reference_table: 'Pg Chain' },
    ] })
    await admin.post(node.url, { row_id: 'C-1' })
    await admin.post(node.url, { row_id: 'C-2', next_node: 'C-1' })
    await admin.post(node.url, { row_id: 'C-3', next_node: 'C-2', other_node: 'C-1' })
    await admin.post(node.url, { row_id: 'C-4', next_node: 'C-2' })
    const plan = await preview(admin, node, ['C-1'])
    expect(plan.rows.map((r) => r.row_id)).toEqual(['C-1', 'C-2', 'C-3', 'C-4'])
    expect((plan.groups as unknown as { column: string; count: number }[]).find((g) => g.column === 'next_node')?.count).toBe(2)
    expect(await purge(admin, node, { ids: ['C-1'] })).toEqual({ deleted: 4, cleared: 0 })
  })

  test('a link held on a line is cleared through its document; other lines stay', async ({ admin }) => {
    const { bu } = await setup(admin)
    await makeTable(admin, { name: 'Pg Stop', kind: 'sub_table', columns: ['label', { column_name: 'unit', column_type: 'Reference', reference_table: BU }] })
    const route = await makeTable(admin, { name: 'Pg Route', id_pattern: 'prompt', columns: [{ column_name: 'stops', column_type: 'Sub-table', row_table: 'Pg Stop' }] })
    await admin.post(route.url, { row_id: 'RT-1', stops: [{ label: 'first', unit: 'BU-T' }, { label: 'second', unit: 'BU-T' }, { label: 'third', unit: 'BU-K' }] })
    expect((await preview(admin, bu, ['BU-T'], 'clear')).groups).toContainEqual(expect.objectContaining({ table: 'Pg Stop', count: 2, action: 'clear' }))
    expect(await purge(admin, bu, { ids: ['BU-T'], links: 'clear' })).toMatchObject({ deleted: 1, cleared: 4 }) // its two stores and two lines
    const kept = await admin.get<{ stops: { label: string; unit: string | null }[] }>(route.rowUrl('RT-1'))
    expect(kept.stops.map((s) => [s.label, s.unit])).toEqual([['first', null], ['second', null], ['third', 'BU-K']])
  })

  test('where the chosen way is impossible the other is used, and neither holds the delete', async ({ admin, createUser }) => {
    const { bu } = await setup(admin)
    // A required link cannot be cleared, so asking to clear deletes it instead.
    const must = await makeTable(admin, { name: 'Pg Must', columns: [{ column_name: 'unit', column_type: 'Reference', reference_table: BU, reqd: true }] })
    const m = await admin.post<{ row_id: string }>(must.url, { unit: 'BU-T' })
    expect((await preview(admin, bu, ['BU-T'], 'clear')).groups).toContainEqual(expect.objectContaining({ table: 'Pg Must', action: 'delete' }))
    // Private work cannot be deleted: a cascade clears an optional link and is held by a required one.
    const { grantRole } = await import('./fixtures')
    const open = await makeTable(admin, { name: 'Pg Soft Note', access_policy: { version: 1, roles: ['Pg Soft Member'], shared_column: 'shared' }, columns: ['shared:Check', { column_name: 'unit', column_type: 'Reference', reference_table: BU }] })
    const hard = await makeTable(admin, { name: 'Pg Hard Note', access_policy: { version: 1, roles: ['Pg Soft Member'], shared_column: 'shared' }, columns: ['shared:Check', { column_name: 'unit', column_type: 'Reference', reference_table: BU, reqd: true }] })
    await grantRole(admin, { table: [open.name, hard.name], role: 'Pg Soft Member', can_read: true, can_create: true, can_write: true })
    const owner = await createUser({ roles: ['Pg Soft Member', 'System Manager'] })
    await owner.post('/api/save_row', { table: open.name, row: { unit: 'BU-K' } })
    expect((await preview(owner, bu, ['BU-K'])).groups).toContainEqual(expect.objectContaining({ table: 'Pg Soft Note', action: 'clear' }))
    await owner.post('/api/save_row', { table: hard.name, row: { unit: 'BU-T' } })
    for (const links of ['cascade', 'clear']) {
      const plan = await preview(owner, bu, ['BU-T'], links)
      expect(plan.blocked).toBe(true)
      expect(plan.groups).toContainEqual(expect.objectContaining({ table: 'Pg Hard Note', action: 'blocked' }))
    }
    expect(await exists('pg_must', m.row_id)).toBe(true)
  })

  test('a link from a connected Table cannot be checked, so it holds the delete', async ({ admin }) => {
    const { bu } = await setup(admin)
    await makeTable(admin, { name: 'Pg Remote', columns: [{ column_name: 'unit', column_type: 'Reference', reference_table: BU }] })
    await sql`update table_def set data_source = 'pg-elsewhere' where name = 'Pg Remote'`
    const { invalidateMeta } = await import('../src/meta')
    invalidateMeta('Pg Remote')
    try {
      const plan = await preview(admin, bu, ['BU-T'])
      expect(plan.blocked).toBe(true)
      expect(plan.groups).toContainEqual(expect.objectContaining({ table: 'Pg Remote', action: 'blocked' }))
    } finally { invalidateMeta('Pg Remote') }
  })

  test('an unset Settings link holds nothing, and a link written during the delete refuses it', async ({ admin }) => {
    const { bu } = await setup(admin)
    await makeTable(admin, { name: 'Pg Unset', kind: 'settings', columns: [{ column_name: 'unit', column_type: 'Reference', reference_table: BU }] })
    const late: TableController = {
      table: BU,
      hooks: { on_trash: async ({ tx }) => { await tx.unsafe("insert into featherbase.pg_store (row_id, store_name, business_unit) values ('S-LATE', 'Late', 'BU-T')") } },
    }
    registerController(late)
    try {
      await expectApiError(purge(admin, bu, { ids: ['BU-T'] }), { status: 409, message: expect.stringContaining('gained a link') })
    } finally { unregisterController(late) }
    expect(await exists('pg_business_unit', 'BU-T')).toBe(true)
    expect(await exists('pg_store', 'S-LATE')).toBe(false)
  })

  test('attachments go with the row; only the platform\'s own stored files are touched', async ({ admin }) => {
    const { bu } = await setup(admin)
    await admin.post('/api/save_row', { table: 'File', row: { file_name: 'a.txt', is_private: false, ref_table: BU, ref_name: 'BU-T' } })
    await sql`update file set file_url = '/files/0123456789abcdef_a.txt' where ref_table = ${BU} and file_name = 'a.txt'`
    await admin.post('/api/save_row', { table: 'File', row: { file_name: 'b.txt', is_private: false, ref_table: BU, ref_name: 'BU-T' } })
    await sql`update file set file_url = '/elsewhere/b.txt' where ref_table = ${BU} and file_name = 'b.txt'`
    await admin.post('/api/save_row', { table: 'File', row: { file_name: 'c.txt', is_private: false, ref_table: BU, ref_name: 'BU-T' } })
    await sql`update file set file_url = '/files/fedcba9876543210_c.txt' where ref_table = ${BU} and file_name = 'c.txt'`
    await admin.post('/api/save_row', { table: 'File', row: { file_name: 'kept.txt', is_private: false } })
    await sql`update file set file_url = '/files/0123456789abcdef_a.txt' where file_name = 'kept.txt'`
    await purge(admin, bu, { ids: ['BU-T'] })
    expect(await sql`select 1 from file where ref_table = ${BU} and ref_name = 'BU-T'`).toHaveLength(0)
    expect(await sql`select 1 from file where file_name = 'kept.txt'`).toHaveLength(1)
    const [rec] = await sql`select snapshot from access_log where operation = 'purge' and ref_table = ${BU} and reference_name = 'BU-T'`
    expect(rec.snapshot._files.map((f: { file_name: string }) => f.file_name).sort()).toEqual(['a.txt', 'b.txt', 'c.txt'])
  })


  test('a run that also updated rows offers only the rows it added', async ({ admin }) => {
    const { bu } = await setup(admin)
    await sql.unsafe("update featherbase.pg_business_unit set bu_name = 'Kept' where row_id = 'BU-K'")
    const run = await admin.post<{ run_id: string }>(`${bu.url}:import`, { key_column: 'row_id', rows: [{ row_id: 'BU-K', bu_name: 'Renamed' }, { row_id: 'BU-A', bu_name: 'Added' }] })
    expect((await admin.get<{ rows: { row_id: string }[] }>(`${bu.url}:purge_preview?run_id=${run.run_id}`)).rows.map((r) => r.row_id)).toEqual(['BU-A'])
  })

  test('an unset Settings link holds nothing', async ({ admin }) => {
    const { bu } = await setup(admin)
    await makeTable(admin, { name: 'Pg Idle', kind: 'settings', columns: [{ column_name: 'unit', column_type: 'Reference', reference_table: BU }] })
    expect(await purge(admin, bu, { ids: ['BU-K'], links: 'clear' })).toEqual({ deleted: 1, cleared: 1 })
  })
})

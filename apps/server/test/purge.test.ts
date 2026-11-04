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
    const [v] = await sql`select data from version where ref_table = ${STORE} and ref_name = 'S-A' and data ? 'link_cleared'`
    expect(v.data).toMatchObject({ changed: [['business_unit', 'BU-T', null]] })
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

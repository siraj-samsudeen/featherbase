// #871: a System Manager renames a custom Table, and everything that names it
// moves with it in one transaction: rows, history, comments, permissions,
// links from other Tables, saved views, list settings and import memory.
import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { expectApiError, expectRefused, grantRole, makeTable, patchDoc } from './fixtures'
import { sql } from '../src/db'

const OLD = 'Trn SAP Plant'
const NEW = 'Trn Plant'
const url = (table: string) => `/api/table/${encodeURIComponent(table)}`
const rename = (client: TestClient, from: string, to: string) =>
  client.post<{ name: string }>(`/api/table_def/${encodeURIComponent(from)}/rename`, { to })

async function plants(admin: TestClient) {
  await makeTable(admin, { name: OLD, id_pattern: 'PLANT-{plant_code}', columns: ['plant_code', 'city'] })
  await admin.post(`${url(OLD)}:import`, { key_column: 'plant_code', rows: [{ plant_code: '8151', city: 'Chenai' }], context: { run_id: 'sap-1' } })
  const row = await admin.get<Record<string, unknown>>(`${url(OLD)}/PLANT-8151`)
  // A person's correction, the kind a re-import must keep (#626, #865).
  await patchDoc(admin, `${url(OLD)}/PLANT-8151`, { city: 'Chennai', updated_at: row.updated_at })
}

describe('#871: renaming a custom Table', () => {
  test('rows, history, comments, permissions and links come along', async ({ admin }) => {
    await plants(admin)
    await makeTable(admin, {
      name: 'Trn Visit',
      columns: [{ column_name: 'plant', column_type: 'Reference', reference_table: OLD }],
    })
    await admin.post('/api/save_row', { table: 'Trn Visit', row: { plant: 'PLANT-8151' } })
    await admin.post('/api/save_row', { table: 'Comment', row: { ref_table: OLD, ref_name: 'PLANT-8151', content: 'Checked on site' } })
    await admin.post(url('Role'), { row_id: 'Trn Reader' })
    await grantRole(admin, { table: OLD, role: 'Trn Reader', can_read: true })
    await admin.post('/api/saved_views', { table: OLD, label: 'Chennai only', filters: [['city', '=', 'Chennai']] })
    await admin.put(`/api/user_settings/${encodeURIComponent(OLD)}`, { columns: ['city'] })

    expect(await rename(admin, OLD, NEW)).toMatchObject({ name: NEW })

    expect(await admin.get(`${url(NEW)}/PLANT-8151`)).toMatchObject({ plant_code: '8151', city: 'Chennai' })
    const activity = await admin.get<{ versions: { data: { changed?: unknown[] } }[]; comments: { content: string }[] }>(
      `/api/activity/${encodeURIComponent(NEW)}/PLANT-8151`,
    )
    expect(activity.versions.map((v) => v.data.changed)).toContainEqual([['city', 'Chenai', 'Chennai']])
    expect(activity.comments.map((c) => c.content)).toContain('Checked on site')
    expect(await sql`select ref_table from permission where role = 'Trn Reader'`).toEqual([{ ref_table: NEW }])
    expect((await admin.get<{ columns: { column_name: string; reference_table: string }[] }>(`${url('Trn Visit')}:meta`)).columns)
      .toContainEqual(expect.objectContaining({ column_name: 'plant', reference_table: NEW }))
    expect((await admin.get<{ views: { label: string }[] }>(`/api/saved_views?table=${encodeURIComponent(NEW)}`)).views.map((v) => v.label))
      .toEqual(['Chennai only'])
    expect(await admin.get(`/api/user_settings/${encodeURIComponent(NEW)}`)).toEqual({ settings: { columns: ['city'] } })
    // New rows still follow the Table's naming rule.
    expect((await admin.post<{ row_id: string }>('/api/save_row', { table: NEW, row: { plant_code: '8152' } })).row_id).toBe('PLANT-8152')
  })

  test('a re-import after the rename keeps the person\'s edit and its history', async ({ admin }) => {
    await plants(admin)
    await rename(admin, OLD, NEW)
    await admin.post(`${url(NEW)}:import`, { key_column: 'plant_code', rows: [{ plant_code: '8151', city: 'Chenai' }], context: { run_id: 'sap-2' } })
    expect(await admin.get(`${url(NEW)}/PLANT-8151`)).toMatchObject({ city: 'Chennai' })
    // A new value from the source is held as a conflict, not written over the edit.
    await admin.post(`${url(NEW)}:import`, { key_column: 'plant_code', rows: [{ plant_code: '8151', city: 'Madras' }], context: { run_id: 'sap-3' } })
    expect(await admin.get(`${url(NEW)}/PLANT-8151`)).toMatchObject({ city: 'Chennai' })
    expect((await admin.get<{ conflicts: Record<string, unknown>[] }>(`${url(NEW)}:import-conflicts`)).conflicts)
      .toEqual([expect.objectContaining({ row_id: 'PLANT-8151', field: 'city', kept: 'Chennai', incoming: 'Madras', editor: 'Administrator' })])
  })

  test('the old name says where the Table went, by URL spelling too', async ({ admin }) => {
    await plants(admin)
    await rename(admin, OLD, NEW)
    for (const spelling of [OLD, 'trn-sap-plant'])
      await expectApiError(admin.get(`${url(spelling)}:meta`), {
        status: 404,
        message: expect.stringMatching(new RegExp(`Table ${OLD} was renamed to ${NEW} by Administrator on \\d{2}-[A-Z][a-z]{2}-\\d{4}$`)),
      })
    // A Table made later under the old name is a Table like any other.
    await makeTable(admin, { name: OLD, columns: ['code'] })
    expect(await admin.get(`${url(OLD)}:meta`)).toMatchObject({ name: OLD })
  })

  test('recently opened entries follow the Table to its new name and address', async ({ admin }) => {
    await plants(admin)
    await admin.post('/api/events', { events: [
      { kind: 'list', key: `list:${OLD}?`, label: OLD, path: '/featherbase/admin/table/trn-sap-plant' },
      { kind: 'row', key: `row:${OLD}/PLANT-8151`, label: 'Chennai', sub: OLD, path: '/featherbase/admin/table/trn-sap-plant/row/PLANT-8151' },
      { kind: 'list', key: 'list:Trn SAP Plants?', label: 'Trn SAP Plants', path: '/featherbase/admin/table/trn-sap-plants' },
    ] })
    await rename(admin, OLD, NEW)
    const { entries } = await admin.get<{ entries: { key: string; label: string; sub?: string; path: string }[] }>('/api/events/summary')
    const pick = (e: { key: string; label: string; sub?: string | null; path: string }) => ({ key: e.key, label: e.label, sub: e.sub ?? null, path: e.path })
    expect(entries.map(pick)).toEqual(expect.arrayContaining([
      { key: `list:${NEW}?`, label: NEW, sub: null, path: '/featherbase/admin/table/trn-plant' },
      { key: `row:${NEW}/PLANT-8151`, label: 'Chennai', sub: NEW, path: '/featherbase/admin/table/trn-plant/row/PLANT-8151' },
      // Another Table whose name merely starts the same way is left alone.
      { key: 'list:Trn SAP Plants?', label: 'Trn SAP Plants', sub: null, path: '/featherbase/admin/table/trn-sap-plants' },
    ]))
    expect(entries.map((e) => e.key)).not.toContain(`list:${OLD}?`)
  })

  test('only a System Manager renames, and only to a free, valid name', async ({ admin, createUser }) => {
    await plants(admin)
    await makeTable(admin, { name: 'Trn Taken', columns: ['code'] })
    const user = await createUser()
    await expectRefused(rename(user, OLD, NEW), 403)
    await expectRefused(rename(admin, OLD, 'Trn Taken'), 409)
    await expectRefused(rename(admin, OLD, 'trn taken'), 409)
    for (const bad of ['', '   ', 'Trn/Plant', 'x'.repeat(200)])
      await expectRefused(rename(admin, OLD, bad), 417)
    expect(await admin.get(`${url(OLD)}/PLANT-8151`)).toMatchObject({ city: 'Chennai' })
  })

  test('platform Tables are not renamed here', async ({ admin }) => {
    await expectRefused(rename(admin, 'Comment', 'Remark'), 417)
    expect(await admin.get(`${url('Comment')}:meta`)).toMatchObject({ name: 'Comment' })
  })

  test('a Table with a unique column renames, and the column stays unique', async ({ admin }) => {
    await makeTable(admin, { name: OLD, columns: [{ column_name: 'plant_code', column_type: 'Data', unique: true }] })
    await admin.post('/api/save_row', { table: OLD, row: { plant_code: '8151' } })
    await rename(admin, OLD, NEW)
    await expectRefused(admin.post('/api/save_row', { table: NEW, row: { plant_code: '8151' } }), 417)
    // The next change to the column finds its constraint under the new name.
    await admin.post(`/api/table_def/${encodeURIComponent(NEW)}/rename_column`, { from: 'plant_code', to: 'sap_code' })
    expect((await admin.post<{ row_id: string }>('/api/save_row', { table: NEW, row: { sap_code: '8152' } })).row_id).toBeTruthy()
  })

  test('a change of case alone keeps the rows where they are', async ({ admin }) => {
    await plants(admin)
    expect(await rename(admin, OLD, 'Trn sap plant')).toMatchObject({ name: 'Trn sap plant' })
    expect(await admin.get(`${url('Trn sap plant')}/PLANT-8151`)).toMatchObject({ city: 'Chennai' })
  })

  test('a Table an installed app lists is not renamed here', async ({ admin }) => {
    await plants(admin)
    await sql`insert into installed_app (name, tables) values ('trnapp', ${sql.json([OLD])})`
    await expectApiError(rename(admin, OLD, NEW), { status: 417, message: expect.stringContaining('belongs to the installed app trnapp') })
    expect(await admin.get(`${url(OLD)}:meta`)).toMatchObject({ name: OLD })
  })

  test('a request without a new name is refused', async ({ admin }) => {
    await plants(admin)
    await expectApiError(admin.post(`/api/table_def/${encodeURIComponent(OLD)}/rename`, {}), { status: 417, message: expect.stringContaining('Expected { to }') })
  })

  test('renaming to the same name changes nothing', async ({ admin }) => {
    await plants(admin)
    expect(await rename(admin, OLD, OLD)).toMatchObject({ name: OLD })
  })
})

// #1454: a Table about places is read only within each person's places, on the ordinary read paths. The app
// `scopedproof` declares its answers Table under `scopedTables`, mapped on store and section; its Answer Reader role
// reads and writes the Table whole, and the platform narrows every read and write to the reader's places. The places
// come from test-apps/fixtures/place-roster, which a test tells what to answer. Every row is made up.
import type { TestClient } from 'feather-testing-postgres'
import { afterEach, describe, expect } from 'vitest'
import { test } from './pg-test'
import { discoverPackages } from '../src/runtime-packages'
import { expectRefused } from './fixtures'
import { eventVisibleTo } from '../src/realtime'
import { ANSWER, APP, NORTH_AND_SOUTH_KIDS, REASON, ids, installed, list, notSetUpProvider, removeScopedFolders, withPlaces, writeApp } from './scoped-proof-app'

afterEach(removeScopedFolders)
describe('a Table about places', () => {
  test('lists only the rows the reader’s places reach, on the ordinary Table read', async ({ admin, createUser }) => {
    await installed(admin)
    const reader = await createUser({ roles: ['Answer Reader'] })
    await withPlaces(NORTH_AND_SOUTH_KIDS, async () => {
      expect(ids(await list(reader))).toEqual(['a1', 'a2', 'a3'])
      // the reader's own filters narrow further, never wider
      expect(ids(await list(reader, ANSWER, [['store', '=', 'S1']]))).toEqual(['a3'])
      // the list's own total counts the same rows
      const page = await reader.get<{ total: number }>(`/api/table/${encodeURIComponent(ANSWER)}?${new URLSearchParams({ limit_page_length: '1' })}`)
      expect(page.total).toBe(3)
      // a count is the same rows
      const counted = await reader.post<{ data: { label: string; value: number }[] }>('/api/dashboard/chart', { table: ANSWER, group_by: 'store', filters: [] })
      expect(Object.fromEntries(counted.data.map((c) => [c.label, c.value]))).toEqual({ N1: 2, S1: 1 })
    })
  })

  test('opens a row within the places, and refuses one outside them', async ({ admin, createUser }) => {
    await installed(admin)
    const reader = await createUser({ roles: ['Answer Reader'] })
    await withPlaces(NORTH_AND_SOUTH_KIDS, async () => {
      expect(await reader.get(`/api/table/${encodeURIComponent(ANSWER)}/a3`)).toMatchObject({ body: 'south kids' })
      await expectRefused(reader.get(`/api/table/${encodeURIComponent(ANSWER)}/a4`), 403, 'outside the places the org chart gives you')
    })
  })

  test('a Sub-table’s rows are only as readable as the row they hang on', async ({ admin, createUser }) => {
    await installed(admin)
    const reader = await createUser({ roles: ['Answer Reader'] })
    await withPlaces(NORTH_AND_SOUTH_KIDS, async () => {
      const codes = (await reader.get<{ data: { code: string }[] }>(`/api/table/${encodeURIComponent(REASON)}?${new URLSearchParams({ fields: JSON.stringify(['code']) })}`)).data
      expect(codes.map((c) => c.code).sort()).toEqual(['a1-festival', 'a1-stockout'])
    })
  })

  test('a comment on a row is only as readable as the row', async ({ admin, createUser }) => {
    await installed(admin)
    for (const name of ['a3', 'a4']) await admin.post('/api/save_row', { table: 'Comment', row: { ref_table: ANSWER, ref_name: name, content: `about ${name}` } })
    // an administrator lets the role read Comments; which ones is the rows' business
    await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Comment', role: 'Answer Reader', operation: 'read', scope_mode: 'all', column_rule: 'every' } })
    const reader = await createUser({ roles: ['Answer Reader'] })
    await withPlaces(NORTH_AND_SOUTH_KIDS, async () => {
      const comments = (await reader.get<{ data: { ref_name: string }[] }>(`/api/table/Comment?${new URLSearchParams({
        fields: JSON.stringify(['ref_name']), filters: JSON.stringify([['ref_table', '=', ANSWER]]) })}`)).data
      expect(comments.map((c) => c.ref_name)).toEqual(['a3'])
    })
  })

  test('a place naming a filter the Table does not map adds no row (fail closed)', async ({ admin, createUser }) => {
    await installed(admin)
    const reader = await createUser({ roles: ['Answer Reader'] })
    await withPlaces([{ label: 'North by line', filters: { store: ['N1'], line: ['L1'] } }, { label: 'South mens', filters: { store: ['S1'], section: ['mens'] } }],
      async () => expect(ids(await list(reader))).toEqual(['a4']))
  })

  test('someone with no places reads only the rows they wrote, and may write their own', async ({ admin, createUser }) => {
    await installed(admin)
    const reader = await createUser({ roles: ['Answer Reader'] })
    await withPlaces([], async () => {
      expect(await list(reader)).toEqual([])
      await reader.post('/api/save_row', { table: ANSWER, row: { row_id: 'mine', store: 'S1', section: 'mens', body: 'my own' } })
      expect(ids(await list(reader))).toEqual(['mine'])
    })
  })

  test('nobody changes a row outside their places', async ({ admin, createUser }) => {
    await installed(admin)
    const reader = await createUser({ roles: ['Answer Reader'] })
    const a4 = await admin.get<{ updated_at: string }>(`/api/table/${encodeURIComponent(ANSWER)}/a4`)
    await withPlaces(NORTH_AND_SOUTH_KIDS, async () => {
      await expectRefused(reader.post('/api/save_row', { table: ANSWER, row: { row_id: 'a4', updated_at: a4.updated_at, body: 'changed' } }), 403)
      const a3 = await reader.get<{ updated_at: string }>(`/api/table/${encodeURIComponent(ANSWER)}/a3`)
      expect(await reader.post('/api/save_row', { table: ANSWER, row: { row_id: 'a3', updated_at: a3.updated_at, body: 'changed' } })).toMatchObject({ row_id: 'a3' })
    })
  })

  test('a live update reaches only the people whose places hold the row; a deletion reaches none of them', async ({ admin, createUser }) => {
    await installed(admin)
    const reader = await createUser({ roles: ['Answer Reader'] })
    const event = (event: string, row_id: string) => ({ channel: `row:${ANSWER}:${row_id}`, event, payload: { table: ANSWER, row_id } })
    await withPlaces(NORTH_AND_SOUTH_KIDS, async () => {
      expect(await eventVisibleTo(reader.user!, event('updated', 'a3'))).toBe(true)
      expect(await eventVisibleTo(reader.user!, event('updated', 'a4'))).toBe(false)
      expect(await eventVisibleTo(reader.user!, event('deleted', 'a3'))).toBe(false)
    })
  })

  test('a scope provider not set up yet gives nobody places: they read only their own rows', async ({ admin, createUser }) => {
    expect(await discoverPackages([await writeApp(), await notSetUpProvider()])).toEqual([])
    await admin.post('/api/install_app', { name: APP })
    await admin.post('/api/install_app', { name: 'placeroster' })
    await admin.post('/api/save_row', { table: ANSWER, row: { row_id: 'a1', store: 'N1', section: 'kids', body: 'north kids' } })
    const reader = await createUser({ roles: ['Answer Reader'] })
    await reader.post('/api/save_row', { table: ANSWER, row: { row_id: 'mine', store: 'N1', section: 'kids', body: 'my own' } })
    expect(ids(await list(reader))).toEqual(['mine'])
  })

  test('a System Manager is not narrowed, as Data Scope does not narrow them', async ({ admin, createUser }) => {
    await installed(admin)
    const manager = await createUser({ roles: ['System Manager'] })
    await withPlaces([], async () => expect(ids(await list(manager))).toEqual(['a1', 'a2', 'a3', 'a4']))
  })

  test('the declaration names the app’s own Table and its plain columns', async () => {
    const problems = async (more: Record<string, unknown>) => JSON.stringify(await discoverPackages([await writeApp(more), (await import('node:path')).resolve('../..', 'test-apps/fixtures/place-roster')]))
    expect(await problems({ scopedTables: [{ table: 'Shop Store', keys: [], filters: { store: 'store' } }] })).toContain('not one of the app')
    expect(await problems({ scopedTables: [{ table: ANSWER, keys: ['missing'], filters: { store: 'store' } }] })).toContain('cannot be filtered on missing')
    expect(await problems({ scopedTables: [{ table: ANSWER, keys: [], filters: { store: 'notes' } }] })).toContain('cannot be filtered on notes')
    expect(await problems({ scopedTables: [{ table: ANSWER, keys: [], filters: {} }] })).toContain('maps at least one scope filter')
  })
})

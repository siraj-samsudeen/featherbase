import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { createUserWithRole, expectApiError, expectRefused, expectStatus, makeTable, type TableRef } from './fixtures'
import { sql } from '../src/db'
import { eventVisibleTo } from '../src/realtime'
import { invalidateMeta } from '../src/meta'
import type { CreateUserFn, TestClient } from 'feather-testing-postgres'

// #246 items 1 and 2: a Table names the Reference columns that scope it
// (scope_on), and can refuse everyone with no Data Scope on those dimensions
// (scope_required) instead of showing them every row.

const STORE = 'Sr Store'
const SECTION = 'Sr Section'
const ROLE = 'Sr Role'

interface World {
  user: TestClient
  store: TableRef
  section: TableRef
  rowOf: (title: string) => Promise<string>
}

async function setup(
  admin: TestClient,
  createUser: CreateUserFn,
  section: Record<string, unknown>,
  scopes: { allow_table: string; for_value: string }[] = [],
): Promise<World> {
  const store = await makeTable(admin, { name: STORE, id_pattern: 'prompt', columns: ['city'] })
  const sectionRef = await makeTable(admin, {
    name: SECTION,
    columns: [
      'title',
      { column_name: 'store', column_type: 'Reference', reference_table: STORE },
      { column_name: 'supplier_store', column_type: 'Reference', reference_table: STORE },
    ],
    ...section,
  })
  const user = await createUserWithRole(admin, createUser, {
    role: ROLE,
    table: [SECTION, STORE],
    can_read: true,
    can_write: true,
    can_create: true,
    can_delete: true,
  })
  for (const s of ['North', 'South']) await admin.post('/api/save_row', { table: STORE, row: { row_id: s } })
  for (const [title, s, supplier] of [['n', 'North', 'South'], ['s', 'South', 'North'], ['none', null, null]])
    await admin.post('/api/save_row', { table: SECTION, row: { title, store: s, supplier_store: supplier } })
  for (const scope of scopes)
    await admin.post('/api/save_row', { table: 'Data Scope', row: { person: user.user, ...scope } })
  const rowOf = async (title: string) =>
    String((await sql.unsafe(`select row_id from featherbase.sr_section where title = $1`, [title]))[0].row_id)
  return { user, store, section: sectionRef, rowOf }
}

const titles = async (client: TestClient, table: TableRef) =>
  (await client.get<{ data: { title: string }[] }>(table.listUrl({ fields: ['title'] })))
    .data.map((r) => r.title).sort()

describe('#246 scope_on: only the declared Reference columns narrow rows', () => {
  test('an undeclared Reference to a scoped Table no longer hides rows', async ({ admin, createUser }) => {
    const { user, section, rowOf } = await setup(admin, createUser, { scope_on: ['store'] },
      [{ allow_table: STORE, for_value: 'North' }])
    // 'n' is North's (supplier South), 's' is South's (supplier North).
    expect(await titles(user, section)).toEqual(['n', 'none'])
    await expectStatus(await user.fetch(section.rowUrl(await rowOf('n'))), 200)
    await expectRefused(user.get(section.rowUrl(await rowOf('s'))), 403)
    // Saving a North row that names South as its supplier is allowed.
    const ok = await user.fetch(section.url, {
      method: 'POST', body: JSON.stringify({ title: 'ok', store: 'North', supplier_store: 'South' }),
    })
    await expectStatus(ok, 201)
  })

  test('without scope_on every Reference narrows, as before', async ({ admin, createUser }) => {
    const { user, section } = await setup(admin, createUser, {}, [{ allow_table: STORE, for_value: 'North' }])
    expect(await titles(user, section)).toEqual(['none'])
  })

  test('scope_on must name Reference columns of the Table', async ({ admin }) => {
    await makeTable(admin, { name: STORE, id_pattern: 'prompt', columns: ['city'] })
    await expectApiError(admin.post('/api/table_def', {
      name: 'Sr Bad', columns: [{ column_name: 'title', column_type: 'Data' }], scope_on: ['title'],
    }), { status: 417 })
    await expectApiError(admin.post('/api/table_def', {
      name: 'Sr Bad', columns: [{ column_name: 'title', column_type: 'Data' }], scope_on: ['nowhere'],
    }), { status: 417 })
    await expectApiError(admin.post('/api/table_def', {
      name: 'Sr Bad', columns: [{ column_name: 'title', column_type: 'Data' }], scope_required: true,
    }), { status: 417 })
  })
})

describe('#246 the scope declaration lives with the Table definition', () => {
  const defUrl = `/api/table_def/${encodeURIComponent(SECTION)}`
  const columns = [
    { column_name: 'title', column_type: 'Data' },
    { column_name: 'store', column_type: 'Reference', reference_table: STORE },
    { column_name: 'supplier_store', column_type: 'Reference', reference_table: STORE },
  ]
  const stored = async () => (await sql`select scope_on, scope_required from featherbase.table_def where name = ${SECTION}`)[0]

  test('an update that leaves it out keeps it; an empty list clears it', async ({ admin, createUser }) => {
    await setup(admin, createUser, { scope_on: ['store'], scope_required: true })
    await admin.put(defUrl, { name: SECTION, columns, description: 'kept' })
    expect(await stored()).toEqual({ scope_on: ['store'], scope_required: true })
    await admin.put(defUrl, { name: SECTION, columns, scope_on: [], scope_required: false })
    expect(await stored()).toEqual({ scope_on: null, scope_required: false })
  })

  test('renaming a scope column renames it in the declaration', async ({ admin, createUser }) => {
    await setup(admin, createUser, { scope_on: ['store', 'supplier_store'], scope_required: true })
    await admin.post(`${defUrl}/rename_column`, { from: 'store', to: 'home_store' })
    expect((await stored()).scope_on).toEqual(['home_store', 'supplier_store'])
  })

  test('a scope column cannot be removed while the Table is scoped on it', async ({ admin, createUser }) => {
    await setup(admin, createUser, { scope_on: ['store'] })
    await expectRefused(admin.put(defUrl, { name: SECTION, columns: columns.filter((c) => c.column_name !== 'store'), remove_columns: ['store'] }), 417)
    expect((await stored()).scope_on).toEqual(['store'])
  })
})

describe('#246 scope_required: no Data Scope means no rows', () => {
  const required = { scope_on: ['store'], scope_required: true }

  test('a person with no Data Scope rows at all lists nothing', async ({ admin, createUser }) => {
    const { user, section } = await setup(admin, createUser, required)
    const res = await user.get<{ data: unknown[]; total: number }>(section.url)
    expect(res.total).toBe(0)
    expect(res.data).toEqual([])
    expect((await user.get<{ count: number }>(`/api/table/${encodeURIComponent(SECTION)}:count`)).count).toBe(0)
  })

  test('a person scoped on another dimension only also lists nothing', async ({ admin, createUser }) => {
    const { user, section } = await setup(admin, createUser, required, [{ allow_table: 'Role', for_value: ROLE }])
    expect((await user.get<{ total: number }>(section.url)).total).toBe(0)
  })

  test('with no Data Scope, reads and every write are refused', async ({ admin, createUser }) => {
    const { user, section, rowOf } = await setup(admin, createUser, required)
    const n = await rowOf('n')
    await expectRefused(user.get(section.rowUrl(n)), 403)
    await expectRefused(user.get(section.rowUrl(await rowOf('none'))), 403)
    await expectRefused(user.post(section.url, { title: 'x', store: 'North' }), 403)
    await expectRefused(user.post(section.url, { title: 'x' }), 403)
    const [current] = await sql.unsafe(`select updated_at from featherbase.sr_section where row_id = $1`, [n])
    await expectRefused(user.fetch(section.rowUrl(n), { method: 'PATCH', body: JSON.stringify({ title: 'changed', updated_at: current.updated_at }) }), 403)
    await expectRefused(user.delete(section.rowUrl(n)), 403)
    const [still] = await sql.unsafe(`select title from featherbase.sr_section where row_id = $1`, [n])
    expect(still.title).toBe('n')
  })

  test('a scoped person sees their store only; a row naming no store is hidden', async ({ admin, createUser }) => {
    const { user, section, rowOf } = await setup(admin, createUser, required, [{ allow_table: STORE, for_value: 'North' }])
    expect(await titles(user, section)).toEqual(['n'])
    await expectRefused(user.get(section.rowUrl(await rowOf('none'))), 403)
    await expectRefused(user.post(section.url, { title: 'x' }), 403)
    const ok = await user.fetch(section.url, { method: 'POST', body: JSON.stringify({ title: 'ok', store: 'North' }) })
    await expectStatus(ok, 201)
  })

  test('a scope column whose type changed still fails closed', async ({ admin, createUser }) => {
    const { user, section } = await setup(admin, createUser, required, [{ allow_table: STORE, for_value: 'North' }])
    await sql`update featherbase.column_def set column_type = 'Data', reference_table = null where parent = ${SECTION} and column_name = 'store'`
    invalidateMeta(SECTION)
    expect((await user.get<{ total: number }>(section.url)).total).toBe(0)
  })

  test('admins are unaffected', async ({ admin, createUser }) => {
    const { section } = await setup(admin, createUser, required)
    expect((await admin.get<{ total: number }>(section.url)).total).toBe(3)
  })

  test('search finds nothing on the Table for a person with no Data Scope', async ({ admin, createUser }) => {
    const { user } = await setup(admin, createUser, { ...required, title_column: 'title' })
    const hits = await user.get<{ results: { table: string }[] }>('/api/search?q=n')
    expect(hits.results.filter((h) => h.table === SECTION)).toEqual([])
  })

  test('realtime events on the Table stop for a person with no Data Scope', async ({ admin, createUser }) => {
    const { user, rowOf } = await setup(admin, createUser, required)
    const row_id = await rowOf('n')
    expect(await eventVisibleTo(user.user!, { event: 'updated', payload: { table: SECTION, row_id } } as never)).toBe(false)
    expect(await eventVisibleTo(user.user!, { event: 'deleted', payload: { table: SECTION, row_id } } as never)).toBe(false)
  })

  test('an undeclared Table still shows everything to a person with no Data Scope', async ({ admin, createUser }) => {
    const { user, section } = await setup(admin, createUser, {})
    expect((await user.get<{ total: number }>(section.url)).total).toBe(3)
  })
})

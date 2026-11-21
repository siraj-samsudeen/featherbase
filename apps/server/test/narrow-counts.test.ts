import { describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { grantRole } from './fixtures'

// #1289 option C: Click To Narrow. One request counts every list of the panel
// at once: for each list, how many of the list's rows reach each value along a
// link path, under the list's filters and every OTHER list's picks, never its
// own. Made-up store layout: Store ← Section → Floor; Section ← Section
// Subcategory → Subcategory → Category.

const STORE = 'Nar Store'
const FLOOR = 'Nar Floor'
const SECTION = 'Nar Section'
const CATEGORY = 'Nar Category'
const SUBCAT = 'Nar Subcategory'
const SECSUB = 'Nar Section Subcategory'

async function setup(admin: TestClient) {
  for (const name of [STORE, FLOOR, CATEGORY])
    await admin.post('/api/table_def', { name, id_pattern: 'prompt', columns: [{ column_name: 'title', column_type: 'Data' }] })
  await admin.post('/api/table_def', {
    name: SUBCAT,
    id_pattern: 'prompt',
    columns: [{ column_name: 'category', column_type: 'Reference', reference_table: CATEGORY }],
  })
  await admin.post('/api/table_def', {
    name: SECTION,
    id_pattern: 'prompt',
    columns: [
      { column_name: 'store', column_type: 'Reference', reference_table: STORE },
      { column_name: 'floor', column_type: 'Reference', reference_table: FLOOR },
      { column_name: 'kind', column_type: 'Choice', choices: 'Fashion\nGrocery' },
    ],
  })
  await admin.post('/api/table_def', {
    name: SECSUB,
    columns: [
      { column_name: 'section', column_type: 'Reference', reference_table: SECTION },
      { column_name: 'subcategory', column_type: 'Reference', reference_table: SUBCAT },
    ],
  })
  for (const s of ['Bayside', 'Northgate', 'Lakeside']) await admin.post('/api/save_row', { table: STORE, row: { row_id: s } })
  for (const f of ['Ground Floor', 'First Floor']) await admin.post('/api/save_row', { table: FLOOR, row: { row_id: f } })
  for (const c of ['Women Ethnic Wear', 'Staples']) await admin.post('/api/save_row', { table: CATEGORY, row: { row_id: c } })
  for (const [s, c] of [['Churidar', 'Women Ethnic Wear'], ['Half Saree', 'Women Ethnic Wear'], ['Rava', 'Staples']])
    await admin.post('/api/save_row', { table: SUBCAT, row: { row_id: s, category: c } })
  const sections: [string, string | null, string | null, string][] = [
    ['Ethnic Wear', 'Bayside', 'First Floor', 'Fashion'],
    ['Night Wear', 'Bayside', 'First Floor', 'Fashion'],
    ['Grocery', 'Bayside', 'Ground Floor', 'Grocery'],
    ['Ladies Ethnic', 'Northgate', 'First Floor', 'Fashion'],
    ['Staples', 'Northgate', null, 'Grocery'],
    ['Pop Up', null, 'Ground Floor', 'Fashion'],
  ]
  for (const [row_id, store, floor, kind] of sections)
    await admin.post('/api/save_row', { table: SECTION, row: { row_id, store, floor, kind } })
  for (const [section, subcategory] of [
    ['Ethnic Wear', 'Churidar'], ['Ethnic Wear', 'Half Saree'], ['Ladies Ethnic', 'Churidar'], ['Grocery', 'Rava'],
  ])
    await admin.post('/api/save_row', { table: SECSUB, row: { section, subcategory } })
}

type Step = { column: string } | { from: string; column: string }
type List = { path: Step[]; pick?: unknown[] }

const narrow = async (client: TestClient, table: string, lists: List[], filters: unknown[] = []) => {
  const qs = `lists=${encodeURIComponent(JSON.stringify(lists))}&filters=${encodeURIComponent(JSON.stringify(filters))}`
  const res = await client.get<{ lists: { values: { value: string | null; count: number }[] }[] }>(
    `/api/table/${encodeURIComponent(table)}:narrow?${qs}`)
  // Each list as { value: count }, the none bucket as '∅', so a test reads as the panel does.
  return res.lists.map((l) => Object.fromEntries(l.values.map((v) => [v.value ?? '∅', v.count])))
}

const pickStores = (...ids: string[]) => ['store', 'related', { table: STORE, filters: [['row_id', 'in', ids]] }]
const pickFloors = (...ids: string[]) => ['floor', 'related', { table: FLOOR, filters: [['row_id', 'in', ids]] }]

describe('#1289: Click To Narrow counts', () => {
  test('each list counts the rows reaching each value, the unlinked ones as none', async ({ admin }) => {
    await setup(admin)
    const [store, floor] = await narrow(admin, SECTION, [{ path: [{ column: 'store' }] }, { path: [{ column: 'floor' }] }])
    expect(store).toEqual({ Bayside: 3, Northgate: 2, '∅': 1 })
    expect(floor).toEqual({ 'First Floor': 3, 'Ground Floor': 2, '∅': 1 })
  })

  test("a list's counts apply every other list's picks, never its own; a ruled-out value stays at 0", async ({ admin }) => {
    await setup(admin)
    const [store, floor] = await narrow(admin, SECTION, [
      { path: [{ column: 'store' }], pick: pickStores('Northgate') },
      { path: [{ column: 'floor' }] },
    ])
    // Store ignores its own pick, so Bayside stays possible.
    expect(store).toEqual({ Bayside: 3, Northgate: 2, '∅': 1 })
    // Floor applies the store pick: Ground Floor is ruled out but still listed.
    expect(floor).toEqual({ 'First Floor': 1, 'Ground Floor': 0, '∅': 1 })
  })

  test('the list filters apply to every list', async ({ admin }) => {
    await setup(admin)
    const [store] = await narrow(admin, SECTION, [{ path: [{ column: 'store' }] }], [['kind', '=', 'Grocery']])
    expect(store).toEqual({ Bayside: 1, Northgate: 1 })
  })

  test('no lists, no counts; with_retired is read', async ({ admin }) => {
    await setup(admin)
    expect(await narrow(admin, SECTION, [])).toEqual([])
    const qs = `lists=${encodeURIComponent(JSON.stringify([{ path: [{ column: 'store' }] }]))}&with_retired=true`
    const res = await admin.get<{ lists: { values: { value: string | null; count: number }[] }[] }>(`/api/table/${encodeURIComponent(SECTION)}:narrow?${qs}`)
    expect(res.lists[0].values.reduce((n, v) => n + v.count, 0)).toBe(6)
  })

  test('a two-step path counts the value two links away', async ({ admin }) => {
    await setup(admin)
    const [floor, category] = await narrow(admin, SECSUB, [
      { path: [{ column: 'section' }, { column: 'floor' }] },
      { path: [{ column: 'subcategory' }, { column: 'category' }] },
    ])
    expect(floor).toEqual({ 'First Floor': 3, 'Ground Floor': 1 })
    expect(category).toEqual({ 'Women Ethnic Wear': 3, Staples: 1 })
  })

  test('through a link table, each row counts once per value, and rows with none are none', async ({ admin }) => {
    await setup(admin)
    const [subcategory, category] = await narrow(admin, SECTION, [
      { path: [{ from: SECSUB, column: 'section' }, { column: 'subcategory' }] },
      { path: [{ from: SECSUB, column: 'section' }, { column: 'subcategory' }, { column: 'category' }] },
    ])
    expect(subcategory).toEqual({ Churidar: 2, 'Half Saree': 1, Rava: 1, '∅': 3 })
    // Ethnic Wear reaches Women Ethnic Wear twice, and counts once.
    expect(category).toEqual({ 'Women Ethnic Wear': 2, Staples: 1, '∅': 3 })
  })

  // Codex review: a fan-out reaching both a value and nothing is linked, as `not related` reads it.
  test('a row reaching a value through one link row and nothing through another is not counted as none', async ({ admin }) => {
    await setup(admin)
    await admin.post('/api/save_row', { table: SECSUB, row: { section: 'Ethnic Wear', subcategory: null } })
    const [subcategory] = await narrow(admin, SECTION, [{ path: [{ from: SECSUB, column: 'section' }, { column: 'subcategory' }] }])
    expect(subcategory).toEqual({ Churidar: 2, 'Half Saree': 1, Rava: 1, '∅': 3 })
  })

  test("a Choice column and the list's own rows are lists too", async ({ admin }) => {
    await setup(admin)
    const [kind, own] = await narrow(admin, SECTION, [
      { path: [{ column: 'kind' }], pick: ['kind', 'in', ['Grocery']] },
      { path: [] },
    ])
    expect(kind).toEqual({ Fashion: 4, Grocery: 2 })
    expect(own).toEqual({ Grocery: 1, Staples: 1, 'Ethnic Wear': 0, 'Night Wear': 0, 'Ladies Ethnic': 0, 'Pop Up': 0 })
  })

  test('only rows the viewer may read are counted', async ({ admin, createUser }) => {
    await setup(admin)
    const ROLE = 'Nar Scoped Role'
    await grantRole(admin, { table: [SECTION, STORE, FLOOR], role: ROLE, can_read: true })
    const user = await createUser({ roles: [ROLE] })
    await admin.post('/api/save_row', { table: 'Data Scope', row: { person: user.user, allow_table: STORE, for_value: 'Bayside' } })
    const [store, floor] = await narrow(user, SECTION, [{ path: [{ column: 'store' }] }, { path: [{ column: 'floor' }] }])
    // Northgate's sections are not hers to read, so Northgate is never named.
    expect(store).toEqual({ Bayside: 3, '∅': 1 })
    expect(floor).toEqual({ 'First Floor': 2, 'Ground Floor': 2 })
  })

  test('a value the viewer may not read is never named: its rows count as not linked', async ({ admin, createUser }) => {
    await setup(admin)
    const ROLE = 'Nar Own Floors Role'
    await grantRole(admin, { table: SECTION, role: ROLE, can_read: true })
    await grantRole(admin, { table: FLOOR, role: ROLE, can_read: true, own_rows_only: true })
    const user = await createUser({ roles: [ROLE] })
    const [floor] = await narrow(user, SECTION, [{ path: [{ column: 'floor' }] }])
    expect(floor).toEqual({ '∅': 6 })
  })

  test('a path through a Table the viewer may not read is refused', async ({ admin, createUser }) => {
    await setup(admin)
    const ROLE = 'Nar No Store Role'
    await grantRole(admin, { table: SECTION, role: ROLE, can_read: true })
    const user = await createUser({ roles: [ROLE] })
    await expect(narrow(user, SECTION, [{ path: [{ column: 'store' }] }])).rejects.toMatchObject({ status: 403 })
  })

  test('malformed lists are refused', async ({ admin }) => {
    await setup(admin)
    const refused = (lists: unknown) => expect(narrow(admin, SECTION, lists as List[])).rejects.toMatchObject({ status: 417 })
    await refused([{ path: [{ column: 'kind' }, { column: 'title' }] }]) // a step past a Choice
    await refused([{ path: [{ column: 'nope' }] }])
    await refused([{ path: [{ from: SUBCAT, column: 'category' }] }]) // not a link to Section
    await refused([{ path: [{ column: 'store' }, { column: 'title' }, { column: 'x' }, { column: 'y' }] }]) // too deep
    await refused(Array.from({ length: 41 }, () => ({ path: [] })))
    await refused({ path: [] })
    await refused([{ path: [{ column: 5 }] }]) // a step names its column
    await refused([{}]) // a list has a path
    await refused([{ path: [{ column: 'store' }], pick: 'store' }]) // a pick is one filter
  })

  test('a link to a row of any Table cannot be a list, and lists must be JSON', async ({ admin }) => {
    await setup(admin)
    const PIN = 'Nar Pin'
    await admin.post('/api/table_def', { name: PIN, columns: [
      { column_name: 'pinned_table', column_type: 'Reference', reference_table: 'Table' },
      { column_name: 'pinned', column_type: 'Reference', table_column: 'pinned_table', choices: `${STORE}\n${FLOOR}` },
    ] })
    await expect(narrow(admin, PIN, [{ path: [{ column: 'pinned' }] }])).rejects.toMatchObject({ status: 417 })
    await expect(admin.get(`/api/table/${encodeURIComponent(SECTION)}:narrow?lists=not-json`)).rejects.toMatchObject({ status: 400 })
  })
})

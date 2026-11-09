// #1021: a Table can be a view, a named filtered lens on another Table (its
// base). A view holds no rows of its own: its rows are its base's rows its
// filter matches, read and written as base rows, under the base's grants and
// policy. Links can name a view; a link to a view stores a base row id.
import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { expectApiError, expectRefused, expectStatus, grantRole, makeTable, patchDoc, tableRef } from './fixtures'
import { createTable, storedRelation } from '../src/table-engine'
import { sql } from '../src/db'
import { getBacklinks, invalidateMeta } from '../src/meta'
import { isInstalled, uninstallApp } from '../src/apps'
import { globalSearch } from '../src/search'

const SITE = 'Vw Site'
const STORE = 'Vw Store'
const SALE = 'Vw Sale'
const site = tableRef(SITE)
const store = tableRef(STORE)
const sale = tableRef(SALE)

type Row = Record<string, unknown> & { row_id: string; updated_at: string }

async function sites(admin: TestClient, opts: { policy?: boolean; restricted?: boolean; writer?: TestClient } = {}) {
  await makeTable(admin, {
    name: SITE, id_pattern: 'prompt', title_column: 'site_name',
    ...(opts.policy ? { access_policy: { version: 1, roles: ['Site Member'] } } : {}),
    columns: ['site_name', 'region', { column_name: 'is_store', column_type: 'Check', ...(opts.restricted ? { tier: 'restricted' } : {}) }],
  })
  const writer = opts.writer ?? admin
  await writer.post(site.url, { row_id: 'S-1', site_name: 'Anna Nagar', region: 'North', is_store: true })
  await writer.post(site.url, { row_id: 'S-2', site_name: 'T Nagar', region: 'South', is_store: true })
  await writer.post(site.url, { row_id: 'W-1', site_name: 'Madhavaram Warehouse', region: 'North', is_store: false })
  return admin.post<Record<string, unknown>>('/api/table_def', {
    name: STORE, kind: 'view', view_of: SITE, view_filters: [['is_store', '=', 1]], label: 'Stores',
  })
}

async function sales(admin: TestClient) {
  await makeTable(admin, { name: SALE, columns: ['amount:Int', { column_name: 'store', column_type: 'Reference', reference_table: STORE }] })
}

const ids = (list: { data: { row_id: string }[] }) => list.data.map((r) => r.row_id).sort()

describe('#1021: a view is metadata only', () => {
  test('it is defined by a base and a filter, shows its base columns and stores nothing', async ({ admin }) => {
    const view = await sites(admin)
    expect(view).toMatchObject({ name: STORE, kind: 'view', view_of: SITE, view_filters: [['is_store', '=', true]], label: 'Stores', access_policy: null })
    const meta = await admin.get<{ columns: { column_name: string }[]; storage_identity: unknown; kind: string }>(store.metaUrl)
    expect(meta.columns.map((c) => c.column_name)).toEqual(['site_name', 'region', 'is_store'])
    expect(meta.storage_identity).toBeNull()
    const [relation] = await sql`select 1 from information_schema.tables where table_name = 'tab_vw_store'`
    expect(relation).toBeUndefined()
    // A new base column appears in the view by itself.
    const base = await admin.get<{ columns: Record<string, unknown>[] }>(site.metaUrl)
    await admin.put(site.defUrl, { columns: [...base.columns, { column_name: 'opened_on', column_type: 'Date' }] })
    const after = await admin.get<{ columns: { column_name: string }[] }>(store.metaUrl)
    expect(after.columns.map((c) => c.column_name)).toContain('opened_on')
  })

  test('its filter must name its base columns with plain operators', async ({ admin }) => {
    await sites(admin)
    const def = (filters: unknown, view_of = SITE) => admin.post('/api/table_def', { name: 'Vw Bad', kind: 'view', view_of, view_filters: filters })
    await expectApiError(def([['nope', '=', 1]]), { status: 417, message: expect.stringContaining('nope is not a column') })
    await expectApiError(def([['region', 'related', {}]]), { status: 417, message: expect.stringContaining('cannot use related') })
    await expectApiError(def([]), { status: 417, message: expect.stringContaining('at least one filter') })
    await expectApiError(def([['region', '=', 'North']], STORE), { status: 417, message: expect.stringContaining('cannot have a view') })
    await expectRefused(def([['row_id', '=', 'x']], 'Table'), 417)
    await expectApiError(admin.post('/api/table_def', { kind: 'view', view_of: SITE, view_filters: [['region', '=', 'North']] }), { status: 417, message: expect.stringContaining('Invalid view definition') })
    await expectRefused(admin.post('/api/table_def', { name: SITE, kind: 'view', view_of: STORE, view_filters: [['region', '=', 'North']] }), 417)
    await expectApiError(admin.post('/api/table_def', { name: STORE, kind: 'view', view_of: SITE, view_filters: [['region', '=', 'North']] }), { status: 409, message: expect.stringContaining('already exists') })
  })

  test('its filter can change; its base cannot', async ({ admin }) => {
    await sites(admin)
    await admin.put(store.defUrl, { view_filters: [['region', '=', 'North']], label: 'North sites' })
    expect(ids(await admin.get(store.url))).toEqual(['S-1', 'W-1'])
    await expectApiError(admin.put(store.defUrl, { view_of: 'Person' }), { status: 417, message: expect.stringContaining('keeps its base') })
  })

  test('every filter operator reads the base rows it names', async ({ admin }) => {
    await sites(admin)
    const rows = async (view_filters: unknown[]) => {
      await admin.put(store.defUrl, { view_filters })
      return ids(await admin.get(store.url))
    }
    expect(await rows([['region', '!=', 'North']])).toEqual(['S-2'])
    expect(await rows([['row_id', '>', 'S-1']])).toEqual(['S-2', 'W-1'])
    expect(await rows([['row_id', '<', 'S-2']])).toEqual(['S-1'])
    expect(await rows([['row_id', '>=', 'S-2']])).toEqual(['S-2', 'W-1'])
    expect(await rows([['row_id', '<=', 'S-2']])).toEqual(['S-1', 'S-2'])
    expect(await rows([['row_id', 'in', ['S-1', 'W-1']]])).toEqual(['S-1', 'W-1'])
    expect(await rows([['row_id', 'not in', ['S-1']]])).toEqual(['S-2', 'W-1'])
    expect(await rows([['row_id', 'in', []]])).toEqual([])
    expect(await rows([['row_id', 'not in', []]])).toEqual([])
    expect(await rows([['site_name', 'like', '%nagar']])).toEqual(['S-1', 'S-2'])
    expect(await rows([['site_name', 'not like', '%nagar']])).toEqual(['W-1'])
    expect(await rows([['region', '=', null]])).toEqual([])
    expect(await rows([['region', '!=', '']])).toEqual(['S-1', 'S-2', 'W-1'])
    expect(await rows([['region', '=', 'North'], ['is_store', '=', 'true']])).toEqual(['S-1'])
  })

  test('a filter value must fit its column and operator', async ({ admin }) => {
    await makeTable(admin, { name: SITE, columns: ['site_name', 'floors:Int', { column_name: 'notes', column_type: 'JSON' }] })
    const def = (filters: unknown) => admin.post('/api/table_def', { name: STORE, kind: 'view', view_of: SITE, view_filters: filters })
    await expectApiError(def('is_store'), { status: 417, message: expect.stringContaining('at least one filter') })
    await expectApiError(def([['floors', '=']]), { status: 417, message: expect.stringContaining('[column, operator, value]') })
    await expectApiError(def([['notes', '=', 'x']]), { status: 417, message: expect.stringContaining('notes is not a column') })
    await expectApiError(def([['floors', 'in', 2]]), { status: 417, message: expect.stringContaining('takes a list of values') })
    await expectApiError(def([['floors', '=', [2]]]), { status: 417, message: expect.stringContaining('takes one value') })
    await expectApiError(def([['floors', '=', 'two']]), { status: 417, message: expect.stringContaining('floors takes a number') })
    await expectApiError(def([['site_name', '=', { a: 1 }]]), { status: 417, message: expect.stringContaining('takes a plain value') })
    await expectApiError(def([['floors', '>', null]]), { status: 417, message: expect.stringContaining('> needs a value') })
    expect(await def([['floors', 'in', ['2', 3]]])).toMatchObject({ view_filters: [['floors', 'in', [2, 3]]] })
  })
})

describe('#1021: a view reads as its base, never wider', () => {
  test('its list, count and summary hold only the rows its filter matches', async ({ admin }) => {
    await sites(admin)
    expect(ids(await admin.get(store.url))).toEqual(['S-1', 'S-2'])
    expect(await admin.get(`${store.url}:count`)).toEqual({ count: 2 })
    expect(ids(await admin.get(store.listUrl({ filters: [['region', '=', 'North']] })))).toEqual(['S-1'])
    // A row opens through the view as its base row, while the view matches it.
    expect(await admin.get(store.rowUrl('S-1'))).toMatchObject({ table: SITE, row_id: 'S-1', site_name: 'Anna Nagar' })
    await expectRefused(admin.get(store.rowUrl('W-1')), 404)
    expect(await admin.get(`${store.rowUrl('S-1')}:capabilities`)).toMatchObject({ write: true })
  })

  test('someone who cannot read the base cannot read the view, by any road', async ({ admin, createUser }) => {
    await sites(admin)
    await sales(admin)
    await grantRole(admin, { role: 'Vw Sales Only', table: SALE, can_read: true, can_create: true })
    const outsider = await createUser({ roles: ['Vw Sales Only'] })
    const refused = { status: 403 }
    await expectApiError(outsider.get(store.url), refused)
    await expectApiError(outsider.get(`${store.url}:count`), refused)
    await expectApiError(outsider.get(store.metaUrl), refused)
    await expectApiError(outsider.get(store.rowUrl('S-1')), refused)
    await expectApiError(outsider.get(`${store.url}:summary`), refused)
    expect(await outsider.post('/api/row_titles', { rows: [{ table: STORE, row_id: 'S-1' }] })).toEqual({ titles: [] })
    expect((await globalSearch('Nagar', outsider.user!)).filter((h) => (h as { table?: string }).table === STORE)).toEqual([])
    // The picker reads the view's list, so it offers nothing either.
    await expectApiError(outsider.get(store.listUrl({ fields: ['row_id', 'site_name'], limit_page_length: 10 })), refused)
    const destinations = await outsider.get<{ tables: { row_id: string }[] }>('/api/command_destinations')
    expect(destinations.tables.map((t) => t.row_id)).not.toContain(STORE)
  })

  test('a base reader reads the view, even when its filter column is beyond their level', async ({ admin, createUser }) => {
    await sites(admin, { restricted: true })
    await grantRole(admin, { role: 'Vw Site Reader', table: SITE, can_read: true })
    const reader = await createUser({ roles: ['Vw Site Reader'] })
    expect(ids(await reader.get(store.url))).toEqual(['S-1', 'S-2'])
    expect(await reader.get(store.rowUrl('S-1'))).not.toHaveProperty('is_store')
    // The column itself stays out of their reach.
    await expectRefused(reader.get(store.listUrl({ filters: [['is_store', '=', false]] })), 417)
    expect((await reader.get<{ readable_columns: string[] }>(store.metaUrl)).readable_columns).not.toContain('is_store')
    const destinations = await reader.get<{ tables: { row_id: string; can_create: boolean }[] }>('/api/command_destinations')
    expect(destinations.tables.find((t) => t.row_id === STORE)).toMatchObject({ can_create: false })
  })

  test('the base policy holds over the view, for administrators too', async ({ admin, createUser }) => {
    await grantRole(admin, { role: 'Site Member', table: [] })
    await makeTable(admin, { name: SITE, id_pattern: 'prompt', access_policy: { version: 1, roles: ['Site Member'] },
      columns: ['site_name', { column_name: 'is_store', column_type: 'Check' }] })
    await grantRole(admin, { role: 'Vw Policy Reader', table: SITE, can_read: true, can_create: true })
    const reader = await createUser({ roles: ['Vw Policy Reader'] })
    const manager = await createUser({ roles: ['System Manager'] })
    const member = await createUser({ roles: ['Vw Policy Reader', 'Site Member'] })
    await member.post(site.url, { row_id: 'S-1', site_name: 'Anna Nagar', is_store: true })
    await member.post(site.url, { row_id: 'W-1', site_name: 'Warehouse', is_store: false })
    await admin.post('/api/table_def', { name: STORE, kind: 'view', view_of: SITE, view_filters: [['is_store', '=', true]] })
    // Outside the policy's roles, the view answers exactly as its base does.
    const outcome = (p: Promise<unknown>) => p.then((r) => r, (e: { status: number }) => e.status)
    for (const viewer of [reader, manager, admin]) {
      const base = await outcome(viewer.get(site.url))
      expect(base === 403 || (base as { total: number }).total === 0).toBe(true)
      expect(await outcome(viewer.get(store.url))).toEqual(base)
      await expectRefused(viewer.get(store.rowUrl('S-1')), 403)
    }
    expect(ids(await member.get(store.url))).toEqual(['S-1'])
  })

  test('Data Scopes on the base narrow the view and the links to it; none can be set on a view', async ({ admin, createUser }) => {
    await sites(admin)
    await sales(admin)
    await grantRole(admin, { role: 'Vw Scoped', table: [SITE, SALE], can_read: true, can_create: true })
    const scoped = await createUser({ roles: ['Vw Scoped'] })
    await admin.post(sale.url, { amount: 10, store: 'S-1' })
    await admin.post(sale.url, { amount: 20, store: 'S-2' })
    await admin.post('/api/save_row', { table: 'Data Scope', row: { person: scoped.user, allow_table: SITE, for_value: 'S-1' } })
    expect(ids(await scoped.get(store.url))).toEqual(['S-1'])
    expect((await scoped.get<{ data: { store: string }[] }>(sale.listUrl({ fields: ['store'] }))).data.map((r) => r.store)).toEqual(['S-1'])
    await expectRefused(scoped.post(sale.url, { amount: 30, store: 'S-2' }), 403)
    await expectApiError(admin.post('/api/save_row', { table: 'Data Scope', row: { person: scoped.user, allow_table: STORE, for_value: 'S-1' } }),
      { status: 417, message: expect.stringContaining('scope Vw Site instead') })
  })

  test('a reader of the view gets only the columns they may read of the base, on every list road', async ({ admin, createUser }) => {
    await sites(admin, { restricted: true })
    await grantRole(admin, { role: 'Vw Site Reader', table: SITE, can_read: true })
    const reader = await createUser({ roles: ['Vw Site Reader'] })
    const list = await reader.get<{ data: Record<string, unknown>[] }>(store.listUrl({ fields: ['row_id', 'site_name'] }))
    expect(list.data.map((r) => r.site_name).sort()).toEqual(['Anna Nagar', 'T Nagar'])
    await expectRefused(reader.get(store.listUrl({ fields: ['row_id', 'is_store'] })), 417)
    await expectRefused(reader.get(`${store.url}:summary?group_by=is_store`), 417)
  })

  test('files on a connected row stay hidden from someone a Data Scope narrows through a link to a view', async ({ admin, createUser }) => {
    const OUTSIDE = 'Vw Outside'
    await sites(admin)
    await makeTable(admin, { name: OUTSIDE, id_pattern: 'prompt', columns: ['subject', { column_name: 'store', column_type: 'Reference', reference_table: STORE }] })
    await admin.post('/api/save_row', { table: OUTSIDE, row: { row_id: 'o-1', subject: 'Outside', store: 'S-1' } })
    await admin.post('/api/save_row', { table: 'File', row: { file_name: 'outside.pdf', ref_table: OUTSIDE, ref_name: 'o-1' } })
    await sql`update table_def set data_source = 'outside-db' where name = ${OUTSIDE}`
    invalidateMeta(OUTSIDE)
    await grantRole(admin, { role: 'Vw Outside Reader', table: [SITE, OUTSIDE, 'File'], can_read: true })
    const scoped = await createUser({ roles: ['Vw Outside Reader'] })
    const fileNames = async () => (await scoped.get<{ data: { file_name: string }[] }>(tableRef('File').listUrl({ fields: ['file_name'], filters: [['ref_table', '=', OUTSIDE]] }))).data.map((f) => f.file_name)
    expect(await fileNames()).toEqual(['outside.pdf'])
    await admin.post('/api/save_row', { table: 'Data Scope', row: { person: scoped.user, allow_table: SITE, for_value: 'S-2' } })
    expect(await fileNames()).toEqual([])
  })

  test('a view takes no grants of its own', async ({ admin }) => {
    await sites(admin)
    await expectApiError(grantRole(admin, { role: 'Vw Grant', table: STORE, can_read: true }),
      { status: 417, message: expect.stringContaining('grant access on Vw Site instead') })
  })
})

describe('#1021: rows are written as base rows only', () => {
  test('every write addressed to the view is refused with one plain message', async ({ admin }) => {
    await sites(admin)
    const s1 = await admin.get<Row>(site.rowUrl('S-1'))
    const refused = { status: 417, message: expect.stringContaining(`${STORE} is a view of ${SITE}`) }
    await expectApiError(admin.post(store.url, { row_id: 'S-9', site_name: 'New', is_store: true }),
      { status: 417, message: expect.stringContaining(`nothing can be created through it. Add it to ${SITE} instead.`) })
    await expectApiError(admin.post('/api/save_row', { table: STORE, row: { row_id: 'S-1', updated_at: s1.updated_at, region: 'East' } }), refused)
    await expectApiError(patchDoc(admin, store.rowUrl('S-1'), { updated_at: s1.updated_at, region: 'East' }), refused)
    await expectApiError(admin.delete(store.rowUrl('S-1')), refused)
    await expectApiError(admin.post(`${store.rowUrl('S-1')}:retire`, { reason: 'Closed' }), refused)
    await expectApiError(admin.post(`${store.url}:import`, { key_column: 'site_name', rows: [{ site_name: 'X' }] }), refused)
    await expectApiError(admin.post('/api/save_row', { table: 'Comment', row: { ref_table: STORE, ref_name: 'S-1', content: 'Hello' } }), refused)
    await expectApiError(admin.post('/api/save_row', { table: 'Share', row: { share_table: STORE, share_name: 'S-1', person: 'Administrator', read: true } }), refused)
    await expectApiError(admin.post('/api/tags', { table: STORE, row_id: 'S-1', tag: 'busy' }), refused)
    await expectApiError(admin.post('/api/assign', { table: STORE, row_id: 'S-1', assign_to: 'Administrator' }), refused)
    // Through the base, the same row is written as always.
    await patchDoc(admin, site.rowUrl('S-1'), { updated_at: s1.updated_at, region: 'East' })
    expect(await admin.get(store.rowUrl('S-1'))).toMatchObject({ region: 'East' })
  })
})

describe('#1021: a link can name a view', () => {
  test('it offers and accepts only the view rows, and stores the base row id', async ({ admin }) => {
    await sites(admin)
    await sales(admin)
    const saved = await admin.post<Row>(sale.url, { amount: 10, store: 'S-1' })
    const [stored] = await sql`select store from ${sql(await storedRelation(SALE))} where row_id = ${saved.row_id}`
    expect(stored.store).toBe('S-1')
    await expectApiError(admin.post(sale.url, { amount: 5, store: 'W-1' }), { status: 417, message: expect.stringContaining('Invalid links') })
    await expectRefused(admin.post(sale.url, { amount: 5, store: 'NOPE' }), 417)
    // The picker reads the view.
    expect(ids(await admin.get(store.listUrl({ fields: ['row_id', 'site_name'], filters: [['site_name', 'like', '%Nagar%']] })))).toEqual(['S-1', 'S-2'])
    expect(await admin.post('/api/row_titles', { rows: [{ table: STORE, row_id: 'S-1' }] })).toEqual({ titles: [{ table: STORE, row_id: 'S-1', title: 'Anna Nagar' }] })
  })

  test('delete blocks, row renames, backlinks, purges and related filters treat it as a link to the base', async ({ admin }) => {
    await sites(admin)
    await sales(admin)
    const saved = await admin.post<Row>(sale.url, { amount: 10, store: 'S-1' })
    await expectApiError(admin.delete(site.rowUrl('S-1')), { status: 417, message: expect.stringContaining(`linked from ${SALE}`) })
    expect(await getBacklinks(SITE)).toContainEqual({ table: SALE, column: 'store', via: null })
    const connections = await admin.get<{ connections: { table: string; count: number }[] }>(`${site.rowUrl('S-1')}:connections`)
    expect(connections.connections).toContainEqual(expect.objectContaining({ table: SALE, count: 1 }))
    expect(ids(await admin.get(sale.listUrl({ filters: [['store', 'related', { table: SITE, filters: [['region', '=', 'North']] }]] })))).toEqual([saved.row_id])
    expect(ids(await admin.get(sale.listUrl({ filters: [['store', 'related', { table: STORE, filters: [['region', '=', 'North']] }]] })))).toEqual([saved.row_id])
    await admin.post(`${site.rowUrl('S-1')}:rename`, { new_name: 'S-100' })
    expect(await admin.get(sale.rowUrl(saved.row_id))).toMatchObject({ store: 'S-100' })
    const plan = await admin.get<{ groups: { table: string }[] }>(`${site.url}:purge_preview?ids=${encodeURIComponent(JSON.stringify(['S-100']))}&links=clear`)
    expect(plan.groups).toContainEqual(expect.objectContaining({ table: SALE }))
  })

  test('deleting a base row permanently unlinks or removes the rows linking through a view', async ({ admin }) => {
    await sites(admin)
    await sales(admin)
    const unlinked = await admin.post<Row>(sale.url, { amount: 1, store: 'S-1' })
    const removed = await admin.post<Row>(sale.url, { amount: 2, store: 'S-2' })
    const purge = (id: string, links: string) => admin.post(`${site.url}:purge`, { ids: [id], links, reason: 'Closed down', confirm: true })
    expect(await purge('S-1', 'clear')).toEqual({ deleted: 1, cleared: 1 })
    expect((await admin.get<Row>(sale.rowUrl(unlinked.row_id))).store).toBeNull()
    await expectRefused(admin.get(site.rowUrl('S-1')), 404)
    expect(await purge('S-2', 'cascade')).toEqual({ deleted: 2, cleared: 0 })
    await expectRefused(admin.get(sale.rowUrl(removed.row_id)), 404)
  })

  test('a row that leaves the view keeps its links: they save unchanged and are flagged', async ({ admin }) => {
    await sites(admin)
    await sales(admin)
    const saved = await admin.post<Row>(sale.url, { amount: 10, store: 'S-1' })
    const s1 = await admin.get<Row>(site.rowUrl('S-1'))
    await patchDoc(admin, site.rowUrl('S-1'), { updated_at: s1.updated_at, is_store: false })
    const held = await admin.get<Row>(sale.rowUrl(saved.row_id))
    expect(held).toMatchObject({ store: 'S-1', links_outside_view: ['store'] })
    const edited = await patchDoc<Row>(admin, sale.rowUrl(saved.row_id), { updated_at: held.updated_at, amount: 11 })
    expect(edited).toMatchObject({ amount: 11, store: 'S-1' })
    // A new or changed value must still be a row of the view.
    await expectRefused(patchDoc(admin, sale.rowUrl(saved.row_id), { updated_at: edited.updated_at, store: 'W-1' }), 417)
    const read = await admin.get<Row>(sale.rowUrl(saved.row_id))
    expect(read).toMatchObject({ amount: 11 })
    // The form sends back the row it read, flag included, and it saves.
    expect(await admin.post('/api/save_row', { table: SALE, row: { ...read, amount: 12 } })).toMatchObject({ amount: 12, store: 'S-1' })
    const fine = await admin.post<Row>(sale.url, { amount: 1, store: 'S-2' })
    expect(await admin.get(sale.rowUrl(fine.row_id))).not.toHaveProperty('links_outside_view')
    const blank = await admin.post<Row>(sale.url, { amount: 2 })
    expect(await admin.get(sale.rowUrl(blank.row_id))).not.toHaveProperty('links_outside_view')
  })

  test('a link moves from the base to its view and back as metadata, once its values fit', async ({ admin }) => {
    await sites(admin)
    await makeTable(admin, { name: SALE, columns: ['amount:Int', { column_name: 'store', column_type: 'Reference', reference_table: SITE }] })
    const kept = await admin.post<Row>(sale.url, { amount: 1, store: 'S-1' })
    const odd = await admin.post<Row>(sale.url, { amount: 2, store: 'W-1' })
    const columns = (target: string) => [{ column_name: 'amount', column_type: 'Int' }, { column_name: 'store', column_type: 'Reference', reference_table: target }]
    await expectApiError(admin.put(sale.defUrl, { columns: columns(STORE) }), { status: 417, message: expect.stringContaining(`W-1 is not ${STORE} rows`) })
    await patchDoc(admin, sale.rowUrl(odd.row_id), { updated_at: odd.updated_at, store: 'S-2' })
    const [before] = await sql`select updated_at from ${sql(await storedRelation(SALE))} where row_id = ${kept.row_id}`
    await admin.put(sale.defUrl, { columns: columns(STORE) })
    const [after] = await sql`select updated_at, store from ${sql(await storedRelation(SALE))} where row_id = ${kept.row_id}`
    expect(after).toEqual({ ...before, store: 'S-1' })
    // The view still protects its base rows from delete.
    await expectApiError(admin.delete(site.rowUrl('S-1')), { status: 417, message: expect.stringContaining(`linked from ${SALE}`) })
    await admin.put(sale.defUrl, { columns: columns(SITE) })
    expect((await admin.get<{ columns: { column_name: string; reference_table: string }[] }>(sale.metaUrl)).columns.find((c) => c.column_name === 'store'))
      .toMatchObject({ reference_table: SITE })
  })

  test('text becomes a link to a view only once every value is one of its rows', async ({ admin }) => {
    await sites(admin)
    await makeTable(admin, { name: SALE, columns: ['amount:Int', 'store'] })
    await admin.post(sale.url, { amount: 2, store: 'W-1' })
    const columns = [{ column_name: 'amount', column_type: 'Int' }, { column_name: 'store', column_type: 'Reference', reference_table: STORE }]
    await expectApiError(admin.put(sale.defUrl, { columns }), { status: 417, message: expect.stringContaining('W-1 is not') })
  })
})

describe('#1021: a base keeps what its views stand on', () => {
  test('a view changes only its label, description and filters', async ({ admin }) => {
    await sites(admin)
    await expectApiError(admin.put(store.defUrl, { kind: 'table' }), { status: 417, message: expect.stringContaining('kind cannot be changed') })
    expect(await admin.put(store.defUrl, { label: ' ', description: ' Sites that sell ' })).toMatchObject({ label: null, description: 'Sites that sell' })
    expect(await admin.put(store.defUrl, {})).toMatchObject({ label: null, description: 'Sites that sell', view_filters: [['is_store', '=', true]] })
    await expectApiError(admin.post(`${store.defUrl}/rename_column`, { from: 'region', to: 'zone' }), { status: 417, message: expect.stringContaining(`rename the column on ${SITE}`) })
    await expect(createTable({ name: 'Vw App View', kind: 'view', view_of: SITE, view_filters: [['region', '=', 'North']] }, 'someapp'))
      .rejects.toThrow('An app cannot define a view')
  })

  test('a change only its base can take is refused, never silently dropped', async ({ admin }) => {
    await sites(admin)
    const refused = { status: 417, message: expect.stringContaining(`change it on ${SITE}`) }
    await expectApiError(admin.put(store.defUrl, { columns: [{ column_name: 'sneaky', column_type: 'Data' }] }), refused)
    await expectApiError(admin.put(store.defUrl, { remove_columns: ['region'] }), refused)
    await expectApiError(admin.put(store.defUrl, { title_column: 'region' }), refused)
    await expectApiError(admin.put(`${store.defUrl}/id_pattern`, { id_pattern: 'hash' }), refused)
    expect((await admin.get<{ columns: { column_name: string }[] }>(site.metaUrl)).columns.map((c) => c.column_name)).not.toContain('sneaky')
  })

  test('a view name cannot spell a relation that already holds rows', async ({ admin }) => {
    await sites(admin)
    await sql`create table featherbase.vw_orphan (row_id text primary key)`
    try {
      await expectApiError(admin.post('/api/table_def', { name: 'Vw Orphan', kind: 'view', view_of: SITE, view_filters: [['region', '=', 'North']] }),
        { status: 409, message: expect.stringContaining('already exists') })
    } finally {
      await sql`drop table featherbase.vw_orphan`
    }
  })

  test('refusals name every view that depends on the base', async ({ admin }) => {
    await sites(admin)
    await admin.post('/api/table_def', { name: 'Vw Shop', kind: 'view', view_of: SITE, view_filters: [['is_store', '=', true], ['region', '=', 'North']] })
    await expectApiError(admin.post(`${site.defUrl}/rename_column`, { from: 'is_store', to: 'store_flag' }),
      { status: 417, message: expect.stringContaining('filter on it') })
    const refusal = await admin.delete(site.defUrl).catch((e: Error) => e.message)
    expect(refusal).toContain('Delete those views first')
  })

  test('an app cannot be uninstalled while a view stands on its Table', async ({ admin }) => {
    const APP = 'test-view-base-app'
    const OWNED = 'Vw App Site'
    try {
      const installed = await admin.fetch('/api/install_app', { method: 'POST', body: JSON.stringify({ manifest: {
        name: APP, tables: [{ name: OWNED, columns: [{ column_name: 'region', column_type: 'Data' }] }],
      } }) })
      await expectStatus(installed, 201)
      await admin.post('/api/table_def', { name: STORE, kind: 'view', view_of: OWNED, view_filters: [['region', '=', 'North']] })
      await expect(uninstallApp(APP)).rejects.toThrow(`the view ${STORE} is based on ${OWNED}`)
      // Refused before anything went: the app and its Table are whole.
      expect(await isInstalled(APP)).toBe(true)
      expect((await admin.get<{ columns: { column_name: string }[] }>(tableRef(OWNED).metaUrl)).columns.map((c) => c.column_name)).toContain('region')
      await admin.delete(store.defUrl)
      await uninstallApp(APP)
      expect(await isInstalled(APP)).toBe(false)
    } finally {
      await sql`delete from table_def where name = ${STORE}`
      await uninstallApp(APP).catch(() => {})
    }
  })

  test('a link with many values outside the view names the first twenty', async ({ admin }) => {
    await sites(admin)
    await makeTable(admin, { name: SALE, columns: ['amount:Int', { column_name: 'store', column_type: 'Reference', reference_table: SITE }] })
    const columns = (target: string) => [{ column_name: 'amount', column_type: 'Int' }, { column_name: 'store', column_type: 'Reference', reference_table: target }]
    // An empty link column moves at once.
    await admin.put(sale.defUrl, { columns: columns(STORE) })
    await admin.put(sale.defUrl, { columns: columns(SITE) })
    for (let i = 10; i < 32; i++) await admin.post(site.url, { row_id: `W-${i}`, site_name: `Depot ${i}`, is_store: false })
    for (let i = 10; i < 32; i++) await admin.post(sale.url, { amount: i, store: `W-${i}` })
    await expectApiError(admin.put(sale.defUrl, { columns: columns(STORE) }), { status: 417, message: expect.stringContaining(`and 2 more are not ${STORE} rows`) })
  })

  test('a filter column cannot be renamed, removed or retyped; the base cannot be deleted while a view stands', async ({ admin }) => {
    await sites(admin)
    await expectApiError(admin.post(`${site.defUrl}/rename_column`, { from: 'is_store', to: 'store_flag' }), { status: 417, message: expect.stringContaining(STORE) })
    await expectApiError(admin.put(site.defUrl, { columns: [{ column_name: 'site_name', column_type: 'Data' }, { column_name: 'region', column_type: 'Data' }], remove_columns: ['is_store'] }),
      { status: 417, message: expect.stringContaining(STORE) })
    await admin.post(`${site.defUrl}/rename_column`, { from: 'region', to: 'zone' })
    expect((await admin.get<{ columns: { column_name: string }[] }>(store.metaUrl)).columns.map((c) => c.column_name)).toContain('zone')
    await expectApiError(admin.delete(site.defUrl), { status: 417, message: expect.stringContaining(`the view ${STORE} is based on it`) })
  })

  test('renaming the base moves the view with it; renaming or deleting the view touches no rows', async ({ admin }) => {
    await sites(admin)
    await sales(admin)
    await admin.post(sale.url, { amount: 10, store: 'S-1' })
    await admin.post(`${site.defUrl}/rename`, { to: 'Vw Place' })
    expect(await admin.get(store.metaUrl)).toMatchObject({ view_of: 'Vw Place' })
    expect(ids(await admin.get(store.url))).toEqual(['S-1', 'S-2'])
    await admin.post(`${store.defUrl}/rename`, { to: 'Vw Shop' })
    expect((await admin.get<{ columns: { column_name: string; reference_table: string }[] }>(sale.metaUrl)).columns.find((c) => c.column_name === 'store'))
      .toMatchObject({ reference_table: 'Vw Shop' })
    // A view a link still names cannot go; once unlinked it goes as metadata.
    await expectApiError(admin.delete(tableRef('Vw Shop').defUrl), { status: 417, message: expect.stringContaining(`${SALE}.store`) })
    await admin.put(sale.defUrl, { columns: [{ column_name: 'amount', column_type: 'Int' }, { column_name: 'store', column_type: 'Reference', reference_table: 'Vw Place' }] })
    await admin.delete(tableRef('Vw Shop').defUrl)
    expect((await admin.get<{ total: number }>(tableRef('Vw Place').url)).total).toBe(3)
    await admin.delete(sale.defUrl)
    await admin.delete(tableRef('Vw Place').defUrl)
  })
})

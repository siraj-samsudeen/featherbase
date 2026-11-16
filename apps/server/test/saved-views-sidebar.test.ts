import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { grantRole } from './fixtures'

// #1229: GET /api/saved_views/sidebar — the Admin sidebar's "Saved views": the
// person's own views on every Table, and others' shared views they starred,
// only on Tables they can read now.

const FILTERS = [['store', '=', 'Attakulangara'] as [string, string, unknown]]
const OPEN = 'SVS Department'
const CLOSED = 'SVS Payroll'

type Client = { get: <T>(path: string) => Promise<T>; post: <T>(path: string, body: unknown) => Promise<T>; put: <T>(path: string, body: unknown) => Promise<T> }

async function tables(admin: Client) {
  for (const name of [OPEN, CLOSED])
    await admin.post('/api/table_def', { name, id_pattern: 'prompt', columns: [{ column_name: 'store', column_type: 'Data' }] })
  // Everyone reads the Department list; Payroll stays closed.
  await grantRole(admin as never, { table: OPEN, role: 'All', can_read: true })
}

const view = (as: Client, table: string, label: string, shared = false) =>
  as.post<{ row_id: string }>('/api/saved_views', { table, label, filters: FILTERS, shared })
const sidebar = async (as: Client) =>
  (await as.get<{ views: { row_id: string; label: string; table: string; mine: boolean; filters: unknown }[] }>('/api/saved_views/sidebar')).views
const star = (as: Client, ids: string[]) => as.put('/api/user_settings/__navigation', { starredViews: ids })

describe('#1229: the sidebar saved views', () => {
  test("lists the person's own views on every Table they can read, with their filters", async ({ admin }) => {
    await tables(admin)
    const atk = await view(admin, OPEN, 'ATK Departments', true)
    const pay = await view(admin, CLOSED, 'Payroll ATK')
    const listed = await sidebar(admin)
    expect(listed.filter((v) => [atk.row_id, pay.row_id].includes(v.row_id)).map((v) => [v.label, v.table, v.mine]))
      .toEqual([['ATK Departments', OPEN, true], ['Payroll ATK', CLOSED, true]])
    expect(listed.find((v) => v.row_id === atk.row_id)!.filters).toEqual(FILTERS)
  })

  test("someone else's shared view shows only once starred; a private one never", async ({ admin, createUser }) => {
    await tables(admin)
    const shared = await view(admin, OPEN, 'ATK Departments', true)
    const priv = await view(admin, OPEN, 'Admin only')
    const reader = await createUser({ email: 'svs.reader@example.test', roles: [] })
    const own = await view(reader, OPEN, 'My stores')

    expect((await sidebar(reader)).map((v) => v.row_id)).toEqual([own.row_id])
    await star(reader, [shared.row_id, priv.row_id])
    const listed = await sidebar(reader)
    expect(listed.map((v) => [v.label, v.mine]).sort()).toEqual([['ATK Departments', false], ['My stores', true]])
  })

  test('a starred view on a Table the person cannot read is left out', async ({ admin, createUser }) => {
    await tables(admin)
    const payroll = await view(admin, CLOSED, 'Payroll ATK', true)
    const reader = await createUser({ email: 'svs.closed@example.test', roles: [] })
    await star(reader, [payroll.row_id])
    expect(await sidebar(reader)).toEqual([])
  })

  test('a starred view that is made private or deleted drops out', async ({ admin, createUser }) => {
    await tables(admin)
    const a = await view(admin, OPEN, 'A view', true)
    const b = await view(admin, OPEN, 'B view', true)
    const reader = await createUser({ email: 'svs.drop@example.test', roles: [] })
    await star(reader, [a.row_id, b.row_id])
    expect(await sidebar(reader)).toHaveLength(2)
    await admin.post(`/api/saved_views/${a.row_id}/share`, { shared: false })
    await admin.fetch(`/api/saved_views/${b.row_id}`, { method: 'DELETE' })
    expect(await sidebar(reader)).toEqual([])
  })

  test('stars that are not a list of ids read as none', async ({ admin, createUser }) => {
    await tables(admin)
    await view(admin, OPEN, 'ATK Departments', true)
    const reader = await createUser({ email: 'svs.junk@example.test', roles: [] })
    await reader.put('/api/user_settings/__navigation', { starredViews: 'everything' })
    expect(await sidebar(reader)).toEqual([])
  })
})

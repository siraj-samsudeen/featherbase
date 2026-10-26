// Sales target page paths the merged web coverage report (ADR 0012) showed
// red: a report grouped by Section, a report the server failed to build, a
// session that ended while the page opened, a role taken away and then given
// back (or the session ended) before the page asked again, and a browser that
// blocks site data. Server
// in-process; the MotherDuck calls are stubbed at the server's own seams, as
// in sales-target-page.test.tsx. Where the server's answer must change between
// the page's calls, the fetch spy changes the DATABASE between them (the same
// device sales-target-page.test.tsx uses), never the answer itself.
import { afterEach, beforeEach, vi } from 'vitest'
import type { Sql } from 'postgres'
import { screen, waitFor, within } from '@testing-library/react'
import { _setEmbedFetch, seedSalesTarget } from 'server/src/sales-target'
import { _setSourceReader } from 'server/src/datasets/sales-target-mtd'
import { test, expect, renderApp } from './pg-test'

const saved = { ...process.env }
beforeEach(() => {
  process.env.SALES_TARGET_TODAY = '2026-09-17'
  process.env.MOTHERDUCK_TOKEN = 'page-test-token'
  process.env.DIVE_ID = 'dive-under-test'
  process.env.DIVE_VERSION = '10'
  process.env.SERVICE_ACCOUNT = 'svc'
  process.env.SALES_TARGET_SHARED_ENV = '/nonexistent/sales-target.env'
  _setSourceReader(async () => [])
  _setEmbedFetch(async () => Response.json({ session: 'stub-session' }))
})
afterEach(() => {
  _setEmbedFetch(null)
  _setSourceReader(null)
  vi.restoreAllMocks()
  for (const k of ['SALES_TARGET_TODAY', 'MOTHERDUCK_TOKEN', 'DIVE_ID', 'DIVE_VERSION', 'SERVICE_ACCOUNT', 'SALES_TARGET_SHARED_ENV'])
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
})

type Fetcher = { fetch: (path: string, init?: RequestInit) => Promise<Response> }

async function viewer(admin: Fetcher) {
  await seedSalesTarget((path, init) => admin.fetch(path, init), { test_employee_1: 'pw-1', test_employee_2: 'pw-2', test_employee_3: 'pw-3', test_employee_4: 'pw-4' }, [
    { username: 'test_employee_1', display_name: 'Employee 1', plant_code: '1501', store_label: 'ATK', material_groups: ['010101001', '010101002'] },
  ])
}

async function open(api: Fetcher) {
  const login = await api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr: 'test_employee_1', pwd: 'pw-1' }) })
  const { token, user } = (await login.json()) as { token: string; user: { row_id: string } }
  await renderApp('/featherbase/sales-target', { token, user: user.row_id } as never)
  return user.row_id
}

/** Pass the page's requests to the in-process server; run `after` once the named call has answered. */
function between(on: Record<string, () => Promise<unknown>>) {
  const real = globalThis.fetch
  const seen = new Set<string>()
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const { signal: _signal, ...rest } = (init ?? {}) as RequestInit
    const res = await real(input, rest)
    for (const [path, after] of Object.entries(on))
      if (String(input).includes(path) && !seen.has(path)) {
        seen.add(path)
        await after()
      }
    return res
  })
}

test('a report whose subcategories map to Sections reads Section by Section, each with its subtotal', async ({ admin, api }) => {
  await viewer(admin)
  delete process.env.DIVE_ID
  await admin.fetch('/api/table_def', {
    method: 'POST',
    body: JSON.stringify({ name: 'Section Merchandise Map', module: 'Store Sections', columns: ['store_code', 'material_group', 'mch_subcategory', 'section_name'].map((c) => ({ column_name: c, column_type: 'Data' })) }),
  })
  for (const [mg, section] of [['010101001', 'Boys Tops'], ['010101002', 'Boys Bottoms']])
    await admin.fetch('/api/save_row', { method: 'POST', body: JSON.stringify({ table: 'Section Merchandise Map', row: { store_code: '1501', material_group: mg, mch_subcategory: section, section_name: section } }) })
  _setSourceReader(async (text: string) => {
    if (/with base as/.test(text)) return [
      ['010101001', 'Store A', 'STA', 100, 60, 1, 1],
      ['010101002', 'Store A', 'STA', 50, 40, 1, 1],
    ]
    if (/merchandise_hierarchy/.test(text)) return [['010101001', 'Shirts'], ['010101002', 'Trousers']]
    return [['2026-09-17', 2]]
  })
  await open(api)
  await waitFor(() => expect(screen.getAllByTestId('snapshot-section')).toHaveLength(2))
  const [bottoms, tops] = screen.getAllByTestId('snapshot-section')
  expect(bottoms).toHaveAttribute('data-section', 'Boys Bottoms')
  expect(within(bottoms).getByTestId('snapshot-section-total')).toHaveTextContent('Boys Bottoms')
  expect(within(bottoms).getAllByTestId('snapshot-row')).toHaveLength(1)
  expect(tops).toHaveAttribute('data-section', 'Boys Tops')
})

test('a report the server could not build says the numbers are unavailable', async ({ admin, api }) => {
  await viewer(admin)
  delete process.env.DIVE_ID
  vi.spyOn(console, 'error').mockImplementation(() => {})
  _setSourceReader(async () => { throw new Error('warehouse down') })
  await open(api)
  expect(await screen.findByTestId('snapshot-error', {}, { timeout: 8000 })).toHaveTextContent(/^Numbers unavailable \(HTTP 5\d\d\)\. This is not a sales figure\.$/)
})

test('a session that ended while the page opened sends the person to sign in', async ({ admin, api, db }) => {
  await viewer(admin)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  let id = ''
  between({ '/api/sales_target/me': async () => { await (db as Sql)`update person set enabled = false where row_id = ${id}` } })
  const login = await api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr: 'test_employee_1', pwd: 'pw-1' }) })
  const { token, user } = (await login.json()) as { token: string; user: { row_id: string } }
  id = user.row_id
  await renderApp('/featherbase/sales-target', { token, user: id } as never)
  await waitFor(() => expect(localStorage.getItem('fc_token')).toBeNull())
})

test('a refusal the server takes back before the page asks again is reported, not shown as no access', async ({ admin, api, db }) => {
  await viewer(admin)
  let id = ''
  const role = async (give: boolean) =>
    give
      ? (db as Sql)`insert into has_role (row_id, parent, parenttype, parentfield, role) values (${`hr-${id}`}, ${id}, 'Person', 'roles', 'Sales Target Viewer') on conflict do nothing`
      : (db as Sql)`delete from has_role where parent = ${id} and role = 'Sales Target Viewer'`
  between({
    '/api/sales_target/me': () => role(false),
    '/api/sales_target/embed_session': () => role(true),
  })
  const login = await api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr: 'test_employee_1', pwd: 'pw-1' }) })
  const { token, user } = (await login.json()) as { token: string; user: { row_id: string } }
  id = user.row_id
  await renderApp('/featherbase/sales-target', { token, user: id } as never)
  const card = await screen.findByTestId('embed-state', {}, { timeout: 8000 })
  await waitFor(() => expect(card).toHaveAttribute('data-state', 'error'))
  expect(screen.queryByText("You don't have access to this report")).not.toBeInTheDocument()
})

test('with site data blocked the page opens on the default store', async ({ admin, api }) => {
  await viewer(admin)
  const read = Storage.prototype.getItem
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
    if (key.startsWith('featherbase.sales-target.store.')) throw new DOMException('blocked', 'SecurityError')
    return read.call(this, key)
  })
  await open(api)
  await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('1501'))
})

test('a refusal followed by a session that ended is reported, not shown as no access', async ({ admin, api, db }) => {
  await viewer(admin)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  let id = ''
  between({
    '/api/sales_target/me': async () => { await (db as Sql)`delete from has_role where parent = ${id} and role = 'Sales Target Viewer'` },
    // Whichever of the two answers first, the person is disabled before the page asks /me again.
    '/api/sales_target/report': async () => { await (db as Sql)`update person set enabled = false where row_id = ${id}` },
    '/api/sales_target/embed_session': async () => { await (db as Sql)`update person set enabled = false where row_id = ${id}` },
  })
  const login = await api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr: 'test_employee_1', pwd: 'pw-1' }) })
  const { token, user } = (await login.json()) as { token: string; user: { row_id: string } }
  id = user.row_id
  await renderApp('/featherbase/sales-target', { token, user: id } as never)
  const card = await screen.findByTestId('embed-state', {}, { timeout: 8000 })
  await waitFor(() => expect(card).toHaveAttribute('data-state', 'error'))
  expect(screen.queryByText("You don't have access to this report")).not.toBeInTheDocument()
})

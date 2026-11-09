// Connecting a data source (#772) and browsing a MotherDuck one (#969), past
// the paths the main warehouse tests take: changing the kind, unticking a
// database, a name already taken, searching the database and schema lists,
// a refresh the network drops, and a source of another kind keeping the
// native form. Against the local stand-in.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, vi } from 'vitest'
import { rmSync } from 'node:fs'
import { overrideVariable } from 'server/src/env'
import { invalidateSources } from 'server/src/sources/registry'
import { buildStandin, STANDIN_TOKENS } from 'server/test/motherduck-standin'
import { test, expect, renderApp } from './pg-test'

type Client = Parameters<typeof renderApp>[1]
const WAIT = { timeout: 15_000 }
let dir: string

beforeAll(async () => {
  dir = await buildStandin()
  overrideVariable('MOTHERDUCK_STANDIN', dir)
  overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.reader)
})
afterAll(() => {
  invalidateSources()
  overrideVariable('MOTHERDUCK_STANDIN', undefined)
  overrideVariable('MOTHERDUCK_TOKEN', undefined)
  rmSync(dir, { recursive: true, force: true })
})

const connect = (admin: Client, name: string) =>
  admin.post('/api/table/Data%20Source:motherduck_connect', { name, databases: ['sales', 'stock'] })

async function newSource(admin: Client, kind: string) {
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/table/data-source/new', admin)
  await user.click(await screen.findByTestId(`kind-${kind}`, {}, WAIT))
  return user
}

test('Change on a chosen database kind goes back to every kind', async ({ admin }) => {
  const user = await newSource(admin, 'postgres')
  await user.click(screen.getByTestId('kind-change'))
  expect(await screen.findByTestId('kind-motherduck')).toBeInTheDocument()
  expect(screen.queryByTestId('kind-line')).not.toBeInTheDocument()
})

test('Change on MotherDuck goes back to every kind', async ({ admin }) => {
  const user = await newSource(admin, 'motherduck')
  await user.click(screen.getByTestId('kind-change'))
  expect(await screen.findByTestId('kind-postgres')).toBeInTheDocument()
})

test('a database ticked and unticked again is not connected', async ({ admin }) => {
  const user = await newSource(admin, 'motherduck')
  await user.clear(screen.getByTestId('connect-name'))
  await user.type(screen.getByTestId('connect-name'), 'web-wh-untick')
  const sales = await screen.findByTestId('db-sales', {}, WAIT)
  await user.click(sales)
  expect(sales).toBeChecked()
  await user.click(sales)
  expect(sales).not.toBeChecked()
  expect(screen.getByTestId('connect-save')).toBeDisabled()
})

test('a name already taken by another source is refused with the reason', async ({ admin }) => {
  await connect(admin, 'web-wh-taken')
  const user = await newSource(admin, 'motherduck')
  await user.clear(screen.getByTestId('connect-name'))
  await user.type(screen.getByTestId('connect-name'), 'web-wh-taken')
  await user.click(await screen.findByTestId('db-sales', {}, WAIT))
  await user.click(screen.getByTestId('connect-save'))
  expect(await screen.findByText(/already/i, {}, WAIT)).toBeInTheDocument()
  expect(screen.queryByTestId('warehouse-browser')).not.toBeInTheDocument()
})

async function openBrowser(admin: Client, name: string) {
  await connect(admin, name)
  await renderApp(`/featherbase/admin/source/${name}?database=sales`, admin)
  await screen.findByTestId('warehouse-browser', {}, WAIT)
  await waitFor(() => expect(screen.getByTestId('browser-refresh')).toBeEnabled(), WAIT)
}

test("searching the browser's databases narrows them", async ({ admin }) => {
  const user = userEvent.setup()
  await openBrowser(admin, 'web-wh-db-search')
  await user.type(screen.getByRole('searchbox', { name: 'Databases' }), 'stock')
  expect(within(screen.getByTestId('browser-database')).getAllByRole('option').map((o) => o.textContent)).toContain('stock')
  expect(within(screen.getByTestId('browser-database')).queryByRole('option', { name: 'sales' })).toBeNull()
})

test("searching the browser's schemas narrows them", async ({ admin }) => {
  const user = userEvent.setup()
  await openBrowser(admin, 'web-wh-schema-search')
  await user.type(screen.getByRole('searchbox', { name: 'Schemas' }), 'hist')
  const options = within(screen.getByRole('combobox', { name: 'Schema' })).getAllByRole('option').map((o) => o.textContent)
  expect(options).toEqual(['All schemas', 'history'])
})

test('a table list refresh the network drops says so', async ({ admin }) => {
  await openBrowser(admin, 'web-wh-refresh')
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (init?.method === 'POST' && path.includes('web-wh-refresh')) throw new TypeError('Failed to fetch')
    return real(input, init)
  })
  await userEvent.click(screen.getByTestId('browser-refresh'))
  expect(await screen.findByText('The table list could not be refreshed', {}, WAIT)).toBeInTheDocument()
})

test("a preview's column search narrows its columns", async ({ admin }) => {
  const user = userEvent.setup()
  await connect(admin, 'web-wh-columns')
  await renderApp('/featherbase/admin/source/web-wh-columns?database=sales&schema=main&table=stores&tableSchema=main&tab=preview', admin)
  const columns = await screen.findByTestId('preview-columns', {}, WAIT)
  await user.type(within(screen.getByRole('tabpanel', { name: /Preview/ })).getByRole('searchbox'), 'state')
  await waitFor(() => expect(columns).toHaveTextContent('state_code'))
  expect(columns).not.toHaveTextContent('Harbour Road')
})

test('a source of another kind opens on the native Data Source form', async ({ admin }) => {
  await admin.post('/api/table/Data%20Source', { row_id: 'web-pg-native', engine: 'postgres', url_env: 'WEB_PG_NATIVE_URL', access: 'read_only' })
  await renderApp('/featherbase/admin/table/data-source/row/web-pg-native', admin)
  expect(await screen.findByTestId('form-view', {}, WAIT)).toBeInTheDocument()
  expect(screen.queryByTestId('warehouse-databases')).not.toBeInTheDocument()
})

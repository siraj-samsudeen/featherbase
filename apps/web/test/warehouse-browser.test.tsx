// The warehouse browser (#772, #969) at its edges: searches that match no
// database or schema, a chosen schema the search hides, a preview addressed
// without its table's schema, a table with empty cells and bookkeeping
// columns, and the server or the network failing a listing or a preview.
// Against the local MotherDuck stand-in.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, vi } from 'vitest'
import type { Sql } from 'postgres'
import { rmSync } from 'node:fs'
import { overrideVariable } from 'server/src/env'
import { invalidateSources } from 'server/src/sources/registry'
import { buildStandin, changeStandin, STANDIN_TOKENS } from 'server/test/motherduck-standin'
import { test, expect, renderApp } from './pg-test'

type Client = Parameters<typeof renderApp>[1]
const WAIT = { timeout: 15_000 }
const SOURCE = 'web-wh-edges'
let dir: string

beforeAll(async () => {
  dir = await buildStandin()
  await changeStandin(dir, 'sales', [
    `create table ledger (code varchar, note varchar, _loaded_at varchar)`,
    `insert into ledger values ('L-1', null, '2026-01-01')`,
  ])
  overrideVariable('MOTHERDUCK_STANDIN', dir)
  overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.reader)
})
afterAll(() => {
  invalidateSources()
  overrideVariable('MOTHERDUCK_STANDIN', undefined)
  overrideVariable('MOTHERDUCK_TOKEN', undefined)
  rmSync(dir, { recursive: true, force: true })
})

async function open(admin: Client, search: string) {
  await admin.post('/api/table/Data%20Source:motherduck_connect', { name: SOURCE, databases: ['sales', 'stock'] })
  await renderApp(`/featherbase/admin/source/${SOURCE}?${search}`, admin)
  return screen.findByTestId('warehouse-browser', {}, WAIT)
}

/** The network drops every request whose address matches. */
function dropNetwork(lost: (url: string) => boolean) {
  const bridge = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    return lost(url) ? Promise.reject(new TypeError('Failed to fetch')) : bridge(input, init)
  })
}

test('a database search that matches nothing says so', async ({ admin }) => {
  await open(admin, 'database=sales&databaseQuery=zzz')
  const select = screen.getByTestId('browser-database')
  expect(within(select).getByRole('option', { name: 'No matching databases' })).toBeDisabled()
  expect(within(select).getByRole('option', { name: 'sales (selected)' })).toBeInTheDocument()
})

test('a schema search that hides the chosen schema keeps it, marked as selected', async ({ admin }) => {
  await open(admin, 'database=sales&schema=history&schemaQuery=zzz')
  const select = await screen.findByRole('combobox', { name: 'Schema' })
  expect(within(select).getByRole('option', { name: 'history (selected)' })).toBeInTheDocument()
  expect(within(select).getByRole('option', { name: 'No matching schemas' })).toBeDisabled()
})

test('choosing All schemas lists the tables of every schema', async ({ admin }) => {
  await open(admin, 'database=sales&schema=history')
  const user = userEvent.setup()
  await waitFor(() => expect(screen.getByRole('table', { name: 'Warehouse tables' })).toHaveTextContent('closed_stores'), WAIT)
  expect(screen.getByRole('table', { name: 'Warehouse tables' })).not.toHaveTextContent('ledger')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Schema' }), '')
  await waitFor(() => expect(screen.getByRole('table', { name: 'Warehouse tables' })).toHaveTextContent('ledger'), WAIT)
})

test("a preview addressed without its table's schema reads the chosen schema's table", async ({ admin }) => {
  await open(admin, 'database=sales&schema=main&tab=preview&table=ledger')
  await waitFor(() => expect(screen.getByTestId('preview-size')).toHaveTextContent('sales · main · 1 rows'), WAIT)
})

test('a preview shows an empty cell as a dash and greys the warehouse\'s own columns', async ({ admin }) => {
  await open(admin, 'database=sales&schema=main&tableSchema=main&tab=preview&table=ledger')
  const rows = await screen.findByTestId('preview-rows', {}, WAIT)
  expect(within(rows).getByRole('table')).toHaveTextContent('L-1—')
  expect(within(rows).queryByText('_loaded_at')).not.toBeInTheDocument()
  const columns = screen.getByTestId('preview-columns')
  expect(within(columns).getByText('_loaded_at')).toHaveClass('text-ink-subtle')
  expect(within(columns).getByText('code')).toHaveClass('font-mono')
  expect(screen.getByText(/^Greyed columns start with _/)).toBeInTheDocument()
})

test('a preview addressed with no schema at all says what the server refused', async ({ admin }) => {
  await open(admin, 'database=sales&tab=preview&table=ledger')
  const panel = screen.getByRole('tabpanel', { name: /Preview/ })
  await waitFor(() => expect(panel).toHaveTextContent('No table .ledger in sales'), WAIT)
})

test('a preview the network drops says the table could not be read', async ({ admin }) => {
  dropNetwork((url) => url.includes('preview'))
  await open(admin, 'database=sales&schema=main&tableSchema=main&tab=preview&table=ledger')
  await waitFor(() => expect(screen.getByRole('tabpanel', { name: /Preview/ })).toHaveTextContent('The table could not be read'), WAIT)
})

test('a table list the network drops says it could not be read', async ({ admin }) => {
  dropNetwork((url) => url.includes('tables'))
  await open(admin, 'database=sales')
  await waitFor(() => expect(screen.getByTestId('warehouse-browser')).toHaveTextContent('The table list could not be read'), WAIT)
})

test('a browser opened on no database opens the first one the source reads', async ({ admin }) => {
  await open(admin, '')
  await waitFor(() => expect(screen.getByTestId('browser-database')).toHaveValue('sales'), WAIT)
  expect(screen.getByRole('combobox', { name: 'Schema' })).toHaveValue('')
})

test('a remembered database the source no longer reads opens the first one it does, on every schema', async ({ admin }) => {
  localStorage.setItem(`fb-warehouse-place:${admin.user}:${SOURCE}`, JSON.stringify({ database: 'archive', schema: 'history' }))
  await open(admin, '')
  await waitFor(() => expect(screen.getByTestId('browser-database')).toHaveValue('sales'), WAIT)
  expect(screen.getByRole('combobox', { name: 'Schema' })).toHaveValue('')
})

test('a browser opened on no database reopens the database and schema this person last had open', async ({ admin }) => {
  localStorage.setItem(`fb-warehouse-place:${admin.user}:${SOURCE}`, JSON.stringify({ database: 'stock', schema: 'main' }))
  await open(admin, '')
  await waitFor(() => expect(screen.getByTestId('browser-database')).toHaveValue('stock'), WAIT)
  expect(screen.getByRole('combobox', { name: 'Schema' })).toHaveValue('main')
})

test('a database the source does not read says what the server refused', async ({ admin }) => {
  await open(admin, 'database=archive')
  await waitFor(() => expect(screen.getByTestId('warehouse-browser')).toHaveTextContent(`Data source ${SOURCE} does not read the database archive`), WAIT)
})

test('a refresh after the source stopped reading the database says what the server refused', async ({ admin, db }) => {
  await open(admin, 'database=sales')
  await waitFor(() => expect(screen.getByTestId('browser-refresh')).toBeEnabled(), WAIT)
  await (db as Sql)`update data_source set databases = '[]'::jsonb where row_id = ${SOURCE}`
  invalidateSources()
  await userEvent.click(screen.getByTestId('browser-refresh'))
  expect(await screen.findByText(`Data source ${SOURCE} does not read the database sales`, {}, WAIT)).toBeInTheDocument()
})

// #772: connect a MotherDuck warehouse by pasting its token, see it in the
// sidebar, and browse it schema → table → preview — against the local stand-in.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll } from 'vitest'
import { rmSync } from 'node:fs'
import { overrideVariable } from 'server/src/env'
import { invalidateSources } from 'server/src/sources/registry'
import { buildStandin, changeStandin, STANDIN_TOKENS } from 'server/test/motherduck-standin'
import { test, expect, renderApp } from './pg-test'

type Client = Parameters<typeof renderApp>[1]
const WAIT = { timeout: 15_000 }
let dir: string

beforeAll(async () => {
  dir = await buildStandin()
  // More than a normal first page: searches must not inspect only rendered rows.
  await changeStandin(dir, 'sales', [
    ...Array.from({ length: 64 }, (_, i) => `create table catalog_${String(i).padStart(3, '0')} (id integer)`),
    `create table zz_catalog_tail (${Array.from({ length: 80 }, (_, i) => `field_${String(i).padStart(3, '0')} varchar`).join(', ')})`,
  ])
  overrideVariable('MOTHERDUCK_STANDIN', dir)
})
afterAll(() => {
  invalidateSources()
  overrideVariable('MOTHERDUCK_STANDIN', undefined)
  rmSync(dir, { recursive: true, force: true })
})

async function connect(admin: Client, name: string) {
  await admin.post('/api/table/Data%20Source:motherduck_connect', { name, token: STANDIN_TOKENS.reader, databases: ['sales', 'stock'] })
}

test('picking MotherDuck folds the kinds into one line; a tested token lists the databases to tick; saving opens the browser', async ({ admin }) => {
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/table/data-source/new', admin)
  await user.click(await screen.findByTestId('kind-motherduck', {}, WAIT))
  expect(screen.getByTestId('kind-line')).toHaveTextContent('MotherDuck')
  expect(screen.queryByTestId('kind-postgres')).not.toBeInTheDocument()
  expect(screen.queryByTestId('connect-databases')).not.toBeInTheDocument()
  expect(screen.getByTestId('connect-token')).toHaveAttribute('type', 'password')
  expect(screen.queryByRole('button', { name: /show/i })).not.toBeInTheDocument()

  await user.clear(screen.getByTestId('connect-name'))
  await user.type(screen.getByTestId('connect-name'), 'web-wh')
  await user.type(screen.getByTestId('connect-token'), STANDIN_TOKENS.reader)
  await user.click(screen.getByTestId('connect-test'))
  await waitFor(() => expect(screen.getByTestId('connect-result')).toHaveTextContent('Connected as reader_user · it can read 5 databases'), WAIT)
  expect(screen.getByTestId('connect-save')).toBeDisabled()

  await user.click(screen.getByTestId('db-sales'))
  await user.click(screen.getByTestId('db-stock'))
  await user.click(screen.getByTestId('connect-save'))
  await screen.findByTestId('warehouse-browser', {}, WAIT)
  expect(screen.getByTestId('browser-database')).toHaveValue('sales')
})

test('a refused token says so in plain words and offers no databases', async ({ admin }) => {
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/table/data-source/new', admin)
  await user.click(await screen.findByTestId('kind-motherduck', {}, WAIT))
  await user.type(screen.getByTestId('connect-token'), STANDIN_TOKENS.refused)
  await user.click(screen.getByTestId('connect-test'))
  await waitFor(() => expect(screen.getByTestId('connect-result')).toHaveTextContent('MotherDuck refused the token'), WAIT)
  expect(screen.getByTestId('connect-result')).not.toHaveTextContent(STANDIN_TOKENS.refused)
  expect(screen.queryByTestId('connect-databases')).not.toBeInTheDocument()
})

test('a token that can write is flagged', async ({ admin }) => {
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/table/data-source/new', admin)
  await user.click(await screen.findByTestId('kind-motherduck', {}, WAIT))
  await user.type(screen.getByTestId('connect-token'), STANDIN_TOKENS.writer)
  await user.click(screen.getByTestId('connect-test'))
  await waitFor(() => expect(screen.getByTestId('connect-result')).toHaveTextContent('can also write'), WAIT)
})

test('another kind keeps the native Data Source form', async ({ admin }) => {
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/table/data-source/new', admin)
  await user.click(await screen.findByTestId('kind-postgres', {}, WAIT))
  expect(await screen.findByTestId('form-view', {}, WAIT)).toBeInTheDocument()
  expect(screen.getByTestId('kind-line')).toHaveTextContent('Postgres')
})

test('the source page shows only the token\'s last four, and replacing it shows the new four', async ({ admin }) => {
  await connect(admin, 'web-wh-token')
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/table/data-source/row/web-wh-token', admin)
  expect(await screen.findByTestId('warehouse-token', {}, WAIT)).toHaveTextContent('Saved, ending …4f2a')
  expect(document.body).not.toHaveTextContent(STANDIN_TOKENS.reader)
  expect(screen.getByTestId('warehouse-databases')).toHaveTextContent('sales')
  await user.click(screen.getByTestId('replace-token'))
  await user.type(screen.getByTestId('replace-token-input'), STANDIN_TOKENS.writer)
  await user.click(screen.getByTestId('replace-token-save'))
  await waitFor(() => expect(screen.getByTestId('warehouse-token')).toHaveTextContent('Saved, ending …77b1'), WAIT)
})

test('the searchable catalog opens a preview and keeps its filters and selection across tabs and copy-return', async ({ admin }) => {
  await connect(admin, 'web-wh-browse')
  const user = userEvent.setup()
  await renderApp('/featherbase/admin', admin)
  const group = await screen.findByTestId('sidebar-group-sources', {}, WAIT)
  await waitFor(() => expect(within(group).getAllByTestId('sidebar-source-database').map((a) => a.textContent)).toEqual(expect.arrayContaining(['sales', 'stock'])), WAIT)
  const sales = within(group).getAllByTestId('sidebar-source-database').find((a) => a.textContent === 'sales' && a.getAttribute('href')?.includes('web-wh-browse'))!
  await user.click(sales)
  await screen.findByTestId('warehouse-browser', {}, WAIT)
  const catalogTab = await screen.findByRole('tab', { name: /tables|catalog/i })
  expect(catalogTab).toHaveAttribute('aria-selected', 'true')
  await user.click(catalogTab)
  await user.keyboard('{ArrowRight}')
  expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('tabpanel', { name: 'Preview' })).toHaveTextContent('Pick a table in the catalog to preview it.')
  await user.keyboard('{ArrowLeft}')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Schema' }), 'main')
  const search = screen.getByRole('searchbox', { name: 'Tables' })
  await user.type(search, 'zz_catalog_tail')
  expect(screen.getByRole('table', { name: 'Warehouse tables' })).toHaveTextContent('zz_catalog_tail')
  await user.clear(search)
  await user.type(search, 'STORES')
  const catalog = screen.getByRole('table', { name: 'Warehouse tables' })
  expect(within(catalog).getAllByRole('row')).toHaveLength(2)
  expect(catalog).not.toHaveTextContent('closed_stores')
  await user.click(within(catalog).getByRole('button', { name: 'stores' }))
  expect(screen.getByRole('tab', { name: /preview/i })).toHaveAttribute('aria-selected', 'true')
  expect(screen.queryByRole('table', { name: 'Warehouse tables' })).not.toBeInTheDocument()
  await waitFor(() => expect(screen.getByTestId('preview-size')).toHaveTextContent('3 rows · 4 columns'), WAIT)
  expect(screen.getByTestId('preview-rows')).toHaveTextContent('Harbour Road')
  expect(screen.getByTestId('preview-columns')).toHaveTextContent('state_code')

  await user.click(screen.getByRole('tab', { name: /tables|catalog/i }))
  expect(screen.getByRole('searchbox', { name: 'Tables' })).toHaveValue('STORES')
  expect(screen.getByRole('combobox', { name: 'Schema' })).toHaveValue('main')
  expect(screen.getByTestId('browser-database')).toHaveValue('sales')
  expect(screen.getByTestId('preview-rows')).not.toBeVisible()
  await user.click(screen.getByRole('tab', { name: /preview.*stores/i }))
  expect(await screen.findByTestId('preview-size', {}, WAIT)).toHaveTextContent('3 rows · 4 columns')

  await user.click(screen.getByTestId('preview-copy'))
  const copy = await screen.findByTestId('copy-setup', {}, WAIT)
  // Breadcrumbs use document navigation, which jsdom cannot execute. The
  // acceptance scenario follows the real link; here exercise its reload URL.
  const back = within(copy).getByRole('link', { name: 'stores' }).getAttribute('href')!
  expect(new URL(back, 'http://localhost').searchParams.get('query')).toBe('STORES')
  await renderApp(back, admin)
  await screen.findByTestId('warehouse-browser', {}, WAIT)
  expect(screen.getByRole('tab', { name: /preview.*stores/i })).toHaveAttribute('aria-selected', 'true')
  expect(await screen.findByTestId('preview-rows', {}, WAIT)).toHaveTextContent('Harbour Road')
  await user.click(screen.getByRole('tab', { name: /tables|catalog/i }))
  expect(screen.getByRole('searchbox', { name: 'Tables' })).toHaveValue('STORES')
  expect(screen.getByRole('combobox', { name: 'Schema' })).toHaveValue('main')
  expect(screen.getByTestId('browser-database')).toHaveValue('sales')
})

test('the browser reopens on the schema this person last had open', async ({ admin }) => {
  await connect(admin, 'web-wh-place')
  await renderApp('/featherbase/admin/source/web-wh-place?database=sales&schema=history', admin)
  await screen.findByTestId('warehouse-browser', {}, WAIT)
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Schema' })).toHaveValue('history'), WAIT)
  await renderApp('/featherbase/admin/source/web-wh-place', admin)
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Schema' })).toHaveValue('history'), WAIT)
  expect(screen.getByTestId('browser-database')).toHaveValue('sales')
  expect(screen.getByRole('table', { name: 'Warehouse tables' })).toHaveTextContent('closed_stores')
})

test('mapping search finds every source column and preserves real input edits and keep choices', async ({ admin }) => {
  await connect(admin, 'web-wh-mapping')
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/source/web-wh-mapping/copy?database=sales&schema=main&table=stores', admin)
  await screen.findByTestId('copy-setup', {}, WAIT)
  await user.clear(screen.getByRole('textbox', { name: 'Name for name' }))
  await user.type(screen.getByRole('textbox', { name: 'Name for name' }), 'store_name')
  await user.type(screen.getByRole('textbox', { name: 'Label for name' }), 'Store title')
  await user.type(screen.getByRole('textbox', { name: 'Description for name' }), 'Trading name')
  await user.click(screen.getByRole('checkbox', { name: 'Keep city' }))

  const search = screen.getByRole('searchbox', { name: 'Column mapping' })
  await user.type(search, 'STATE_CODE')
  const mapping = screen.getByRole('table', { name: 'Columns to copy' })
  expect(within(mapping).getAllByRole('row')).toHaveLength(2)
  expect(screen.getByRole('textbox', { name: 'Name for state_code' })).toHaveValue('state_code')
  expect(screen.queryByRole('textbox', { name: 'Name for name' })).not.toBeInTheDocument()
  await user.type(screen.getByRole('textbox', { name: 'Label for state_code' }), 'Region code')
  await user.clear(search)
  await user.type(search, 'Trading name')
  expect(screen.getByRole('textbox', { name: 'Name for name' })).toHaveValue('store_name')
  expect(screen.getByRole('textbox', { name: 'Label for name' })).toHaveValue('Store title')
  expect(screen.getByRole('textbox', { name: 'Description for name' })).toHaveValue('Trading name')
  await user.clear(search)
  await user.type(search, 'no matching column')
  expect(screen.queryByRole('textbox', { name: 'Name for name' })).not.toBeInTheDocument()
  await user.clear(search)
  expect(screen.getByRole('checkbox', { name: 'Keep city' })).not.toBeChecked()
  expect(screen.getByRole('textbox', { name: 'Label for state_code' })).toHaveValue('Region code')
  expect(screen.getByTestId('copy-key')).toHaveValue('code')
  expect(screen.getByRole('checkbox', { name: 'Keep code' })).toBeDisabled()
  await waitFor(() => expect(screen.getByTestId('copy-create')).toBeEnabled(), WAIT)
})

test('mapping search reaches the last of 80 columns and updates its source identity, not its filtered index', async ({ admin }) => {
  await connect(admin, 'web-wh-wide')
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/source/web-wh-wide/copy?database=sales&schema=main&table=zz_catalog_tail', admin)
  await screen.findByTestId('copy-setup', {}, WAIT)
  const search = screen.getByRole('searchbox', { name: 'Column mapping' })
  await user.type(search, 'field_079')
  expect(screen.getByRole('textbox', { name: 'Name for field_079' })).toHaveValue('field_079')
  await user.clear(screen.getByRole('textbox', { name: 'Name for field_079' }))
  await user.type(screen.getByRole('textbox', { name: 'Name for field_079' }), 'last_field')
  await user.type(screen.getByRole('textbox', { name: 'Label for field_079' }), 'Last field')
  await user.click(screen.getByRole('checkbox', { name: 'Keep field_079' }))
  await user.clear(search)
  await user.type(search, 'field_000')
  expect(screen.getByRole('textbox', { name: 'Name for field_000' })).toHaveValue('field_000')
  expect(screen.getByRole('textbox', { name: 'Label for field_000' })).toHaveValue('')
  expect(screen.getByRole('checkbox', { name: 'Keep field_000' })).toBeChecked()
  await user.clear(search)
  await user.type(search, 'last_field')
  expect(screen.getByRole('textbox', { name: 'Label for field_079' })).toHaveValue('Last field')
  expect(screen.getByRole('checkbox', { name: 'Keep field_079' })).not.toBeChecked()
})

test('someone who is not a System Manager sees no Data sources group', async ({ admin, createUser }) => {
  await connect(admin, 'web-wh-hidden')
  await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Warehouse Shelf Clerk' } })
  await admin.post('/api/table_def', { name: 'Warehouse Shelf Note', columns: [{ column_name: 'title', column_type: 'Data' }] })
  await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: 'Warehouse Shelf Note', role: 'Warehouse Shelf Clerk', can_read: true } })
  const clerk = await createUser({ email: 'wh.clerk@example.com', roles: ['Warehouse Shelf Clerk'] })
  await renderApp('/featherbase/admin', clerk)
  await screen.findByTestId('sidebar-group-data', {}, WAIT)
  expect(screen.queryByTestId('sidebar-group-sources')).not.toBeInTheDocument()
})

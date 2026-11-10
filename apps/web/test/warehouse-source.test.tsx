// #772, #969: connect a MotherDuck warehouse with the instance's token, see it in the
// sidebar, and browse it schema → table → preview — against the local stand-in.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, vi } from 'vitest'
import { rmSync } from 'node:fs'
import { overrideVariable } from 'server/src/env'
import { invalidateSources } from 'server/src/sources/registry'
import { buildStandin, changeStandin, STANDIN_TOKENS } from 'server/test/motherduck-standin'
import { test, expect, renderApp } from './pg-test'
import { grantRole } from 'server/test/fixtures'

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
  overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.reader)
})
afterAll(() => {
  invalidateSources()
  overrideVariable('MOTHERDUCK_STANDIN', undefined)
  overrideVariable('MOTHERDUCK_TOKEN', undefined)
  rmSync(dir, { recursive: true, force: true })
})

async function connect(admin: Client, name: string) {
  await admin.post('/api/table/Data%20Source:motherduck_connect', { name, databases: ['sales', 'stock'] })
}

test('picking MotherDuck folds the kinds into one line; the token of this instance lists the databases to tick, with nothing to paste; saving opens the browser', async ({ admin }) => {
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/table/data-source/new', admin)
  await user.click(await screen.findByTestId('kind-motherduck', {}, WAIT))
  expect(screen.getByTestId('kind-line')).toHaveTextContent('MotherDuck')
  expect(screen.queryByTestId('kind-postgres')).not.toBeInTheDocument()
  expect(document.querySelector('input[type=password]')).toBeNull()

  await user.clear(screen.getByTestId('connect-name'))
  await user.type(screen.getByTestId('connect-name'), 'web-wh')
  await waitFor(() => expect(screen.getByTestId('connect-result')).toHaveTextContent('Connected as reader_user · it can read 5 databases'), WAIT)
  expect(screen.getByTestId('connect-save')).toBeDisabled()

  await user.click(screen.getByTestId('db-sales'))
  await user.click(screen.getByTestId('db-stock'))
  await user.click(screen.getByTestId('connect-save'))
  await screen.findByTestId('warehouse-browser', {}, WAIT)
  expect(screen.getByTestId('browser-database')).toHaveValue('sales')
})

test('a refused token says so in plain words and offers no databases', async ({ admin }) => {
  overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.refused)
  try {
    const user = userEvent.setup()
    await renderApp('/featherbase/admin/table/data-source/new', admin)
    await user.click(await screen.findByTestId('kind-motherduck', {}, WAIT))
    await waitFor(() => expect(screen.getByTestId('connect-result')).toHaveTextContent("MotherDuck refused this server's token"), WAIT)
    expect(screen.getByTestId('connect-result')).not.toHaveTextContent(STANDIN_TOKENS.refused)
    expect(screen.queryByTestId('connect-databases')).not.toBeInTheDocument()
  } finally { overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.reader) }
})

test('an instance with no token says so and offers no databases', async ({ admin }) => {
  overrideVariable('MOTHERDUCK_TOKEN', undefined)
  try {
    const user = userEvent.setup()
    await renderApp('/featherbase/admin/table/data-source/new', admin)
    await user.click(await screen.findByTestId('kind-motherduck', {}, WAIT))
    await waitFor(() => expect(screen.getByTestId('connect-result')).toHaveTextContent('MOTHERDUCK_TOKEN is not set'), WAIT)
    expect(screen.queryByTestId('connect-databases')).not.toBeInTheDocument()
  } finally { overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.reader) }
})

test('another kind keeps the native Data Source form', async ({ admin }) => {
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/table/data-source/new', admin)
  await user.click(await screen.findByTestId('kind-postgres', {}, WAIT))
  expect(await screen.findByTestId('form-view', {}, WAIT)).toBeInTheDocument()
  expect(screen.getByTestId('kind-line')).toHaveTextContent('Postgres')
})

test('the source page shows its databases, and no token to see or change', async ({ admin }) => {
  await connect(admin, 'web-wh-token')
  await renderApp('/featherbase/admin/table/data-source/row/web-wh-token', admin)
  expect(await screen.findByTestId('warehouse-databases', {}, WAIT)).toHaveTextContent('sales')
  expect(document.body).not.toHaveTextContent(STANDIN_TOKENS.reader)
  expect(document.querySelector('input[type=password]')).toBeNull()
  expect(screen.queryByRole('button', { name: /replace/i })).not.toBeInTheDocument()
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
  await changeStandin(dir, 'sales', ['create table stores_new as select * from stores'])
  expect(screen.getByRole('table', { name: 'Warehouse tables' })).not.toHaveTextContent('stores_new')
  await user.click(screen.getByTestId('browser-refresh'))
  await waitFor(() => expect(screen.getByRole('table', { name: 'Warehouse tables' })).toHaveTextContent('stores_new'), WAIT)
  expect(screen.getByRole('searchbox', { name: 'Tables' })).toHaveValue('STORES')
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

test('a key column whose values repeat says how many rows repeat one', async ({ admin }) => {
  await connect(admin, 'web-wh-repeat')
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/source/web-wh-repeat/copy?database=sales&schema=main&table=stores', admin)
  await screen.findByTestId('copy-setup', {}, WAIT)
  await user.selectOptions(screen.getByTestId('copy-key'), 'city')
  await waitFor(() => expect(screen.getByTestId('copy-key-check')).toHaveTextContent(/^1 rows repeat a value$/), WAIT)
})

/** The network drops the requests whose address contains `part`. */
function dropRequests(part: string) {
  const real = globalThis.fetch
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    String(input instanceof Request ? input.url : input).includes(part) ? Promise.reject(new TypeError('Failed to fetch')) : real(input, init))
}

test('a table the network drops while it is read for a copy says it could not be read', async ({ admin }) => {
  await connect(admin, 'web-wh-unread')
  const dropped = dropRequests(':preview?')
  try {
    await renderApp('/featherbase/admin/source/web-wh-unread/copy?database=sales&schema=main&table=stores', admin)
    expect(await screen.findByText('The table could not be read', {}, WAIT)).toBeInTheDocument()
  } finally {
    dropped.mockRestore()
  }
})

test('a copy the network drops says it could not be made', async ({ admin }) => {
  await connect(admin, 'web-wh-unmade')
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/source/web-wh-unmade/copy?database=sales&schema=main&table=stores', admin)
  await screen.findByTestId('copy-setup', {}, WAIT)
  await waitFor(() => expect(screen.getByTestId('copy-create')).toBeEnabled(), WAIT)
  const dropped = dropRequests(':copy_create')
  try {
    await user.click(screen.getByTestId('copy-create'))
    expect(await screen.findByText('The copy could not be made', {}, WAIT)).toBeInTheDocument()
  } finally {
    dropped.mockRestore()
  }
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
  await user.clear(screen.getByTestId('copy-name'))
  await user.type(screen.getByTestId('copy-name'), 'Data Source')
  await user.click(screen.getByTestId('copy-create'))
  expect(await screen.findByText('Table Data Source already exists', {}, WAIT)).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Name for name' })).toHaveValue('store_name')
  expect(screen.getByRole('checkbox', { name: 'Keep city' })).not.toBeChecked()
  await user.clear(screen.getByTestId('copy-name'))
  await user.type(screen.getByTestId('copy-name'), 'Mapped Warehouse Stores')
  await user.click(screen.getByTestId('copy-create'))
  await waitFor(() => expect(screen.getByTestId('list-rows')).toHaveTextContent('Harbour Road'), WAIT)
  expect(screen.queryByTestId('copy-setup')).not.toBeInTheDocument()
  expect(await admin.get('/api/table/Mapped%20Warehouse%20Stores/S001')).toMatchObject({ row_id: 'S001', store_name: 'Harbour Road', state_code: '32' })
  const copied = await admin.get<{ columns: { column_name: string; label: string; description?: string }[] }>('/api/table/Mapped%20Warehouse%20Stores:meta')
  expect(copied.columns).toEqual(expect.arrayContaining([expect.objectContaining({ column_name: 'store_name', label: 'Store title', description: 'Trading name' })]))
  expect(copied.columns.map(c => c.column_name)).not.toContain('city')
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
  await grantRole(admin, { table: 'Warehouse Shelf Note', role: 'Warehouse Shelf Clerk', can_read: true })
  const clerk = await createUser({ email: 'wh.clerk@example.com', roles: ['Warehouse Shelf Clerk'] })
  await renderApp('/featherbase/admin', clerk)
  await screen.findByTestId('sidebar-group-data', {}, WAIT)
  expect(screen.queryByTestId('sidebar-group-sources')).not.toBeInTheDocument()
})

test('Copy again refreshes corrected native rows through source changes', async ({ admin }) => {
  await changeStandin(dir, 'sales', ['create table copybar_stores as select * from stores'])
  await connect(admin, 'web-wh-copybar')
  await admin.post('/api/table/Data%20Source/web-wh-copybar:copy_create', {
    database: 'sales', schema: 'main', table: 'copybar_stores', name: 'Copybar Store', key: 'code',
    columns: ['name', 'state_code', 'code'].map(source => ({ source, column_name: source })),
  })
  const rowPath = '/api/table/Copybar%20Store/S002'
  const row = await admin.get<{ updated_at: string }>(rowPath)
  await admin.post('/api/save_row', { table: 'Copybar Store', row: { row_id: 'S002', updated_at: row.updated_at, state_code: 'Owner correction' } })
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/table/copybar-store', admin)
  const bar = await screen.findByTestId('copy-bar', {}, WAIT)
  expect(bar).toHaveTextContent('Copied from web-wh-copybar · sales.main.copybar_stores · matched on code')
  expect(bar).toHaveTextContent('last copied')
  await waitFor(() => expect(screen.getByTestId('list-rows')).toHaveTextContent('Owner correction'), WAIT)

  await changeStandin(dir, 'sales', [
    `update copybar_stores set name = 'Hill Street renamed', state_code = '34' where code = 'S002'`,
    `delete from copybar_stores where code = 'S003'`,
    `insert into copybar_stores values ('S004', 'New Quay', 'Port Town', '07')`,
  ])
  await admin.post('/api/table/Data%20Source/web-wh-copybar:refresh_tables', { database: 'sales' })
  await user.click(within(bar).getByRole('button', { name: 'Copy again' }))
  const result = await screen.findByTestId('copy-result', {}, WAIT)
  expect(result).toHaveTextContent('Copied: 1 added · 2 updated')
  expect(result).toHaveTextContent('1 conflict where the source changed a value someone corrected (see Import conflicts)')
  expect(result).toHaveTextContent('1 deleted at source')
  await waitFor(() => {
    expect(screen.getByTestId('list-rows')).toHaveTextContent('Hill Street renamed')
    expect(screen.getByTestId('list-rows')).toHaveTextContent('New Quay')
    expect(screen.getByTestId('list-rows')).toHaveTextContent('Owner correction')
    expect(within(bar).getByRole('button', { name: 'Copy again' })).toBeEnabled()
  }, WAIT)
  expect(await admin.get(rowPath)).toMatchObject({ name: 'Hill Street renamed', state_code: 'Owner correction' })
  expect(await admin.get('/api/table/Copybar%20Store/S003')).toMatchObject({ deleted_at_source: true })

  await user.click(screen.getByRole('button', { name: 'List actions' }))
  await user.click(await screen.findByRole('button', { name: 'Import conflicts' }))
  const panel = await screen.findByRole('region', { name: 'Import conflicts' })
  expect(await within(panel).findByText('Owner correction')).toBeInTheDocument()
  expect(within(panel).getByText('34')).toBeInTheDocument()

  await changeStandin(dir, 'sales', [`insert into copybar_stores values ('S003', 'Market Lane restored', 'Port Town', '32')`])
  await admin.post('/api/table/Data%20Source/web-wh-copybar:refresh_tables', { database: 'sales' })
  await user.click(within(bar).getByRole('button', { name: 'Copy again' }))
  await waitFor(() => {
    expect(screen.getByTestId('copy-result')).toHaveTextContent('Copied: 0 added · 4 updated')
    expect(screen.getByTestId('copy-result')).toHaveTextContent('1 back at source')
    expect(screen.getByTestId('copy-result')).not.toHaveTextContent('deleted at source')
    expect(screen.getByTestId('list-rows')).toHaveTextContent('Market Lane restored')
    expect(within(bar).getByRole('button', { name: 'Copy again' })).toBeEnabled()
  }, WAIT)
  expect(await admin.get('/api/table/Copybar%20Store/S003')).toMatchObject({ deleted_at_source: false, name: 'Market Lane restored' })
})

test('a refused Copy again can be retried after correcting source keys', async ({ admin }) => {
  await changeStandin(dir, 'sales', ['create table copybar_retry_stores as select * from stores'])
  await connect(admin, 'web-wh-copybar-retry')
  await admin.post('/api/table/Data%20Source/web-wh-copybar-retry:copy_create', {
    database: 'sales', schema: 'main', table: 'copybar_retry_stores', name: 'Copybar Retry Store', key: 'code',
    columns: ['name', 'code'].map(source => ({ source, column_name: source })),
  })
  const before = await admin.get('/api/table/Copybar%20Retry%20Store/S001')
  await changeStandin(dir, 'sales', [`insert into copybar_retry_stores values ('S001', 'Duplicate store', 'Port Town', '32')`])
  await admin.post('/api/table/Data%20Source/web-wh-copybar-retry:refresh_tables', { database: 'sales' })
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/table/copybar-retry-store', admin)
  const bar = await screen.findByTestId('copy-bar', {}, WAIT)
  await user.click(within(bar).getByRole('button', { name: 'Copy again' }))
  expect(await within(bar).findByText('Copy key values must be unique')).toBeInTheDocument()
  expect(screen.queryByTestId('copy-result')).not.toBeInTheDocument()
  expect(within(bar).getByRole('button', { name: 'Copy again' })).toBeEnabled()
  expect(await admin.get('/api/table/Copybar%20Retry%20Store/S001')).toEqual(before)

  await changeStandin(dir, 'sales', [
    `delete from copybar_retry_stores where name = 'Duplicate store'`,
    `update copybar_retry_stores set name = 'Harbour Road refreshed' where code = 'S001'`,
  ])
  await admin.post('/api/table/Data%20Source/web-wh-copybar-retry:refresh_tables', { database: 'sales' })
  await user.click(within(bar).getByRole('button', { name: 'Copy again' }))
  expect(await screen.findByTestId('copy-result', {}, WAIT)).toHaveTextContent('Copied: 0 added · 3 updated')
  expect(bar).not.toHaveTextContent('Copy key values must be unique')
  await waitFor(() => {
    expect(screen.getByTestId('list-rows')).toHaveTextContent('Harbour Road refreshed')
    expect(within(bar).getByRole('button', { name: 'Copy again' })).toBeEnabled()
  }, WAIT)
})

test('a copied table can be refreshed automatically, paused and resumed from its copy bar', async ({ admin }) => {
  await changeStandin(dir, 'sales', ['create table schedule_stores as select * from stores'])
  await connect(admin, 'web-wh-schedule')
  await admin.post('/api/table/Data%20Source/web-wh-schedule:copy_create', {
    database: 'sales', schema: 'main', table: 'schedule_stores', name: 'Schedule Store', key: 'code',
    columns: ['name', 'code'].map(source => ({ source, column_name: source })),
  })
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/table/schedule-store', admin)
  const schedule = await screen.findByTestId('copy-schedule', {}, WAIT)
  const cadence = within(schedule).getByRole('combobox', { name: 'Refresh automatically' })
  await waitFor(() => expect(cadence).toBeEnabled(), WAIT)
  expect(cadence).toHaveValue('off')
  await user.selectOptions(cadence, 'hourly')
  const pause = await within(schedule).findByRole('button', { name: 'Pause' }, WAIT)
  expect(within(schedule).getByRole('link', { name: 'Manage job' })).toBeInTheDocument()
  await waitFor(() => expect(pause).toBeEnabled(), WAIT)
  await user.click(pause)
  await waitFor(() => expect(schedule).toHaveTextContent('Paused · hourly'), WAIT)
  expect(cadence).toHaveValue('off')
  const resume = within(schedule).getByRole('button', { name: 'Resume' })
  await waitFor(() => expect(resume).toBeEnabled(), WAIT)
  await user.click(resume)
  await waitFor(() => expect(within(schedule).getByRole('button', { name: 'Pause' })).toBeInTheDocument(), WAIT)
  expect(await admin.get('/api/table/Schedule%20Store:copy_schedule')).toMatchObject({ cadence: 'hourly', enabled: true })
  // Turning it off keeps the cadence for a later resume.
  await waitFor(() => expect(cadence).toBeEnabled(), WAIT)
  await user.selectOptions(cadence, 'off')
  await waitFor(() => expect(schedule).toHaveTextContent('Paused · hourly'), WAIT)
}, 60_000)

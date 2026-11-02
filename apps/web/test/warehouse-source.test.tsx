// #772: connect a MotherDuck warehouse by pasting its token, see it in the
// sidebar, and browse it schema → table → preview — against the local stand-in.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll } from 'vitest'
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
  await renderApp('/featherbase/admin/Data%20Source/new', admin)
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
  await renderApp('/featherbase/admin/Data%20Source/new', admin)
  await user.click(await screen.findByTestId('kind-motherduck', {}, WAIT))
  await user.type(screen.getByTestId('connect-token'), STANDIN_TOKENS.refused)
  await user.click(screen.getByTestId('connect-test'))
  await waitFor(() => expect(screen.getByTestId('connect-result')).toHaveTextContent('MotherDuck refused the token'), WAIT)
  expect(screen.getByTestId('connect-result')).not.toHaveTextContent(STANDIN_TOKENS.refused)
  expect(screen.queryByTestId('connect-databases')).not.toBeInTheDocument()
})

test('a token that can write is flagged', async ({ admin }) => {
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/Data%20Source/new', admin)
  await user.click(await screen.findByTestId('kind-motherduck', {}, WAIT))
  await user.type(screen.getByTestId('connect-token'), STANDIN_TOKENS.writer)
  await user.click(screen.getByTestId('connect-test'))
  await waitFor(() => expect(screen.getByTestId('connect-result')).toHaveTextContent('can also write'), WAIT)
})

test('another kind keeps the native Data Source form', async ({ admin }) => {
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/Data%20Source/new', admin)
  await user.click(await screen.findByTestId('kind-postgres', {}, WAIT))
  expect(await screen.findByTestId('form-view', {}, WAIT)).toBeInTheDocument()
  expect(screen.getByTestId('kind-line')).toHaveTextContent('Postgres')
})

test('the source page shows only the token\'s last four, and replacing it shows the new four', async ({ admin }) => {
  await connect(admin, 'web-wh-token')
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/Data%20Source/web-wh-token', admin)
  expect(await screen.findByTestId('warehouse-token', {}, WAIT)).toHaveTextContent('Saved, ending …4f2a')
  expect(document.body).not.toHaveTextContent(STANDIN_TOKENS.reader)
  expect(screen.getByTestId('warehouse-databases')).toHaveTextContent('sales')
  await user.click(screen.getByTestId('replace-token'))
  await user.type(screen.getByTestId('replace-token-input'), STANDIN_TOKENS.writer)
  await user.click(screen.getByTestId('replace-token-save'))
  await waitFor(() => expect(screen.getByTestId('warehouse-token')).toHaveTextContent('Saved, ending …77b1'), WAIT)
})

test('the sidebar lists the source with its databases, and browsing goes schema, table, preview', async ({ admin }) => {
  await connect(admin, 'web-wh-browse')
  const user = userEvent.setup()
  await renderApp('/featherbase/admin', admin)
  const group = await screen.findByTestId('sidebar-group-sources', {}, WAIT)
  await waitFor(() => expect(within(group).getAllByTestId('sidebar-source-database').map((a) => a.textContent)).toEqual(expect.arrayContaining(['sales', 'stock'])), WAIT)
  const sales = within(group).getAllByTestId('sidebar-source-database').find((a) => a.textContent === 'sales' && a.getAttribute('href')?.includes('web-wh-browse'))!
  await user.click(sales)
  await screen.findByTestId('warehouse-browser', {}, WAIT)
  await waitFor(() => expect(screen.getAllByTestId('schema-row').map((r) => r.textContent)).toEqual(['history1', 'main1']), WAIT)
  await user.click(screen.getAllByTestId('table-row').find((r) => r.textContent?.startsWith('stores'))!)
  // Both picks fold into chips, and the preview takes the full width.
  expect(screen.getByTestId('chip-schema')).toHaveTextContent('main')
  expect(screen.getByTestId('chip-table')).toHaveTextContent('stores')
  expect(screen.queryByTestId('pane-table')).not.toBeInTheDocument()
  await waitFor(() => expect(screen.getByTestId('preview-size')).toHaveTextContent('3 rows · 4 columns'), WAIT)
  expect(screen.getByTestId('preview-rows')).toHaveTextContent('Harbour Road')
  expect(screen.getByTestId('preview-columns')).toHaveTextContent('state_code')
})

test('the browser reopens on the schema this person last had open', async ({ admin }) => {
  await connect(admin, 'web-wh-place')
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/source/web-wh-place?database=sales&schema=history', admin)
  await screen.findByTestId('warehouse-browser', {}, WAIT)
  // A chosen schema is folded into a chip; the chip reopens the schema list.
  await waitFor(() => expect(screen.getByTestId('chip-schema')).toHaveTextContent('history'), WAIT)
  await renderApp('/featherbase/admin/source/web-wh-place', admin)
  await waitFor(() => expect(screen.getByTestId('chip-schema')).toHaveTextContent('history'), WAIT)
  await user.click(screen.getByTestId('chip-schema'))
  expect(screen.getAllByTestId('schema-row').find((r) => r.dataset.selected)?.textContent).toBe('history1')
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

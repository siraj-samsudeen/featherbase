// #1021: creating a view from a Table's list. The server rules are in
// apps/server/test/table-views.test.ts; this file proves what the person sees
// when a dialog in the Table administration menu has something to say.

import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import { tableSlug } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { holdResponses } from './held-requests'

type Admin = Parameters<typeof renderApp>[1]

async function seed(admin: Admin) {
  await admin.post('/api/table_def', {
    name: 'Vwd Site',
    columns: [
      { column_name: 'site_name', column_type: 'Data', label: 'Site name', in_list_view: true },
      { column_name: 'is_store', column_type: 'Check', label: 'Is store', in_list_view: true },
    ],
  })
  await admin.post('/api/table_def', { name: 'Vwd Taken', columns: [{ column_name: 'title', column_type: 'Data' }] })
}

test('a refused name is said in the dialog, which stays open when focus leaves it', async ({ admin }) => {
  await seed(admin)
  const filters = encodeURIComponent(JSON.stringify([['is_store', '=', 1]]))
  await renderApp(`/featherbase/admin/table/vwd-site?filters=${filters}`, admin)
  fireEvent.click(await screen.findByRole('button', { name: /Table administration/ }))
  fireEvent.click(await screen.findByTestId('save-as-view'))
  const name = await screen.findByTestId('save-as-view-name')
  // A busy button gives up focus, as does a click on the dialog's own words.
  fireEvent.focusOut(name, { relatedTarget: null })
  expect(screen.getByTestId('save-as-view-dialog')).toBeTruthy()
  fireEvent.change(name, { target: { value: 'Vwd Taken' } })
  fireEvent.click(screen.getByTestId('save-as-view-confirm'))
  await waitFor(() => expect(screen.getByTestId('save-as-view-error').textContent).toContain('already exists'))
  cleanup()
})

const T = { timeout: 10_000 }
const STORES = encodeURIComponent(JSON.stringify([['is_store', '=', 1]]))

async function openNewView(admin: Admin, filters = STORES) {
  await seed(admin)
  await renderApp(`/featherbase/admin/table/vwd-site?filters=${filters}`, admin)
  fireEvent.click(await screen.findByRole('button', { name: /Table administration/ }, T))
  fireEvent.click(await screen.findByTestId('save-as-view'))
  return screen.findByTestId('save-as-view-dialog')
}

test("Create view keeps the list's filter as a view and opens the view's list, saying what it shows", async ({ admin }) => {
  await openNewView(admin)
  fireEvent.change(screen.getByTestId('save-as-view-name'), { target: { value: 'Vwd Store' } })
  fireEvent.click(screen.getByTestId('save-as-view-confirm'))
  const banner = await screen.findByTestId('view-banner', {}, T)
  expect(within(banner).getByTestId('view-banner-base')).toHaveTextContent('Vwd Site')
  expect(within(banner).getByTestId('view-banner-filter')).toHaveTextContent(/^Is store is Yes$/)
})

test('a list filtered on something other than its own columns cannot become a view, and says why', async ({ admin }) => {
  const dialog = await openNewView(admin, encodeURIComponent(JSON.stringify([['site_name', 'is', 'set']])))
  expect(within(dialog).getByTestId('save-as-view-why')).toHaveTextContent('A view keeps plain filters on this Table’s own columns.')
  expect(within(dialog).queryByTestId('save-as-view-confirm')).not.toBeInTheDocument()
})

test('Cancel closes the new view dialog', async ({ admin }) => {
  await openNewView(admin)
  fireEvent.click(screen.getByTestId('save-as-view-cancel'))
  expect(screen.queryByTestId('save-as-view-dialog')).not.toBeInTheDocument()
})

test('Escape closes the new view dialog', async ({ admin }) => {
  await openNewView(admin)
  fireEvent.keyDown(screen.getByTestId('save-as-view-name'), { key: 'Escape' })
  expect(screen.queryByTestId('save-as-view-dialog')).not.toBeInTheDocument()
})

test('a click outside the new view dialog closes it', async ({ admin }) => {
  const dialog = await openNewView(admin)
  fireEvent.click(dialog.parentElement!)
  expect(screen.queryByTestId('save-as-view-dialog')).not.toBeInTheDocument()
})

test('a click outside the new view dialog while it creates the view keeps it open', async ({ admin }) => {
  const dialog = await openNewView(admin)
  fireEvent.change(screen.getByTestId('save-as-view-name'), { target: { value: 'Vwd Store' } })
  const creating = holdResponses('/api/table_def')
  fireEvent.click(screen.getByTestId('save-as-view-confirm'))
  await creating.asked
  fireEvent.click(dialog.parentElement!)
  expect(screen.getByTestId('save-as-view-dialog')).toBeInTheDocument()
  await act(async () => { creating.release() })
  expect(await screen.findByTestId('view-banner', {}, T)).toBeInTheDocument()
})

async function seedStores(admin: Admin) {
  await seed(admin)
  const store = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Vwd Site', row: { site_name: 'Canal Road', is_store: true } })
  await admin.post('/api/table_def', { name: 'Vwd Store', kind: 'view', view_of: 'Vwd Site', view_filters: [['is_store', '=', 1]] })
  return store.row_id
}

test("a view's row opens as its base's row", async ({ admin }) => {
  const id = await seedStores(admin)
  const app = await renderApp(`/featherbase/admin/table/vwd-store/row/${id}`, admin)
  await waitFor(() => expect((app.router.state as { location: { pathname: string } }).location.pathname).toBe(`/featherbase/admin/table/vwd-site/row/${id}`), T)
  expect(await screen.findByTestId('form-view', {}, T)).toBeInTheDocument()
})

test('a new row on a view is offered on its base instead', async ({ admin }) => {
  await seedStores(admin)
  await renderApp('/featherbase/admin/table/vwd-store/new', admin)
  const notice = await screen.findByTestId('view-new-row', {}, T)
  expect(notice).toHaveTextContent('Vwd Store is a view of Vwd Site and holds no rows of its own.')
  expect(within(notice).getByTestId('view-new-row-base')).toHaveAttribute('href', '/featherbase/admin/table/vwd-site/new')
})

test("a view's banner reads No, empty and lists in plain words", async ({ admin }) => {
  await seed(admin)
  await admin.post('/api/table_def', {
    name: 'Vwd Odd Sites',
    kind: 'view',
    view_of: 'Vwd Site',
    view_filters: [['is_store', '=', false], ['site_name', '!=', null], ['site_name', 'in', ['North', 'South']]],
  })
  await renderApp(`/featherbase/admin/table/${tableSlug('Vwd Odd Sites')}`, admin)
  const banner = await screen.findByTestId('view-banner', {}, T)
  expect(within(banner).getByTestId('view-banner-filter')).toHaveTextContent('Is store is No, Site name is not empty, Site name is one of North, South')
})

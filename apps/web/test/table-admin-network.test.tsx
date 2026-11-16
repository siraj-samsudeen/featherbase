// A Table's administration when the network drops: renaming, archiving,
// un-archiving and deleting the Table, and saving a filtered list as a view.
// Each says the raw "TypeError: Failed to fetch" a browser gives a lost
// request, where the rest of the Admin says in words that the action failed.
// One defect (#1117); the Table is left as it was.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tableSlug } from 'shared'
import { vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const DT = 'Tan Plant'
const T = { timeout: 10_000 }

async function openAdministration(admin: Admin, search = '') {
  await admin.post('/api/table_def', { name: DT, columns: [{ column_name: 'city', column_type: 'Data', label: 'City', in_list_view: true }] })
  await admin.post('/api/save_row', { table: DT, row: { city: 'Chennai' } })
  await renderApp(`/featherbase/admin/table/${tableSlug(DT)}${search}`, admin)
  await screen.findByTestId('list-view', {}, T)
  await userEvent.click(await screen.findByRole('button', { name: 'Table administration' }))
}

/** Every POST or DELETE to the Table definitions is lost, as offline. */
function dropTableWrites() {
  const bridge = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    (init?.method === 'POST' || init?.method === 'DELETE') &&
    String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).startsWith('/api/table_def')
      ? Promise.reject(new TypeError('Failed to fetch'))
      : bridge(input, init))
}

const inWords = (el: HTMLElement) => expect(el.textContent).not.toMatch(/TypeError/)

test('a rename the network drops says in words that it failed', async ({ admin }) => {
  await openAdministration(admin)
  await userEvent.click(await screen.findByTestId('rename-table', {}, T))
  const dialog = await screen.findByTestId('rename-table-dialog')
  await userEvent.clear(within(dialog).getByTestId('rename-table-input'))
  await userEvent.type(within(dialog).getByTestId('rename-table-input'), 'Tan Site')
  dropTableWrites()
  await userEvent.click(within(dialog).getByTestId('rename-table-confirm'))
  inWords(await within(dialog).findByTestId('rename-table-error'))
})

test('an archive the network drops says in words that it failed', async ({ admin }) => {
  await openAdministration(admin)
  await userEvent.click(await screen.findByTestId('archive-table', {}, T))
  const dialog = await screen.findByTestId('archive-table-dialog')
  await userEvent.type(within(dialog).getByTestId('archive-table-note'), 'Replaced')
  dropTableWrites()
  await userEvent.click(within(dialog).getByTestId('archive-table-confirm'))
  inWords(await within(dialog).findByTestId('archive-table-error'))
})

test('an un-archive the network drops says in words that it failed', async ({ admin }) => {
  await admin.post('/api/table_def', { name: DT, columns: [{ column_name: 'city', column_type: 'Data', label: 'City', in_list_view: true }] })
  await admin.post(`/api/table_def/${encodeURIComponent(DT)}/archive`, { note: 'old' })
  await renderApp(`/featherbase/admin/table/${tableSlug(DT)}`, admin)
  const banner = await screen.findByTestId('archived-banner', {}, T)
  dropTableWrites()
  await userEvent.click(within(banner).getByTestId('unarchive-table'))
  inWords(await within(banner).findByTestId('unarchive-table-error'))
})

test('deleting the Table when the network drops says in words that it failed', async ({ admin }) => {
  await openAdministration(admin)
  await userEvent.click(await screen.findByTestId('delete-table', {}, T))
  const dialog = await screen.findByTestId('delete-table-dialog')
  const confirm = within(dialog).getByTestId('delete-table-confirm')
  await waitFor(() => expect(confirm).toBeEnabled())
  dropTableWrites()
  await userEvent.click(confirm)
  inWords(await within(dialog).findByTestId('delete-table-error'))
})

test('a view the network drops says in words that it was not saved', async ({ admin }) => {
  const filters = encodeURIComponent(JSON.stringify([['city', '=', 'Chennai']]))
  await admin.post('/api/table_def', { name: DT, columns: [{ column_name: 'city', column_type: 'Data', label: 'City', in_list_view: true }] })
  await renderApp(`/featherbase/admin/table/${tableSlug(DT)}?filters=${filters}`, admin)
  await screen.findByTestId('list-view', {}, T)
  await userEvent.click(await screen.findByRole('button', { name: 'Table administration' }))
  await userEvent.click(await screen.findByTestId('save-as-view', {}, T))
  await userEvent.type(await screen.findByTestId('save-as-view-name'), 'Tan Chennai')
  dropTableWrites()
  await userEvent.click(screen.getByTestId('save-as-view-confirm'))
  inWords(await screen.findByTestId('save-as-view-error'))
})

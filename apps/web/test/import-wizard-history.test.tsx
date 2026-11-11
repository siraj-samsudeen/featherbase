// The import wizard's history strip deleting a run's added rows for good
// (#859), and its matching-column check when the network drops.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Sql } from 'postgres'
import { afterEach, vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'
import { clearSession } from '../src/lib/import-session'
import { holdResponses } from './held-requests'

type Admin = Parameters<typeof renderApp>[1]
const T = { timeout: 10_000 }

afterEach(() => {
  vi.unstubAllGlobals()
  clearSession()
})

async function importedShelves(admin: Admin) {
  clearSession()
  await admin.post('/api/table_def', { name: 'Iwh Shelf', id_pattern: 'prompt', columns: [{ column_name: 'title', column_type: 'Data' }] })
  await admin.post('/api/table/Iwh%20Shelf:import', {
    rows: [{ row_id: 'shelf-1', title: 'top' }, { row_id: 'shelf-2', title: 'bottom' }],
    context: { run_id: 'iwh-run', file_name: 'shelves.csv' },
  })
  await renderApp('/featherbase/admin/import?table=Iwh%20Shelf', admin)
  return within(await screen.findByTestId('iw-run-history', {}, T))
}

test('a reverted run, logged with no counts, says it was reverted and counts nothing', async ({ admin, db }) => {
  clearSession()
  await admin.post('/api/table_def', { name: 'Iwh Shelf', id_pattern: 'prompt', columns: [{ column_name: 'title', column_type: 'Data' }] })
  await admin.post('/api/table/Iwh%20Shelf:import', {
    rows: [{ row_id: 'shelf-1', title: 'top' }], context: { run_id: 'iwh-reverted', file_name: 'shelves.csv' },
  })
  await (db as Sql)`update import_log set inserted = null, updated = null, failed = null, reverted_at = now() where run_id = 'iwh-reverted'`
  await renderApp('/featherbase/admin/import?table=Iwh%20Shelf', admin)
  const history = await screen.findByTestId('iw-run-history', {}, T)
  await waitFor(() => expect(history).toHaveTextContent('shelves.csv — 0 processed matches · 0 added · 0 failed'), T)
  expect(within(history).getByText('reverted')).toBeInTheDocument()
})

test("Cancel on deleting a run's rows permanently keeps them", async ({ admin }) => {
  const history = await importedShelves(admin)
  await userEvent.click(await history.findByTestId('iw-run-purge-0', {}, T))
  await userEvent.click(within(await screen.findByTestId('purge-dialog')).getByTestId('purge-cancel'))
  expect(screen.queryByTestId('purge-dialog')).not.toBeInTheDocument()
  expect(await admin.get('/api/table/Iwh%20Shelf')).toMatchObject({ total: 2 })
})

test("a run's added rows deleted permanently from the history strip are marked gone", async ({ admin }) => {
  const user = userEvent.setup()
  const history = await importedShelves(admin)
  await user.click(await history.findByTestId('iw-run-purge-0', {}, T))
  const dialog = await screen.findByTestId('purge-dialog')
  await within(dialog).findByTestId('purge-summary', {}, T)
  await user.type(within(dialog).getByTestId('purge-reason'), 'Imported into the wrong Table')
  await user.type(within(dialog).getByTestId('purge-confirm-word'), 'DELETE')
  await user.click(within(dialog).getByTestId('purge-confirm'))
  expect(await history.findByTestId('iw-run-purged-0', {}, T)).toHaveTextContent('its added rows are gone')
  expect(screen.queryByTestId('purge-dialog')).not.toBeInTheDocument()
  expect(await admin.get('/api/table/Iwh%20Shelf')).toMatchObject({ total: 0 })
})

test('a choice changed while Import is still checking stops the import and asks for it again', async ({ admin }) => {
  clearSession()
  await admin.post('/api/table_def', { name: 'Iwh Zone', columns: [
    { column_name: 'zone_name', column_type: 'Data', label: 'Zone name' },
    { column_name: 'pop', column_type: 'Int' },
    { column_name: 'note', column_type: 'Data' },
  ] })
  await admin.post('/api/table/Iwh%20Zone:import', { rows: [{ zone_name: 'Z1', pop: 1 }] })
  await renderApp('/featherbase/admin/import?table=Iwh%20Zone', admin)
  const bytes = new TextEncoder().encode('zone_name,pop,note\nZ1,1,\nZ2,2,\n').buffer
  const file = new File([bytes], 'zones.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes })
  fireEvent.change(await screen.findByTestId('iw-file-input', {}, T), { target: { files: [file] } })
  await screen.findByTestId('iw-import', {}, T)
  await screen.findByTestId('iw-map-use-0-2', {}, T)
  const checking = holdResponses(':import')
  fireEvent.click(screen.getByTestId('iw-import'))
  await checking.asked
  fireEvent.click(screen.getByTestId('iw-map-use-0-2'))
  await act(async () => { checking.release() })
  expect(await screen.findByTestId('iw-error', {}, T)).toHaveTextContent('Import choices changed while checking. Import again to check the current choices.')
  expect(await admin.get('/api/table/Iwh%20Zone:count')).toEqual({ count: 1 })
})

test('matching columns that could not be checked say so, and Try again checks them', async ({ admin }) => {
  clearSession()
  await admin.post('/api/table_def', {
    name: 'Iwh Zone',
    columns: [{ column_name: 'zone_name', column_type: 'Data', label: 'Zone name', unique: true }],
  })
  await admin.post('/api/save_row', { table: 'Iwh Zone', row: { zone_name: 'A' } })
  // The network drops for the matching-column check until it comes back.
  let down = true
  const bridged = globalThis.fetch
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    down && String(input).includes('Iwh%20Zone:import') && String(init?.body).includes('analyze_keys')
      ? Promise.reject(new TypeError('Failed to fetch'))
      : bridged(input, init))
  await renderApp('/featherbase/admin/import', admin)
  const bytes = new TextEncoder().encode('zone_name\nA\nB\n').buffer
  const file = new File([bytes], 'zones.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes })
  fireEvent.change(await screen.findByTestId('iw-file-input', {}, T), { target: { files: [file] } })
  const notice = (await screen.findByText(/Could not check matching columns/, {}, T)).closest('div')!
  down = false
  await userEvent.click(within(notice).getByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(screen.queryByText(/Could not check matching columns/)).not.toBeInTheDocument(), T)
})

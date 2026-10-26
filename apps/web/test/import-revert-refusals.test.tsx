// Reverting an import run from the wizard's history strip: backing out of the
// preview, a revert that cannot take back a row another Table now points at
// (named with the reason), and a revert asked for after the Table went. Gaps
// the merged web coverage report (ADR 0012) showed; refusals are the server's.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'
import { clearSession } from '../src/lib/import-session'

type Admin = Parameters<typeof renderApp>[1]

async function importedShelf(admin: Admin) {
  clearSession()
  await admin.post('/api/table_def', { name: 'Iwv Shelf', id_pattern: 'prompt', columns: [{ column_name: 'title', column_type: 'Data' }] })
  await admin.post('/api/table/Iwv%20Shelf:import', {
    rows: [{ row_id: 'shelf-9', title: 'top' }, { row_id: 'shelf-10', title: 'bottom' }],
    context: { batch_id: 'iwv-batch', run_id: 'iwv-run', file_name: 'shelves.csv' },
  })
  await renderApp('/featherbase/admin/import?table=Iwv%20Shelf', admin)
  return within(await screen.findByTestId('iw-run-history', {}, { timeout: 8000 }))
}

test('the revert preview can be cancelled; a row another Table points at is not taken back, with the reason', async ({ admin }) => {
  const user = userEvent.setup()
  await admin.post('/api/table_def', { name: 'Iwv Bin', columns: [{ column_name: 'shelf', column_type: 'Reference', reference_table: 'Iwv Shelf' }] })
  const history = await importedShelf(admin)
  await admin.post('/api/save_row', { table: 'Iwv Bin', row: { shelf: 'shelf-9' } })

  await user.click(history.getByTestId('iw-revert-open-h0'))
  expect(await history.findByTestId('iw-revert-preview-h0')).toHaveTextContent('delete 2 added rows')
  await user.click(within(history.getByTestId('iw-revert-preview-h0')).getByRole('button', { name: 'Cancel' }))
  expect(history.queryByTestId('iw-revert-preview-h0')).not.toBeInTheDocument()

  await user.click(history.getByTestId('iw-revert-open-h0'))
  await user.click(await history.findByTestId('iw-revert-confirm-h0'))
  const result = await history.findByTestId('iw-revert-result-h0')
  expect(result).toHaveTextContent(/^Reverted: 0 restored, 1 deleted; failed shelf-9: .+/)
  expect(((await admin.get('/api/table/Iwv%20Shelf')) as { total: number }).total).toBe(1)
  clearSession()
})

test('a revert asked for after the Table was deleted is refused with the reason', async ({ admin }) => {
  const user = userEvent.setup()
  const history = await importedShelf(admin)
  await admin.delete('/api/table_def/Iwv%20Shelf')
  await user.click(history.getByTestId('iw-revert-open-h0'))
  await waitFor(() => expect(history.getByTestId('iw-revert-h0')).toHaveTextContent(/Table Iwv Shelf was deleted by Administrator on /))
  expect(history.queryByTestId('iw-revert-preview-h0')).not.toBeInTheDocument()
  clearSession()
})

// Reverting an import run from the wizard's history strip: backing out of the
// preview, a revert that cannot take back a row another Table now points at
// (named with the reason), and a revert asked for after the Table went. Gaps
// the merged web coverage report (ADR 0012) showed; refusals are the server's.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'
import { clearSession } from '../src/lib/import-session'
import { sql } from 'server/src/db'

type Admin = Parameters<typeof renderApp>[1]

test('history excludes pre-run-id logs without hiding a current revertable import', async ({ admin }) => {
  clearSession()
  await admin.post('/api/table_def', { name: 'Iwv Shelf', columns: [{ column_name: 'title', column_type: 'Data' }] })
  await admin.post('/api/table/Iwv%20Shelf:import', {
    rows: [{ title: 'old shelf' }], context: { run_id: 'legacy-run', file_name: 'legacy.csv' },
  })
  // Historical persisted state: before run identities existed, Import Log
  // entries had no run_id. The current API always supplies one.
  await sql`update import_log set run_id = null where ref_table = 'Iwv Shelf' and run_id = 'legacy-run'`
  await admin.post('/api/table/Iwv%20Shelf:import', {
    rows: [{ title: 'current shelf' }], context: { run_id: 'current-run', file_name: 'current.csv' },
  })
  await renderApp('/featherbase/admin/import?table=Iwv%20Shelf', admin)
  const history = await screen.findByTestId('iw-run-history')
  expect(history).toHaveTextContent('current.csv — 0 updated · 1 added · 0 failed')
  expect(history).not.toHaveTextContent('legacy.csv')
  const user = userEvent.setup()
  await user.click(within(history).getByTestId('iw-revert-open-h0'))
  expect(await within(history).findByTestId('iw-revert-preview-h0')).toHaveTextContent('delete 1 added rows')
  await user.click(within(history).getByRole('button', { name: 'Cancel' }))
  expect(await admin.get('/api/table/Iwv%20Shelf')).toMatchObject({ total: 2 })
  clearSession()
})

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
  const history = await importedShelf(admin)
  // A link needs its target Table to exist first (#511).
  await admin.post('/api/table_def', { name: 'Iwv Bin', columns: [{ column_name: 'shelf', column_type: 'Reference', reference_table: 'Iwv Shelf' }] })
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

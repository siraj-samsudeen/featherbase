import { screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'
import { clearSession } from '../src/lib/import-session'

// Spreadsheet import — "Rows with nothing to import are skipped, not guessed at":
// a file row with no value in any mapped column is counted and skipped, said
// before and after the import, and the counts still add up to the file's rows.

const DT = 'Iw Skip Target'

test('rows with nothing in any mapped column are counted and skipped, before and after the import', async ({ admin }) => {
  clearSession()
  await admin.post('/api/table_def', {
    name: DT,
    columns: [
      { column_name: 'sku', column_type: 'Data' },
      { column_name: 'qty', column_type: 'Int' },
    ],
  })
  await renderApp(`/featherbase/admin/import?table=${encodeURIComponent(DT)}`, admin)
  // `note` is in the file but not in the table, so nothing maps it; the
  // middle row carries a value only there.
  const csv = 'sku,qty,note\nA-1,1,first\n,,only a note\nB-2,2,last\n'
  const bytes = new TextEncoder().encode(csv).buffer
  const file = new File([bytes], 'stock.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes })
  fireEvent.change(await screen.findByTestId('iw-file-input'), { target: { files: [file] } })
  await screen.findByTestId('iw-target-0', undefined, { timeout: 8000 })

  const user = userEvent.setup()
  await user.click(await screen.findByTestId('iw-check'))
  const check = await screen.findByTestId('iw-check-0')
  await waitFor(() => expect(check).toHaveTextContent('All 2 rows are ready to import'))
  expect(screen.getByTestId('iw-check-skipped-0')).toHaveTextContent('1 rows have no data in the imported columns and will be skipped')

  await user.click(screen.getByTestId('iw-import'))
  // The finished import says the same.
  await waitFor(() => expect(screen.getByTestId('iw-result-0')).toHaveTextContent('1 rows had no data in the imported columns and were skipped'), { timeout: 8000 })
  await waitFor(async () => {
    const rows = await admin.get<{ total: number }>(`/api/table/${encodeURIComponent(DT)}`)
    expect(rows.total).toBe(2)
  })
  clearSession()
})

test('a file that is not a CSV or spreadsheet is refused with a message, and nothing is started', async ({ admin }) => {
  clearSession()
  await renderApp('/featherbase/admin/import', admin)
  const bytes = new TextEncoder().encode('just some words').buffer
  const file = new File([bytes], 'notes.txt', { type: 'text/plain' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes })
  fireEvent.change(await screen.findByTestId('iw-file-input'), { target: { files: [file] } })
  expect(await screen.findByTestId('iw-error', undefined, { timeout: 8000 })).toHaveTextContent('notes.txt: not a CSV or Excel file')
  expect(screen.queryByTestId('iw-target-0')).toBeNull()
  clearSession()
})

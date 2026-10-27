// Import wizard paths with more than one sheet that the merged web coverage
// report (ADR 0012) showed red: choosing separate Tables after looking at
// combining, the rule for a sheet that holds both of two columns being
// combined (and clearing the pick), and the saved-work banner counting what
// already landed when the rows themselves were not kept. Real server.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as XLSX from 'xlsx'
import { test, expect, renderApp } from './pg-test'
import { IMPORT_DATA_KEY, clearSession } from '../src/lib/import-session'

function uploadWorkbook(sheets: Record<string, unknown[][]>, name = 'book.xlsx') {
  const wb = XLSX.utils.book_new()
  for (const [sheet, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheet)
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const file = new File([buf], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => buf })
  return file
}

const BOOK = {
  'Both': [['Iws Code', 'Iws Name', 'Iws Zone'], ['STR-1', 'Anna Nagar', 'Fresh']],
  'By Name': [['Iws Name', 'Iws Zone'], ['T Nagar', 'Dairy']],
}

test('separate after merge, and a combine whose sheet holds both columns asks for a rule; Clear drops the pick', async ({ admin }) => {
  clearSession()
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/import', admin)
  fireEvent.change(await screen.findByTestId('iw-file-input', {}, { timeout: 8000 }), { target: { files: [uploadWorkbook(BOOK)] } })
  await user.click(await screen.findByTestId('iw-ov-master', {}, { timeout: 8000 }))
  await user.click(screen.getByTestId('iw-ov-mode-merge'))
  await user.click(screen.getByTestId('iw-ov-mode-separate'))
  expect(screen.getByTestId('iw-ov-mode-separate')).toBeChecked()
  await user.click(screen.getByTestId('iw-ov-mode-merge'))
  await user.type(screen.getByTestId('iw-ov-merge-name'), 'Iws Sections')
  await user.click(screen.getByTestId('iw-ov-continue'))

  await user.click(await screen.findByTestId('iw-combine-pick-0-0'))
  await user.click(screen.getByTestId('iw-combine-pick-0-1'))
  await screen.findByTestId('iw-combine-overlap-0')
  await user.click(screen.getByTestId('iw-combine-rule-join-0'))
  await user.click(screen.getByTestId('iw-combine-rule-first-0'))
  expect(screen.getByTestId('iw-combine-rule-first-0')).toBeChecked()
  await user.click(screen.getByRole('button', { name: 'Clear' }))
  expect(screen.queryByTestId('iw-combine-overlap-0')).not.toBeInTheDocument()
  expect(screen.getByTestId('iw-combine-pick-0-0')).not.toBeChecked()
  clearSession()
})

test('when the rows were not kept, the saved-work banner counts the Tables already imported', async ({ admin }) => {
  clearSession()
  const user = userEvent.setup()
  const first = await renderApp('/featherbase/admin/import', admin)
  fireEvent.change(await screen.findByTestId('iw-file-input', {}, { timeout: 8000 }), {
    target: { files: [uploadWorkbook({ 'Iws A': [['Iws Aisle'], ['1']], 'Iws B': [['Iws Bay'], ['2']] }, 'two.xlsx')] },
  })
  await user.click(await screen.findByTestId('iw-ov-master', {}, { timeout: 8000 }))
  await user.click(screen.getByTestId('iw-ov-continue'))
  await user.click(await screen.findByTestId('iw-import-one'))
  await screen.findByTestId('iw-import-one-done', {}, { timeout: 10_000 })
  first.unmount()

  // As if the workbook had been too large to keep: the decisions stay, the rows do not.
  sessionStorage.removeItem(IMPORT_DATA_KEY)
  await renderApp('/featherbase/admin/import', admin)
  await waitFor(() => expect(screen.getByTestId('iw-resume')).toHaveTextContent('Your work on two.xlsx is saved. 2 Tables planned, 1 already imported.'))
  clearSession()
})

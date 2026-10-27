// The import wizard must not lose work it has already done or been told
// about: a sheet that has landed can't be reached again through the sheet
// overview (#325), and a file that doesn't match saved work is held back and
// asked about rather than silently replacing it (#326). Real server.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as XLSX from 'xlsx'
import { test, expect, renderApp } from './pg-test'
import { IMPORT_DATA_KEY, clearSession } from '../src/lib/import-session'

function uploadWorkbook(sheets: Record<string, unknown[][]>, name: string) {
  const wb = XLSX.utils.book_new()
  for (const [sheet, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheet)
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const file = new File([buf], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => buf })
  return file
}

const TWO = { 'Ikw A': [['Ikw Aisle'], ['1']], 'Ikw B': [['Ikw Bay'], ['2']] }
const OTHER = { 'Ikw Zone': [['Ikw Zone Name'], ['North'], ['South']], 'Ikw Shelf': [['Ikw Shelf No'], ['7']] }

async function drop(file: File) {
  fireEvent.change(await screen.findByTestId('iw-file-input', {}, { timeout: 8000 }), { target: { files: [file] } })
}

test('the way back to the sheet overview closes once a Table has been imported (#325)', async ({ admin }) => {
  clearSession()
  const user = userEvent.setup()
  const first = await renderApp('/featherbase/admin/import', admin)
  await drop(uploadWorkbook(TWO, 'two.xlsx'))
  await user.click(await screen.findByTestId('iw-ov-master', {}, { timeout: 8000 }))
  await user.click(screen.getByTestId('iw-ov-continue'))

  // Nothing imported yet: the sheet choice can still change.
  expect(await screen.findByTestId('iw-back-to-overview')).toBeInTheDocument()
  expect(screen.queryByTestId('iw-sheets-fixed')).not.toBeInTheDocument()

  await user.click(screen.getByTestId('iw-import-one'))
  await screen.findByTestId('iw-import-one-done', {}, { timeout: 10_000 })

  // One landed, one to go: going back would reset the landed one to "not
  // imported", so the way back is gone and the stepper says why.
  expect(screen.queryByTestId('iw-back-to-overview')).not.toBeInTheDocument()
  expect(screen.getByTestId('iw-sheets-fixed')).toHaveTextContent('Sheets are fixed once a Table is imported.')
  expect(screen.getByTestId('iw-import')).toHaveTextContent('Import the remaining 1 Table')
  expect(screen.getByTestId('iw-import')).not.toHaveTextContent('1 Tables')
  // The stepper itself still works: it walked on to the Table still waiting,
  // and steps back to the one that landed.
  await waitFor(() => expect(screen.getByTestId('iw-step-of')).toHaveTextContent('Table 2 of 2'))
  await user.click(screen.getByTestId('iw-prev'))
  expect(screen.getByTestId('iw-step-of')).toHaveTextContent('Table 1 of 2')

  // And it stays closed after leaving and coming back.
  first.unmount()
  await renderApp('/featherbase/admin/import', admin)
  await screen.findByTestId('iw-sheets-fixed', {}, { timeout: 8000 })
  expect(screen.queryByTestId('iw-back-to-overview')).not.toBeInTheDocument()
  clearSession()
})

test('a different file dropped onto saved work is held back and asked about (#326)', async ({ admin }) => {
  clearSession()
  const user = userEvent.setup()
  const first = await renderApp('/featherbase/admin/import', admin)
  await drop(uploadWorkbook(TWO, 'two.xlsx'))
  await user.click(await screen.findByTestId('iw-ov-master', {}, { timeout: 8000 }))
  await user.click(screen.getByTestId('iw-ov-continue'))
  await user.click(await screen.findByTestId('iw-import-one'))
  await screen.findByTestId('iw-import-one-done', {}, { timeout: 10_000 })
  await waitFor(() => expect(screen.getByTestId('iw-step-of')).toHaveTextContent('Table 2 of 2'))
  first.unmount()

  // As if the workbook had been too large to keep: the decisions stay, the rows do not.
  sessionStorage.removeItem(IMPORT_DATA_KEY)
  await renderApp('/featherbase/admin/import', admin)
  await screen.findByTestId('iw-resume', {}, { timeout: 8000 })
  // The live region is there before anything goes into it, so the warning is read out.
  expect(document.querySelector('[aria-live="polite"]')).toBeInTheDocument()

  // A different file: the saved work is kept and the user is asked.
  await drop(uploadWorkbook(OTHER, 'other.xlsx'))
  const warning = await screen.findByTestId('iw-mismatch', {}, { timeout: 8000 })
  // Announced, not just painted.
  expect(within(warning).getByRole('status')).toBeInTheDocument()
  expect(warning).toHaveTextContent("other.xlsx isn't the file your saved work is for.")
  expect(warning).toHaveTextContent(
    "Your work on two.xlsx (2 Tables planned, 1 already imported) is still saved. This file's sheets, headings or row counts don't match it.",
  )
  expect(warning.parentElement).toHaveAttribute('aria-live', 'polite')
  expect(screen.getByTestId('iw-resume')).toHaveTextContent('Your work on two.xlsx is saved.')
  expect(screen.getByTestId('iw-file-name')).toHaveTextContent('Drop two.xlsx again to carry on')
  expect(screen.queryByTestId('iw-ov-master')).not.toBeInTheDocument()

  // Keeping the saved work closes the warning and keeps waiting for two.xlsx.
  await user.click(screen.getByTestId('iw-mismatch-keep'))
  expect(screen.queryByTestId('iw-mismatch')).not.toBeInTheDocument()
  expect(screen.getByTestId('iw-resume')).toBeInTheDocument()

  // A changed copy under the same name is called a copy, not "two.xlsx isn't two.xlsx".
  await drop(uploadWorkbook({ 'Ikw A': [['Ikw Aisle Renamed'], ['1']], 'Ikw B': [['Ikw Bay'], ['2']] }, 'two.xlsx'))
  expect(await screen.findByTestId('iw-mismatch', {}, { timeout: 8000 })).toHaveTextContent(
    "This copy of two.xlsx isn't the one your saved work is for.",
  )
  expect(screen.getByTestId('iw-mismatch-replace')).toHaveTextContent('Import this copy instead')
  await user.click(screen.getByTestId('iw-mismatch-keep'))

  // Dropping the right file while the warning is up resumes as before.
  await drop(uploadWorkbook(OTHER, 'other.xlsx'))
  await screen.findByTestId('iw-mismatch', {}, { timeout: 8000 })
  await drop(uploadWorkbook(TWO, 'two.xlsx'))
  await waitFor(() => expect(screen.queryByTestId('iw-resume')).not.toBeInTheDocument())
  expect(screen.queryByTestId('iw-mismatch')).not.toBeInTheDocument()
  expect(await screen.findByTestId('iw-step-of')).toHaveTextContent('Table 2 of 2')
  clearSession()
})

test('choosing to import the different file discards the saved work and opens it fresh (#326)', async ({ admin }) => {
  clearSession()
  const user = userEvent.setup()
  const first = await renderApp('/featherbase/admin/import', admin)
  await drop(uploadWorkbook(TWO, 'two.xlsx'))
  await user.click(await screen.findByTestId('iw-ov-master', {}, { timeout: 8000 }))
  await user.click(screen.getByTestId('iw-ov-continue'))
  await screen.findByTestId('iw-step-of')
  first.unmount()

  sessionStorage.removeItem(IMPORT_DATA_KEY)
  await renderApp('/featherbase/admin/import', admin)
  await screen.findByTestId('iw-resume', {}, { timeout: 8000 })

  await drop(uploadWorkbook(OTHER, 'other.xlsx'))
  const warning = await screen.findByTestId('iw-mismatch', {}, { timeout: 8000 })
  // Nothing landed, so nothing is said about it.
  expect(warning).toHaveTextContent('Your work on two.xlsx (2 Tables planned) is still saved.')
  expect(screen.getByTestId('iw-mismatch-replace')).toHaveTextContent('Import other.xlsx instead')
  await user.click(screen.getByTestId('iw-mismatch-replace'))

  expect(screen.queryByTestId('iw-mismatch')).not.toBeInTheDocument()
  expect(screen.queryByTestId('iw-resume')).not.toBeInTheDocument()
  expect(await screen.findByTestId('iw-file-name')).toHaveTextContent('other.xlsx — 2 sheets')
  expect(await screen.findByTestId('iw-ov-master')).not.toBeChecked()
  clearSession()
})

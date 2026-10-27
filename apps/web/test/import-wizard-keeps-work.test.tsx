// The import wizard must not lose work it has already done or been told
// about: a sheet that has landed can't be reached again through the sheet
// overview (#325). Real server.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as XLSX from 'xlsx'
import { test, expect, renderApp } from './pg-test'
import { clearSession } from '../src/lib/import-session'

function uploadWorkbook(sheets: Record<string, unknown[][]>, name: string) {
  const wb = XLSX.utils.book_new()
  for (const [sheet, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheet)
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const file = new File([buf], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => buf })
  return file
}

const TWO = { 'Ikw A': [['Ikw Aisle'], ['1']], 'Ikw B': [['Ikw Bay'], ['2']] }

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

// #115 / IMP-I1 in the wizard: the only row number a person ever sees is
// Excel's own. A blank row above a bad row must not shift the blame — before
// the fix the wizard named row 5 for a defect the person sees at row 6.
// The parse and server halves: parse-file.test.ts, server/test/import/invariants.test.ts.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as XLSX from 'xlsx'
import { test, expect, renderApp } from './pg-test'
import { clearSession } from '../src/lib/import-session'

const DT = 'Row Number Truth'

function workbook() {
  // Laid out so the numbers below are Excel's own.
  const truth = XLSX.utils.aoa_to_sheet([
    ['Truth SKU', 'Truth Count'], // row 1 — header
    ['a', 1], //                     row 2
    ['', ''], //                     row 3 — entirely blank
    ['b', 2], //                     row 4
    ['c', 3], //                     row 5
    ['d', 'abc'], //                 row 6 — 'abc' cannot land in Int
    ['e', 4], //                     row 7
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, truth, 'Truth')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const file = new File([buf], 'truth.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => buf })
  return file
}

test('#115: a blank row does not shift the blame — the check names the true Excel row', async ({ admin }) => {
  clearSession()
  await admin.post('/api/table_def', {
    name: DT,
    columns: [
      { column_name: 'truth_sku', label: 'Truth SKU', column_type: 'Data', in_list_view: true },
      { column_name: 'truth_count', label: 'Truth Count', column_type: 'Int', in_list_view: true },
    ],
  })
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/import', admin)
  fireEvent.change(await screen.findByTestId('iw-file-input', {}, { timeout: 8000 }), { target: { files: [workbook()] } })

  await waitFor(() => expect(screen.getByTestId('iw-target-0')).toHaveValue(DT), { timeout: 8000 })
  // The blank row is not data: 5 rows, not 6.
  expect(screen.getByTestId('import-wizard')).toHaveTextContent('5 rows')

  await user.click(screen.getByTestId('iw-check'))
  const check = await screen.findByTestId('iw-check-0', {}, { timeout: 8000 })
  expect(check).toHaveTextContent('4 rows ready')
  expect(check).toHaveTextContent('1 with problems')
  expect(check).toHaveTextContent('row 6:')
  expect(check).not.toHaveTextContent('row 5')

  // The preview flags the same row the message names; its neighbour is not
  // flagged, and the blank row 3 keeps its own numbered place.
  const row = (n: number) => screen.getByTestId(`iw-preview-row-0-${n}`)
  await waitFor(() => expect(row(6)).toHaveAttribute('data-failed', 'true'))
  expect(row(6)).toHaveTextContent('abc')
  expect(row(5)).not.toHaveAttribute('data-failed', 'true')
  expect(row(3)).toBeInTheDocument()
  expect(row(2)).toHaveTextContent('a')
  clearSession()
})

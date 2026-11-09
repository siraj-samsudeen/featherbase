// What the Import wizard calls a new Table when the file or sheet gives it no
// usable name: a file named only with digits, a merged group whose name was
// cleared, and a sheet sent back to New Table. Real server.
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as XLSX from 'xlsx'
import { test, expect, renderApp } from './pg-test'
import { clearSession } from '../src/lib/import-session'

function csvFile(csv: string, name: string) {
  const bytes = new TextEncoder().encode(csv).buffer
  const file = new File([bytes], name, { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes })
  return file
}

function workbook(sheets: Record<string, unknown[][]>, name = 'book.xlsx') {
  const wb = XLSX.utils.book_new()
  for (const [sheet, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheet)
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const file = new File([buf], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => buf })
  return file
}

async function drop(file: File) {
  fireEvent.change(await screen.findByTestId('iw-file-input'), { target: { files: [file] } })
}

test('a file named only with digits makes a Table called Imported Table', async ({ admin }) => {
  clearSession()
  await renderApp('/featherbase/admin/import', admin)
  await drop(csvFile('Iwn Title\nalpha\n', '2024.csv'))
  expect(await screen.findByTestId('iw-new-name-0', undefined, { timeout: 8000 })).toHaveValue('Imported Table')
  clearSession()
})

test('a sheet sent back to New Table from a digits-only file is called Imported Table', async ({ admin }) => {
  clearSession()
  const user = userEvent.setup()
  await admin.post('/api/table_def', { name: 'Iwn Stock', columns: [{ column_name: 'iwn_sku', column_type: 'Data' }] })
  await renderApp('/featherbase/admin/import', admin)
  await drop(csvFile('iwn_sku\nA-1\n', '2024.csv'))
  const target = await screen.findByTestId('iw-target-0', undefined, { timeout: 8000 })
  await user.click(target)
  await user.click(await screen.findByTestId('iw-target-opt-0-Iwn Stock'))
  await user.click(target)
  await user.click(screen.getByTestId('iw-target-new-0'))
  expect(await screen.findByTestId('iw-new-name-0')).toHaveValue('Imported Table')
  clearSession()
})

test("a workbook's sheet sent back to New Table is named for its sheet", async ({ admin }) => {
  clearSession()
  const user = userEvent.setup()
  await admin.post('/api/table_def', { name: 'Iwn Stock', columns: [{ column_name: 'iwn_sku', column_type: 'Data' }] })
  await renderApp('/featherbase/admin/import', admin)
  await drop(workbook({ 'Iwn Shelves': [['iwn_sku'], ['A-1']], Other: [['iwn_other'], ['x']] }))
  await user.click(await screen.findByTestId('iw-ov-sheet-0', undefined, { timeout: 8000 }))
  await user.click(screen.getByTestId('iw-ov-continue'))
  const target = await screen.findByTestId('iw-target-0')
  await user.click(target)
  await user.click(await screen.findByTestId('iw-target-opt-0-Iwn Stock'))
  await user.click(target)
  await user.click(screen.getByTestId('iw-target-new-0'))
  expect(await screen.findByTestId('iw-new-name-0')).toHaveValue('Iwn Shelves')
  clearSession()
})

test('sheets combined under a cleared name make one Table called Imported Table', async ({ admin }) => {
  clearSession()
  const user = userEvent.setup()
  await renderApp('/featherbase/admin/import', admin)
  await drop(workbook({ First: [['Iwn Zone'], ['A']], Second: [['Iwn Zone'], ['B']] }))
  await user.click(await screen.findByTestId('iw-ov-master', undefined, { timeout: 8000 }))
  await user.click(screen.getByTestId('iw-ov-mode-merge'))
  await user.clear(screen.getByTestId('iw-ov-merge-name'))
  await user.click(screen.getByTestId('iw-ov-continue'))
  expect(await screen.findByTestId('iw-new-name-0')).toHaveValue('Imported Table')
  clearSession()
})

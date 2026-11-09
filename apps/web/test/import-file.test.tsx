// IMP-006: drop a CSV or Excel file on the Table builder -> an inferred Table
// and its imported rows. Moved down from e2e/import-file.spec.ts (#1080): the
// real builder in jsdom, creating the Table through the in-process server.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as XLSX from 'xlsx'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const rows = () => [...document.querySelectorAll<HTMLElement>('[data-testid=dt-fields] tbody tr[data-columnrow]')]
const cell = (row: HTMLElement, f: string) => row.querySelector(`[data-rowfield=${f}]`) as HTMLInputElement
const here = (r: { router: unknown }) =>
  (r.router as { state: { location: { pathname: string } } }).state.location.pathname

function fileOf(bytes: ArrayBuffer, name: string, type: string) {
  const file = new File([bytes], name, { type })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes })
  return file
}

const CSV = [
  'Customer Name,Qty,Unit Price,Ship Date,Paid',
  'Alice,2,9.99,2026-01-15,yes',
  'Bob,5,12.5,2026-02-01,no',
  'Chandra,1,3.25,2026-02-10,yes',
].join('\n')

async function count(admin: Admin, table: string) {
  return (await admin.get<{ count: number }>(`/api/table/${encodeURIComponent(table)}:count`)).count
}

test('IMP-006: drop a CSV; inferred schema prefills the builder; create imports the rows', async ({ admin }) => {
  const user = userEvent.setup()
  const app = await renderApp('/featherbase/admin', admin)
  await user.click(await screen.findByTestId('new-table-link', {}, { timeout: 8000 }))
  const zone = await screen.findByTestId('dt-dropzone', {}, { timeout: 8000 })
  const csv = fileOf(new TextEncoder().encode(CSV).buffer as ArrayBuffer, 'import sales.csv', 'text/csv')
  fireEvent.drop(zone, { dataTransfer: { files: [csv] } })

  const name = await screen.findByTestId('dt-file-name', {}, { timeout: 8000 })
  expect(name).toHaveTextContent('import sales.csv')
  expect(name).toHaveTextContent('3 rows')
  expect(screen.getByTestId('dt-name')).toHaveValue('Import Sales')
  await waitFor(() => expect(rows()).toHaveLength(5))
  expect(rows().map((r) => [cell(r, 'column_name').value, cell(r, 'column_type').value])).toEqual([
    ['customer_name', 'Data'],
    ['qty', 'Int'],
    ['unit_price', 'Float'],
    ['ship_date', 'Date'],
    ['paid', 'Check'],
  ])
  expect(screen.getByTestId('dt-preview')).toHaveTextContent('Alice')

  await user.click(screen.getByTestId('dt-create'))
  await waitFor(() => expect(screen.getByTestId('list-rows')).toHaveTextContent('Chandra'), { timeout: 10_000 })
  expect(screen.getByTestId('list-rows')).toHaveTextContent('Alice')
  expect(here(app)).toMatch(/^\/featherbase\/admin\/table\/import-sales/)

  // The server's truth: inferred types persisted, rows really inserted.
  const meta = await admin.get<{ columns: { column_name: string; column_type: string }[] }>(
    `/api/table/${encodeURIComponent('Import Sales')}:meta`,
  )
  expect(Object.fromEntries(meta.columns.map((c) => [c.column_name, c.column_type]))).toMatchObject({
    customer_name: 'Data',
    qty: 'Int',
    unit_price: 'Float',
    ship_date: 'Date',
    paid: 'Check',
  })
  expect(await count(admin, 'Import Sales')).toBe(3)
})

test('IMP-006: a real .xlsx imports the same way (via the file picker)', async ({ admin }) => {
  const user = userEvent.setup()
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Item', 'On Hand', 'Reorder At'], ['Widget', 12, 5], ['Gadget', 3, 10]]), 'Stock')
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const app = await renderApp('/featherbase/admin/new-table', admin)
  fireEvent.change(await screen.findByTestId('dt-file-input', {}, { timeout: 8000 }), {
    target: { files: [fileOf(bytes, 'import inventory.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')] },
  })

  await waitFor(() => expect(screen.getByTestId('dt-name')).toHaveValue('Import Inventory'), { timeout: 8000 })
  await waitFor(() => expect(rows()).toHaveLength(3))
  expect(cell(rows()[0], 'column_name')).toHaveValue('item')
  expect(cell(rows()[1], 'column_type')).toHaveValue('Int')

  await user.click(screen.getByTestId('dt-create'))
  await waitFor(() => expect(screen.getByTestId('list-rows')).toHaveTextContent('Gadget'), { timeout: 10_000 })
  expect(screen.getByTestId('list-rows')).toHaveTextContent('Widget')
  expect(here(app)).toMatch(/^\/featherbase\/admin\/table\/import-inventory/)
  expect(await count(admin, 'Import Inventory')).toBe(2)
})

test('IMP-006: a non-tabular file is refused with a message', async ({ admin }) => {
  await renderApp('/featherbase/admin/new-table', admin)
  fireEvent.change(await screen.findByTestId('dt-file-input', {}, { timeout: 8000 }), {
    target: { files: [fileOf(new TextEncoder().encode('hello').buffer as ArrayBuffer, 'notes.txt', 'text/plain')] },
  })
  expect(await screen.findByTestId('dt-error', {}, { timeout: 8000 })).toHaveTextContent('not a CSV or Excel file')
})

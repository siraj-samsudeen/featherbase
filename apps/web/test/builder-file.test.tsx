// The Table builder built from a file, at its edges: a drop or a file picker
// that brings no file, a file named only with digits, a column the file makes
// a Choice, a long file's preview, a cleared label, a module left blank, a
// Sub-table column, rows the import refuses or skips, and a create the
// network drops; and the cards view a person last chose. The Table and its
// rows land on the real server.
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const gridRows = () => [...document.querySelectorAll<HTMLTableRowElement>('[data-testid=dt-fields] [data-columnrow]')]
const cell = (row: HTMLElement, field: string) => row.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-rowfield=${field}]`)!
const rowFor = (name: string) => gridRows().find((r) => cell(r, 'column_name').value === name)!

async function openBuilder(admin: Admin) {
  await renderApp('/featherbase/admin/new-table', admin)
  return screen.findByTestId('table-builder', {}, { timeout: 8000 })
}

function csv(text: string, name: string) {
  const bytes = new TextEncoder().encode(text).buffer
  const file = new File([bytes], name, { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes })
  return file
}

async function drop(file: File) {
  fireEvent.change(screen.getByTestId('dt-file-input'), { target: { files: [file] } })
  await screen.findByTestId('dt-file-name', {}, { timeout: 8000 })
}

test('a drop that carries no file leaves the builder waiting for one', async ({ admin }) => {
  await openBuilder(admin)
  fireEvent.drop(screen.getByTestId('dt-dropzone'), { dataTransfer: { files: [] } })
  expect(screen.getByTestId('dt-dropzone')).toHaveTextContent(/Drag & drop a CSV or Excel file here/)
})

test('closing the file picker without a file leaves the builder waiting for one', async ({ admin }) => {
  await openBuilder(admin)
  fireEvent.change(screen.getByTestId('dt-file-input'), { target: { files: [] } })
  expect(screen.queryByTestId('dt-file-name')).not.toBeInTheDocument()
})

test('a file named only with digits names the Table Imported Table', async ({ admin }) => {
  await openBuilder(admin)
  await drop(csv('Tbf Title\nalpha\n', '2024.csv'))
  expect(screen.getByTestId('dt-name')).toHaveValue('Imported Table')
})

test("a column the file shows to be a Choice carries its options into the grid", async ({ admin }) => {
  await openBuilder(admin)
  const rows = Array.from({ length: 12 }, (_, i) => `item ${i},${i % 2 ? 'Open' : 'Closed'}`)
  await drop(csv(['tbf_item,tbf_stage', ...rows].join('\n'), 'tickets.csv'))
  expect(cell(rowFor('tbf_stage'), 'column_type')).toHaveValue('Choice')
  expect(cell(rowFor('tbf_stage'), 'target')).toHaveValue('Closed, Open')
})

test("a long file's preview says how many of its rows it shows", async ({ admin }) => {
  await openBuilder(admin)
  await drop(csv(['tbf_n', ...Array.from({ length: 30 }, (_, i) => `n${i}`)].join('\n'), 'long.csv'))
  expect(screen.getByText(/^Data preview/)).toHaveTextContent(/\(first \d+ of 30 rows\)/)
})

test('a column whose label is cleared is headed by its name in the preview', async ({ admin }) => {
  await openBuilder(admin)
  await drop(csv('Tbf Title\nalpha\n', 'titles.csv'))
  fireEvent.change(cell(rowFor('tbf_title'), 'label'), { target: { value: '' } })
  expect(within(screen.getByTestId('dt-preview')).getByRole('columnheader', { name: 'tbf_title' })).toBeInTheDocument()
})

test('a Table made with its module left blank goes in Custom', async ({ admin }) => {
  const user = userEvent.setup()
  await openBuilder(admin)
  await user.type(screen.getByTestId('dt-name'), 'Tbf Moduleless')
  await user.clear(screen.getByTestId('dt-module'))
  await user.type(cell(gridRows()[0], 'label'), 'Note')
  await user.click(screen.getByTestId('dt-create'))
  await screen.findByTestId('list-view', undefined, { timeout: 10_000 })
  const meta = await admin.get<{ module: string }>(`/api/table/${encodeURIComponent('Tbf Moduleless')}:meta`)
  expect(meta.module).toBe('Custom')
})

test('a Sub-table column holds the rows of the Table it names', async ({ admin }) => {
  const user = userEvent.setup()
  await admin.post('/api/table_def', { name: 'Tbf Line', kind: 'sub_table', columns: [{ column_name: 'item', column_type: 'Data' }] })
  await openBuilder(admin)
  await user.type(screen.getByTestId('dt-name'), 'Tbf Order')
  await user.type(cell(gridRows()[0], 'label'), 'Lines')
  fireEvent.change(cell(gridRows()[0], 'column_type'), { target: { value: 'Sub-table' } })
  await user.type(cell(gridRows()[0], 'target'), 'Tbf Line')
  await user.click(screen.getByTestId('dt-create'))
  await screen.findByTestId('list-view', undefined, { timeout: 10_000 })
  const meta = await admin.get<{ columns: { column_name: string; row_table: string | null }[] }>(`/api/table/${encodeURIComponent('Tbf Order')}:meta`)
  expect(meta.columns.find((c) => c.column_name === 'lines')?.row_table).toBe('Tbf Line')
})

test('rows the import refuses are named three at a time, and blank rows are counted as skipped', async ({ admin }) => {
  const user = userEvent.setup()
  await openBuilder(admin)
  await drop(csv('tbf_code,tbf_note,tbf_extra\nA,,\nB,,\nC,,\nD,,\nE,six,\n,,left out\n', 'codes.csv'))
  // Left out of the Table: its row has nothing in the columns imported.
  const extra = rowFor('tbf_extra')
  fireEvent.change(cell(extra, 'label'), { target: { value: '' } })
  fireEvent.change(cell(extra, 'column_name'), { target: { value: '' } })
  await user.clear(screen.getByTestId('dt-name'))
  await user.type(screen.getByTestId('dt-name'), 'Tbf Codes')
  await user.click(cell(rowFor('tbf_note'), 'reqd'))
  await user.click(screen.getByTestId('dt-create'))
  const error = await screen.findByTestId('dt-error', {}, { timeout: 10_000 })
  expect(error).toHaveTextContent('Table created; 1 of 5 rows imported.')
  expect(error).toHaveTextContent(/ and 1 more/)
  expect(error).toHaveTextContent('1 row had no data in the imported columns and was skipped.')
})

test('more than one blank row is counted in the plural', async ({ admin }) => {
  const user = userEvent.setup()
  await openBuilder(admin)
  await drop(csv('tbf_code,tbf_note,tbf_extra\nA,,\n,,left out\n,,also left out\n', 'codes.csv'))
  const extra = rowFor('tbf_extra')
  fireEvent.change(cell(extra, 'label'), { target: { value: '' } })
  fireEvent.change(cell(extra, 'column_name'), { target: { value: '' } })
  await user.clear(screen.getByTestId('dt-name'))
  await user.type(screen.getByTestId('dt-name'), 'Tbf Blanks')
  await user.click(cell(rowFor('tbf_note'), 'reqd'))
  await user.click(screen.getByTestId('dt-create'))
  const error = await screen.findByTestId('dt-error', {}, { timeout: 10_000 })
  expect(error).toHaveTextContent('2 rows had no data in the imported columns and were skipped.')
})

test('a create the network drops says the create failed', async ({ admin }) => {
  const user = userEvent.setup()
  await openBuilder(admin)
  await user.type(screen.getByTestId('dt-name'), 'Tbf Lost')
  await user.type(cell(gridRows()[0], 'label'), 'Note')
  const bridge = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url) === '/api/table_def'
      ? Promise.reject(new TypeError('Failed to fetch'))
      : bridge(input, init))
  await user.click(screen.getByTestId('dt-create'))
  expect(await screen.findByTestId('dt-error')).toHaveTextContent('Create failed')
})

test('the builder opens in the cards view a person last chose', async ({ admin }) => {
  localStorage.setItem('fc-table-builder-view', 'cards')
  try {
    await openBuilder(admin)
    expect(screen.getByTestId('dt-view-cards')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('dt-view-grid')).toHaveAttribute('aria-pressed', 'false')
  } finally {
    localStorage.removeItem('fc-table-builder-view')
  }
})

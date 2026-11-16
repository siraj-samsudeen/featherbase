// IMP-010/IMP-013: the import wizard over a workbook of several sheets — one
// sheet to a new Table, one recognised by its columns as an existing Table
// despite a meaningless sheet name, a check before anything is written, a
// sheet left out, a column dropped, and the list's own Import button.
// Moved from the Playwright import-wizard spec (#1080); real wizard, real
// in-process server, rolled-back database.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as XLSX from 'xlsx'
import { tableSlug } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { clearSession } from '../src/lib/import-session'

type Admin = Parameters<typeof renderApp>[1]
const NEW_DT = 'Wizard Orders'
const EXISTING_DT = 'Wizard Stock'
const WAIT = { timeout: 8000 }
const LONG = { timeout: 20_000 }
const enc = encodeURIComponent
const pathOf = (r: { router: unknown }) => (r.router as { state: { location: { pathname: string } } }).state.location.pathname

function workbook(name: string, sheets: Record<string, unknown[][]>): File {
  const wb = XLSX.utils.book_new()
  for (const [sheet, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheet)
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const file = new File([buf], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => buf })
  return file
}

function csv(name: string, text: string): File {
  const bytes = new TextEncoder().encode(text).buffer
  const file = new File([bytes], name, { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes })
  return file
}

// Sheet 1's headers match no Table, and Status repeats enough to be a Choice.
// Sheet 2 matches Wizard Stock by its columns, under a junk name, with one
// row whose Int column holds text.
const BOOK = {
  Orders: [
    ['Wizard Ref', 'Wizard Amount', 'Status'],
    ['A-1', 10.5, 'Open'], ['A-2', 20, 'Closed'], ['A-3', 12, 'Open'],
    ['A-4', 7.25, 'Closed'], ['A-5', 99, 'Open'], ['A-6', 1, 'Closed'],
  ],
  'export-final-v2 (3)': [
    ['Wizard SKU', 'Bin Count', 'Restock Level'],
    ['Widget', 12, 5], ['Gadget', 'many', 10], ['Sprocket', 7, 2],
  ],
}

async function makeStock(admin: Admin) {
  await admin.post('/api/table_def', {
    name: EXISTING_DT,
    columns: [
      { column_name: 'wizard_sku', label: 'Wizard SKU', column_type: 'Data', in_list_view: true },
      { column_name: 'bin_count', label: 'Bin Count', column_type: 'Int', in_list_view: true },
      { column_name: 'restock_level', label: 'Restock Level', column_type: 'Int' },
    ],
  })
}

const countOf = async (admin: Admin, table: string) => (await admin.get<{ count: number }>(`/api/table/${enc(table)}:count`)).count
const grid = () => [...within(screen.getByTestId('iw-new-grid-0')).getAllByRole('row')].filter((r) => r.hasAttribute('data-columnrow'))
const cell = (row: HTMLElement, field: string) => row.querySelector<HTMLInputElement>(`[data-rowfield=${field}]`)!

async function openOnBook(admin: Admin, file: File) {
  clearSession()
  const r = await renderApp('/featherbase/admin', admin)
  await userEvent.click(await screen.findByTestId('import-data-link', {}, WAIT))
  expect(await screen.findByTestId('import-wizard', {}, WAIT)).toBeInTheDocument()
  fireEvent.change(screen.getByTestId('iw-file-input'), { target: { files: [file] } })
  await screen.findByTestId('iw-overview', {}, WAIT)
  return r
}

async function bothSheets(admin: Admin) {
  await openOnBook(admin, workbook('q3 numbers FINAL.xlsx', BOOK))
  await userEvent.click(screen.getByTestId('iw-ov-master'))
  await userEvent.click(screen.getByTestId('iw-ov-continue'))
  await screen.findByTestId('iw-target-0')
}

test('IMP-010: a two-sheet workbook opens on the overview with nothing selected', async ({ admin }) => {
  await openOnBook(admin, workbook('q3 numbers FINAL.xlsx', BOOK))
  expect(screen.getByTestId('iw-file-name')).toHaveTextContent('2 sheets')
  expect(screen.getByTestId('iw-ov-count').textContent).toBe('0 of 2 sheets selected')
  clearSession()
})

test('IMP-010: a sheet matching no Table becomes a new Table named for it, its repeating column a Choice', async ({ admin }) => {
  await makeStock(admin)
  await bothSheets(admin)
  expect(screen.getByTestId('iw-target-0')).toHaveValue('New Table…')
  expect(screen.getByTestId('iw-new-name-0')).toHaveValue('Orders')
  // NAM-002: the locked Row ID row heads the grid.
  expect(within(screen.getByTestId('iw-new-grid-0')).getAllByRole('row').find((r) => r.closest('tbody'))).toHaveAttribute('data-testid', 'iw-row-id-0')
  const status = grid()[2]
  expect(cell(status, 'column_type')).toHaveValue('Choice')
  expect(cell(status, 'label')).toHaveValue('Status')
  expect(cell(status, 'column_name')).toHaveValue('status')
  expect(status).toHaveTextContent('Closed, Open')
  clearSession()
})

test('IMP-010: the next step finds the existing Table by its columns, and says so', async ({ admin }) => {
  await makeStock(admin)
  await bothSheets(admin)
  expect(screen.getByTestId('iw-step-of')).toHaveTextContent('Table 1 of 2')
  expect(screen.queryByTestId('iw-sheet-1')).not.toBeInTheDocument()
  await userEvent.click(screen.getByTestId('iw-next'))
  expect(await screen.findByTestId('iw-step-of')).toHaveTextContent('Table 2 of 2')
  expect(screen.queryByTestId('iw-sheet-0')).not.toBeInTheDocument()
  expect(screen.getByTestId('iw-target-1')).toHaveValue(EXISTING_DT)
  expect(screen.getByTestId('iw-auto-matched-1')).toHaveTextContent(EXISTING_DT)
  expect(screen.getByTestId('iw-mapped-count-1')).toHaveTextContent('3 of 3')
  clearSession()
})

test('IMP-010: Check finds the bad row before anything is written', async ({ admin }) => {
  await makeStock(admin)
  await bothSheets(admin)
  await userEvent.click(screen.getByTestId('iw-next'))
  await screen.findByTestId('iw-target-1')
  await userEvent.click(screen.getByTestId('iw-check'))
  const check = await screen.findByTestId('iw-check-1', {}, WAIT)
  await waitFor(() => expect(check).toHaveTextContent('2 rows ready, 1 with problems'))
  expect(check).toHaveTextContent('row 3')
  expect(await countOf(admin, EXISTING_DT)).toBe(0)
  clearSession()
})

test('IMP-010: importing lands both sheets, skips the bad row, and logs each sheet', async ({ admin }) => {
  await makeStock(admin)
  await bothSheets(admin)
  await userEvent.clear(screen.getByTestId('iw-new-name-0'))
  await userEvent.type(screen.getByTestId('iw-new-name-0'), NEW_DT)
  await userEvent.click(screen.getByTestId('iw-next'))
  await screen.findByTestId('iw-target-1')
  await userEvent.click(screen.getByTestId('iw-import'))
  await screen.findByTestId('iw-done', {}, LONG)
  await waitFor(() => expect(screen.getByTestId('iw-result-0')).toHaveTextContent(`Imported 6 rows into ${NEW_DT}`), LONG)
  await waitFor(() => expect(screen.getByTestId('iw-result-1')).toHaveTextContent(`Imported 2 rows into ${EXISTING_DT}`), LONG)
  expect(screen.getByTestId('iw-history-link')).toBeInTheDocument()

  expect(await countOf(admin, NEW_DT)).toBe(6)
  expect(await countOf(admin, EXISTING_DT)).toBe(2)
  const log = (await admin.get<{ data: Record<string, unknown>[] }>(
    `/api/table/${enc('Import Log')}?fields=${enc('["ref_table","sheet_name","table_created","inserted","failed"]')}&filters=${enc(JSON.stringify([['file_name', '=', 'q3 numbers FINAL.xlsx']]))}`,
  )).data
  const byTable = Object.fromEntries(log.map((r) => [r.ref_table as string, r]))
  expect(byTable[NEW_DT]).toMatchObject({ sheet_name: 'Orders', table_created: true })
  expect(Number(byTable[NEW_DT].inserted)).toBe(6)
  expect(byTable[EXISTING_DT]).toMatchObject({ sheet_name: 'export-final-v2 (3)' })
  expect(Number(byTable[EXISTING_DT].inserted)).toBe(2)
  expect(Number(byTable[EXISTING_DT].failed)).toBe(1)
  const meta = await admin.get<{ columns: { column_name: string; column_type: string; choices: string | null }[] }>(`/api/table/${enc(NEW_DT)}:meta`)
  expect(meta.columns.find((c) => c.column_name === 'status')).toMatchObject({ column_type: 'Choice', choices: 'Closed\nOpen' })
  clearSession()
}, 40_000)

const PICK_BOOK = {
  'Wizard Keep': [['Pick A', 'Pick B', 'Pick C'], ['a1', 'b1', 'c1'], ['a2', 'b2', 'c2']],
  'Wizard Drop': [['Drop Only'], ['never imported']],
}

test('IMP-013: a sheet not chosen on the overview is left out, and the tally says so', async ({ admin }) => {
  await openOnBook(admin, workbook('pick and skip.xlsx', PICK_BOOK))
  await userEvent.click(screen.getByTestId('iw-ov-sheet-0'))
  expect(screen.getByTestId('iw-ov-tally')).toHaveTextContent('1 left out')
  await userEvent.click(screen.getByTestId('iw-ov-continue'))
  await screen.findByTestId('iw-target-0')
  expect(screen.queryByTestId('iw-sheet-1')).not.toBeInTheDocument()
  clearSession()
})

test('IMP-013: searching the target picker for nothing still offers New Table…', async ({ admin }) => {
  await openOnBook(admin, workbook('pick and skip.xlsx', PICK_BOOK))
  await userEvent.click(screen.getByTestId('iw-ov-sheet-0'))
  await userEvent.click(screen.getByTestId('iw-ov-continue'))
  await userEvent.click(await screen.findByTestId('iw-target-0'))
  await userEvent.type(screen.getByTestId('iw-target-search-0'), 'zzzznope')
  expect(screen.getByTestId('iw-target-new-0')).toBeInTheDocument()
  clearSession()
})

test('IMP-013: a column left out is not created, and only the chosen sheet\'s rows land, on its list', async ({ admin }) => {
  const r = await openOnBook(admin, workbook('pick and skip.xlsx', PICK_BOOK))
  await userEvent.click(screen.getByTestId('iw-ov-sheet-0'))
  await userEvent.click(screen.getByTestId('iw-ov-continue'))
  await screen.findByTestId('iw-target-0')
  await userEvent.click(cell(grid()[1], 'include'))
  expect(screen.getByTestId('iw-import')).toHaveTextContent('Import 2 rows')
  await userEvent.click(screen.getByTestId('iw-import'))
  // A single active sheet lands on the new Table's list.
  await waitFor(() => expect(pathOf(r)).toBe(`/featherbase/admin/table/${tableSlug('Wizard Keep')}`), LONG)
  expect(await countOf(admin, 'Wizard Keep')).toBe(2)
  const names = (await admin.get<{ columns: { column_name: string }[] }>(`/api/table/${enc('Wizard Keep')}:meta`)).columns.map((c) => c.column_name)
  expect(names).toEqual(expect.arrayContaining(['pick_a', 'pick_c']))
  expect(names).not.toContain('pick_b')
  const dropped = await admin.fetch(`/api/table/${enc('Wizard Drop')}:meta`)
  expect(dropped.status).toBe(404)
  clearSession()
}, 30_000)

test('IMP-010: the list\'s Import button opens the wizard with that Table as the target', async ({ admin }) => {
  await makeStock(admin)
  await admin.post('/api/save_row', { table: EXISTING_DT, row: { wizard_sku: 'Held', bin_count: 1, restock_level: 1 } })
  clearSession()
  const r = await renderApp(`/featherbase/admin/table/${tableSlug(EXISTING_DT)}`, admin)
  await userEvent.click(await screen.findByRole('button', { name: 'List actions' }, WAIT))
  await userEvent.click(await screen.findByTestId('open-import'))
  expect(await screen.findByTestId('import-wizard', {}, WAIT)).toBeInTheDocument()
  fireEvent.change(screen.getByTestId('iw-file-input'), { target: { files: [csv('anything at all.csv', 'Wizard SKU,Bin Count,Restock Level\nCog-1,4,1')] } })
  await waitFor(() => expect(screen.getByTestId('iw-target-0')).toHaveValue(EXISTING_DT), WAIT)
  // The peek opens the target's list in a new tab, beside its current count.
  const peek = screen.getByTestId('iw-view-target-0')
  expect(peek).toHaveAttribute('href', `/featherbase/admin/table/${tableSlug(EXISTING_DT)}`)
  expect(peek).toHaveAttribute('target', '_blank')
  await waitFor(() => expect(screen.getByTestId('iw-target-count-0')).toHaveTextContent('holds 1 rows now'))

  // IMP-013: skipping a mapped column is a checkbox.
  await userEvent.click(screen.getByTestId('iw-map-use-0-2'))
  expect(screen.getByTestId('iw-mapped-count-0')).toHaveTextContent('2 of 3')
  await userEvent.click(screen.getByTestId('iw-import'))
  await waitFor(() => expect(pathOf(r)).toBe(`/featherbase/admin/table/${tableSlug(EXISTING_DT)}`), LONG)
  await waitFor(() => expect(screen.getByTestId('list-rows')).toHaveTextContent('Cog-1'), WAIT)

  expect(await countOf(admin, EXISTING_DT)).toBe(2)
  const rows = (await admin.get<{ data: { restock_level: unknown }[] }>(
    `/api/table/${enc(EXISTING_DT)}?fields=${enc('["wizard_sku","restock_level"]')}&filters=${enc(JSON.stringify([['wizard_sku', '=', 'Cog-1']]))}`,
  )).data
  expect(rows).toHaveLength(1)
  expect(rows[0].restock_level).toBeNull()
  clearSession()
}, 30_000)

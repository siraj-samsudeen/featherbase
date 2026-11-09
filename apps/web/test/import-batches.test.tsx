// #206/#207 (issue #197): the Tables one import created are one thing the
// person did — listed together under Past imports and deleted together.
// Moved from the Playwright import-batches spec (#1080): the workbook goes
// through the real wizard into the in-process server. The batch API itself
// is apps/server/test/import/batches.test.ts's; refusals are
// import-batches-refusal.test.tsx's.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as XLSX from 'xlsx'
import { test, expect, renderApp } from './pg-test'
import { clearSession } from '../src/lib/import-session'

type Admin = Parameters<typeof renderApp>[1]
const ONE = 'Batch Sheet One'
const TWO = 'Batch Sheet Two'
const THREE = 'Batch Sheet Three'
const EXISTING = 'Batch Preexisting Table'
const WAIT = { timeout: 8000 }
const LONG = { timeout: 20_000 }

function workbook(name: string): File {
  const wb = XLSX.utils.book_new()
  for (const [sheet, header] of [['Alpha', 'Bch Alpha'], ['Beta', 'Bch Beta'], ['Gamma', 'Bch Gamma']] as const)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[header, 'Bch Note'], ['a', 'x'], ['b', 'y']]), sheet)
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const file = new File([buf], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => buf })
  return file
}

async function openWizard(admin: Admin, file: File) {
  clearSession()
  await renderApp('/featherbase/admin', admin)
  await userEvent.click(await screen.findByTestId('import-data-link', {}, WAIT))
  fireEvent.change(await screen.findByTestId('iw-file-input', {}, WAIT), { target: { files: [file] } })
  await screen.findByTestId('iw-overview', {}, WAIT)
}

async function rename(index: number, name: string) {
  const box = await screen.findByTestId(`iw-new-name-${index}`)
  await userEvent.clear(box)
  await userEvent.type(box, name)
}

async function importAll() {
  await userEvent.click(screen.getByTestId('iw-import'))
  await waitFor(() => expect(screen.getByTestId('iw-done')).toHaveTextContent('Import complete.'), LONG)
}

const firstBatch = () => screen.getAllByTestId(/^ib-batch-/)[0]
const tableNames = async (admin: Admin) =>
  (await admin.get<{ data: { row_id: string }[] }>('/api/table/Table?limit_page_length=500')).data.map((t) => t.row_id)

async function threeTablesImported(admin: Admin) {
  await openWizard(admin, workbook('batch fixture.xlsx'))
  await userEvent.click(screen.getByTestId('iw-ov-master'))
  await userEvent.click(screen.getByTestId('iw-ov-continue'))
  await rename(0, ONE)
  await userEvent.click(screen.getByTestId('iw-next'))
  await rename(1, TWO)
  await userEvent.click(screen.getByTestId('iw-next'))
  await rename(2, THREE)
  await importAll()
  await userEvent.click(screen.getByTestId('iw-batches-link'))
  await screen.findByTestId('import-batches', {}, WAIT)
  await waitFor(() => expect(firstBatch()).toHaveTextContent('batch fixture.xlsx'), WAIT)
}

test('three sheets imported as three Tables are one entry under Past imports', async ({ admin }) => {
  await threeTablesImported(admin)
  const card = firstBatch()
  for (const name of [ONE, TWO, THREE]) {
    expect(within(card).getByTestId(`ib-target-${name}`)).toBeInTheDocument()
    expect(within(card).getByTestId(`ib-created-${name}`)).toBeInTheDocument()
  }
  expect(card).toHaveTextContent('6 rows added')
  clearSession()
}, 60_000)

test('one action deletes the three Tables an import created, naming them first', async ({ admin }) => {
  await threeTablesImported(admin)
  const card = firstBatch()
  const del = within(card).getByTestId(/^ib-delete-/)
  expect(del).toHaveTextContent('Delete the 3 Tables this import created')
  await userEvent.click(del)
  expect(within(card).getAllByTestId(/^ib-confirm-/)[0]).toHaveTextContent(ONE)
  await userEvent.click(within(card).getByTestId(/^ib-confirm-go-/))
  const outcome = await screen.findByTestId('ib-outcome', {}, LONG)
  expect(outcome).toHaveTextContent('Deleted')
  expect(outcome).toHaveTextContent('no longer listed')
  const names = await tableNames(admin)
  for (const name of [ONE, TWO, THREE]) expect(names).not.toContain(name)
  clearSession()
}, 60_000)

test('a Table that only received rows is never deleted with the batch', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: EXISTING,
    columns: [{ column_name: 'bch_alpha', column_type: 'Data' }, { column_name: 'bch_note', column_type: 'Data' }],
  })
  await admin.post('/api/save_row', { table: EXISTING, row: { bch_alpha: 'pre-existing', bch_note: 'mine' } })
  await openWizard(admin, workbook('batch mixed.xlsx'))
  await userEvent.click(screen.getByTestId('iw-ov-sheet-0'))
  await userEvent.click(screen.getByTestId('iw-ov-sheet-1'))
  await userEvent.click(screen.getByTestId('iw-ov-continue'))
  await userEvent.click(await screen.findByTestId('iw-target-0'))
  await userEvent.click(await screen.findByTestId(`iw-target-opt-0-${EXISTING}`))
  await userEvent.click(screen.getByTestId('iw-next'))
  await rename(1, TWO)
  await importAll()

  await userEvent.click(screen.getByTestId('iw-batches-link'))
  await screen.findByTestId('import-batches', {}, WAIT)
  await waitFor(() => expect(firstBatch()).toHaveTextContent('batch mixed.xlsx'), WAIT)
  const card = firstBatch()
  expect(within(card).getByTestId(`ib-appended-${EXISTING}`)).toHaveTextContent('existing Table')
  expect(within(card).getByTestId(`ib-created-${TWO}`)).toBeInTheDocument()
  const del = within(card).getByTestId(/^ib-delete-/)
  expect(del).toHaveTextContent('Delete the 1 Table this import created')
  await userEvent.click(del)
  expect(within(card).getAllByTestId(/^ib-confirm-/)[0]).not.toHaveTextContent(EXISTING)
  await userEvent.click(within(card).getByTestId(/^ib-confirm-go-/))
  expect(await screen.findByTestId('ib-outcome', {}, LONG)).toHaveTextContent('Deleted')

  const names = await tableNames(admin)
  expect(names).not.toContain(TWO)
  expect(names).toContain(EXISTING)
  expect(await admin.get(`/api/table/${encodeURIComponent(EXISTING)}:count`)).toMatchObject({ count: 3 })
  clearSession()
}, 60_000)

test('a merge group is one Table in the import, not one per sheet', async ({ admin }) => {
  await openWizard(admin, workbook('batch merged.xlsx'))
  await userEvent.click(screen.getByTestId('iw-ov-master'))
  await userEvent.click(screen.getByTestId('iw-ov-mode-merge'))
  await userEvent.clear(screen.getByTestId('iw-ov-merge-name'))
  await userEvent.type(screen.getByTestId('iw-ov-merge-name'), ONE)
  await userEvent.click(screen.getByTestId('iw-ov-continue'))
  await screen.findByTestId('iw-import')
  await importAll()

  clearSession()
  await renderApp('/featherbase/admin/imports', admin)
  await screen.findByTestId('import-batches', {}, WAIT)
  await waitFor(() => expect(firstBatch()).toHaveTextContent('batch merged.xlsx'), WAIT)
  const card = firstBatch()
  expect(within(card).getAllByTestId(/^ib-target-/)).toHaveLength(1)
  expect(within(card).getByTestId(`ib-target-${ONE}`)).toHaveTextContent('3 sheets')
  expect(within(card).getByTestId(`ib-target-${ONE}`)).toHaveTextContent('Alpha, Beta, Gamma')
  clearSession()
}, 60_000)

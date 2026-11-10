// #206/#207 (issue #197): the Tables one import created are one thing the
// person did — listed together under Past imports and deleted together.
// Moved from the Playwright import-batches spec (#1080): the workbook goes
// through the real wizard into the in-process server. The batch API itself
// is apps/server/test/import/batches.test.ts's; refusals are
// import-batches-refusal.test.tsx's.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as XLSX from 'xlsx'
import { vi } from 'vitest'
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

// Batches made through the import API, as the wizard sends them.
async function importInto(admin: Admin, table: string, rows: Record<string, unknown>[], batch: string, run: string, created = false) {
  await admin.post(`/api/table/${encodeURIComponent(table)}:import`, {
    rows,
    context: { batch_id: batch, run_id: run, file_name: `${batch}.csv`, sheet_name: 'Sheet1', table_created: created },
  })
}

test('Past imports with nothing imported says so and offers an import', async ({ admin }) => {
  await renderApp('/featherbase/admin/imports', admin)
  expect(await screen.findByTestId('ib-empty', {}, WAIT)).toHaveTextContent('Nothing imported yet.')
})

test('an import with refused rows counts them as failed, on the import and on its Table', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Bch Needs Note', columns: [{ column_name: 'note', column_type: 'Data', reqd: true }] })
  await importInto(admin, 'Bch Needs Note', [{ note: 'kept' }, { note: '' }], 'bch-failed', 'bch-failed-run')
  await renderApp('/featherbase/admin/imports', admin)
  const batch = await screen.findByTestId('ib-batch-bch-failed', {}, WAIT)
  expect(batch).toHaveTextContent('1 rows added · 1 failed')
  expect(within(batch).getByTestId('ib-target-Bch Needs Note')).toHaveTextContent('1 added · 1 failed')
})

test('a run taken back is marked reverted on its Table', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Bch Taken Back', columns: [{ column_name: 'note', column_type: 'Data' }] })
  await importInto(admin, 'Bch Taken Back', [{ note: 'one' }], 'bch-reverted', 'bch-reverted-run')
  await admin.post(`/api/table/${encodeURIComponent('Bch Taken Back')}:import-revert`, { run_id: 'bch-reverted-run' })
  await renderApp('/featherbase/admin/imports', admin)
  const batch = await screen.findByTestId('ib-batch-bch-reverted', {}, WAIT)
  expect(within(batch).getByTestId('ib-target-Bch Taken Back')).toHaveTextContent(/ · reverted$/)
})

test('Past imports the network drops says it could not load them', async ({ admin }) => {
  const bridge = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).startsWith('/api/import/batches')
      ? Promise.reject(new TypeError('Failed to fetch'))
      : bridge(input, init))
  await renderApp('/featherbase/admin/imports', admin)
  expect(await screen.findByTestId('ib-error', {}, WAIT)).toHaveTextContent('Could not load imports')
})

test('deleting an import the network drops says it could not delete', async ({ admin }) => {
  await admin.post('/api/table_def', { name: 'Bch Kept Anyway', columns: [{ column_name: 'note', column_type: 'Data' }] })
  await importInto(admin, 'Bch Kept Anyway', [{ note: 'one' }], 'bch-lost', 'bch-lost-run', true)
  await renderApp('/featherbase/admin/imports', admin)
  await userEvent.click(await screen.findByTestId('ib-delete-bch-lost', {}, WAIT))
  const bridge = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    init?.method === 'DELETE' || String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).includes('batches/')
      ? Promise.reject(new TypeError('Failed to fetch'))
      : bridge(input, init))
  await userEvent.click(screen.getByTestId('ib-confirm-go-bch-lost'))
  expect(await screen.findByTestId('ib-error-bch-lost', {}, WAIT)).toHaveTextContent('Could not delete')
})

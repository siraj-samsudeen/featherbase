// #211 (issue #197): combining two columns that folding could never join.
// Some sheets label the store `Store Code` (STR-009), others `Store Name`
// (Anna Nagar). The values look nothing alike, which is why nothing proposes
// it (no guessing) and why the person must be able to say it themselves.
// Moved down from e2e/import-combine.spec.ts (#1080): the real wizard in
// jsdom, importing through the in-process server.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as XLSX from 'xlsx'
import { test, expect, renderApp } from './pg-test'
import { clearSession } from '../src/lib/import-session'

type Admin = Parameters<typeof renderApp>[1]
const DT = 'Combine Sections'

function workbook(sheets: Record<string, unknown[][]>, name: string) {
  const wb = XLSX.utils.book_new()
  for (const [sheet, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheet)
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const file = new File([buf], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => buf })
  return file
}

// Two sheets naming the same thing differently, no sheet carrying both.
const APART = {
  'By Code': [['Cmb Store Code', 'Cmb Zone'], ['STR-009', 'Fresh'], ['STR-009', 'Dairy']],
  'By Name': [['Cmb Store Name', 'Cmb Zone'], ['Anna Nagar', 'Frozen']],
}

const grid = () => [...screen.getByTestId('iw-new-grid-0').querySelectorAll<HTMLElement>('tbody tr[data-columnrow]')]
const nameOf = (row: HTMLElement) => (row.querySelector('[data-rowfield=column_name]') as HTMLInputElement).value

async function openMergedGroup(admin: Admin, sheets: Record<string, unknown[][]>, file: string) {
  clearSession()
  const user = userEvent.setup()
  await renderApp('/featherbase/admin', admin)
  await user.click(await screen.findByTestId('import-data-link', {}, { timeout: 8000 }))
  fireEvent.change(await screen.findByTestId('iw-file-input', {}, { timeout: 8000 }), {
    target: { files: [workbook(sheets, file)] },
  })
  await screen.findByTestId('iw-overview', {}, { timeout: 8000 })
  await user.click(screen.getByTestId('iw-ov-master'))
  await user.click(screen.getByTestId('iw-ov-mode-merge'))
  await user.clear(screen.getByTestId('iw-ov-merge-name'))
  await user.type(screen.getByTestId('iw-ov-merge-name'), DT)
  await user.click(screen.getByTestId('iw-ov-continue'))
  await screen.findByTestId('iw-group-0', {}, { timeout: 8000 })
  return user
}

async function stores(admin: Admin) {
  const rows = await admin.get<{ data: { store: string }[] }>(
    `/api/table/${encodeURIComponent(DT)}?fields=${encodeURIComponent('["store","cmb_zone"]')}&limit_page_length=20`,
  )
  return rows.data.map((r) => r.store).sort()
}

test('folding leaves the two store columns apart — nothing is guessed', async ({ admin }) => {
  await openMergedGroup(admin, APART, 'combine fixture.xlsx')
  await waitFor(() => expect(grid()).toHaveLength(3))
  expect(nameOf(grid()[0])).toBe('cmb_store_code')
  expect(nameOf(grid()[2])).toBe('cmb_store_name')
  // The invitation to say so is there, and says what it is for.
  expect(screen.getByTestId('iw-combine-0')).toHaveTextContent('store code and a store name')
  clearSession()
})

test('the user combines them, and every row lands in one column', async ({ admin }) => {
  const user = await openMergedGroup(admin, APART, 'combine fixture.xlsx')
  await user.click(screen.getByTestId('iw-combine-pick-0-0'))
  await user.click(screen.getByTestId('iw-combine-pick-0-2'))
  // Sample values are shown for both, so "same thing?" is answerable.
  expect(await screen.findByTestId('iw-combine-sample-0-cmb_store_code')).toHaveTextContent('STR-009')
  expect(screen.getByTestId('iw-combine-sample-0-cmb_store_name')).toHaveTextContent('Anna Nagar')
  // No sheet has both, so there is nothing to resolve, and it says so.
  expect(screen.getByTestId('iw-combine-no-overlap-0')).toBeInTheDocument()

  // Set whole: an emptied box shows the first column's name again, so typing would append to it.
  fireEvent.change(screen.getByTestId('iw-combine-name-0'), { target: { value: 'Store' } })
  await user.click(screen.getByTestId('iw-combine-go-0'))
  await waitFor(() => expect(grid()).toHaveLength(2))
  expect(screen.getByTestId('iw-combine-0')).toHaveTextContent('combined by you')

  await user.click(screen.getByTestId('iw-import'))
  expect(await screen.findByTestId('iw-result-0', {}, { timeout: 10_000 })).toHaveTextContent('Imported 3 rows')
  // Both spellings feed the one column.
  expect(await stores(admin)).toEqual(['Anna Nagar', 'STR-009', 'STR-009'])
  clearSession()
})

test('a column with no values in its sheet says so in the combine sample', async ({ admin }) => {
  const user = await openMergedGroup(admin, {
    'By Code': APART['By Code'],
    'By Name': [['Cmb Store Name', 'Cmb Zone'], [null, 'Frozen']],
  }, 'combine blank.xlsx')
  await waitFor(() => expect(grid()).toHaveLength(3))
  await user.click(screen.getByTestId('iw-combine-pick-0-0'))
  await user.click(screen.getByTestId('iw-combine-pick-0-2'))
  expect(await screen.findByTestId('iw-combine-sample-0-cmb_store_name')).toHaveTextContent('(no values)')
  clearSession()
})

test('a combine can be undone, and the columns come back', async ({ admin }) => {
  const user = await openMergedGroup(admin, APART, 'combine fixture.xlsx')
  await user.click(screen.getByTestId('iw-combine-pick-0-0'))
  await user.click(screen.getByTestId('iw-combine-pick-0-2'))
  // Set whole: an emptied box shows the first column's name again, so typing would append to it.
  fireEvent.change(screen.getByTestId('iw-combine-name-0'), { target: { value: 'Store' } })
  await user.click(screen.getByTestId('iw-combine-go-0'))
  await waitFor(() => expect(grid()).toHaveLength(2))

  await user.click(screen.getByTestId('iw-uncombine-0'))
  // Back to three, so a wrong call is not a dead end.
  await waitFor(() => expect(grid()).toHaveLength(3))
  clearSession()
})

test('a sheet holding BOTH columns must be given a rule', async ({ admin }) => {
  // Sheet 1 carries both. Silently picking one would lose data.
  const user = await openMergedGroup(admin, {
    'Both': [['Cmb Store Code', 'Cmb Store Name', 'Cmb Zone'], ['STR-001', 'Anna Nagar', 'Fresh']],
    'Name Only': [['Cmb Store Name', 'Cmb Zone'], ['T Nagar', 'Dairy']],
  }, 'overlap fixture.xlsx')
  await user.click(screen.getByTestId('iw-combine-pick-0-0'))
  await user.click(screen.getByTestId('iw-combine-pick-0-1'))
  // The overlap is named, with the sheet that causes it.
  expect(await screen.findByTestId('iw-combine-overlap-0')).toHaveTextContent('Both')
  await user.click(screen.getByTestId('iw-combine-rule-join-0'))
  // Set whole: an emptied box shows the first column's name again, so typing would append to it.
  fireEvent.change(screen.getByTestId('iw-combine-name-0'), { target: { value: 'Store' } })
  await user.click(screen.getByTestId('iw-combine-go-0'))

  await user.click(screen.getByTestId('iw-import'))
  expect(await screen.findByTestId('iw-result-0', {}, { timeout: 10_000 })).toHaveTextContent('Imported 2 rows')
  // 'join' kept BOTH values on the row that had both, and the lone value on
  // the row that had one. Nothing was silently dropped.
  expect(await stores(admin)).toEqual(['STR-001 · Anna Nagar', 'T Nagar'])
  clearSession()
})

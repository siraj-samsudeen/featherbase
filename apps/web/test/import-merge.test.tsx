// #201 (issue #197): several sheets of the same shape become ONE Table — the
// reported case was eleven store sheets of section data. Moved from the
// Playwright import-merge spec (#1080); the workbook goes through the real
// wizard into the in-process server.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as XLSX from 'xlsx'
import { test, expect, renderApp } from './pg-test'
import { clearSession } from '../src/lib/import-session'

type Admin = Parameters<typeof renderApp>[1]
const MERGED = 'Merge Sections'
const WAIT = { timeout: 8000 }
const LONG = { timeout: 20_000 }
const enc = encodeURIComponent

function workbook(name: string, sheets: Record<string, unknown[][]>): File {
  const wb = XLSX.utils.book_new()
  for (const [sheet, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheet)
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const file = new File([buf], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => buf })
  return file
}

// "The same shape" the way real workbooks are: store 2 shouts its header,
// store 3 has a trailing space and a lower-case header, and a column the
// others lack.
const STORES = {
  'Store 001': [['Merge Zone', 'Merge Floor', 'Merge Count'], ['Fresh', 'Ground', 12], ['Dairy', 'First', 8]],
  'Store 002': [['MERGE ZONE', 'Merge Floor', 'Merge_Count'], ['Frozen', 'Second', 5]],
  'Store 003': [['Merge Zone ', 'merge floor', 'Merge Count', 'Merge Note'], ['Grocery', 'Ground', 21, 'relaid']],
}

async function overview(admin: Admin, file: File) {
  clearSession()
  await renderApp('/featherbase/admin', admin)
  await userEvent.click(await screen.findByTestId('import-data-link', {}, WAIT))
  fireEvent.change(await screen.findByTestId('iw-file-input', {}, WAIT), { target: { files: [file] } })
  await screen.findByTestId('iw-overview', {}, WAIT)
}

async function mergeAll(name: string) {
  await userEvent.click(screen.getByTestId('iw-ov-master'))
  await userEvent.click(screen.getByTestId('iw-ov-mode-merge'))
  await userEvent.clear(screen.getByTestId('iw-ov-merge-name'))
  await userEvent.type(screen.getByTestId('iw-ov-merge-name'), name)
}

const grid = () => [...within(screen.getByTestId('iw-new-grid-0')).getAllByRole('row')].filter((r) => r.hasAttribute('data-columnrow'))
const nameOf = (row: HTMLElement) => row.querySelector<HTMLInputElement>('[data-rowfield=column_name]')!.value

test('merging three sheets: the tally says what it will give, before going on', async ({ admin }) => {
  await overview(admin, workbook('chain sections.xlsx', STORES))
  await mergeAll(MERGED)
  expect(screen.getByTestId('iw-ov-tally')).toHaveTextContent('4 rows will be imported')
  expect(screen.getByTestId('iw-ov-tally')).toHaveTextContent('1 Table')
  clearSession()
})

test('a merge group is one card, its columns folded apart from case and spaces, the absent column noted', async ({ admin }) => {
  await overview(admin, workbook('chain sections.xlsx', STORES))
  await mergeAll(MERGED)
  await userEvent.click(screen.getByTestId('iw-ov-continue'))
  expect(await screen.findByTestId('iw-group-0')).toHaveTextContent('3 sheets → one Table')
  expect(screen.queryByTestId('iw-sheet-1')).not.toBeInTheDocument()
  expect(screen.queryByTestId('iw-sheet-2')).not.toBeInTheDocument()
  const rows = grid()
  expect(rows).toHaveLength(4)
  expect(rows.slice(0, 3).map(nameOf)).toEqual(['merge_zone', 'merge_floor', 'merge_count'])
  expect(screen.getByTestId('iw-group-members-0')).toHaveTextContent('Store 001')
  expect(screen.getByTestId('iw-group-members-0')).toHaveTextContent('no Merge Note')
  clearSession()
})

test('importing a merge group lands every sheet\'s rows in the one Table, under the folded columns', async ({ admin }) => {
  await overview(admin, workbook('chain sections.xlsx', STORES))
  await mergeAll(MERGED)
  await userEvent.click(screen.getByTestId('iw-ov-continue'))
  await userEvent.click(await screen.findByTestId('iw-import'))
  await waitFor(() => expect(screen.getByTestId('iw-result-0')).toHaveTextContent('Imported 4 rows'), LONG)

  const { data } = await admin.get<{ data: Record<string, unknown>[] }>(
    `/api/table/${enc(MERGED)}?fields=${enc('["merge_zone","merge_floor","merge_count","merge_note"]')}&limit_page_length=50`,
  )
  expect(data).toHaveLength(4)
  expect(data.map((r) => r.merge_zone).sort()).toEqual(['Dairy', 'Fresh', 'Frozen', 'Grocery'])
  expect(data.every((r) => r.merge_floor)).toBe(true)
  expect(data.filter((r) => r.merge_note === 'relaid')).toHaveLength(1)
  const names = (await admin.get<{ data: { row_id: string }[] }>('/api/table/Table?limit_page_length=500')).data.map((t) => t.row_id)
  expect(names).toContain(MERGED)
  expect(names).not.toContain('Store 001')
  expect(names).not.toContain('Store 002')
  clearSession()
}, 30_000)

test('a merged run is logged per sheet under one run id, and one revert takes back all of it', async ({ admin }) => {
  await overview(admin, workbook('chain sections.xlsx', STORES))
  await mergeAll(MERGED)
  await userEvent.click(screen.getByTestId('iw-ov-continue'))
  await userEvent.click(await screen.findByTestId('iw-import'))
  await waitFor(() => expect(screen.getByTestId('iw-result-0')).toHaveTextContent('Imported 4 rows'), LONG)

  const parts = (await admin.get<{ data: { sheet_name: string; run_id: string; table_created: boolean }[] }>(
    `/api/table/${enc('Import Log')}?fields=${enc('["sheet_name","run_id","inserted","table_created"]')}&filters=${enc(JSON.stringify([['ref_table', '=', MERGED]]))}&limit_page_length=50`,
  )).data
  expect(parts.map((p) => p.sheet_name).sort()).toEqual(['Store 001', 'Store 002', 'Store 003'])
  expect(new Set(parts.map((p) => p.run_id)).size).toBe(1)
  expect(parts.filter((p) => p.table_created)).toHaveLength(1)

  await userEvent.click(screen.getByTestId('iw-revert-open-0'))
  expect(await screen.findByTestId('iw-revert-preview-0', {}, WAIT)).toHaveTextContent('delete 4 added rows')
  await userEvent.click(screen.getByTestId('iw-revert-confirm-0'))
  await waitFor(() => expect(screen.getByTestId('iw-revert-result-0')).toHaveTextContent('4 deleted'), LONG)
  expect(await admin.get(`/api/table/${enc(MERGED)}:count`)).toMatchObject({ count: 0 })
  clearSession()
}, 30_000)

test('choosing separate still makes one Table per sheet, walked one at a time', async ({ admin }) => {
  await overview(admin, workbook('chain sections.xlsx', STORES))
  await userEvent.click(screen.getByTestId('iw-ov-sheet-0'))
  await userEvent.click(screen.getByTestId('iw-ov-sheet-1'))
  await userEvent.click(screen.getByTestId('iw-ov-mode-separate'))
  expect(screen.getByTestId('iw-ov-tally')).toHaveTextContent('2 Tables')
  await userEvent.click(screen.getByTestId('iw-ov-continue'))

  expect(await screen.findByTestId('iw-step-of')).toHaveTextContent('Table 1 of 2')
  expect(screen.getByTestId('iw-sheet-0')).toBeInTheDocument()
  expect(screen.queryByTestId('iw-sheet-1')).not.toBeInTheDocument()
  expect(screen.queryByTestId('iw-group-0')).not.toBeInTheDocument()
  await userEvent.click(screen.getByTestId('iw-next'))
  expect(await screen.findByTestId('iw-sheet-1')).toBeInTheDocument()
  expect(screen.queryByTestId('iw-sheet-0')).not.toBeInTheDocument()

  await userEvent.click(screen.getByTestId('iw-import'))
  await waitFor(() => expect(screen.getByTestId('iw-result-0')).toHaveTextContent('Imported 2 rows'), LONG)
  await waitFor(() => expect(screen.getByTestId('iw-result-1')).toHaveTextContent('Imported 1 row'), LONG)
  clearSession()
}, 30_000)

// Review finding 4 on PR #210: a header-only first sheet is skipped before any
// log request, so the created flag belongs on the first part actually sent.
test('a group whose first sheet is header-only still records that it created the Table', async ({ admin }) => {
  await overview(admin, workbook('header first.xlsx', {
    'Store 010': [['Merge Zone', 'Merge Floor']],
    'Store 011': [['Merge Zone', 'Merge Floor'], ['Bakery', 'Ground']],
  }))
  await mergeAll('Merge Header First')
  await userEvent.click(screen.getByTestId('iw-ov-continue'))
  await userEvent.click(await screen.findByTestId('iw-import'))
  await waitFor(() => expect(screen.getByTestId('iw-result-0')).toHaveTextContent('Imported 1 row'), LONG)
  const { batches } = await admin.get<{ batches: { targets: { table: string; created: boolean }[] }[] }>('/api/import/batches')
  const target = batches.flatMap((b) => b.targets).find((t) => t.table === 'Merge Header First')
  expect(target).toMatchObject({ table: 'Merge Header First', created: true })
  clearSession()
}, 30_000)

// Moved from e2e/import-overview.spec.ts (#199/#200, issue #197; #1080): the
// file overview. A workbook opens on a list of sheets — no column grids — with
// the sheets the workbook was hiding in their own section, and NOTHING
// selected until the person says so. Real server, sandboxed database.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as XLSX from 'xlsx'
import { tableHref } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { clearSession } from '../src/lib/import-session'

const PICKED_DT = 'Overview Picked'

// Two visible sheets and two the workbook hides — one ordinary, one very
// hidden, which only VBA can set and which the overview names distinctly.
function workbook(): File {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Ov Ref', 'Ov Amount'], ['P-1', 10], ['P-2', 20]]), 'Picked')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Ov Other', 'Ov Qty'], ['Q-1', 1]]), 'Ignored')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Lookup Key', 'Lookup Value'], ['k', 'v']]), 'Tucked')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Scratch A', 'Scratch B'], [1, 2]]), 'Buried')
  wb.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 0 }, { Hidden: 1 }, { Hidden: 2 }] }
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const file = new File([buf], 'overview fixture.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => buf })
  return file
}

async function drop(file: File) {
  fireEvent.change(await screen.findByTestId('iw-file-input', {}, { timeout: 8000 }), { target: { files: [file] } })
}

async function openOverview(admin: Parameters<typeof renderApp>[1]) {
  clearSession()
  const r = await renderApp('/featherbase/admin/import', admin)
  await drop(workbook())
  await screen.findByTestId('iw-overview', {}, { timeout: 8000 })
  return r
}

const count = () => screen.getByTestId('iw-ov-count').textContent
const master = () => screen.getByTestId<HTMLInputElement>('iw-ov-master')
const pathOf = (r: { router: unknown }) =>
  (r.router as { state: { location: { pathname: string } } }).state.location.pathname

test('Import data on the Admin opens the wizard, where a workbook opens on its sheet overview', async ({ admin }) => {
  clearSession()
  const r = await renderApp('/featherbase/admin', admin)
  await userEvent.click(await screen.findByTestId('import-data-link', {}, { timeout: 8000 }))
  await waitFor(() => expect(pathOf(r)).toBe('/featherbase/admin/import'))
  await drop(workbook())
  expect(await screen.findByTestId('iw-overview', {}, { timeout: 8000 })).toBeInTheDocument()
})

test('the overview lists sheets only, sections the hidden ones, and starts with none selected', async ({ admin }) => {
  await openOverview(admin)
  // Sheets only — none of the column grids the wizard used to open on.
  expect(screen.queryByTestId('iw-new-grid-0')).not.toBeInTheDocument()
  expect(screen.queryByTestId('iw-mapping-0')).not.toBeInTheDocument()
  // Two sections: visible above, hidden below, each counting its own.
  expect(screen.getByTestId('iw-ov-section-visible')).toHaveTextContent('Visible sheets (2)')
  expect(screen.getByTestId('iw-ov-section-hidden')).toHaveTextContent('Hidden sheets (2)')
  // 'very hidden' is not flattened into 'hidden' — the workbook meant more.
  expect(screen.getByTestId('iw-ov-row-3')).toHaveTextContent('very hidden')
  expect(screen.getByTestId('iw-ov-row-2')).toHaveTextContent('hidden')
  expect(screen.getByTestId('iw-ov-row-2')).not.toHaveTextContent('very hidden')
  // #200's whole point: nothing is included by default.
  expect(count()).toBe('0 of 4 sheets selected')
  for (const i of [0, 1, 2, 3]) expect(screen.getByTestId(`iw-ov-sheet-${i}`)).not.toBeChecked()
})

test('continuing with no sheet chosen is refused in words, and the overview stays', async ({ admin }) => {
  await openOverview(admin)
  await userEvent.click(screen.getByTestId('iw-ov-continue'))
  expect(await screen.findByTestId('iw-ov-refusal')).toBeInTheDocument()
  expect(screen.getByTestId('iw-overview')).toBeInTheDocument()
})

test('each group toggle acts on its own section, and the master reports a partial choice as mixed', async ({ admin }) => {
  const user = userEvent.setup()
  await openOverview(admin)
  // "Select all visible" leaves the hidden sheets alone.
  await user.click(screen.getByTestId('iw-ov-all-visible'))
  expect(count()).toBe('2 of 4 sheets selected')
  expect(screen.getByTestId('iw-ov-sheet-0')).toBeChecked()
  expect(screen.getByTestId('iw-ov-sheet-1')).toBeChecked()
  expect(screen.getByTestId('iw-ov-sheet-2')).not.toBeChecked()
  expect(master().indeterminate).toBe(true)
  // The same control clears the group it filled.
  await user.click(screen.getByTestId('iw-ov-all-visible'))
  expect(count()).toBe('0 of 4 sheets selected')
  // Hidden sheets are reachable and selectable, in their own group.
  await user.click(screen.getByTestId('iw-ov-all-hidden'))
  expect(count()).toBe('2 of 4 sheets selected')
  expect(screen.getByTestId('iw-ov-sheet-2')).toBeChecked()
  expect(screen.getByTestId('iw-ov-sheet-0')).not.toBeChecked()
})

test('the master selects every sheet, then reads as fully checked', async ({ admin }) => {
  const user = userEvent.setup()
  await openOverview(admin)
  await user.click(screen.getByTestId('iw-ov-all-hidden'))
  await user.click(master())
  expect(count()).toBe('4 of 4 sheets selected')
  expect(master()).toBeChecked()
  expect(master().indeterminate).toBe(false)
})

test('only the chosen sheet reaches the column step, and importing it creates no Table for the rest', async ({ admin }) => {
  const user = userEvent.setup()
  const r = await openOverview(admin)
  await user.click(screen.getByTestId('iw-ov-sheet-0'))
  expect(screen.getByTestId('iw-ov-tally')).toHaveTextContent('2 rows will be imported')
  expect(screen.getByTestId('iw-ov-tally')).toHaveTextContent('3 left out')
  await user.click(screen.getByTestId('iw-ov-continue'))

  expect(await screen.findByTestId('iw-sheet-0')).toBeInTheDocument()
  expect(screen.queryByTestId('iw-sheet-1')).not.toBeInTheDocument()
  expect(screen.queryByTestId('iw-sheet-2')).not.toBeInTheDocument()
  expect(screen.getByTestId('iw-chosen-count').textContent).toBe('1 of 4 sheets selected')

  const name = screen.getByTestId('iw-new-name-0')
  await user.clear(name)
  await user.type(name, PICKED_DT)
  await user.click(screen.getByTestId('iw-import'))
  // A single imported target opens its list.
  await waitFor(() => expect(pathOf(r)).toBe(tableHref(PICKED_DT)), { timeout: 10_000 })
  await waitFor(() => expect(screen.getByTestId('list-rows').querySelectorAll('tr')).toHaveLength(2), { timeout: 8000 })
  expect(screen.getByTestId('list-rows')).toHaveTextContent('P-1')
  expect(screen.getByTestId('list-rows')).toHaveTextContent('P-2')

  const { data: rows } = await admin.get<{ data: { ov_ref: string; ov_amount: number }[] }>(
    `/api/table/${encodeURIComponent(PICKED_DT)}?fields=${encodeURIComponent('["ov_ref","ov_amount"]')}`,
  )
  expect(rows.map(({ ov_ref, ov_amount }) => ({ ov_ref, ov_amount })).sort((a, b) => a.ov_ref.localeCompare(b.ov_ref)))
    .toEqual([{ ov_ref: 'P-1', ov_amount: 10 }, { ov_ref: 'P-2', ov_amount: 20 }])
  // The three sheets left unselected created nothing — the defect that made
  // one import produce eleven unwanted Tables.
  const { data: tables } = await admin.get<{ data: { row_id: string }[] }>('/api/table/Table?limit_page_length=500')
  const names = tables.map((t) => t.row_id)
  expect(names).toContain(PICKED_DT)
  for (const left of ['Ignored', 'Tucked', 'Buried']) expect(names).not.toContain(left)
  clearSession()
})

test('going back to the overview keeps the sheets chosen and the names typed', async ({ admin }) => {
  const user = userEvent.setup()
  await openOverview(admin)
  await user.click(screen.getByTestId('iw-ov-sheet-0'))
  await user.click(screen.getByTestId('iw-ov-continue'))
  const name = await screen.findByTestId('iw-new-name-0')
  await user.clear(name)
  await user.type(name, 'Renamed Before Going Back')

  await user.click(screen.getByTestId('iw-back-to-overview'))
  expect(await screen.findByTestId('iw-ov-sheet-0')).toBeChecked()
  expect(count()).toBe('1 of 4 sheets selected')
  // The rename survives the round trip — leaving the step is not a reset.
  await user.click(screen.getByTestId('iw-ov-continue'))
  expect(await screen.findByTestId('iw-new-name-0')).toHaveValue('Renamed Before Going Back')
  clearSession()
})

test('a CSV has nothing to choose, so the overview never appears', async ({ admin }) => {
  clearSession()
  await renderApp('/featherbase/admin/import', admin)
  const bytes = new TextEncoder().encode('Solo Ref,Solo Amount\nS-1,5\n').buffer
  const file = new File([bytes], 'single.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes })
  await drop(file)
  expect(await screen.findByTestId('iw-new-grid-0', {}, { timeout: 8000 })).toBeInTheDocument()
  expect(screen.queryByTestId('iw-overview')).not.toBeInTheDocument()
  clearSession()
})

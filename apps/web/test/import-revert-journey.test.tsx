// Moved from e2e/import-revert-journey.spec.ts (spec 0005, RVT-J1; #1080): the
// walk via the history strip. A corrected file lands on a match key; a later
// import edits a row again; revert: rehearsal counts first, the edited row
// skipped and NAMED, the run's insert deleted, then "revert these anyway" as
// a second explicit act. The server's own rules are
// apps/server/test/import/revert.test.ts; this proves the wizard drives them.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as XLSX from 'xlsx'
import { tableHref } from 'shared'
import { test, expect, renderApp } from './pg-test'
import { clearSession } from '../src/lib/import-session'

const DT = 'Revert Journey Zones'

function xlsxFile(rows: unknown[][], name: string): File {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Zones')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const file = new File([buf], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => buf })
  return file
}

const pathOf = (r: { router: unknown }) =>
  (r.router as { state: { location: { pathname: string } } }).state.location.pathname

test('RVT-J1: the bad run is reverted from the history strip: rehearsed, the edited row skipped and named, then restored on a second act', async ({ admin }) => {
  clearSession()
  const user = userEvent.setup()
  const zones = async () => {
    const { data } = await admin.get<{ data: { row_id: string; zone: string; pop: unknown }[] }>(
      `/api/table/${encodeURIComponent(DT)}?fields=${encodeURIComponent('["row_id","zone","pop"]')}&limit_page_length=100`,
    )
    return Object.fromEntries(data.map((r) => [r.zone, { name: r.row_id, pop: Number(r.pop) }]))
  }

  // Prior state: a Table with rows outside any run.
  await admin.post('/api/table_def', {
    name: DT,
    columns: [
      { column_name: 'zone', label: 'Zone', column_type: 'Data', in_list_view: true },
      { column_name: 'pop', label: 'Pop', column_type: 'Int', in_list_view: true },
    ],
  })
  await admin.post(`/api/table/${encodeURIComponent(DT)}:import`, { rows: [{ zone: 'Alpha', pop: 12000 }, { zone: 'Bravo', pop: 8400 }] })

  // The run under test: upsert the corrected file through the wizard.
  const first = await renderApp('/featherbase/admin/import', admin)
  fireEvent.change(await screen.findByTestId('iw-file-input', {}, { timeout: 8000 }), {
    target: { files: [xlsxFile([['Zone', 'Pop'], ['Alpha', 13500], ['Charlie', 100]], 'corrected.xlsx')] },
  })
  await waitFor(() => expect(screen.getByTestId('iw-target-0')).toHaveValue(DT), { timeout: 8000 })
  await user.selectOptions(screen.getByTestId('iw-key-0'), 'zone')
  await waitFor(() => expect(screen.getByTestId('iw-preview-0')).toHaveTextContent('1 row changes · 0 unchanged · 1 added'))
  await user.click(screen.getByRole('button', { name: 'Import 2 rows' }))
  // The wizard goes on to the Table's list.
  await waitFor(() => expect(pathOf(first)).toBe(tableHref(DT)), { timeout: 10_000 })
  first.unmount()

  // Someone edits Alpha after the run.
  await admin.post(`/api/table/${encodeURIComponent(DT)}:import`, { key_column: 'zone', rows: [{ zone: 'Alpha', pop: 99999 }] })
  const alpha = (await zones()).Alpha.name

  // J1.1: back to the wizard with the Table preselected; rehearse first.
  await renderApp(`/featherbase/admin/import?table=${encodeURIComponent(DT)}`, admin)
  const history = await screen.findByTestId('iw-run-history', {}, { timeout: 8000 })
  // The later API edit has its own run and sits ahead; pick the named one.
  const runs = within(history).getAllByTestId(/^iw-run-\d+$/).filter((el) => el.textContent?.includes('corrected.xlsx'))
  expect(runs).toHaveLength(1)
  const key = `h${runs[0].getAttribute('data-testid')!.slice('iw-run-'.length)}`
  await user.click(within(history).getByTestId(`iw-revert-open-${key}`))
  const preview = await within(history).findByTestId(`iw-revert-preview-${key}`)
  expect(preview).toHaveTextContent('delete 1 added rows')
  expect(preview).toHaveTextContent(`${alpha} (edited after this import)`)

  // J1.2: confirm. Charlie goes; Alpha stays edited, named in the report.
  await user.click(within(history).getByTestId(`iw-revert-confirm-${key}`))
  const result = await within(history).findByTestId(`iw-revert-result-${key}`)
  expect(result).toHaveTextContent('0 restored, 1 deleted')
  expect(result).toHaveTextContent(`${alpha} (edited after this import)`)

  // J1.3: the Table agrees.
  const mid = await zones()
  expect(Object.keys(mid).sort()).toEqual(['Alpha', 'Bravo'])
  expect(mid.Alpha.pop).toBe(99999)
  expect(mid.Bravo.pop).toBe(8400)

  // J1.4: the escalation restores Alpha to the run's before-value, 12000.
  await user.click(within(history).getByTestId(`iw-revert-override-${key}`))
  await waitFor(() => expect(within(history).getByTestId(`iw-revert-result-${key}`)).toHaveTextContent('1 restored'))
  const after = await zones()
  expect(after.Alpha.pop).toBe(12000)
  expect(after.Bravo.pop).toBe(8400)

  // J1.5: the log records the revert.
  const { data: logs } = await admin.get<{ data: { reverted_at: unknown }[] }>(
    `/api/table/${encodeURIComponent('Import Log')}?fields=${encodeURIComponent('["ref_table","reverted_at"]')}&filters=${encodeURIComponent(JSON.stringify([['ref_table', '=', DT]]))}`,
  )
  expect(logs.some((l) => l.reverted_at)).toBe(true)
  clearSession()
})

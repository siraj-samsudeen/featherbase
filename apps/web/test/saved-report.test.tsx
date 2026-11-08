// RPT-002: a saved report restores its columns, filters and grouping, from its
// address or from the saved-report picker. Moved down from
// e2e/saved-report.spec.ts (#1080): the real report view in jsdom, saving
// through the in-process server.
import { tableSlug } from 'shared'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

type Admin = Parameters<typeof renderApp>[1]
const T = 'Srp Task'
const REPORT = 'Srp open tasks by status'
const reportPath = (search = '') => `/featherbase/admin/table/${encodeURIComponent(tableSlug(T))}/view/report${search}`
const search = (r: { router: unknown }) =>
  (r.router as { state: { location: { searchStr: string } } }).state.location.searchStr

async function seed(admin: Admin) {
  await admin.post('/api/table_def', {
    name: T,
    columns: [
      { column_name: 'title', column_type: 'Data', label: 'Title', in_list_view: true },
      { column_name: 'stage', column_type: 'Choice', label: 'Status', choices: 'Open\nClosed', in_list_view: true },
      { column_name: 'qty', column_type: 'Int', label: 'Qty', in_list_view: true },
    ],
  })
  for (const [title, stage, qty] of [['alpha', 'Open', 1], ['bravo', 'Open', 2], ['charlie', 'Closed', 5]] as const)
    await admin.post('/api/save_row', { table: T, row: { title, stage, qty } })
}

const rows = () => screen.queryAllByTestId('report-row')

test('RPT-002: saved report restores columns, filters, and grouping', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  const app = await renderApp(reportPath(), admin)
  await waitFor(() => expect(rows()).toHaveLength(3), { timeout: 8000 })
  expect(screen.getByTestId('report-head-qty')).toBeInTheDocument()

  // Drop the qty column, filter status = Open, group by status, and save.
  await user.click(screen.getByTestId('report-columns'))
  await user.click(await screen.findByTestId('report-col-qty'))
  await user.click(screen.getByTestId('report-columns'))
  await user.selectOptions(screen.getByTestId('filter-field'), 'stage')
  await user.selectOptions(await screen.findByTestId('filter-value'), 'Open')
  await user.click(screen.getByTestId('filter-add'))
  await waitFor(() => expect(rows()).toHaveLength(2))
  await user.selectOptions(screen.getByTestId('report-groupby'), 'stage')
  await user.click(screen.getByTestId('report-save'))
  await user.type(screen.getByTestId('report-save-name'), REPORT)
  await user.click(screen.getByTestId('report-save-confirm'))
  await waitFor(() => expect(search(app)).toMatch(/report=/))

  // A fresh open of the saved address restores everything.
  cleanup()
  await renderApp(reportPath(`?report=${encodeURIComponent(REPORT)}`), admin)
  await waitFor(() => expect(screen.getByTestId('report-groupby')).toHaveValue('stage'), { timeout: 8000 })
  await waitFor(() => expect(rows()).toHaveLength(2))
  expect(screen.queryByTestId('report-head-qty')).not.toBeInTheDocument()
  await waitFor(() => {
    const open = document.querySelector<HTMLElement>('[data-group="Open"]')!
    expect(within(open).getByTestId('group-count')).toHaveTextContent('(2)')
  })

  // The picker opens it from the default report too.
  cleanup()
  await renderApp(reportPath(), admin)
  await waitFor(() => expect(rows()).toHaveLength(3), { timeout: 8000 })
  await user.selectOptions(await screen.findByTestId('saved-report-picker'), REPORT)
  await waitFor(() => expect(rows()).toHaveLength(2))
  expect(screen.getByTestId('report-groupby')).toHaveValue('stage')
})

// RPT-005: the Admin page for a script report — its declared filter controls,
// the columns and rows its execute() returns, a re-run with filters, and the
// two ways it can fail. Gaps the merged web coverage report (ADR 0012) showed:
// no e2e spec opens this page.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppError } from 'server/src/errors'
import { registerScriptReport } from 'server/src/script-report'
import { test, expect, renderApp } from './pg-test'

const REPORT = 'Web SR Echo'

// The registry is process-global with no unregister; the names are unique to
// this file, so leaving them registered is unobservable elsewhere.
registerScriptReport({
  name: 'Web SR Echo Script',
  filters: [
    { column_name: 'n', label: 'N', column_type: 'Int' },
    { column_name: 'kind', label: 'Kind', column_type: 'Choice', choices: '\nsmall\nlarge' },
    { column_name: 'only_active', label: 'Only active', column_type: 'Check' },
    { column_name: 'since', label: 'Since', column_type: 'Date' },
    { column_name: 'note', label: 'Note', column_type: 'Data' },
  ],
  execute: async (filters) => {
    if (filters.note === 'boom') throw new AppError('ValidationError', 'the report refused this note')
    if (filters.kind === 'large') return { columns: ['n'], rows: [] }
    return {
      columns: ['n', 'kind', 'active', 'empty'],
      rows: [{ n: filters.n ?? 0, kind: filters.kind ?? 'any', active: String(filters.only_active ?? false), empty: null }],
    }
  },
})

async function seed(admin: { post: (p: string, b: unknown) => Promise<unknown> }) {
  await admin.post('/api/save_row', {
    table: 'Report',
    row: { row_id: REPORT, ref_table: 'Person', report_type: 'Script Report', report_script: 'Web SR Echo Script' },
  })
}

test('opens with its filters, runs at once, and re-runs with the chosen values', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await renderApp(`/featherbase/admin/script-report/${encodeURIComponent(REPORT)}`, admin)
  expect(await screen.findByTestId('script-report-title')).toHaveTextContent(REPORT)
  const filters = screen.getByTestId('script-report-filters')
  expect(within(filters).getByText('N')).toBeInTheDocument()
  expect(screen.getByTestId('sr-filter-n')).toHaveAttribute('type', 'number')
  expect(screen.getByTestId('sr-filter-since')).toHaveAttribute('type', 'date')
  expect(screen.getByTestId('sr-filter-note')).toHaveAttribute('type', 'text')
  expect(within(screen.getByTestId('sr-filter-kind')).getByRole('option', { name: '(any)' })).toBeInTheDocument()

  // The first run happens without pressing Run, with no filters.
  const rows = await screen.findByTestId('script-report-rows')
  expect(screen.getByTestId('sr-col-kind')).toHaveTextContent('kind')
  await waitFor(() => expect(rows).toHaveTextContent('0anyfalse—'))

  await user.type(screen.getByTestId('sr-filter-n'), '7')
  await user.selectOptions(screen.getByTestId('sr-filter-kind'), 'small')
  await user.click(screen.getByTestId('sr-filter-only_active'))
  expect(screen.getByTestId('sr-filter-only_active')).toBeChecked()
  await user.click(screen.getByTestId('script-report-run'))
  await waitFor(() => expect(screen.getByTestId('script-report-rows')).toHaveTextContent('7smalltrue—'))

  // Unticking clears the filter rather than sending false.
  await user.click(screen.getByTestId('sr-filter-only_active'))
  await user.click(screen.getByTestId('script-report-run'))
  await waitFor(() => expect(screen.getByTestId('script-report-rows')).toHaveTextContent('7smallfalse—'))
})

test('a run with no rows says so, and a run the report refuses shows why', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await renderApp(`/featherbase/admin/script-report/${encodeURIComponent(REPORT)}`, admin)
  await screen.findByTestId('script-report-rows')

  await user.selectOptions(screen.getByTestId('sr-filter-kind'), 'large')
  await user.click(screen.getByTestId('script-report-run'))
  expect(await screen.findByTestId('script-report-empty')).toHaveTextContent('No rows')

  await user.selectOptions(screen.getByTestId('sr-filter-kind'), '')
  await user.type(screen.getByTestId('sr-filter-note'), 'boom')
  await user.click(screen.getByTestId('script-report-run'))
  expect(await screen.findByTestId('script-report-run-error')).toHaveTextContent('the report refused this note')
  expect(screen.queryByTestId('script-report-rows')).not.toBeInTheDocument()
})

test('a report that does not exist says so instead of loading forever', async ({ admin }) => {
  await renderApp('/featherbase/admin/script-report/No%20Such%20Report', admin)
  const error = await screen.findByTestId('script-report-error')
  expect(error.textContent).toMatch(/No Such Report|not found/i)
})

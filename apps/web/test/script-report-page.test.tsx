// RPT-005: the Admin page for a script report — its declared filter controls,
// the columns and rows its execute() returns, a re-run with filters, and the
// two ways it can fail. Gaps the merged web coverage report (ADR 0012) showed:
// no e2e spec opens this page.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
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

test('a run the network drops says the report failed to run', async ({ admin }) => {
  const user = userEvent.setup()
  await seed(admin)
  await renderApp(`/featherbase/admin/script-report/${encodeURIComponent(REPORT)}`, admin)
  await screen.findByTestId('script-report-rows')
  const real = globalThis.fetch
  const dropped = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    String(input).includes('/api/run_script_report') ? Promise.reject(new TypeError('Failed to fetch')) : real(input, init))
  try {
    await user.click(screen.getByTestId('script-report-run'))
    expect(await screen.findByTestId('script-report-run-error')).toHaveTextContent('Failed to run report')
  } finally {
    dropped.mockRestore()
  }
})

// A report declaring a choice with no choices, whose answer has no columns.
registerScriptReport({
  name: 'Web SR Bare Script',
  filters: [{ column_name: 'pick', label: 'Pick', column_type: 'Choice' }],
  execute: async () => ({ columns: [], rows: [] }),
})

async function seedBare(admin: { post: (p: string, b: unknown) => Promise<unknown> }) {
  await admin.post('/api/save_row', {
    table: 'Report',
    row: { row_id: 'Web SR Bare', ref_table: 'Person', report_type: 'Script Report', report_script: 'Web SR Bare Script' },
  })
}

test('a choice filter declared with no choices offers only (any), and an answer with no columns says No rows', async ({ admin }) => {
  await seedBare(admin)
  await renderApp(`/featherbase/admin/script-report/${encodeURIComponent('Web SR Bare')}`, admin)
  expect(await screen.findByTestId('script-report-empty')).toHaveTextContent('No rows')
  expect(within(screen.getByTestId('sr-filter-pick')).getAllByRole('option').map((o) => o.textContent)).toEqual(['(any)'])
})

test("a report whose definition the network drops says it was not found", async ({ admin }) => {
  await seedBare(admin)
  const real = globalThis.fetch
  const dropped = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    String(input).includes('/api/script_report/') ? Promise.reject(new TypeError('Failed to fetch')) : real(input, init))
  try {
    await renderApp(`/featherbase/admin/script-report/${encodeURIComponent('Web SR Bare')}`, admin)
    expect(await screen.findByTestId('script-report-error', {}, { timeout: 10_000 })).toHaveTextContent(/^Report not found$/)
  } finally {
    dropped.mockRestore()
  }
})

test('a report that does not exist says so instead of loading forever', async ({ admin }) => {
  await renderApp('/featherbase/admin/script-report/No%20Such%20Report', admin)
  const error = await screen.findByTestId('script-report-error')
  expect(error.textContent).toMatch(/No Such Report|not found/i)
})

const DEFAULT_REPORT = 'Web SR Defaults'
registerScriptReport({
  name: DEFAULT_REPORT,
  filters: [
    { column_name: 'n', label: 'N', column_type: 'Int', default: 0 },
    { column_name: 'one', label: 'One', column_type: 'Int', default: 1 },
    { column_name: 'kind', label: 'Kind', column_type: 'Choice', choices: '\nsmall\nlarge', default: 'small' },
    { column_name: 'enabled', label: 'Enabled', column_type: 'Check', default: false },
    { column_name: 'only_active', label: 'Only active', column_type: 'Check', default: true },
    { column_name: 'since', label: 'Since', column_type: 'Date', default: '2026-10-01' },
    { column_name: 'note', label: 'Note', column_type: 'Data', default: 'starting note' },
    { column_name: 'empty', label: 'Empty', column_type: 'Data', default: null },
    { column_name: 'absent', label: 'Absent', column_type: 'Data' },
  ],
  execute: async (filters) => ({ columns: ['filters'], rows: [{ filters: JSON.stringify(filters) }] }),
})

async function seedDefaults(admin: { post: (p: string, b: unknown) => Promise<unknown> }) {
  await admin.post('/api/save_row', {
    table: 'Report',
    row: { row_id: DEFAULT_REPORT, ref_table: 'Person', report_type: 'Script Report', report_script: DEFAULT_REPORT },
  })
}

test('the first run uses the declared defaults', async ({ admin }) => {
  await seedDefaults(admin)
  await renderApp(`/featherbase/admin/script-report/${encodeURIComponent(DEFAULT_REPORT)}`, admin)
  const rows = await screen.findByTestId('script-report-rows')
  expect(JSON.parse(rows.textContent!)).toEqual({
    n: 0, one: 1, kind: 'small', enabled: false, only_active: true, since: '2026-10-01', note: 'starting note',
  })
  expect(screen.getByTestId('sr-filter-n')).toHaveValue(0)
  expect(screen.getByTestId('sr-filter-kind')).toHaveValue('small')
  expect(screen.getByTestId('sr-filter-enabled')).not.toBeChecked()
  expect(screen.getByTestId('sr-filter-only_active')).toBeChecked()
  expect(screen.getByTestId('sr-filter-since')).toHaveValue('2026-10-01')
  expect(screen.getByTestId('sr-filter-empty')).toHaveValue('')
  expect(screen.getByTestId('sr-filter-absent')).toHaveValue('')
})

test('later runs preserve explicitly cleared defaults', async ({ admin }) => {
  const user = userEvent.setup()
  await seedDefaults(admin)
  const app = await renderApp(`/featherbase/admin/script-report/${encodeURIComponent(DEFAULT_REPORT)}`, admin)
  await screen.findByTestId('script-report-rows')
  await user.clear(screen.getByTestId('sr-filter-n'))
  await user.selectOptions(screen.getByTestId('sr-filter-kind'), '')
  await user.click(screen.getByTestId('sr-filter-only_active'))
  await user.clear(screen.getByTestId('sr-filter-note'))
  await user.type(screen.getByTestId('sr-filter-note'), '1')
  await app.queryClient.invalidateQueries({ queryKey: ['script-report', DEFAULT_REPORT] })
  await user.click(screen.getByTestId('script-report-run'))
  await waitFor(() => expect(JSON.parse(screen.getByTestId('script-report-rows').textContent!)).toEqual({
    one: 1, enabled: false, since: '2026-10-01', note: '1',
  }))
  expect(screen.getByTestId('sr-filter-n')).toHaveValue(null)
  expect(screen.getByTestId('sr-filter-kind')).toHaveValue('')
  expect(screen.getByTestId('sr-filter-only_active')).not.toBeChecked()
})

test('report navigation starts from the destination defaults', async ({ admin }) => {
  await seed(admin)
  await seedDefaults(admin)
  const app = await renderApp(`/featherbase/admin/script-report/${encodeURIComponent(DEFAULT_REPORT)}`, admin)
  await screen.findByTestId('script-report-rows')
  await userEvent.setup().clear(screen.getByTestId('sr-filter-n'))
  await app.router.navigate({ to: `/featherbase/admin/script-report/${encodeURIComponent(REPORT)}` })
  await waitFor(() => expect(screen.getByTestId('script-report-rows')).toHaveTextContent('0anyfalse—'))
  expect(screen.getByTestId('sr-filter-n')).toHaveValue(null)
  await app.router.navigate({ to: `/featherbase/admin/script-report/${encodeURIComponent(DEFAULT_REPORT)}` })
  await waitFor(() => expect(screen.getByTestId('sr-filter-n')).toHaveValue(0))
  await waitFor(() => expect(JSON.parse(screen.getByTestId('script-report-rows').textContent!)).toMatchObject({ n: 0, kind: 'small' }))
})

// RPT-006: a report's chart reflects its rows, and pinning it puts the chart
// on a dashboard, drawn from live data. Chart derivation and pinning on the
// server: apps/server/test/report-chart.test.ts.
import { tableSlug } from 'shared'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

const DT = 'Rc Sale'
const REPORT = 'Rc Report'
const DASH = 'Rc Board'

test('RPT-006: the chart reflects the report rows, and pinning shows it on the dashboard', async ({ admin }) => {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [
      { column_name: 'region', column_type: 'Choice', choices: 'North\nSouth', in_list_view: true },
      { column_name: 'amount', column_type: 'Int', in_list_view: true },
    ],
  })
  // Grouped by region: North 2, South 1.
  for (const [region, amount] of [['North', 100], ['South', 50], ['North', 25]] as const)
    await admin.post(`/api/table/${encodeURIComponent(DT)}`, { region, amount })
  await admin.post('/api/save_row', {
    table: 'Report',
    row: { row_id: REPORT, ref_table: DT, report_type: 'Report Builder', config: { columns: ['region', 'amount'], filters: [] } },
  })
  await admin.post('/api/save_row', { table: 'Dashboard', row: { row_id: DASH, label: 'RC Board', config: { cards: [], charts: [] } } })

  const user = userEvent.setup()
  await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}/view/report?report=${encodeURIComponent(REPORT)}`, admin)
  await screen.findByTestId('report-view', {}, { timeout: 8000 })
  await waitFor(() => expect(screen.getAllByTestId('report-row')).toHaveLength(3))
  await user.selectOptions(screen.getByTestId('report-groupby'), 'region')
  expect(await screen.findByTestId('report-chart')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByTestId('chart-bar-value-North').textContent).toBe('2'))
  expect(screen.getByTestId('chart-bar-value-South').textContent).toBe('1')

  await user.selectOptions(screen.getByTestId('pin-dashboard'), DASH)
  await user.click(screen.getByTestId('pin-chart'))
  expect(await screen.findByTestId('pin-msg')).toHaveTextContent(`Pinned to ${DASH}`)

  cleanup()
  await renderApp(`/featherbase/admin/dashboard/${encodeURIComponent(DASH)}`, admin)
  expect(await screen.findByTestId(`chart-${REPORT}`, {}, { timeout: 8000 })).toBeInTheDocument()
  await waitFor(() => expect(screen.getByTestId('bar-value-North').textContent).toBe('2'))
  expect(screen.getByTestId('bar-value-South').textContent).toBe('1')
})

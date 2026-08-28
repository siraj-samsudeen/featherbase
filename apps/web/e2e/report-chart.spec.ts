import { test, expect, adminAuth } from './fixtures'

const DT = 'Rc E2E Sale'
const REPORT = 'Rc E2E Report'
const DASH = 'Rc E2E Board'

// Known data: North 100, South 50, North 25 → grouped by region: North 2, South 1.
const ROWS: [string, number][] = [
  ['North', 100],
  ['South', 50],
  ['North', 25],
]

test.beforeAll(async ({ request }) => {
  const headers = await adminAuth(request)
  const dt = await request.post('/api/table_def', {
    headers,
    data: {
      name: DT,
      columns: [
        { column_name: 'region', column_type: 'Choice', choices: 'North\nSouth', in_list_view: true },
        { column_name: 'amount', column_type: 'Int', in_list_view: true },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  const existing = (await (
    await request.get(`/api/table/${encodeURIComponent(DT)}?limit_page_length=500`, { headers })
  ).json()) as { data: { row_id: string }[] }
  for (const d of existing.data) await request.delete(`/api/table/${encodeURIComponent(DT)}/${d.row_id}`, { headers })
  for (const [region, amount] of ROWS)
    await request.post(`/api/table/${encodeURIComponent(DT)}`, { headers, data: { region, amount } })

  // A saved Report Builder report over the Table.
  await request.delete(`/api/table/Report/${encodeURIComponent(REPORT)}`, { headers })
  await request.post('/api/save_row', {
    headers,
    data: {
      table: 'Report',
      row: { row_id: REPORT, ref_table: DT, report_type: 'Report Builder', config: { columns: ['region', 'amount'], filters: [] } },
    },
  })

  // An empty dashboard to pin onto.
  await request.delete(`/api/table/Dashboard/${encodeURIComponent(DASH)}`, { headers })
  await request.post('/api/save_row', {
    headers,
    data: { table: 'Dashboard', row: { row_id: DASH, label: 'RC Board', config: { cards: [], charts: [] } } },
  })
})

test('RPT-006: chart reflects report data and pinning shows it on the dashboard', async ({ page }) => {
  // Open the saved report; group by region so the chart shows per-region counts.
  await page.goto(`/admin/${encodeURIComponent(DT)}/view/report?report=${encodeURIComponent(REPORT)}`)
  await expect(page.getByTestId('report-view')).toBeVisible()
  await page.getByTestId('report-groupby').selectOption('region')

  // The chart reflects the report data: North 2, South 1.
  await expect(page.getByTestId('report-chart')).toBeVisible()
  await expect(page.getByTestId('chart-bar-value-North')).toHaveText('2')
  await expect(page.getByTestId('chart-bar-value-South')).toHaveText('1')

  // Pin the chart to the dashboard.
  await page.getByTestId('pin-dashboard').selectOption(DASH)
  await page.getByTestId('pin-chart').click()
  await expect(page.getByTestId('pin-msg')).toContainText(`Pinned to ${DASH}`)

  // The dashboard now shows the pinned report chart, recomputed from live data.
  await page.goto(`/admin/dashboard/${encodeURIComponent(DASH)}`)
  await expect(page.getByTestId(`chart-${REPORT}`)).toBeVisible()
  await expect(page.getByTestId('bar-value-North')).toHaveText('2')
  await expect(page.getByTestId('bar-value-South')).toHaveText('1')
})

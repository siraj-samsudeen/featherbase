import { test, expect, adminToken, bearer, type APIRequestContext } from './fixtures'

const DT = 'RPT Saved Task'
const REPORT = 'Open tasks by status'

// RPT-002: save a configured report; reopening it restores columns,
// filters, and grouping.

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const token = await adminToken(request)
  const auth = bearer(token)
  // RPT Task fixtures exist via report-view.spec; make sure here too (idempotent).
  const dt = await request.post('/api/table_def', {
    headers: auth,
    data: {
      name: DT,
      columns: [
        { column_name: 'title', column_type: 'Data', label: 'Title', in_list_view: true },
        { column_name: 'stage', column_type: 'Choice', label: 'Status', choices: 'Open\nClosed', in_list_view: true },
        { column_name: 'qty', column_type: 'Int', label: 'Qty', in_list_view: true },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  const listed = (await (
    await request.get(`/api/table/${encodeURIComponent(DT)}?limit_page_length=100`, { headers: auth })
  ).json()) as { data: { row_id: string }[] }
  for (const row of listed.data)
    await request.delete(`/api/table/${encodeURIComponent(DT)}/${row.row_id}`, { headers: auth })
  for (const [title, stage, qty] of [
    ['alpha', 'Open', 1],
    ['bravo', 'Open', 2],
    ['charlie', 'Closed', 5],
  ] as [string, string, number][]) {
    await request.post(`/api/table/${encodeURIComponent(DT)}`, {
      headers: auth,
      data: { title, stage, qty },
    })
  }
  await request.delete(`/api/table/Report/${encodeURIComponent(REPORT)}`, { headers: auth })
})

test('RPT-002: saved report restores columns, filters, and grouping', async ({ page }) => {
  // Configure: drop qty column, filter status=Open, group by status.
  await page.goto(`/admin/${encodeURIComponent(DT)}/view/report`)
  await expect(page.getByTestId('report-row')).toHaveCount(3)
  await page.getByTestId('report-columns').click()
  await page.getByTestId('report-col-qty').uncheck()
  await page.getByTestId('report-columns').click()
  await page.getByTestId('filter-field').selectOption('stage')
  await page.getByTestId('filter-value').fill('Open')
  await page.getByTestId('filter-add').click()
  await expect(page.getByTestId('report-row')).toHaveCount(2)
  await page.getByTestId('report-groupby').selectOption('stage')

  // Save it.
  await page.getByTestId('report-save').click()
  await page.getByTestId('report-save-name').fill(REPORT)
  await page.getByTestId('report-save-confirm').click()
  await expect(page).toHaveURL(/report=/)

  // Fresh navigation to the saved URL restores everything.
  await page.goto(
    `/admin/${encodeURIComponent(DT)}/view/report?report=${encodeURIComponent(REPORT)}`,
  )
  await expect(page.getByTestId('report-head-qty')).toHaveCount(0) // column choice
  await expect(page.getByTestId('report-groupby')).toHaveValue('stage') // grouping
  await expect(page.getByTestId('report-row')).toHaveCount(2) // filter applied
  const open = page.locator('[data-group="Open"]')
  await expect(open.getByTestId('group-count')).toContainText('(2)')

  // The picker also opens it from scratch.
  await page.goto(`/admin/${encodeURIComponent(DT)}/view/report`)
  await expect(page.getByTestId('report-row')).toHaveCount(3) // default state first
  await page.getByTestId('saved-report-picker').selectOption(REPORT)
  await expect(page.getByTestId('report-row')).toHaveCount(2)
  await expect(page.getByTestId('report-groupby')).toHaveValue('stage')
})

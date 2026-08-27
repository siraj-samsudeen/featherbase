import { test, expect, adminAuth } from './fixtures'

const REPORT = 'E2E User SR'

test.beforeAll(async ({ request }) => {
  const headers = await adminAuth(request)
  await request.delete(`/api/table/Report/${encodeURIComponent(REPORT)}`, { headers })
  const res = await request.post('/api/save_row', {
    headers,
    data: {
      table: 'Report',
      row: { row_id: REPORT, ref_table: 'User', report_type: 'Script Report', report_script: 'User Report' },
    },
  })
  if (res.status() !== 201) throw new Error(`create report: ${res.status()} ${await res.text()}`)
  // Ensure at least one disabled user exists so the filter has an effect.
  const u = 'sr-disabled@x.com'
  await request.delete(`/api/table/User/${encodeURIComponent(u)}`, { headers })
  await request.post('/api/save_row', {
    headers,
    data: { table: 'User', row: { row_id: u, email: u, full_name: 'SR Disabled', enabled: false } },
  })
})

// RPT-005: a registered script report renders its filter controls and data.
test('RPT-005: script report renders filter controls and data', async ({ page }) => {
  await page.goto(`/admin/script-report/${encodeURIComponent(REPORT)}`)
  await expect(page.getByTestId('script-report-title')).toHaveText(REPORT)

  // Declared filter control renders, and data columns render.
  await expect(page.getByTestId('sr-filter-enabled')).toBeVisible()
  await expect(page.getByTestId('sr-col-row_id')).toBeVisible()
  await expect(page.getByTestId('sr-col-enabled')).toBeVisible()
  await expect(page.getByTestId('script-report-rows')).toContainText('Administrator')

  // Filtering to disabled users changes the data and drops Administrator.
  await page.getByTestId('sr-filter-enabled').selectOption('No')
  await page.getByTestId('script-report-run').click()
  await expect(page.getByTestId('script-report-rows')).toContainText('sr-disabled@x.com')
  await expect(page.getByTestId('script-report-rows')).not.toContainText('Administrator')
})

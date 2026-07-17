import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const REPORT = 'E2E User SR'

async function adminHeaders(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
}

test.beforeAll(async ({ request }) => {
  const headers = await adminHeaders(request)
  await request.delete(`/api/resource/Report/${encodeURIComponent(REPORT)}`, { headers })
  const res = await request.post('/api/save_doc', {
    headers,
    data: {
      doctype: 'Report',
      doc: { name: REPORT, ref_doctype: 'User', report_type: 'Script Report', report_script: 'User Report' },
    },
  })
  if (res.status() !== 201) throw new Error(`create report: ${res.status()} ${await res.text()}`)
  // Ensure at least one disabled user exists so the filter has an effect.
  const u = 'sr-disabled@x.com'
  await request.delete(`/api/resource/User/${encodeURIComponent(u)}`, { headers })
  await request.post('/api/save_doc', {
    headers,
    data: { doctype: 'User', doc: { name: u, email: u, full_name: 'SR Disabled', enabled: false } },
  })
})

// RPT-005: a registered script report renders its filter controls and data.
test('RPT-005: script report renders filter controls and data', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)

  await page.goto(`/desk/script-report/${encodeURIComponent(REPORT)}`)
  await expect(page.getByTestId('script-report-title')).toHaveText(REPORT)

  // Declared filter control renders, and data columns render.
  await expect(page.getByTestId('sr-filter-enabled')).toBeVisible()
  await expect(page.getByTestId('sr-col-name')).toBeVisible()
  await expect(page.getByTestId('sr-col-enabled')).toBeVisible()
  await expect(page.getByTestId('script-report-rows')).toContainText('Administrator')

  // Filtering to disabled users changes the data and drops Administrator.
  await page.getByTestId('sr-filter-enabled').selectOption('No')
  await page.getByTestId('script-report-run').click()
  await expect(page.getByTestId('script-report-rows')).toContainText('sr-disabled@x.com')
  await expect(page.getByTestId('script-report-rows')).not.toContainText('Administrator')
})

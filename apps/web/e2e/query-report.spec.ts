import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const REPORT = 'E2E Recent Users'

async function adminHeaders(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
}

test.beforeAll(async ({ request }) => {
  const headers = await adminHeaders(request)
  await request.delete(`/api/table/Report/${encodeURIComponent(REPORT)}`, { headers })
  const res = await request.post('/api/save_row', {
    headers,
    data: {
      table: 'Report',
      row: {
        row_id: REPORT,
        ref_table: 'User',
        report_type: 'Query Report',
        query: 'select row_id, enabled from "user" where created_at >= {from_date} order by row_id',
      },
    },
  })
  if (res.status() !== 201) throw new Error(`create report: ${res.status()} ${await res.text()}`)
})

// RPT-004: a Query Report with a date filter runs and renders.
test('RPT-004: a SQL report with a date filter runs and renders', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/admin/)

  await page.goto(`/admin/query-report/${encodeURIComponent(REPORT)}`)
  await expect(page.getByTestId('query-report-title')).toHaveText(REPORT)
  await expect(page.getByTestId('filter-from_date')).toBeVisible()
  await expect(page.getByTestId('qr-col-row_id')).toBeVisible()

  // A permissive date returns rows including Administrator.
  await page.getByTestId('filter-from_date').fill('2000-01-01')
  await page.getByTestId('query-report-run').click()
  await expect(page.getByTestId('query-report-rows')).toContainText('Administrator')

  // A future date filters everything out — the filter genuinely drives the SQL.
  await page.getByTestId('filter-from_date').fill('2999-01-01')
  await page.getByTestId('query-report-run').click()
  await expect(page.getByTestId('query-report-empty')).toBeVisible()
})

// RPT-004: non-privileged users cannot author SQL. A Report-editor role that is
// not System Manager is rejected when it tries to create a Query Report.
test('RPT-004: a non-System-Manager cannot author Query Report SQL', async ({ request }) => {
  const headers = await adminHeaders(request)
  const ROLE = 'E2E Rpt Editor'
  const USER = 'e2e-rpt-editor@x.com'
  const PWD = 'rpteditor12345'

  await request.post('/api/save_row', { headers, data: { table: 'Role', row: { row_id: ROLE } } })
  await request.post('/api/save_row', {
    headers,
    data: { table: 'Permission', row: { ref_table: 'Report', role: ROLE, can_read: true, can_write: true, can_create: true } },
  })
  await request.post('/api/save_row', {
    headers,
    data: { table: 'User', row: { row_id: USER, email: USER, enabled: true, roles: [{ role: ROLE }] } },
  })
  await request.post('/api/set_password', { headers, data: { user: USER, password: PWD } })

  const login = await request.post('/api/login', { data: { usr: USER, pwd: PWD } })
  const userHeaders = { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }

  // Same role CAN create an ordinary report (proves it has base Report perms)…
  const ok = await request.post('/api/save_row', {
    headers: userHeaders,
    data: { table: 'Report', row: { row_id: 'E2E Editor Builder', ref_table: 'User', report_type: 'Report Builder' } },
  })
  expect(ok.status()).toBe(201)

  // …but is blocked from authoring SQL.
  const denied = await request.post('/api/save_row', {
    headers: userHeaders,
    data: {
      table: 'Report',
      row: { row_id: 'E2E Editor Evil', ref_table: 'User', report_type: 'Query Report', query: 'select row_id from "user"' },
    },
  })
  expect(denied.status()).toBe(403)
  expect(((await denied.json()) as { error: { type: string } }).error.type).toBe('PermissionError')

  // cleanup
  await request.delete(`/api/table/Report/${encodeURIComponent('E2E Editor Builder')}`, { headers })
})

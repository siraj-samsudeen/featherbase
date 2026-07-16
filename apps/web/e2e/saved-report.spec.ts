import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'RPT Task'
const REPORT = 'Open tasks by status'

// RPT-002: save a configured report; reopening it restores columns,
// filters, and grouping.

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const token = ((await login.json()) as { token: string }).token
  const auth = { Authorization: `Bearer ${token}` }
  // RPT Task fixtures exist via report-view.spec; make sure here too (idempotent).
  const dt = await request.post('/api/doctype', {
    headers: auth,
    data: {
      name: DT,
      fields: [
        { fieldname: 'title', fieldtype: 'Data', label: 'Title', in_list_view: true },
        { fieldname: 'status', fieldtype: 'Select', label: 'Status', options: 'Open\nClosed', in_list_view: true },
        { fieldname: 'qty', fieldtype: 'Int', label: 'Qty', in_list_view: true },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  const listed = (await (
    await request.get(`/api/resource/${encodeURIComponent(DT)}?limit_page_length=100`, { headers: auth })
  ).json()) as { data: { name: string }[] }
  for (const row of listed.data)
    await request.delete(`/api/resource/${encodeURIComponent(DT)}/${row.name}`, { headers: auth })
  for (const [title, status, qty] of [
    ['alpha', 'Open', 1],
    ['bravo', 'Open', 2],
    ['charlie', 'Closed', 5],
  ] as [string, string, number][]) {
    await request.post(`/api/resource/${encodeURIComponent(DT)}`, {
      headers: auth,
      data: { title, status, qty },
    })
  }
  await request.delete(`/api/resource/Report/${encodeURIComponent(REPORT)}`, { headers: auth })
})

test('RPT-002: saved report restores columns, filters, and grouping', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)

  // Configure: drop qty column, filter status=Open, group by status.
  await page.goto(`/desk/${encodeURIComponent(DT)}/view/report`)
  await expect(page.getByTestId('report-row')).toHaveCount(3)
  await page.getByTestId('report-columns').click()
  await page.getByTestId('report-col-qty').uncheck()
  await page.getByTestId('report-columns').click()
  await page.getByTestId('filter-field').selectOption('status')
  await page.getByTestId('filter-value').fill('Open')
  await page.getByTestId('filter-add').click()
  await expect(page.getByTestId('report-row')).toHaveCount(2)
  await page.getByTestId('report-groupby').selectOption('status')

  // Save it.
  await page.getByTestId('report-save').click()
  await page.getByTestId('report-save-name').fill(REPORT)
  await page.getByTestId('report-save-confirm').click()
  await expect(page).toHaveURL(/report=/)

  // Fresh navigation to the saved URL restores everything.
  await page.goto(
    `/desk/${encodeURIComponent(DT)}/view/report?report=${encodeURIComponent(REPORT)}`,
  )
  await expect(page.getByTestId('report-head-qty')).toHaveCount(0) // column choice
  await expect(page.getByTestId('report-groupby')).toHaveValue('status') // grouping
  await expect(page.getByTestId('report-row')).toHaveCount(2) // filter applied
  const open = page.locator('[data-group="Open"]')
  await expect(open.getByTestId('group-count')).toContainText('(2)')

  // The picker also opens it from scratch.
  await page.goto(`/desk/${encodeURIComponent(DT)}/view/report`)
  await expect(page.getByTestId('report-row')).toHaveCount(3) // default state first
  await page.getByTestId('saved-report-picker').selectOption(REPORT)
  await expect(page.getByTestId('report-row')).toHaveCount(2)
  await expect(page.getByTestId('report-groupby')).toHaveValue('status')
})

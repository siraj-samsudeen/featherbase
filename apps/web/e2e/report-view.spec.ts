import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'RPT Task'

// RPT-001: report view — group a list by a Select field; group rows show
// correct counts and sums; column picker toggles columns.

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const token = ((await login.json()) as { token: string }).token
  const auth = { Authorization: `Bearer ${token}` }

  const dt = await request.post('/api/doctype', {
    headers: auth,
    data: {
      name: DT,
      fields: [
        { fieldname: 'title', fieldtype: 'Data', label: 'Title', in_list_view: true },
        {
          fieldname: 'status',
          fieldtype: 'Select',
          label: 'Status',
          options: 'Open\nClosed',
          in_list_view: true,
        },
        { fieldname: 'qty', fieldtype: 'Int', label: 'Qty', in_list_view: true },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)

  // Deterministic dataset: wipe and reseed.
  const listed = (await (
    await request.get(`/api/resource/${encodeURIComponent(DT)}?limit_page_length=100`, {
      headers: auth,
    })
  ).json()) as { data: { name: string }[] }
  for (const row of listed.data)
    await request.delete(`/api/resource/${encodeURIComponent(DT)}/${row.name}`, { headers: auth })

  const seed: [string, string, number][] = [
    ['alpha', 'Open', 1],
    ['bravo', 'Open', 2],
    ['charlie', 'Closed', 5],
  ]
  for (const [title, status, qty] of seed) {
    const res = await request.post(`/api/resource/${encodeURIComponent(DT)}`, {
      headers: auth,
      data: { title, status, qty },
    })
    if (res.status() !== 201) throw new Error(`seed: ${res.status()}`)
  }
})

test('RPT-001: group by Select shows correct counts and sums; column picker works', async ({
  page,
}) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)

  // Enter through the list view's Report button.
  await page.goto(`/desk/${encodeURIComponent(DT)}`)
  await page.getByTestId('open-report').click()
  await expect(page.getByTestId('report-view')).toBeVisible()
  await expect(page.getByTestId('report-total')).toContainText('3 rows')
  await expect(page.getByTestId('report-row')).toHaveCount(3)

  // Grand total row sums qty across all rows: 1 + 2 + 5 = 8.
  await expect(page.getByTestId('grand-sum-qty')).toContainText('8')

  // Group by status: Open (2) sum 3, Closed (1) sum 5.
  await page.getByTestId('report-groupby').selectOption('status')
  const headers = page.getByTestId('group-header')
  await expect(headers).toHaveCount(2)

  const closed = page.locator('[data-group="Closed"]')
  await expect(closed.getByTestId('group-count')).toContainText('(1)')
  await expect(closed.getByTestId('group-sum-qty')).toContainText('5')

  const open = page.locator('[data-group="Open"]')
  await expect(open.getByTestId('group-count')).toContainText('(2)')
  await expect(open.getByTestId('group-sum-qty')).toContainText('3')

  // Collapsing a group hides its member rows.
  await open.click()
  await expect(page.getByTestId('report-row')).toHaveCount(1)
  await open.click()
  await expect(page.getByTestId('report-row')).toHaveCount(3)

  // Column picker: dropping qty removes its column header.
  await expect(page.getByTestId('report-head-qty')).toBeVisible()
  await page.getByTestId('report-columns').click()
  await page.getByTestId('report-col-qty').uncheck()
  await expect(page.getByTestId('report-head-qty')).toHaveCount(0)
  // …and adding one brings it in.
  await page.getByTestId('report-col-qty').check()
  await expect(page.getByTestId('report-head-qty')).toBeVisible()
})

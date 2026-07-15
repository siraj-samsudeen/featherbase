import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT_A = 'UI List A'
const DT_B = 'UI List B'

async function adminToken(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/login', {
    data: { usr: 'Administrator', pwd: ADMIN_PWD },
  })
  return ((await res.json()) as { token: string }).token
}

async function ensureFixtures(request: APIRequestContext) {
  const token = await adminToken(request)
  const auth = { Authorization: `Bearer ${token}` }

  for (const [name, fields] of [
    [
      DT_A,
      [
        { fieldname: 'title', fieldtype: 'Data', label: 'Title', in_list_view: true },
        { fieldname: 'qty', fieldtype: 'Int', label: 'Qty', in_list_view: true },
      ],
    ],
    [
      DT_B,
      [
        { fieldname: 'city', fieldtype: 'Data', label: 'City', in_list_view: true },
        { fieldname: 'active', fieldtype: 'Check', label: 'Active', in_list_view: true },
      ],
    ],
  ] as const) {
    const meta = await request.get(`/api/meta/${encodeURIComponent(name)}`, { headers: auth })
    if (meta.status() === 404) {
      await request.post('/api/doctype', { headers: auth, data: { name, fields } })
    }
  }

  const listA = await request.get(
    `/api/resource/${encodeURIComponent(DT_A)}?limit_page_length=1`,
    { headers: auth },
  )
  const totalA = ((await listA.json()) as { total: number }).total
  for (let i = totalA; i < 30; i++) {
    await request.post(`/api/resource/${encodeURIComponent(DT_A)}`, {
      headers: auth,
      data: { title: `item-${String(i).padStart(2, '0')}`, qty: i },
    })
  }

  const listB = await request.get(
    `/api/resource/${encodeURIComponent(DT_B)}?limit_page_length=1`,
    { headers: auth },
  )
  const totalB = ((await listB.json()) as { total: number }).total
  for (let i = totalB; i < 3; i++) {
    await request.post(`/api/resource/${encodeURIComponent(DT_B)}`, {
      headers: auth,
      data: { city: `city-${i}`, active: i % 2 === 0 },
    })
  }
}

test.beforeAll(async ({ request }) => {
  await ensureFixtures(request)
})

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL(/\/desk/)
}

test('UI-002: one generic ListView renders two different DocTypes with sort + pagination', async ({ page }) => {
  await login(page)

  // --- DocType A: metadata columns, pagination
  await page.goto(`/desk/${encodeURIComponent(DT_A)}`)
  await expect(page.getByTestId('col-title')).toContainText('Title')
  await expect(page.getByTestId('col-qty')).toContainText('Qty')
  await expect(page.getByTestId('list-total')).toContainText('30 total')
  await expect(page.getByTestId('list-rows').locator('tr')).toHaveCount(20)
  await expect(page.getByTestId('page-info')).toContainText('1–20 of 30')

  await page.getByTestId('next-page').click()
  await expect(page.getByTestId('page-info')).toContainText('21–30 of 30')
  await expect(page.getByTestId('list-rows').locator('tr')).toHaveCount(10)
  await expect(page.getByTestId('prev-page')).toBeEnabled()
  await expect(page.getByTestId('next-page')).toBeDisabled()

  // --- Sorting: qty asc puts qty=0 first; desc puts qty=29 first
  await page.getByTestId('col-qty').click()
  await expect(page.getByTestId('page-info')).toContainText('1–20 of 30')
  await expect(page.getByTestId('list-rows').locator('tr').first()).toContainText('item-00')
  await page.getByTestId('col-qty').click()
  await expect(page.getByTestId('list-rows').locator('tr').first()).toContainText('item-29')

  // --- DocType B: same component, entirely different columns
  await page.goto(`/desk/${encodeURIComponent(DT_B)}`)
  await expect(page.getByTestId('col-city')).toContainText('City')
  await expect(page.getByTestId('col-active')).toContainText('Active')
  await expect(page.getByTestId('list-total')).toContainText('3 total')
  await expect(page.getByTestId('list-rows').locator('tr')).toHaveCount(3)
  await expect(page.getByTestId('list-rows')).toContainText('✓')

  // Row link navigates to the document route
  await page.getByTestId('list-rows').locator('tr').first().locator('a').click()
  await expect(page.getByTestId('doc-page')).toBeVisible()
})

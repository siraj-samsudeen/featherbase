import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'Ls DT'

// UI-013: customize a list (hide a column, set a sort), log out and back in,
// the settings are restored.

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const headers = { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
  const dt = await request.post('/api/doctype', {
    headers,
    data: {
      name: DT,
      fields: [
        { fieldname: 'title', fieldtype: 'Data', label: 'Title', in_list_view: true },
        { fieldname: 'city', fieldtype: 'Data', label: 'City', in_list_view: true },
        { fieldname: 'rank', fieldtype: 'Int', label: 'Rank', in_list_view: true },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  // Reset this user's saved settings for a clean start.
  await request.put(`/api/user_settings/${encodeURIComponent(DT)}`, { headers, data: {} })
  for (const [title, city, rank] of [
    ['alpha', 'NYC', 3],
    ['bravo', 'LA', 1],
    ['charlie', 'SF', 2],
  ] as [string, string, number][]) {
    const r = await request.post(`/api/resource/${encodeURIComponent(DT)}`, { headers, data: { title, city, rank } })
    if (![201, 409].includes(r.status())) throw new Error(`seed: ${r.status()}`)
  }
})

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)
}

test('UI-013: list customizations persist across logout/login', async ({ page }) => {
  await login(page)
  await page.goto(`/desk/${encodeURIComponent(DT)}`)

  // Baseline: City column visible.
  await expect(page.getByTestId('col-city')).toBeVisible()

  // Customize: hide City, sort ascending by Rank.
  await page.getByTestId('list-columns').click()
  await page.getByTestId('list-col-toggle-city').uncheck()
  await page.getByTestId('list-columns').click() // close picker
  await expect(page.getByTestId('col-city')).toHaveCount(0)

  await page.getByTestId('col-rank').click() // sort asc by rank
  // First data row should be rank 1 (bravo) once sorted ascending.
  await expect(page.getByTestId('list-rows').locator('tr').first()).toContainText('bravo')

  // Give the debounced PUT a moment, then log out and back in.
  await page.waitForTimeout(300)
  await page.getByTestId('logout').click()
  await expect(page).toHaveURL(/\/login/)
  await login(page)
  await page.goto(`/desk/${encodeURIComponent(DT)}`)

  // Restored: City still hidden, sort still ascending by rank (bravo first).
  await expect(page.getByTestId('col-city')).toHaveCount(0)
  await expect(page.getByTestId('col-title')).toBeVisible()
  await expect(page.getByTestId('list-rows').locator('tr').first()).toContainText('bravo')
})

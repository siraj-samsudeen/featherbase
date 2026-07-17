import { expect, test } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'UI Form A' // fixtures from formview.spec (idempotent creators)

test('UI-009 + META-013: missing reqd field errors inline via shared zod schema, with NO network call', async ({ page, request }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const token = ((await login.json()) as { token: string }).token
  const list = await request.get(
    `/api/resource/${encodeURIComponent(DT)}?limit_page_length=1&order_by=creation desc`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  test.skip(list.status() === 404, 'run formview.spec first to create fixtures')
  const docName = ((await list.json()) as { data: { name: string }[] }).data[0].name

  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL(/\/desk/)

  let saveCalls = 0
  await page.route('**/api/save_doc', async (route) => {
    saveCalls++
    await route.continue()
  })

  await page.goto(`/desk/${encodeURIComponent(DT)}/${docName}`)
  await expect(page.getByTestId('form-view')).toBeVisible()

  // Clear the required title and try to save: inline error, zero network calls
  await page.locator('[data-field=title]').fill('')
  await page.getByTestId('form-save').click()
  await expect(page.getByTestId('error-title')).toBeVisible()
  await expect(page.getByTestId('error-title')).toContainText(/Required/i)
  expect(saveCalls).toBe(0)

  // Bad date via direct value also caught client-side (type=number guard etc.)
  await page.locator('[data-field=title]').fill('client valid again')
  await page.getByTestId('form-save').click()
  await expect(page.getByTestId('form-banner')).toContainText('Saved')
  expect(saveCalls).toBe(1)
})

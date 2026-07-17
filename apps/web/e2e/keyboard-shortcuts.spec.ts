import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'KB E2E Doc'

async function adminHeaders(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
}

let docName: string

test.beforeAll(async ({ request }) => {
  const headers = await adminHeaders(request)
  const dt = await request.post('/api/doctype', {
    headers,
    data: { name: DT, fields: [{ fieldname: 'title', fieldtype: 'Data', in_list_view: true }] },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  const doc = await request.post(`/api/resource/${encodeURIComponent(DT)}`, { headers, data: { title: 'orig' } })
  docName = ((await doc.json()) as { name: string }).name
})

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)
}

// UI-015: Ctrl/Cmd+S saves the current form.
test('UI-015: Ctrl+S saves the form', async ({ page }) => {
  await login(page)
  await page.goto(`/desk/${encodeURIComponent(DT)}/${docName}`)
  await expect(page.getByTestId('form-view')).toBeVisible()
  await page.locator('[data-field=title]').fill(`kb-${Date.now()}`)
  await page.keyboard.press('Control+s')
  await expect(page.getByTestId('form-banner')).toContainText('Saved')
})

// UI-015: Ctrl/Cmd+B opens a new document of the current DocType.
test('UI-015: Ctrl+B opens a new document', async ({ page }) => {
  await login(page)
  await page.goto(`/desk/${encodeURIComponent(DT)}`)
  await expect(page.getByTestId('list-view')).toBeVisible()
  await page.keyboard.press('Control+b')
  await expect(page).toHaveURL(new RegExp(`/desk/${encodeURIComponent(DT)}/new`))
  await expect(page.getByTestId('form-view')).toBeVisible()
})

// UI-015: the "g then d" leader sequence navigates to the Desk home.
test('UI-015: g then d navigates to the Desk home', async ({ page }) => {
  await login(page)
  await page.goto(`/desk/${encodeURIComponent(DT)}/${docName}`)
  await expect(page.getByTestId('form-view')).toBeVisible()
  await page.locator('body').click() // ensure focus is not in an input
  await page.keyboard.press('g')
  await page.keyboard.press('d')
  await expect(page).toHaveURL(/\/desk$/)
})

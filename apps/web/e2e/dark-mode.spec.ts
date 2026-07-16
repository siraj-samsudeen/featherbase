import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'

async function login(page: Page) {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)
}

async function serverTheme(request: APIRequestContext): Promise<string> {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const token = ((await login.json()) as { token: string }).token
  const who = (await (await request.get('/api/whoami', { headers: { Authorization: `Bearer ${token}` } })).json()) as {
    theme?: string
  }
  return who.theme ?? 'light'
}

// Ensure the account starts (and ends) in light mode so this test is isolated.
test.beforeEach(async ({ request }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const token = ((await login.json()) as { token: string }).token
  await request.post('/api/set_theme', { headers: { Authorization: `Bearer ${token}` }, data: { theme: 'light' } })
})
test.afterEach(async ({ request }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const token = ((await login.json()) as { token: string }).token
  await request.post('/api/set_theme', { headers: { Authorization: `Bearer ${token}` }, data: { theme: 'light' } })
})

// UI-024: toggling dark mode re-skins the UI and the preference persists
// per-user (server-side), surviving a reload.
test('UI-024: dark mode toggles, persists across reload, and is stored per-user', async ({ page, request }) => {
  await login(page)
  const html = page.locator('html')

  // Starts light.
  await expect(html).not.toHaveAttribute('data-theme', 'dark')
  const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)

  // Toggle to dark: the root marks dark and the canvas darkens.
  await page.getByTestId('theme-toggle').click()
  await expect(html).toHaveAttribute('data-theme', 'dark')
  const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(darkBg).not.toBe(lightBg)

  // The preference is stored server-side, per user.
  await expect.poll(() => serverTheme(request)).toBe('dark')

  // It survives a reload (no flash back to light).
  await page.reload()
  await page.waitForURL(/\/desk/)
  await expect(html).toHaveAttribute('data-theme', 'dark')
})

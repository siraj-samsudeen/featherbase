import { test, expect, adminToken, type APIRequestContext } from './fixtures'

async function serverTheme(request: APIRequestContext): Promise<string> {
  const token = await adminToken(request)
  const who = (await (await request.get('/api/whoami', { headers: { Authorization: `Bearer ${token}` } })).json()) as {
    theme?: string
  }
  return who.theme ?? 'light'
}

// Ensure the account starts (and ends) in light mode so this test is isolated.
test.beforeEach(async ({ request }) => {
  const token = await adminToken(request)
  await request.post('/api/set_theme', { headers: { Authorization: `Bearer ${token}` }, data: { theme: 'light' } })
})
test.afterEach(async ({ request }) => {
  const token = await adminToken(request)
  await request.post('/api/set_theme', { headers: { Authorization: `Bearer ${token}` }, data: { theme: 'light' } })
})

// UI-024: toggling dark mode re-skins the UI and the preference persists
// per-user (server-side), surviving a reload.
test('UI-024: dark mode toggles, persists across reload, and is stored per-user', async ({ page, request }) => {
  await page.goto('/admin')
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
  await page.waitForURL(/\/admin/)
  await expect(html).toHaveAttribute('data-theme', 'dark')
})

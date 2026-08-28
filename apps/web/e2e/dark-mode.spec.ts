import { test, expect, adminToken } from './fixtures'

// UI-024, browser-only remainder. The toggle's DOM effect, its per-user
// server storage, and a fresh load reading it back are all component tests
// now (apps/web/test/theme.test.tsx, #223 batch 1). What no jsdom test can
// see is the payoff: jsdom loads no stylesheet and computes no cascade, so
// only a real browser can say whether marking the root `dark` actually
// repaints the canvas. That one assertion is what is left here.

test.beforeEach(async ({ request }) => {
  const token = await adminToken(request)
  await request.post('/api/set_theme', { headers: { Authorization: `Bearer ${token}` }, data: { theme: 'light' } })
})
test.afterEach(async ({ request }) => {
  const token = await adminToken(request)
  await request.post('/api/set_theme', { headers: { Authorization: `Bearer ${token}` }, data: { theme: 'light' } })
})

test('UI-024: switching to dark actually repaints the canvas', async ({ page }) => {
  await page.goto('/admin')
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark')
  const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)

  await page.getByTestId('theme-toggle').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(darkBg).not.toBe(lightBg)
})

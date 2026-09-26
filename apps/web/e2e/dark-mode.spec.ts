import { test, expect, adminToken } from './fixtures'

// UI-024, browser-only remainder. The toggle's DOM effect, its per-user
// server storage, and a fresh load reading it back are all component tests
// now (apps/web/test/theme.test.tsx, #223 batch 1). What no jsdom test can
// see is the payoff: jsdom loads no stylesheet and computes no cascade, so
// only a real browser can say whether marking the root `dark` actually
// repaints the canvas. That one assertion is what is left here.
//
// Migrated to the feather-testing-core DSL (docs/testing/e2e-dsl-migration.md).

test.beforeEach(async ({ request }) => {
  const token = await adminToken(request)
  await request.post('/api/set_theme', { headers: { Authorization: `Bearer ${token}` }, data: { theme: 'light' } })
})
test.afterEach(async ({ request }) => {
  const token = await adminToken(request)
  await request.post('/api/set_theme', { headers: { Authorization: `Bearer ${token}` }, data: { theme: 'light' } })
})

test('UI-024: switching to dark actually repaints the canvas', async ({ session }) => {
  let lightBg = ''
  await session
    .visit('/admin')
    .within('html', (root) => root.assertAttribute('data-theme', 'light'))
    .step('read the light canvas background', async ({ page }) => {
      lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    })
    .click('🌙')
    .within('html', (root) => root.assertAttribute('data-theme', 'dark'))
    .step('compare the repainted dark canvas background', async ({ page }) => {
      const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
      expect(darkBg).not.toBe(lightBg)
  })
})

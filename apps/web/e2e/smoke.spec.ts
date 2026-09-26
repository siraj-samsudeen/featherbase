import { anonymousTest as test, expect } from './fixtures'

// Migrated to the feather-testing-core DSL (docs/testing/e2e-dsl-migration.md).
// `./init.sh` runs this file's `playwright test e2e/smoke.spec.ts` directly
// (apps/web/package.json's `smoke` script) against whatever stack it just
// booted, non-isolated — see the note atop apps/web/playwright.config.ts.
// Nothing about that changes here: this file still imports `anonymousTest`
// and its tests still resolve against `WEB_URL`/the default baseURL exactly
// as before; only the test bodies move onto Session verbs.
test('app boots: root redirects to login and the form renders', async ({ session }) => {
  await session.visit('/').assertPath('/featherbase/login').assertHas('[data-testid="login-form"]')
  await session.step('the Sign in button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  })
})

test('legacy login query reaches the server redirect and preserves its return location', async ({ session }) => {
  await session
    .visit('/login?next=%2Ffeatherbase%2Fadmin%2Faccess-tokens')
    .assertPath('/featherbase/login', { queryParams: { next: '/featherbase/admin/access-tokens' } })
    .assertHas('[data-testid="login-form"]')
})

test('api is reachable through the web proxy', async ({ request }) => {
  const res = await request.get('/api/ping')
  expect(res.ok()).toBeTruthy()
  expect(await res.json()).toMatchObject({ message: 'pong', db: true })
})

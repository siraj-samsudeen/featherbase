import { anonymousTest as test, expect } from './fixtures'

// The dev-preview click-through link, exercised the way it is actually used:
// paste a URL into a fresh browser and expect to be inside the app, as an
// ordinary named user rather than Administrator.
//
// Skipped unless the server under test was started with preview sign-in on,
// because that is the only configuration in which the route exists at all —
// which is itself the property this suite is defending.
const KEY = process.env.PREVIEW_LOGIN_KEY ?? ''
const USER = process.env.PREVIEW_LOGIN_USER ?? ''

test.describe('preview sign-in', () => {
  test.skip(!KEY || !USER, 'server not started with PREVIEW_LOGIN_KEY / PREVIEW_LOGIN_USER')

  // Migrated to the feather-testing-core DSL (docs/testing/e2e-dsl-migration.md).
  // Every check here is an attribute/URL/localStorage assertion the DSL has
  // no verb for, so each logical chunk stays a named step around
  // `session.visit`.
  test('the link lands inside the app, signed in as the preview user', async ({ session }) => {
    // A brand-new context: no cookie, no localStorage, nothing but the URL.
    await session.visit(`/preview?key=${encodeURIComponent(KEY)}`)

    await session.step('lands straight into the Desk, not the login form', async ({ page }) => {
      await expect(page).toHaveURL(/\/admin/, { timeout: 15_000 })
      await expect(page.locator('input[name=password]')).toHaveCount(0)
    })

    await session.step('signed in as the named user, not Administrator', async ({ page }) => {
      // Signed in as the named user — the SPA's own session, not just a
      // cookie the server happens to honour.
      const stored = await page.evaluate(() => localStorage.getItem('fc_user'))
      expect(stored).toContain(USER)
      // …and NOT as Administrator, which is the entire point of the exercise.
      expect(stored).not.toContain('Administrator')
    })
  })

  test('the session token never appears in a URL along the way', async ({ session, page }) => {
    // #150/#173 removed 7-day JWTs from URLs. The preview link must not
    // quietly reintroduce one, so record every URL the browser visits.
    const urls: string[] = []
    page.on('framenavigated', (f) => urls.push(f.url()))
    await session.visit(`/preview?key=${encodeURIComponent(KEY)}`)
    await session.step('lands in /admin', async ({ page }) => {
      await expect(page).toHaveURL(/\/admin/, { timeout: 15_000 })
    })

    const token = await page.evaluate(() => localStorage.getItem('fc_token'))
    expect(token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/)
    for (const url of urls) expect(url).not.toContain(token as string)
    // The handoff code is what travelled instead.
    expect(urls.some((u) => u.includes('/oauth-callback?code='))).toBe(true)
  })

  test('a wrong key does not sign anyone in', async ({ session, page }) => {
    await session.visit('/preview?key=definitely-not-the-key')
    // 404 falls through to the SPA shell, which bounces a signed-out visitor
    // to the login form. What matters: no session was established.
    const stored = await page.evaluate(() => localStorage.getItem('fc_user'))
    expect(stored).toBeNull()
  })

  test('the preview user sees the app as a non-Administrator', async ({ session }) => {
    await session.visit(`/preview?key=${encodeURIComponent(KEY)}`)
    await session.step('lands in /admin and opens the import wizard', async ({ page }) => {
      await expect(page).toHaveURL(/\/admin/, { timeout: 15_000 })

      // The import wizard is reachable and usable — the System Manager role
      // is what makes the new-Table path work, and a preview that could not
      // create a Table would show a permission wall instead of the feature.
      await page.getByTestId('import-data-link').click()
      await expect(page.getByTestId('import-wizard')).toBeVisible()
    })
  })
})

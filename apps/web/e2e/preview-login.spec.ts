import { expect, test } from '@playwright/test'

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

  test('the link lands inside the app, signed in as the preview user', async ({ page }) => {
    // A brand-new context: no cookie, no localStorage, nothing but the URL.
    await page.goto(`/preview?key=${encodeURIComponent(KEY)}`)

    // Straight into the Desk, not the login form.
    await expect(page).toHaveURL(/\/admin/, { timeout: 15_000 })
    await expect(page.locator('input[name=password]')).toHaveCount(0)

    // Signed in as the named user — the SPA's own session, not just a cookie
    // the server happens to honour.
    const stored = await page.evaluate(() => localStorage.getItem('fc_user'))
    expect(stored).toContain(USER)

    // …and NOT as Administrator, which is the entire point of the exercise.
    expect(stored).not.toContain('Administrator')
  })

  test('the session token never appears in a URL along the way', async ({ page }) => {
    // #150/#173 removed 7-day JWTs from URLs. The preview link must not
    // quietly reintroduce one, so record every URL the browser visits.
    const urls: string[] = []
    page.on('framenavigated', (f) => urls.push(f.url()))
    await page.goto(`/preview?key=${encodeURIComponent(KEY)}`)
    await expect(page).toHaveURL(/\/admin/, { timeout: 15_000 })

    const token = await page.evaluate(() => localStorage.getItem('fc_token'))
    expect(token).toBeTruthy()
    for (const url of urls) expect(url).not.toContain(token as string)
    // The handoff code is what travelled instead.
    expect(urls.some((u) => u.includes('/oauth-callback?code='))).toBe(true)
  })

  test('a wrong key does not sign anyone in', async ({ page }) => {
    await page.goto('/preview?key=definitely-not-the-key')
    // 404 falls through to the SPA shell, which bounces a signed-out visitor
    // to the login form. What matters: no session was established.
    const stored = await page.evaluate(() => localStorage.getItem('fc_user'))
    expect(stored).toBeNull()
  })

  test('the preview user sees the app as a non-Administrator', async ({ page }) => {
    await page.goto(`/preview?key=${encodeURIComponent(KEY)}`)
    await expect(page).toHaveURL(/\/admin/, { timeout: 15_000 })

    // The import wizard is reachable and usable — the System Manager role is
    // what makes the new-Table path work, and a preview that could not create
    // a Table would show a permission wall instead of the feature.
    await page.getByTestId('import-data-link').click()
    await expect(page.getByTestId('import-wizard')).toBeVisible()
  })
})

import { anonymousTest as test, expect, adminToken, loginAs, type APIRequestContext } from './fixtures'

async function serverPalette(request: APIRequestContext): Promise<string> {
  const token = await adminToken(request)
  const who = (await (
    await request.get('/api/whoami', { headers: { Authorization: `Bearer ${token}` } })
  ).json()) as { palette?: string }
  return who.palette ?? 'classic'
}

// Ensure the account starts (and ends) on the classic palette so this test
// is isolated — same pattern as dark-mode.spec.ts.
async function resetPalette(request: APIRequestContext) {
  const token = await adminToken(request)
  await request.post('/api/set_palette', {
    headers: { Authorization: `Bearer ${token}` },
    data: { palette: 'classic' },
  })
}
test.beforeEach(async ({ request }) => resetPalette(request))
test.afterEach(async ({ request }) => resetPalette(request))

// UI-025: the palette picker re-skins the UI (second theming axis alongside
// light/dark), persists per-user on the server, and survives a reload.
//
// Migrated to the feather-testing-core DSL (docs/testing/e2e-dsl-migration.md).
// Every check here is a `data-*` attribute assertion or a computed-style/
// localStorage evaluate — none has a Session verb — so the body stays a
// sequence of named steps around `loginAs`/`serverPalette` exactly as before.
test('UI-025: palette switches, persists across reload, and is stored per-user', async ({ session, request }) => {
  await session.step('sign in as Administrator', async ({ page }) => {
    await loginAs(page)
  })

  await session.step('starts classic: no data-palette attribute, Frappe-blue brand', async ({ page }) => {
    const html = page.locator('html')
    await expect(html).not.toHaveAttribute('data-palette', /./)
    const classicBrand = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-brand').trim(),
    )
    expect(classicBrand).toBe('#2490ef')
  })

  await session.step('pick ivory: the root is stamped and the brand token changes to clay', async ({ page }) => {
    const html = page.locator('html')
    await page.getByTestId('palette-select').selectOption('ivory')
    await expect(html).toHaveAttribute('data-palette', 'ivory')
    const ivoryBrand = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-brand').trim(),
    )
    expect(ivoryBrand).toBe('#c15f3c')
  })

  // The preference is stored server-side, per user.
  await expect.poll(() => serverPalette(request)).toBe('ivory')

  await session.step('survives a reload (localStorage mirror applies before whoami)', async ({ page }) => {
    await page.reload()
    await page.waitForURL(/\/admin/)
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'ivory')
  })

  await session.step('palette composes with dark mode: both attributes coexist', async ({ page }) => {
    const html = page.locator('html')
    await page.getByTestId('theme-toggle').click()
    await expect(html).toHaveAttribute('data-theme', 'dark')
    await expect(html).toHaveAttribute('data-palette', 'ivory')
    await page.getByTestId('theme-toggle').click()
  })

  // The server rejects unknown palettes.
  const token = await adminToken(request)
  const bad = await request.post('/api/set_palette', {
    headers: { Authorization: `Bearer ${token}` },
    data: { palette: 'neon' },
  })
  expect(bad.status()).toBe(417)

  // Logging out clears the cached identity and the theming attributes, and
  // the mirror is scoped per user — the next account in this tab must not
  // inherit this user's palette (PR #92 review).
  await session.step('logging out clears cached identity/theming; the mirror stays scoped per user', async ({ page }) => {
    const html = page.locator('html')
    await page.getByTestId('session-user').click()
    await page.getByTestId('logout').click()
    await page.waitForURL(/\/login/)
    await expect(html).not.toHaveAttribute('data-palette', /./)
    const mirror = await page.evaluate(() => ({
      scoped: localStorage.getItem('fc_palette:Administrator'),
      global: localStorage.getItem('fc_palette'),
    }))
    expect(mirror.scoped).toBe('ivory')
    expect(mirror.global).toBeNull()
  })
})

// The palette picker stays reachable on mobile via the account menu, where
// the navbar selects collapse to avoid horizontal overflow (PR #92 review).
test('UI-025: on mobile the palette moves into the account menu and the navbar does not overflow', async ({ session, request }) => {
  await session.step('sign in on a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 720 })
    await loginAs(page)
  })

  await session.step('the palette select is hidden and the navbar does not overflow', async ({ page }) => {
    await expect(page.getByTestId('palette-select')).toBeHidden()
    const noOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    )
    expect(noOverflow).toBe(true)
  })

  await session.step('switch to graphite from the account menu', async ({ page }) => {
    await page.getByTestId('session-user').click()
    await page.getByTestId('palette-select-mobile').selectOption('graphite')
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'graphite')
  })
  // Wait for the write to land before afterEach resets it, so the reset
  // cannot race the in-flight set_palette request.
  await expect.poll(() => serverPalette(request)).toBe('graphite')
})

// The exact leak from the PR #92 review: A picks a palette and logs out; B
// logs in in the SAME tab and must get their own look — not A's still-fresh
// cached whoami or localStorage mirror.
test('UI-025: a second user in the same tab does not inherit the first user’s palette', async ({ session, request }) => {
  const USER_B = 'palette-e2e@x.com'
  const token = await adminToken(request)
  const headers = { Authorization: `Bearer ${token}` }
  const created = await request.post('/api/save_row', {
    headers,
    data: { table: 'User', row: { row_id: USER_B, email: USER_B, full_name: 'Palette E2E', enabled: true } },
  })
  if (created.status() !== 201) throw new Error(`create user: ${created.status()} ${await created.text()}`)
  await request.post('/api/set_password', { headers, data: { user: USER_B, password: 'palettepw123' } })

  // A (Administrator) picks Ivory; wait for it to persist server-side.
  await session.step('A (Administrator) picks Ivory', async ({ page }) => {
    await loginAs(page)
    await page.getByTestId('palette-select').selectOption('ivory')
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'ivory')
  })
  await expect.poll(() => serverPalette(request)).toBe('ivory')

  // A logs out; B logs in in the same tab.
  await session.step('A logs out; B logs in in the same tab', async ({ page }) => {
    await page.getByTestId('session-user').click()
    await page.getByTestId('logout').click()
    await page.waitForURL(/\/login/)
    await page.fill('input[name=email]', USER_B)
    await page.fill('input[name=password]', 'palettepw123')
    await page.click('button[type=submit]')
    await page.waitForURL(/\/admin/)
    await expect(page.getByTestId('session-user')).toBeVisible()
  })

  // B sees their own (classic) look immediately — and still does after
  // whoami has had time to resolve, which is when the leaked cache used to
  // flip the palette back to A's.
  await session.step('B sees their own (classic) look, even after whoami settles', async ({ page }) => {
    await expect(page.locator('html')).not.toHaveAttribute('data-palette', /./)
    const settled = await page.evaluate(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(document.documentElement.dataset.palette ?? null), 800),
        ),
    )
    expect(settled).toBeNull()
  })
})

import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'

async function login(page: Page) {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)
}

async function adminToken(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return ((await res.json()) as { token: string }).token
}

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
test('UI-025: palette switches, persists across reload, and is stored per-user', async ({ page, request }) => {
  await login(page)
  const html = page.locator('html')

  // Starts classic: no data-palette attribute, Frappe-blue brand.
  await expect(html).not.toHaveAttribute('data-palette', /./)
  const classicBrand = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--color-brand').trim(),
  )
  expect(classicBrand).toBe('#2490ef')

  // Pick ivory: the root is stamped and the brand token changes to clay.
  await page.getByTestId('palette-select').selectOption('ivory')
  await expect(html).toHaveAttribute('data-palette', 'ivory')
  const ivoryBrand = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--color-brand').trim(),
  )
  expect(ivoryBrand).toBe('#c15f3c')

  // The preference is stored server-side, per user.
  await expect.poll(() => serverPalette(request)).toBe('ivory')

  // It survives a reload (localStorage mirror applies before whoami).
  await page.reload()
  await page.waitForURL(/\/desk/)
  await expect(html).toHaveAttribute('data-palette', 'ivory')

  // Palette composes with dark mode: both attributes coexist.
  await page.getByTestId('theme-toggle').click()
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await expect(html).toHaveAttribute('data-palette', 'ivory')
  await page.getByTestId('theme-toggle').click()

  // The server rejects unknown palettes.
  const token = await adminToken(request)
  const bad = await request.post('/api/set_palette', {
    headers: { Authorization: `Bearer ${token}` },
    data: { palette: 'neon' },
  })
  expect(bad.status()).toBe(417)
})

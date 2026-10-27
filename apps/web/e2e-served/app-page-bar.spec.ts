// #650: an installed app's own page, served as production serves it: the
// built web app's bar bundle (/featherbase/bar.js, a second Vite entry) draws
// the shared top bar over the app's page, and the page keeps the response the
// app's page always had: its frame policy (E4), its own assets, the client
// version header on the platform's requests, and the person's identity.
// playwright.served.config.ts lists the bar-proof fixture app.
import { test, expect, type APIRequestContext } from '@playwright/test'

const PAGE = '/barproof/report?store=S103'

async function adminHeaders(request: APIRequestContext) {
  const res = await request.post('/api/login', { data: { usr: 'Administrator', pwd: process.env.ADMIN_PASSWORD ?? 'admin' } })
  expect(res.status()).toBe(200)
  return { Authorization: `Bearer ${((await res.json()) as { token: string }).token}` }
}

test.beforeAll(async ({ request }) => {
  const headers = await adminHeaders(request)
  for (const name of ['placeroster', 'barproof']) {
    const installed = await request.post('/api/install_app', { headers, data: { name } })
    expect([201, 409]).toContain(installed.status())
  }
})

test("the built bar bundle draws the shared bar over an app's page, and the page is served as before", async ({ page }) => {
  await page.goto('/featherbase/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', process.env.ADMIN_PASSWORD ?? 'admin')
  await page.click('button[type=submit]')
  await expect(page.getByTestId('session-user')).toBeVisible()

  const versioned = page.waitForRequest((request) => request.url().endsWith('/api/app_bar/barproof'))
  const response = (await page.goto(PAGE))!
  await test.step('the page keeps its frame policy and serving headers', async () => {
    expect(response.status()).toBe(200)
    expect(response.headers()['content-security-policy']).toBe("frame-src 'self'")
    expect(response.headers()['cache-control']).toBe('no-store')
    expect(response.headers()['x-content-type-options']).toBe('nosniff')
  })
  await test.step("the app's own page and the bar's script are both served", async () => {
    await expect(page.locator('#bar-proof-page')).toBeVisible()
    await expect(page.locator('#store-on-load')).toHaveText('S103')
    const script = await page.request.get('/featherbase/bar.js')
    expect([script.status(), script.headers()['content-type']]).toEqual([200, expect.stringMatching(/javascript/)])
  })
  await test.step('the bar is drawn, as the signed-in person, with the client version header on its requests', async () => {
    await expect(page.getByTestId('top-bar-name')).toHaveText('Bar proof')
    await page.getByTestId('session-user').click()
    await expect(page.getByTestId('account-identity')).toContainText('Administrator')
    expect((await versioned).headers()['x-featherbase-app-version']).toMatch(/barproof@/)
  })
})

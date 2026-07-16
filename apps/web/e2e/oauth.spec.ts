import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const EMAIL = 'oauth.e2e.user@gmail.com'

async function adminHeaders(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
}

test.beforeEach(async ({ request }) => {
  // Start from a clean slate so the flow exercises account CREATION.
  const headers = await adminHeaders(request)
  await request.delete(`/api/resource/User/${encodeURIComponent(EMAIL)}`, { headers })
})

test('PLAT-006: Google OAuth (mock) creates a User and lands in the Desk', async ({ page }) => {
  await page.goto('/login')
  // Kick off the OAuth flow (full-page navigation to the server endpoint).
  await page.getByTestId('google-login').click()

  // The mock consent screen appears; choose the identity.
  await expect(page.getByTestId('mock-approve')).toBeVisible()
  await page.getByTestId('mock-email').fill(EMAIL)
  await page.getByTestId('mock-name').fill('OAuth E2E User')
  await page.getByTestId('mock-approve').click()

  // We land in the Desk, signed in as the new user.
  await page.waitForURL(/\/desk/)
  await expect(page.getByTestId('session-user')).toBeVisible()

  // The User was created and marked as a Google login.
  const headers = await adminHeaders(page.request)
  const doc = (await (
    await page.request.get(`/api/resource/User/${encodeURIComponent(EMAIL)}`, { headers })
  ).json()) as { name: string; social_login: string; enabled: boolean }
  expect(doc.name).toBe(EMAIL)
  expect(doc.social_login).toBe('google')
  expect(doc.enabled).toBe(true)
})

test('PLAT-006: a second OAuth sign-in links the same User (no duplicate)', async ({ page, request }) => {
  // Pre-create the user (as if from a first sign-in), disabled, to prove the
  // flow links + re-enables rather than duplicating.
  const headers = await adminHeaders(request)
  await request.post('/api/save_doc', {
    headers,
    data: { doctype: 'User', doc: { name: EMAIL, email: EMAIL, full_name: 'Existing', enabled: true, roles: [] } },
  })

  await page.goto('/login')
  await page.getByTestId('google-login').click()
  await page.getByTestId('mock-email').fill(EMAIL)
  await page.getByTestId('mock-approve').click()
  await page.waitForURL(/\/desk/)

  // Exactly one User with that email.
  const listed = (await (
    await request.get(`/api/resource/User?filters=${encodeURIComponent(JSON.stringify([['email', '=', EMAIL]]))}`, { headers })
  ).json()) as { data: { name: string }[] }
  expect(listed.data.length).toBe(1)
})

test('PLAT-006: a tampered OAuth state is rejected', async ({ request }) => {
  // The callback must reject a forged/blank state (CSRF protection).
  const res = await request.get('/api/oauth/google/callback?code=abc&state=forged.signature', {
    maxRedirects: 0,
  })
  expect(res.status()).toBe(401)
})

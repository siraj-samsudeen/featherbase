import { anonymousTest as test, expect, adminAuth, type APIRequestContext } from './fixtures'

const EMAIL = 'oauth.e2e.user@gmail.com'

async function setAllowedDomains(request: APIRequestContext, value: string) {
  const headers = await adminAuth(request)
  const res = await request.post('/api/save_row', {
    headers,
    data: { table: 'System Settings', row: { allowed_login_domains: value } },
  })
  if (res.status() !== 201) throw new Error(`save allowed_login_domains: ${res.status()}`)
}

test.beforeEach(async ({ request }) => {
  // Blank is the secure default and makes each test independent even if a
  // preceding process was interrupted before its teardown ran.
  await setAllowedDomains(request, '')
  const headers = await adminAuth(request)
  await request.delete(`/api/table/User/${encodeURIComponent(EMAIL)}`, { headers })
})

test.afterEach(async ({ request }) => {
  // The creation journey opts into wildcard provisioning. Always restore the
  // secure default so no later spec can inherit that widened policy.
  await setAllowedDomains(request, '')
})

test('PLAT-006: Google OAuth (mock) creates a User and lands in the Admin', async ({ page, request }) => {
  await setAllowedDomains(request, '*')
  // #150: every URL this flow puts in the address bar — and therefore in
  // history, in the Referer of anything the page fetches next, and in every
  // proxy log on the way — is recorded, so the assertion below can prove the
  // session token is in none of them.
  const visited: string[] = []
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) visited.push(frame.url())
  })

  await page.goto('/login')
  // Kick off the OAuth flow (full-page navigation to the server endpoint).
  await page.getByTestId('google-login').click()

  // The mock consent screen appears; choose the identity.
  await expect(page.getByTestId('mock-approve')).toBeVisible()
  await page.getByTestId('mock-email').fill(EMAIL)
  await page.getByTestId('mock-name').fill('OAuth E2E User')
  await page.getByTestId('mock-approve').click()

  // We land in the Admin, signed in as the new user.
  await page.waitForURL(/\/admin/)
  await expect(page.getByTestId('session-user')).toBeVisible()

  // #150: the landing carried a one-time handoff code, never the session
  // token; the SPA POSTed that code back and holds the real token now.
  expect(visited.some((u) => u.includes('/oauth-callback?code='))).toBe(true)
  for (const url of visited) expect(url).not.toContain('token=')
  const stored = await page.evaluate(() => localStorage.getItem('fc_token'))
  expect(stored).toBeTruthy()
  expect(visited.join(' ')).not.toContain(stored as string)

  // The User was created and marked as a Google login.
  const headers = await adminAuth(page.request)
  const doc = (await (
    await page.request.get(`/api/table/User/${encodeURIComponent(EMAIL)}`, { headers })
  ).json()) as { row_id: string; social_login: string; enabled: boolean }
  expect(doc.row_id).toBe(EMAIL)
  expect(doc.social_login).toBe('google')
  expect(doc.enabled).toBe(true)
})

test('PLAT-006: a second OAuth sign-in links the same User (no duplicate)', async ({ page, request }) => {
  // Pre-create the user (as if from a first sign-in) to prove the flow LINKS
  // rather than duplicating. It is created enabled on purpose: since #137 a
  // disabled account is refused, never re-enabled by signing in.
  const headers = await adminAuth(request)
  await request.post('/api/save_row', {
    headers,
    data: { table: 'User', row: { row_id: EMAIL, email: EMAIL, full_name: 'Existing', enabled: true, roles: [] } },
  })

  await page.goto('/login')
  await page.getByTestId('google-login').click()
  await page.getByTestId('mock-email').fill(EMAIL)
  await page.getByTestId('mock-approve').click()
  await page.waitForURL(/\/admin/)

  // Exactly one User with that email.
  const listed = (await (
    await request.get(`/api/table/User?filters=${encodeURIComponent(JSON.stringify([['email', '=', EMAIL]]))}`, { headers })
  ).json()) as { data: { row_id: string }[] }
  expect(listed.data.length).toBe(1)
})

test('PLAT-006: a tampered OAuth state is rejected', async ({ request }) => {
  // The callback must reject a forged/blank state (CSRF protection).
  const res = await request.get('/api/oauth/google/callback?code=abc&state=forged.signature', {
    maxRedirects: 0,
  })
  expect(res.status()).toBe(401)
})

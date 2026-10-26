import { anonymousTest as test, expect, adminAuth, type APIRequestContext } from './fixtures'

const EMAIL = 'oauth.e2e.user@gmail.com'

// person-identities: Google is the Sign In Method row `google`.
async function setAllowedDomains(request: APIRequestContext, value: string) {
  const headers = await adminAuth(request)
  const path = `/api/table/${encodeURIComponent('Sign In Method')}/google`
  const row = (await (await request.get(path, { headers })).json()) as { updated_at: string }
  const res = await request.patch(path, { headers, data: { allowed_email_domains: value, updated_at: row.updated_at } })
  if (res.status() !== 200) throw new Error(`save allowed_email_domains: ${res.status()}`)
}

// People Google creates get an opaque id (person-identities), so the test
// user is found by its email.
async function usersWithEmail(request: APIRequestContext): Promise<{ row_id: string; enabled: boolean }[]> {
  const headers = await adminAuth(request)
  const filters = encodeURIComponent(JSON.stringify([['email', '=', EMAIL]]))
  const fields = encodeURIComponent(JSON.stringify(['row_id', 'enabled']))
  return ((await (await request.get(`/api/table/Person?filters=${filters}&fields=${fields}`, { headers })).json()) as {
    data: { row_id: string; enabled: boolean }[]
  }).data
}

test.beforeEach(async ({ request }) => {
  // Blank is the secure default and makes each test independent even if a
  // preceding process was interrupted before its teardown ran.
  await setAllowedDomains(request, '')
  const headers = await adminAuth(request)
  for (const u of await usersWithEmail(request))
    await request.delete(`/api/table/Person/${encodeURIComponent(u.row_id)}`, { headers })
})

test.afterEach(async ({ request }) => {
  // The creation journey opts into wildcard provisioning. Always restore the
  // secure default so no later spec can inherit that widened policy.
  await setAllowedDomains(request, '')
})

// Migrated to the feather-testing-core DSL (docs/testing/e2e-dsl-migration.md).
// The mock-OAuth screen and its outcome are all testid-addressed, so the
// flow lives in named steps; `session` carries the plain navigation.
test('PLAT-006: Google OAuth (mock) creates a User and lands on the no-access page until given a role', async ({ session, page, request }) => {
  await setAllowedDomains(request, '*')
  // #150: every URL this flow puts in the address bar — and therefore in
  // history, in the Referer of anything the page fetches next, and in every
  // proxy log on the way — is recorded, so the assertion below can prove the
  // session token is in none of them.
  const visited: string[] = []
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) visited.push(frame.url())
  })

  await session.visit('/login')
  await session.step('kick off the mock OAuth flow and approve the mock consent screen', async ({ page }) => {
    await page.getByTestId('google-login').click()
    await expect(page.getByTestId('mock-approve')).toBeVisible()
    await page.getByTestId('mock-email').fill(EMAIL)
    await page.getByTestId('mock-name').fill('OAuth E2E User')
    await page.getByTestId('mock-approve').click()
  })

  // A brand-new person has no role yet (#410): they are signed in and told so,
  // with a way to sign out, rather than shown an empty Admin.
  await session.step('signed in as the new user, told they have no access yet', async ({ page }) => {
    await page.waitForURL(/\/admin/)
    await expect(page.getByTestId('no-access')).toBeVisible()
    await expect(page.getByTestId('logout')).toBeVisible()
  })

  // #150: the landing carried a one-time handoff code, never the session
  // token; the SPA POSTed that code back and holds the real token now.
  expect(visited.some((u) => u.includes('/oauth-callback?code='))).toBe(true)
  for (const url of visited) expect(url).not.toContain('token=')
  const stored = await page.evaluate(() => localStorage.getItem('fc_token'))
  expect(stored).toBeTruthy()
  expect(visited.join(' ')).not.toContain(stored as string)

  // The User was created and linked to that Google account by its account ID.
  // Its id is opaque and permanent, never the address.
  const headers = await adminAuth(page.request)
  const [doc] = await usersWithEmail(page.request)
  expect(doc.row_id).toMatch(/^psn_[a-z2-7]{20}$/)
  expect(doc.enabled).toBe(true)
  const links = (await (
    await page.request.get(`/api/people/${encodeURIComponent(doc.row_id)}/identities`, { headers })
  ).json()) as { identities: { method: string; subject: string | null }[] }
  expect(links.identities).toEqual([expect.objectContaining({ method: 'google', subject: EMAIL })])
})

test('PLAT-006: an invited Google address links the existing User (no duplicate)', async ({ session, request }) => {
  // Pre-create the user and invite its Google address (person-identities: a
  // matching email alone never links). It is created enabled on purpose:
  // since #137 a disabled account is refused, never re-enabled by signing in.
  const headers = await adminAuth(request)
  // Its own address, so it never depends on deleting the person the first
  // test's Google sign-in created. person-rename: the id is minted (`psn_…`),
  // never the address.
  const INVITED = 'oauth.e2e.invited@gmail.com'
  const filters = encodeURIComponent(JSON.stringify([['email', '=', INVITED]]))
  const prior = (await (await request.get(`/api/table/Person?filters=${filters}`, { headers })).json()) as { data: { row_id: string }[] }
  for (const p of prior.data) await request.delete(`/api/table/Person/${encodeURIComponent(p.row_id)}`, { headers })
  const made = await request.post('/api/save_row', {
    headers,
    data: { table: 'Person', row: { email: INVITED, full_name: 'Existing', enabled: true, roles: [] } },
  })
  if (made.status() !== 201) throw new Error(`create person: ${made.status()} ${await made.text()}`)
  const existingId = ((await made.json()) as { row_id: string }).row_id
  await request.post(`/api/people/${encodeURIComponent(existingId)}/identities`, { headers, data: { method: 'google', email: INVITED } })

  await session.visit('/login')
  await session.step('sign in through the mock OAuth flow', async ({ page }) => {
    await page.getByTestId('google-login').click()
    await page.getByTestId('mock-email').fill(INVITED)
    await page.getByTestId('mock-approve').click()
    await page.waitForURL(/\/admin/)
  })

  // Exactly one User with that email.
  const listed = (await (
    await request.get(`/api/table/Person?filters=${encodeURIComponent(JSON.stringify([['email', '=', INVITED]]))}`, { headers })
  ).json()) as { data: { row_id: string }[] }
  expect(listed.data.length).toBe(1)
  expect(listed.data[0].row_id).toBe(existingId)
})

// A refused Google sign-in is a browser navigation: it lands back on the
// sign-in page with a plain message, never a raw JSON error page.
test('a Google account nobody set up lands on the sign-in page with a plain message', async ({ session, request }) => {
  // Its own never-seen address and account ID, so no earlier spec's person or
  // link can let it in.
  const stranger = `oauth.e2e.stranger.${Date.now()}@gmail.com`
  await session.visit('/login')
  await session.step('sign in through the mock OAuth flow with an address nobody invited', async ({ page }) => {
    await page.getByTestId('google-login').click()
    await page.getByTestId('mock-email').fill(stranger)
    await page.getByTestId('mock-approve').click()
  })

  // #474: a panel of next steps, not an empty form.
  await session.step('back on the sign-in page, told what to do, with no form to type into', async ({ page }) => {
    await page.waitForURL(/\/featherbase\/login\?error=not_provisioned$/)
    const panel = page.getByTestId('sign-in-refused-panel')
    await expect(panel.getByRole('heading', { name: "We couldn't sign you in" })).toBeVisible()
    await expect(page.getByTestId('sign-in-refused')).toContainText("This Google account isn't set up for")
    await expect(page.getByTestId('sign-in-refused')).toContainText('Ask your manager or IT to invite you')
    await expect(page.getByText('Access not provisioned')).toHaveCount(0)
    await expect(page.locator('input:visible')).toHaveCount(0)
    await expect(page.getByTestId('login-form')).toHaveCount(0)
  })

  await session.step('"Other ways to sign in" reveals the usual methods', async ({ page }) => {
    await page.getByTestId('refused-other-ways').click()
    await expect(page.getByTestId('login-form')).toBeVisible()
    await expect(page.getByTestId('google-login')).toBeVisible()
    await expect(page.getByTestId('sign-in-refused-panel')).toHaveCount(0)
  })

  const headers = await adminAuth(request)
  const filters = encodeURIComponent(JSON.stringify([['email', '=', stranger]]))
  expect(((await (await request.get(`/api/table/Person?filters=${filters}`, { headers })).json()) as { data: unknown[] }).data).toEqual([])
})

// #474: "Try another Google account" starts Google sign-in again with the
// account picker forced, and a second, invited account then gets in.
test('after a refusal, "Try another Google account" starts Google again and another account signs in', async ({ session, request }) => {
  const stamp = Date.now()
  const refused = `oauth.e2e.refused.${stamp}@gmail.com`
  const invited = `oauth.e2e.retry.${stamp}@gmail.com`
  const headers = await adminAuth(request)
  const made = await request.post('/api/save_row', {
    headers,
    data: { table: 'Person', row: { email: invited, full_name: 'Retry Person', enabled: true, roles: [] } },
  })
  if (made.status() !== 201) throw new Error(`create person: ${made.status()} ${await made.text()}`)
  const invitedId = ((await made.json()) as { row_id: string }).row_id
  await request.post(`/api/people/${encodeURIComponent(invitedId)}/identities`, { headers, data: { method: 'google', email: invited } })

  const starts: string[] = []
  await session.visit('/login')
  await session.step('the first Google account is refused', async ({ page }) => {
    page.on('request', (r) => {
      if (r.url().includes('/api/oauth/google/login')) starts.push(r.url())
    })
    await page.getByTestId('google-login').click()
    await page.getByTestId('mock-email').fill(refused)
    await page.getByTestId('mock-approve').click()
    await page.waitForURL(/\/featherbase\/login\?error=not_provisioned$/)
    await expect(page.getByTestId('sign-in-refused-panel')).toBeVisible()
  })

  await session.step('try another Google account: the sign-in starts again with the picker forced', async ({ page }) => {
    await page.getByTestId('refused-google-retry').click()
    await expect(page.getByTestId('mock-approve')).toBeVisible()
    expect(starts.at(-1)).toContain('/api/oauth/google/login?prompt=select_account')
    // The refused address is not carried into the new attempt.
    await expect(page.getByTestId('mock-email')).not.toHaveValue(refused)
    await page.getByTestId('mock-email').fill(invited)
    await page.getByTestId('mock-approve').click()
    await page.waitForURL(/\/admin/)
  })

  await request.delete(`/api/table/Person/${encodeURIComponent(invitedId)}`, { headers })
})

test('PLAT-006: a tampered OAuth state is rejected', async ({ request }) => {
  // The callback must reject a forged/blank state (CSRF protection).
  const res = await request.get('/api/oauth/google/callback?code=abc&state=forged.signature', {
    maxRedirects: 0,
  })
  expect(res.status()).toBe(401)
})

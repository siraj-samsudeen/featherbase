import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const USER = 'set2-e2e-user@x.com'

async function adminHeaders(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
}

async function resetKeyFromSink(request: APIRequestContext): Promise<string> {
  const headers = await adminHeaders(request)
  const filters = encodeURIComponent(JSON.stringify([['mail_to', '=', USER]]))
  const fields = encodeURIComponent(JSON.stringify(['name', 'body', 'creation']))
  // Poll: the mail is delivered inside the reset-request handler, but allow a
  // few retries so this never races the sink write under load.
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = (await (
      await request.get(
        `/api/resource/Email%20Sink?filters=${filters}&fields=${fields}&order_by=creation%20desc&limit_page_length=20`,
        { headers },
      )
    ).json()) as { data: { body: string }[] }
    for (const row of res.data) {
      const m = /key=([0-9a-f]+)/.exec(row.body ?? '')
      if (m) return m[1]
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('no reset key found in sink')
}

// test 1 needs the account enabled; test 2 disables it — run them in order.
test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ request }) => {
  const headers = await adminHeaders(request)
  // Start clean: a prior run may have left this user disabled, and save_doc
  // won't re-enable it without a modified stamp. Delete, then create fresh.
  await request.delete(`/api/resource/User/${encodeURIComponent(USER)}`, { headers })
  const created = await request.post('/api/save_doc', {
    headers,
    data: { doctype: 'User', doc: { name: USER, email: USER, full_name: 'Set2 E2E', enabled: true } },
  })
  if (created.status() !== 201) throw new Error(`create user: ${created.status()} ${await created.text()}`)
  await request.post('/api/set_password', { headers, data: { user: USER, password: 'initialpw123' } })
  // Clean any old reset mails so the key we read is from this run.
  const filters = encodeURIComponent(JSON.stringify([['mail_to', '=', USER]]))
  const old = (await (
    await request.get(`/api/resource/Email%20Sink?filters=${filters}&limit_page_length=50`, { headers })
  ).json()) as { data: { name: string }[] }
  for (const m of old.data) await request.delete(`/api/resource/Email%20Sink/${m.name}`, { headers })
})

// SET-002: a user resets their password via the emailed link, then logs in
// with the new password.
test('SET-002: password reset via emailed link works end to end', async ({ page, request }) => {
  // Request a reset through the login page's "Forgot password?" flow.
  await page.goto('/login')
  await page.getByTestId('forgot-password').click()
  await page.getByTestId('forgot-usr').fill(USER)
  await page.getByTestId('forgot-submit').click()
  await expect(page.getByTestId('reset-sent')).toBeVisible()

  // The reset link (with its key) landed in the sink; open it and set a new pw.
  const key = await resetKeyFromSink(request)
  await page.goto(`/reset-password?key=${key}`)
  await page.getByTestId('reset-password').fill('brandnewpw456')
  await page.getByTestId('reset-confirm').fill('brandnewpw456')
  await page.getByTestId('reset-submit').click()
  await expect(page.getByTestId('reset-done')).toBeVisible()

  // The new password logs in; the old one is gone.
  await page.getByTestId('reset-to-login').click()
  await page.fill('input[name=email]', USER)
  await page.fill('input[name=password]', 'brandnewpw456')
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)
  await expect(page.getByTestId('session-user')).toBeVisible()
})

// SET-002: a disabled user cannot log in.
test('SET-002: a disabled user cannot log in', async ({ page, request }) => {
  const headers = await adminHeaders(request)
  const doc = (await (
    await request.get(`/api/resource/User/${encodeURIComponent(USER)}`, { headers })
  ).json()) as { modified: string }
  const put = await request.put(`/api/resource/User/${encodeURIComponent(USER)}`, {
    headers,
    data: { enabled: false, modified: doc.modified },
  })
  expect(put.status()).toBe(200)

  await page.goto('/login')
  await page.fill('input[name=email]', USER)
  await page.fill('input[name=password]', 'brandnewpw456')
  await page.click('button[type=submit]')
  await expect(page.getByTestId('login-error')).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
})

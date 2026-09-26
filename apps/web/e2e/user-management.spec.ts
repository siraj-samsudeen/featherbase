import { anonymousTest as test, expect, adminAuth, type APIRequestContext } from './fixtures'

const USER = 'set2-e2e-user@x.com'

async function resetKeyFromSink(request: APIRequestContext): Promise<string> {
  const headers = await adminAuth(request)
  const filters = encodeURIComponent(JSON.stringify([['mail_to', '=', USER]]))
  const fields = encodeURIComponent(JSON.stringify(['row_id', 'body', 'created_at']))
  // Poll: the mail is delivered inside the reset-request handler, but allow a
  // few retries so this never races the sink write under load.
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = (await (
      await request.get(
        `/api/table/Email%20Sink?filters=${filters}&fields=${fields}&order_by=created_at%20desc&limit_page_length=20`,
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
  const headers = await adminAuth(request)
  const created = await request.post('/api/save_row', {
    headers,
    data: { table: 'User', row: { row_id: USER, email: USER, full_name: 'Set2 E2E', enabled: true } },
  })
  if (created.status() !== 201) throw new Error(`create user: ${created.status()} ${await created.text()}`)
  await request.post('/api/set_password', { headers, data: { user: USER, password: 'initialpw123' } })
  // Clean any old reset mails so the key we read is from this run.
  const filters = encodeURIComponent(JSON.stringify([['mail_to', '=', USER]]))
  const old = (await (
    await request.get(`/api/table/Email%20Sink?filters=${filters}&limit_page_length=50`, { headers })
  ).json()) as { data: { row_id: string }[] }
  for (const m of old.data) await request.delete(`/api/table/Email%20Sink/${m.row_id}`, { headers })
})

// SET-002: a user resets their password via the emailed link, then logs in
// with the new password.
//
// Migrated to the feather-testing-core DSL (docs/testing/e2e-dsl-migration.md).
// The forgot-password/reset-password screens are testid-addressed, so that
// mechanics stays in named steps; the real login form at the end IS
// label-friendly, so it becomes DSL verbs (mirrors admin.spec.ts).
test('SET-002: password reset via emailed link works end to end', async ({ session, request }) => {
  await session.visit('/login')
  await session.step("request a password reset via the login page's Forgot password flow", async ({ page }) => {
    await page.getByTestId('forgot-password').click()
    await page.getByTestId('forgot-usr').fill(USER)
    await page.getByTestId('forgot-submit').click()
    await expect(page.getByTestId('reset-sent')).toBeVisible()
  })

  // The reset link (with its key) landed in the sink; open it and set a new pw.
  const key = await resetKeyFromSink(request)
  await session.visit(`/featherbase/reset-password?key=${key}`)
  await session.step('set a new password', async ({ page }) => {
    await page.getByTestId('reset-password').fill('brandnewpw456')
    await page.getByTestId('reset-confirm').fill('brandnewpw456')
    await page.getByTestId('reset-submit').click()
    await expect(page.getByTestId('reset-done')).toBeVisible()
  })

  // The new password logs in; the old one is gone.
  await session.step('back to login', async ({ page }) => {
    await page.getByTestId('reset-to-login').click()
  })
  await session.fillIn('Email or username', USER).fillIn('Password', 'brandnewpw456').clickButton('Sign in')
  await session.step('lands somewhere inside /admin', async ({ page }) => {
    await page.waitForURL(/\/admin/)
    await expect(page.getByTestId('session-user')).toBeVisible()
  })
})

// SET-002: a disabled user cannot log in.
test('SET-002: a disabled user cannot log in', async ({ session, request }) => {
  const headers = await adminAuth(request)
  const doc = (await (
    await request.get(`/api/table/User/${encodeURIComponent(USER)}`, { headers })
  ).json()) as { updated_at: string }
  const put = await request.patch(`/api/table/User/${encodeURIComponent(USER)}`, {
    headers,
    data: { enabled: false, updated_at: doc.updated_at },
  })
  expect(put.status()).toBe(200)

  await session
    .visit('/login')
    .fillIn('Email or username', USER)
    .fillIn('Password', 'brandnewpw456')
    .clickButton('Sign in')
    .assertHas('[data-testid="login-error"]')
    .assertPath('/featherbase/login')
})

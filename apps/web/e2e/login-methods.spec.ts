import { anonymousTest as test, expect, adminAuth, loginAs, type APIRequestContext } from './fixtures'

// person-identities (#275): a person signed in with a password links a Google
// account from Sign-in methods, then signs in with that Google account after
// its address changed — Google is recognised by its account ID, not the email.
const USER = 'login-methods-e2e'
const PW = 'login-methods-pw-1'
const SUBJECT = 'g-login-methods-e2e'

async function reset(request: APIRequestContext) {
  const headers = await adminAuth(request)
  await request.delete(`/api/table/User/${USER}`, { headers })
}

test.beforeEach(async ({ request }) => {
  await reset(request)
  const headers = await adminAuth(request)
  const made = await request.post('/api/save_row', { headers, data: { table: 'User', row: { row_id: USER, full_name: 'Login Methods', enabled: true, roles: [] } } })
  if (made.status() !== 201) throw new Error(`create user: ${made.status()}`)
  await request.post('/api/set_password', { headers, data: { user: USER, password: PW } })
})

test.afterEach(async ({ request }) => reset(request))

test('#275: link Google while signed in, then sign in with it after its address changed', async ({ session, page, request }) => {
  await loginAs(page, USER, PW)
  await session.visit('/admin/sign-in-methods').assertHas('[data-testid="sign-in-methods"]')

  await session.step('link a Google account through the mock consent screen', async ({ page }) => {
    await page.getByTestId('link-google').click()
    await page.getByTestId('mock-email').fill('login.methods@gmail.com')
    await page.getByTestId('mock-subject').fill(SUBJECT)
    await page.getByTestId('mock-approve').click()
    await expect(page.getByTestId('link-outcome')).toContainText('Your Google account is linked')
  })

  await session.step('sign out completely', async ({ page }) => {
    await page.evaluate(() => fetch('/api/logout', { method: 'POST' }))
    await page.context().clearCookies()
    await page.evaluate(() => localStorage.clear())
  })

  await session.visit('/login')
  await session.step('sign in with the same Google account under a new address', async ({ page }) => {
    await page.getByTestId('google-login').click()
    await page.getByTestId('mock-email').fill('login.methods.renamed@gmail.com')
    await page.getByTestId('mock-subject').fill(SUBJECT)
    await page.getByTestId('mock-approve').click()
    await page.waitForURL(/\/admin/)
    await expect(page.getByTestId('session-user')).toBeVisible()
  })

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('fc_user') ?? '{}') as { row_id?: string })
  expect(stored.row_id).toBe(USER)
  const headers = await adminAuth(request)
  const links = (await (await request.get(`/api/users/${USER}/identities`, { headers })).json()) as { identities: { method: string; subject: string }[] }
  expect(links.identities).toEqual([expect.objectContaining({ method: 'google', subject: SUBJECT })])
})

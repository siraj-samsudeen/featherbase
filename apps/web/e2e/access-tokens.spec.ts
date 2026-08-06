import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const SVC = 'svc-e2e-spec'

async function adminHeaders(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
}

// Each run reuses the dev database — sweep this spec's principal (tokens
// cascade with the user row) so reruns start clean.
test.beforeAll(async ({ request }) => {
  const headers = await adminHeaders(request)
  await request.delete(`/api/table/User/${SVC}`, { headers }).catch(() => {})
})

// #131: the access-tokens screen — create a service account, issue it a
// token through the show-once modal, prove the secret authenticates, revoke.
test('#131: service account + token lifecycle through the Admin screen', async ({
  page,
  request,
}) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/admin/)

  await page.goto('/admin/access-tokens')
  await expect(page.getByTestId('access-tokens')).toBeVisible()

  // Create a service account with the System Manager role.
  await page.getByTestId('sa-name').fill(SVC)
  await page.getByTestId('sa-role-System Manager').check()
  await page.getByTestId('sa-create').click()
  await expect(page.getByTestId(`sa-${SVC}`)).toBeVisible()
  await expect(page.getByTestId(`sa-${SVC}`)).toContainText('System Manager')

  // Issue a token for it from its row; the show-once modal reveals the secret.
  await page.getByTestId(`sa-issue-${SVC}`).click()
  await expect(page.getByTestId('issue-dialog')).toBeVisible()
  await expect(page.getByTestId('token-owner')).toHaveValue(SVC)
  await page.getByTestId('token-label').fill('e2e spec token')
  await page.getByTestId('issue-confirm').click()
  await expect(page.getByTestId('secret-dialog')).toBeVisible()
  const secret = (await page.getByTestId('secret-value').textContent())!.trim()
  expect(secret).toMatch(/^fbt_/)
  await page.getByTestId('secret-done').click()

  // The secret authenticates as the service account.
  const who = await request.get('/api/whoami', {
    headers: { Authorization: `Bearer ${secret}` },
  })
  expect(who.status()).toBe(200)
  expect(((await who.json()) as { name: string }).name).toBe(SVC)

  // The token row is listed as active with its label; revoke it.
  const row = page.locator('[data-testid^="token-tok_"]', { hasText: 'e2e spec token' }).first()
  await expect(row).toContainText('active')
  await row.getByRole('button', { name: 'Revoke' }).click()
  await expect(row).toContainText('revoked')

  // A revoked secret no longer authenticates.
  const dead = await request.get('/api/whoami', {
    headers: { Authorization: `Bearer ${secret}` },
  })
  expect(dead.status()).toBe(401)
})

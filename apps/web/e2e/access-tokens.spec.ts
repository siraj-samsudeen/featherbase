import { test, expect, adminAuth } from './fixtures'

const SVC = 'svc-e2e-spec'

// #131: the access-tokens screen — create a service account, issue it a
// token through the show-once modal, prove the secret authenticates, revoke.
// Every control here is testid-addressed, so the mechanics stay in named
// steps; assertHas covers the plain presence/text checks around them.
test('#131: service account + token lifecycle through the Admin screen', async ({
  session,
  request,
}) => {
  await session.visit('/admin/access-tokens').assertHas('[data-testid="access-tokens"]')

  await session.step('create a service account with the System Manager role', async ({ page }) => {
    await page.getByTestId('sa-name').fill(SVC)
    await page.getByTestId('sa-role-System Manager').check()
    await page.getByTestId('sa-create').click()
  })
  // person-rename: the account's id is minted (`svc_…`); SVC is its name.
  const idOf = async () => {
    const listed = (await (await request.get('/api/service_accounts', { headers: await adminAuth(request) })).json()) as {
      service_accounts: { row_id: string; label: string }[]
    }
    return listed.service_accounts.find((a) => a.label === SVC)?.row_id ?? ''
  }
  await expect.poll(idOf).toMatch(/^svc_[a-z2-7]{20}$/)
  const id = await idOf()
  await session
    .assertHas(`[data-testid="sa-${id}"]`, { text: SVC })
    .assertHas(`[data-testid="sa-${id}"]`, { text: 'System Manager' })

  let secret = ''
  await session.step(
    'issue a token from its row and reveal the secret via the show-once modal',
    async ({ page }) => {
      await page.getByTestId(`sa-issue-${id}`).click()
      await expect(page.getByTestId('issue-dialog')).toBeVisible()
      await expect(page.getByTestId('token-owner')).toHaveValue(id)
      await page.getByTestId('token-label').fill('e2e spec token')
      await page.getByTestId('issue-confirm').click()
      await expect(page.getByTestId('secret-dialog')).toBeVisible()
      secret = (await page.getByTestId('secret-value').textContent())!.trim()
      expect(secret).toMatch(/^fbt_/)
      await page.getByTestId('secret-done').click()
    },
  )

  // The secret authenticates as the service account.
  const who = await request.get('/api/whoami', {
    headers: { Authorization: `Bearer ${secret}` },
  })
  expect(who.status()).toBe(200)
  expect(((await who.json()) as { row_id: string }).row_id).toBe(id)

  await session.step('the token row is listed as active with its label; revoke it', async ({ page }) => {
    const row = page.locator('[data-testid^="token-tok_"]', { hasText: 'e2e spec token' }).first()
    await expect(row).toContainText('active')
    await row.getByRole('button', { name: 'Revoke' }).click()
    await expect(row).toContainText('revoked')
  })

  // A revoked secret no longer authenticates.
  const dead = await request.get('/api/whoami', {
    headers: { Authorization: `Bearer ${secret}` },
  })
  expect(dead.status()).toBe(401)
})

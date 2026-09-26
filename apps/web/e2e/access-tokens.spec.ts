import { test, expect } from './fixtures'

const SVC = 'svc-e2e-spec'

// #131: the access-tokens screen — create a service account, issue it a
// token through the show-once modal, prove the secret authenticates, revoke.
// Migrated to the feather-testing-core DSL (docs/testing/e2e-dsl-migration.md):
// every control here is testid-addressed, so the mechanics stay in named
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
  await session
    .assertHas(`[data-testid="sa-${SVC}"]`)
    .assertHas(`[data-testid="sa-${SVC}"]`, { text: 'System Manager' })

  let secret = ''
  await session.step(
    'issue a token from its row and reveal the secret via the show-once modal',
    async ({ page }) => {
      await page.getByTestId(`sa-issue-${SVC}`).click()
      await expect(page.getByTestId('issue-dialog')).toBeVisible()
      await expect(page.getByTestId('token-owner')).toHaveValue(SVC)
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
  expect(((await who.json()) as { row_id: string }).row_id).toBe(SVC)

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

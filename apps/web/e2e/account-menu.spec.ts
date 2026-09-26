// #72: the navbar avatar opens an account menu with Change password + Log
// out. The full loop: change the password from the modal, log out, verify the
// old password is rejected and the new one signs in.
//
// Migrated to the feather-testing-core DSL
// (docs/testing/e2e-dsl-migration.md): the account menu and modal are
// testid-addressed (no accessible name Playwright's role/label matchers can
// reach), so most of this stays inside named steps — the login-form
// assertions at top and bottom are the part the DSL can express directly.

import { anonymousTest as test, expect, ADMIN_PWD, signIn, type APIRequestContext } from './fixtures'

const TEMP_PWD = 'acct-72-temp-password'

// Whatever happened (pass or fail, before or after the in-test change),
// put the Administrator password back so the rest of the suite can log in.
async function restorePassword(request: APIRequestContext) {
  for (const pwd of [ADMIN_PWD, TEMP_PWD]) {
    const res = await request.post('/api/login', { data: { usr: 'Administrator', pwd } })
    if (res.ok()) {
      const { token } = (await res.json()) as { token: string }
      await request.post('/api/set_password', {
        data: { password: ADMIN_PWD },
        headers: { Authorization: `Bearer ${token}` },
      })
      return
    }
  }
  throw new Error('could not restore the Administrator password')
}

test.afterEach(async ({ request }) => {
  await restorePassword(request)
})

test('ACCT-001: avatar menu changes the password end-to-end', async ({ session }) => {
  await signIn(session)

  // The avatar opens the account menu; Escape closes it.
  await session.step('avatar opens the account menu; Escape closes it', async ({ page }) => {
    await page.getByTestId('session-user').click()
    await expect(page.getByTestId('account-menu')).toBeVisible()
    await expect(page.getByTestId('account-menu')).toContainText('Administrator')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('account-menu')).toHaveCount(0)
  })

  // Reopen; clicking elsewhere closes it.
  await session.step('reopen; clicking elsewhere closes it', async ({ page }) => {
    await page.getByTestId('session-user').click()
    await expect(page.getByTestId('account-menu')).toBeVisible()
    await page.getByTestId('awesomebar').click()
    await expect(page.getByTestId('account-menu')).toHaveCount(0)
  })

  // Change password — a mismatched confirmation is blocked client-side.
  await session.step('mismatched confirmation is blocked client-side', async ({ page }) => {
    await page.getByTestId('session-user').click()
    await page.getByTestId('account-change-password').click()
    await expect(page.getByTestId('change-password-modal')).toBeVisible()
    await page.getByTestId('change-password-new').fill(TEMP_PWD)
    await page.getByTestId('change-password-confirm').fill('something-else')
    await page.getByTestId('change-password-submit').click()
    await expect(page.getByTestId('change-password-error')).toContainText('Passwords do not match')
  })

  // Fix the confirmation — success feedback, then close.
  await session.step('fixed confirmation succeeds; the modal closes', async ({ page }) => {
    await page.getByTestId('change-password-confirm').fill(TEMP_PWD)
    await page.getByTestId('change-password-submit').click()
    await expect(page.getByTestId('change-password-done')).toBeVisible()
    await page.getByTestId('change-password-close').click()
    await expect(page.getByTestId('change-password-modal')).toHaveCount(0)
  })

  // Log out from the same menu.
  await session.step('log out from the account menu', async ({ page }) => {
    await page.getByTestId('session-user').click()
    await page.getByTestId('logout').click()
  })
  await session.assertPath('/featherbase/login')

  // The old password is rejected…
  await session.step('the old password is rejected', async ({ page }) => {
    await page.fill('input[name=email]', 'Administrator')
    await page.fill('input[name=password]', ADMIN_PWD)
    await page.click('button[type=submit]')
    await expect(page.getByTestId('login-error')).toBeVisible()
  })

  // …and the new one signs in.
  await session
    .fillIn('Password', TEMP_PWD)
    .clickButton('Sign in')
  await session.step('the new password signs in', async ({ page }) => {
    await page.waitForURL(/\/admin/)
    await expect(page.getByTestId('session-user')).toBeVisible()
  })
})

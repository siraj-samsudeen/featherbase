// #72: the navbar avatar opens an account menu with Change password + Log
// out. The full loop: change the password from the modal, log out, verify the
// old password is rejected and the new one signs in.

import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
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

test('ACCT-001: avatar menu changes the password end-to-end', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/admin/)

  // The avatar opens the account menu; Escape closes it.
  await page.getByTestId('session-user').click()
  await expect(page.getByTestId('account-menu')).toBeVisible()
  await expect(page.getByTestId('account-menu')).toContainText('Administrator')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('account-menu')).toHaveCount(0)

  // Reopen; clicking elsewhere closes it.
  await page.getByTestId('session-user').click()
  await expect(page.getByTestId('account-menu')).toBeVisible()
  await page.getByTestId('awesomebar').click()
  await expect(page.getByTestId('account-menu')).toHaveCount(0)

  // Change password — a mismatched confirmation is blocked client-side.
  await page.getByTestId('session-user').click()
  await page.getByTestId('account-change-password').click()
  await expect(page.getByTestId('change-password-modal')).toBeVisible()
  await page.getByTestId('change-password-new').fill(TEMP_PWD)
  await page.getByTestId('change-password-confirm').fill('something-else')
  await page.getByTestId('change-password-submit').click()
  await expect(page.getByTestId('change-password-error')).toContainText('Passwords do not match')

  // Fix the confirmation — success feedback, then close.
  await page.getByTestId('change-password-confirm').fill(TEMP_PWD)
  await page.getByTestId('change-password-submit').click()
  await expect(page.getByTestId('change-password-done')).toBeVisible()
  await page.getByTestId('change-password-close').click()
  await expect(page.getByTestId('change-password-modal')).toHaveCount(0)

  // Log out from the same menu.
  await page.getByTestId('session-user').click()
  await page.getByTestId('logout').click()
  await expect(page).toHaveURL(/\/login/)

  // The old password is rejected…
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await expect(page.getByTestId('login-error')).toBeVisible()

  // …and the new one signs in.
  await page.fill('input[name=password]', TEMP_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/admin/)
  await expect(page.getByTestId('session-user')).toBeVisible()
})

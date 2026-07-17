import { expect, test } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'

test('UI-001: full login flow into the Desk shell', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)

  // Wrong password shows an error, stays on login
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', 'wrong')
  await page.click('button[type=submit]')
  await expect(page.getByTestId('login-error')).toBeVisible()

  // Correct login lands in the Desk
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL(/\/desk/)

  // Sidebar lists DocTypes from metadata (core seeds present)
  const nav = page.getByTestId('doctype-nav')
  await expect(nav.getByText('User', { exact: true })).toBeVisible()
  await expect(nav.getByText('Role', { exact: true })).toBeVisible()
  await expect(nav.getByText('DocType', { exact: true })).toBeVisible()

  // Session user shown
  await expect(page.getByTestId('session-user')).toContainText('Administrator')

  // Navigate to a DocType page
  await nav.getByText('User', { exact: true }).click()
  await expect(page).toHaveURL(/\/desk\/User/)
  await expect(page.getByTestId('doctype-page')).toContainText('User')

  // Deep link survives reload (token persisted)
  await page.reload()
  await expect(page.getByTestId('doctype-page')).toContainText('User')

  // Logout returns to login and guards /desk
  await page.getByTestId('logout').click()
  await expect(page).toHaveURL(/\/login/)
  await page.goto('/desk')
  await expect(page).toHaveURL(/\/login/)
})

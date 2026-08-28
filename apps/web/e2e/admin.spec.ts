import { anonymousTest as test, expect, ADMIN_PWD } from './fixtures'

test('UI-001: full login flow into the Admin shell', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)

  // Wrong password shows an error, stays on login
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', 'wrong')
  await page.click('button[type=submit]')
  await expect(page.getByTestId('login-error')).toBeVisible()

  // Correct login lands in the Admin
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL(/\/admin/)

  // #80: the sidebar lists Home Pages; every table stays reachable through
  // the All tables entry, which shows the grouped list — user modules first,
  // platform tables under a System group that starts collapsed with a count
  // badge (#74). Expanding it surfaces every engine table as a normal link
  // (grouped, never hidden).
  await expect(page.getByTestId('home-page-nav')).toBeVisible()
  await page.getByTestId('all-tables-link').click()
  const nav = page.getByTestId('table-nav')
  await expect(page.getByTestId('system-group-toggle')).toBeVisible()
  await expect(nav.getByText('User', { exact: true })).toBeHidden()
  await expect(page.getByTestId('system-group-count')).not.toHaveText('0')
  await page.getByTestId('system-group-toggle').click()
  await expect(nav.getByText('User', { exact: true })).toBeVisible()
  await expect(nav.getByText('Role', { exact: true })).toBeVisible()
  await expect(nav.getByText('Table', { exact: true })).toBeVisible()

  // Session user shown
  await expect(page.getByTestId('session-user')).toContainText('Administrator')

  // Navigate to a Table page
  await nav.getByText('User', { exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/User/)
  await expect(page.getByTestId('table-page')).toContainText('User')

  // Deep link survives reload (token persisted)
  await page.reload()
  await expect(page.getByTestId('table-page')).toContainText('User')

  // Logout (inside the avatar's account menu, #72) returns to login and
  // guards /admin
  await page.getByTestId('session-user').click()
  await page.getByTestId('logout').click()
  await expect(page).toHaveURL(/\/login/)
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/login/)
})

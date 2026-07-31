import { expect, test } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'

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
  const nav = page.getByTestId('doctype-nav')
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
  await expect(page.getByTestId('doctype-page')).toContainText('User')

  // Deep link survives reload (token persisted)
  await page.reload()
  await expect(page.getByTestId('doctype-page')).toContainText('User')

  // Logout (inside the avatar's account menu, #72) returns to login and
  // guards /admin
  await page.getByTestId('session-user').click()
  await page.getByTestId('logout').click()
  await expect(page).toHaveURL(/\/login/)
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/login/)
})

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/admin/)
}

// #84: the Admin moved from /desk to /admin. Every link minted under the old
// prefix — bookmarks, emailed row links, the SLA escalation notices — still
// lands on the right page.
test('#84: legacy /desk links redirect to their /admin twin', async ({ page }) => {
  await login(page)

  // The bare prefix lands where /admin lands: the first visible Home Page.
  await page.goto('/desk')
  await expect(page).toHaveURL(/\/admin\/home\//)

  // A row deep link keeps its Table and row name, and actually renders.
  await page.goto('/desk/User/Administrator')
  await expect(page).toHaveURL(/\/admin\/User\/Administrator$/)
  await expect(page.getByTestId('doc-page')).toContainText('Administrator')

  // The query string rides along, so a shared link keeps its state.
  await page.goto('/desk/import?table=User')
  await expect(page).toHaveURL('/admin/import?table=User')
  await expect(page.getByTestId('doctype-page')).toBeVisible()

  // Deeper routes keep every segment, not just the first.
  await page.goto('/desk/User/view/report?report=e2e-report')
  await expect(page).toHaveURL('/admin/User/view/report?report=e2e-report')

  // The old prefix is replaced, not pushed: Back lands on the previous Admin
  // page instead of bouncing through a dead /desk entry.
  await page.goBack()
  await expect(page).toHaveURL('/admin/import?table=User')
})

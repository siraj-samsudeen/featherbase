import { anonymousTest as test, expect, ADMIN_PWD } from './fixtures'

// UI-001, migrated to the feather-testing-core DSL
// (docs/testing/e2e-dsl-migration.md). The login form's fields ARE labelled,
// so sign-in itself becomes DSL verbs; the sidebar/table-nav assertions stay
// testid-addressed steps.
test('UI-001: full login flow into the Admin shell', async ({ session }) => {
  await session
    .visit('/')
    .assertPath('/featherbase/login')

  // Wrong password shows an error, stays on login
  await session
    .fillIn('Email or username', 'Administrator')
    .fillIn('Password', 'wrong')
    .clickButton('Sign in')
    .assertHas('[data-testid="login-error"]')

  // Correct login lands in the Admin. The landing path varies with
  // home-recall state (/admin/home/home, a recent Table, …), so this checks
  // "somewhere inside /admin" rather than an exact path — assertPath is an
  // exact match and can't express that, hence the step.
  await session.fillIn('Password', ADMIN_PWD).clickButton('Sign in')
  await session.step('lands somewhere inside /admin', async ({ page }) => {
    await expect(page).toHaveURL(/\/admin/)
  })

  // #80: the sidebar lists Home Pages; every table stays reachable through
  // the All tables entry, which shows the grouped list — user modules first,
  // platform tables under a System group that starts collapsed with a count
  // badge (#74). Expanding it surfaces every engine table as a normal link
  // (grouped, never hidden).
  await session.assertHas('[data-testid="home-page-nav"]')
  await session.step('open All tables and expand the System group', async ({ page }) => {
    await page.getByTestId('all-tables-link').click()
    const nav = page.getByTestId('table-nav')
    await expect(page.getByTestId('system-group-toggle')).toBeVisible()
    await expect(nav.getByText('User', { exact: true })).toBeHidden()
    await expect(page.getByTestId('system-group-count')).not.toHaveText('0')
    await page.getByTestId('system-group-toggle').click()
    await expect(nav.getByText('User', { exact: true })).toBeVisible()
    await expect(nav.getByText('Role', { exact: true })).toBeVisible()
    await expect(nav.getByText('Table', { exact: true })).toBeVisible()
  })

  // Session user shown
  await session.assertHas('[data-testid="session-user"]', { text: 'Administrator' })

  // Navigate to a Table page
  await session.step('click through to the User table', async ({ page }) => {
    await page.getByTestId('table-nav').getByText('User', { exact: true }).click()
  })
  await session
    .assertPath('/featherbase/admin/User')
    .assertHas('[data-testid="table-page"]', { text: 'User' })

  // Deep link survives reload (token persisted)
  await session.step('reload keeps the same Table page', async ({ page }) => {
    await page.reload()
  })
  await session.assertHas('[data-testid="table-page"]', { text: 'User' })

  // Logout (inside the avatar's account menu, #72) returns to login and
  // guards /admin
  await session.step('log out from the account menu', async ({ page }) => {
    await page.getByTestId('session-user').click()
    await page.getByTestId('logout').click()
  })
  await session.assertPath('/featherbase/login')
  await session.step('the guarded /admin route bounces back to login', async ({ page }) => {
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/login/)
  })
})

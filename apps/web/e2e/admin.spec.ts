import { anonymousTest as test, test as signedInTest, expect, ADMIN_PWD, adminAuth } from './fixtures'

// UI-001. The login form's fields ARE labelled,
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
    await expect(nav.getByText('Person', { exact: true })).toBeHidden()
    await expect(page.getByTestId('system-group-count')).not.toHaveText('0')
    await page.getByTestId('system-group-toggle').click()
    await expect(nav.getByText('Person', { exact: true })).toBeVisible()
    await expect(nav.getByText('Role', { exact: true })).toBeVisible()
    await expect(nav.getByText('Table', { exact: true })).toBeVisible()
  })

  // Session user shown
  await session.assertHas('[data-testid="session-user"]', { text: 'Administrator' })

  // Navigate to a Table page
  await session.step('click through to the Person table', async ({ page }) => {
    await page.getByTestId('table-nav').getByText('Person', { exact: true }).click()
  })
  await session
    .assertPath('/featherbase/admin/Person')
    .assertHas('[data-testid="table-page"]', { text: 'Person' })

  // Deep link survives reload (token persisted)
  await session.reload().assertHas('[data-testid="table-page"]', { text: 'Person' })

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

signedInTest('a cached list remains usable when settings and recent-history reads lose the connection', async ({ session, page, request }) => {
  const headers = await adminAuth(request)
  const table = 'Offline Cached List'
  const made = await request.post('/api/table_def', { headers, data: {
    name: table, columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }],
  } })
  expect(made.status()).toBe(201)
  expect((await request.post('/api/save_row', { headers, data: { table, row: { title: 'Locally cached row' } } })).status()).toBe(201)
  await session.visit(`/featherbase/admin/${encodeURIComponent(table)}`)
    .assertHas('[data-testid="list-rows"]', { text: 'Locally cached row' })
    .step('open the account page, then return with the connection lost', async () => {
      await page.getByTestId('session-user').click()
      await page.getByTestId('account-sign-in-methods').click()
      await expect(page.getByTestId('sign-in-methods')).toBeVisible()
      await page.context().setOffline(true)
      const settings = page.waitForEvent('requestfailed', { predicate: (r) => r.url().includes('/api/user_settings/') })
      const history = page.waitForEvent('requestfailed', { predicate: (r) => r.url().endsWith('/api/events/summary') })
      const events = page.waitForEvent('requestfailed', { predicate: (r) => r.url().endsWith('/api/events') })
      await page.goBack()
      await Promise.all([settings, history, events])
      await expect(page.getByTestId('list-rows')).toContainText('Locally cached row')
      await expect(page.getByTestId('admin-sidebar')).toBeVisible()
      await page.context().setOffline(false)
      await page.getByTestId('col-title').click()
      await expect.poll(async () => {
        const result = await request.get(`/api/user_settings/${encodeURIComponent(table)}`, { headers })
        return (await result.json()).settings?.sort
      }).toEqual({ field: 'title', dir: 'asc' })
    })
})

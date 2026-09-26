import { test, expect, adminAuth } from './fixtures'

const DT = 'WS E2E Task'
const DASH = 'ws-e2e-board'
const WS = 'ws-e2e'

test.beforeAll(async ({ request }) => {
  const headers = await adminAuth(request)
  const dt = await request.post('/api/table_def', {
    headers,
    data: { name: DT, columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }] },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  await request.delete(`/api/table/Dashboard/${DASH}`, { headers })
  await request.post('/api/save_row', {
    headers,
    data: { table: 'Dashboard', row: { row_id: DASH, label: 'WS Board', config: JSON.stringify({ cards: [{ label: 'All', table: DT }] }) } },
  })
  await request.delete(`/api/table/Home Page/${WS}`, { headers })
  const ws = await request.post('/api/save_row', {
    headers,
    data: {
      table: 'Home Page',
      row: {
        row_id: WS,
        label: 'Sales',
        shortcuts: JSON.stringify([
          { label: 'Tasks', type: 'table', link_to: DT },
          { label: 'Board', type: 'dashboard', link_to: DASH },
        ]),
      },
    },
  })
  if (ws.status() !== 201) throw new Error(`home page: ${ws.status()} ${await ws.text()}`)
})

// UI-027: a home page (Workspace) lists its shortcuts; clicking navigates
// correctly. Migrated to the feather-testing-core DSL
// (docs/testing/e2e-dsl-migration.md): title checks are exact `toHaveText`,
// which assertHas' substring semantics can't safely stand in for, so the
// click journey and its exact-text proofs stay in named steps.
test('UI-027: home page lists shortcuts and they navigate', async ({ session }) => {
  await session.visit('/admin').assertHas(`[data-testid="home-page-link-${WS}"]`)

  await session.step('click the sidebar Home Pages entry', async ({ page }) => {
    await page.getByTestId(`home-page-link-${WS}`).click()
    await expect(page).toHaveURL(new RegExp(`/admin/home/${WS}`))
  })

  await session.step('title and shortcuts render', async ({ page }) => {
    await expect(page.getByTestId('home-page-title')).toHaveText('Sales')
    await expect(page.getByTestId('shortcut-Tasks')).toBeVisible()
    await expect(page.getByTestId('shortcut-Board')).toBeVisible()
  })

  await session.step('a Table shortcut opens that list', async ({ page }) => {
    await page.getByTestId('shortcut-Tasks').click()
    await expect(page).toHaveURL(new RegExp(`/admin/${encodeURIComponent(DT)}`))
  })
  await session.assertHas('[data-testid="list-view"]')

  await session.step('a dashboard shortcut opens the dashboard', async ({ page }) => {
    await page.goto(`/admin/home/${WS}`)
    await page.getByTestId('shortcut-Board').click()
    await expect(page).toHaveURL(new RegExp(`/admin/dashboard/${DASH}`))
  })
  await session.assertHas('[data-testid="dashboard-title"]')
})

// #80: the sidebar lists Home Pages only; /admin lands on the first visible
// page; the System page's cards open Table lists; and the All tables entry
// keeps every table reachable.
test('#80: sidebar flip — landing, System page cards, All tables', async ({ session }) => {
  await session.visit('/admin')

  await session.step('/admin redirects to the first visible home page', async ({ page }) => {
    await expect(page).toHaveURL(/\/admin\/home\//)
  })

  await session.assertHas('[data-testid="home-page-link-system"]')

  await session.step('the System page opens with its title and grouped cards', async ({ page }) => {
    await page.getByTestId('home-page-link-system').click()
    await expect(page).toHaveURL(/\/admin\/home\/system/)
    await expect(page.getByTestId('home-page-title')).toHaveText('System')
  })
  await session.assertHas('[data-testid="home-card-Users & Access"]')

  await session.step('a card link opens the Table list', async ({ page }) => {
    await page.getByTestId('home-link-User').click()
    await expect(page).toHaveURL(/\/admin\/User/)
  })
  await session.assertHas('[data-testid="list-view"]')

  await session.step('the sidebar holds no direct table links; All tables reaches them', async ({ page }) => {
    // The sidebar holds NO direct table links — tables live behind All tables.
    await expect(page.getByTestId('admin-sidebar').getByTestId('table-nav')).toHaveCount(0)
    await page.getByTestId('all-tables-link').click()
    await expect(page).toHaveURL(/\/admin\/all-tables/)
    const nav = page.getByTestId('table-nav')
    // User tables grouped by module; the created table is reachable.
    await expect(nav.getByText(DT, { exact: true })).toBeVisible()
  })

  await session.assertHas('[data-testid="system-group-toggle"]')

  await session.step('the System group is collapsed with a count; expanding surfaces engine tables', async ({ page }) => {
    const nav = page.getByTestId('table-nav')
    await expect(page.getByTestId('system-group-count')).not.toHaveText('0')
    await expect(nav.getByText('Role', { exact: true })).toBeHidden()
    await page.getByTestId('system-group-toggle').click()
    await expect(nav.getByText('Role', { exact: true })).toBeVisible()
  })
})

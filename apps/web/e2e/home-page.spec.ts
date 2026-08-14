import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'WS E2E Task'
const DASH = 'ws-e2e-board'
const WS = 'ws-e2e'

async function adminHeaders(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
}

test.beforeAll(async ({ request }) => {
  const headers = await adminHeaders(request)
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

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/admin/)
}

// UI-027: a home page (Workspace) lists its shortcuts; clicking navigates
// correctly.
test('UI-027: home page lists shortcuts and they navigate', async ({ page }) => {
  await login(page)

  // Reachable from the sidebar's Home Pages list.
  await expect(page.getByTestId(`home-page-link-${WS}`)).toBeVisible()
  await page.getByTestId(`home-page-link-${WS}`).click()
  await expect(page).toHaveURL(new RegExp(`/admin/home/${WS}`))

  await expect(page.getByTestId('home-page-title')).toHaveText('Sales')
  await expect(page.getByTestId('shortcut-Tasks')).toBeVisible()
  await expect(page.getByTestId('shortcut-Board')).toBeVisible()

  // Clicking a Table shortcut opens that list.
  await page.getByTestId('shortcut-Tasks').click()
  await expect(page).toHaveURL(new RegExp(`/admin/${encodeURIComponent(DT)}`))
  await expect(page.getByTestId('list-view')).toBeVisible()

  // Back to the home page, the dashboard shortcut opens the dashboard.
  await page.goto(`/admin/home/${WS}`)
  await page.getByTestId('shortcut-Board').click()
  await expect(page).toHaveURL(new RegExp(`/admin/dashboard/${DASH}`))
  await expect(page.getByTestId('dashboard-title')).toBeVisible()
})

// #80: the sidebar lists Home Pages only; /admin lands on the first visible
// page; the System page's cards open Table lists; and the All tables entry
// keeps every table reachable.
test('#80: sidebar flip — landing, System page cards, All tables', async ({ page }) => {
  await login(page)

  // /admin redirects to the first visible home page.
  await expect(page).toHaveURL(/\/admin\/home\//)

  // The seeded System page is in the sidebar; its cards are grouped links.
  await expect(page.getByTestId('home-page-link-system')).toBeVisible()
  await page.getByTestId('home-page-link-system').click()
  await expect(page).toHaveURL(/\/admin\/home\/system/)
  await expect(page.getByTestId('home-page-title')).toHaveText('System')
  await expect(page.getByTestId('home-card-Users & Access')).toBeVisible()

  // A card link opens the Table list.
  await page.getByTestId('home-link-User').click()
  await expect(page).toHaveURL(/\/admin\/User/)
  await expect(page.getByTestId('list-view')).toBeVisible()

  // The sidebar holds NO direct table links — tables live behind All tables.
  await expect(page.getByTestId('admin-sidebar').getByTestId('table-nav')).toHaveCount(0)
  await page.getByTestId('all-tables-link').click()
  await expect(page).toHaveURL(/\/admin\/all-tables/)
  const nav = page.getByTestId('table-nav')
  // User tables grouped by module; the created table is reachable.
  await expect(nav.getByText(DT, { exact: true })).toBeVisible()
  // System group collapsed with a count; expanding surfaces engine tables.
  await expect(page.getByTestId('system-group-toggle')).toBeVisible()
  await expect(page.getByTestId('system-group-count')).not.toHaveText('0')
  await expect(nav.getByText('Role', { exact: true })).toBeHidden()
  await page.getByTestId('system-group-toggle').click()
  await expect(nav.getByText('Role', { exact: true })).toBeVisible()
})

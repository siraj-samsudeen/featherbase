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
  const dt = await request.post('/api/doctype', {
    headers,
    data: { name: DT, fields: [{ fieldname: 'title', fieldtype: 'Data', in_list_view: true }] },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  await request.delete(`/api/resource/Dashboard/${DASH}`, { headers })
  await request.post('/api/save_doc', {
    headers,
    data: { doctype: 'Dashboard', doc: { name: DASH, label: 'WS Board', config: JSON.stringify({ cards: [{ label: 'All', doctype: DT }] }) } },
  })
  await request.delete(`/api/resource/Workspace/${WS}`, { headers })
  const ws = await request.post('/api/save_doc', {
    headers,
    data: {
      doctype: 'Workspace',
      doc: {
        name: WS,
        label: 'Sales',
        shortcuts: JSON.stringify([
          { label: 'Tasks', type: 'doctype', link_to: DT },
          { label: 'Board', type: 'dashboard', link_to: DASH },
        ]),
      },
    },
  })
  if (ws.status() !== 201) throw new Error(`workspace: ${ws.status()} ${await ws.text()}`)
})

// UI-027: a workspace lists its shortcuts and clicking navigates correctly.
test('UI-027: workspace lists shortcuts and they navigate', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)

  // Reachable from the sidebar workspace list.
  await expect(page.getByTestId(`workspace-link-${WS}`)).toBeVisible()
  await page.getByTestId(`workspace-link-${WS}`).click()
  await expect(page).toHaveURL(new RegExp(`/desk/workspace/${WS}`))

  await expect(page.getByTestId('workspace-title')).toHaveText('Sales')
  await expect(page.getByTestId('shortcut-Tasks')).toBeVisible()
  await expect(page.getByTestId('shortcut-Board')).toBeVisible()

  // Clicking a DocType shortcut opens that list.
  await page.getByTestId('shortcut-Tasks').click()
  await expect(page).toHaveURL(new RegExp(`/desk/${encodeURIComponent(DT)}`))
  await expect(page.getByTestId('list-view')).toBeVisible()

  // Back to the workspace, the dashboard shortcut opens the dashboard.
  await page.goto(`/desk/workspace/${WS}`)
  await page.getByTestId('shortcut-Board').click()
  await expect(page).toHaveURL(new RegExp(`/desk/dashboard/${DASH}`))
  await expect(page.getByTestId('dashboard-title')).toBeVisible()
})

import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const USER = 'routine-e2e@x.com'
const PWD = 'routinepw123'
const DAY = 86_400_000

// #101 Phase 5: the routine suggestion + pinned workspace, for a dedicated
// user so the seeded multi-day trail never pollutes Administrator's feed.

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const token = ((await login.json()) as { token: string }).token
  const auth = { Authorization: `Bearer ${token}` }
  const created = await request.post('/api/save_doc', {
    headers: auth,
    data: { doctype: 'User', doc: { name: USER, email: USER, full_name: 'Routine E2E', enabled: true } },
  })
  if (![201, 409].includes(created.status())) throw new Error(`user: ${created.status()}`)
  await request.post('/api/set_password', { headers: auth, data: { user: USER, password: PWD } })

  // Seed the habit AS that user: two list destinations on 5 distinct days,
  // all inside the server's 7-day timestamp trust window.
  const uLogin = await request.post('/api/login', { data: { usr: USER, pwd: PWD } })
  const uToken = ((await uLogin.json()) as { token: string }).token
  const now = Date.now()
  const events = []
  for (let d = 1; d <= 5; d++) {
    events.push({
      kind: 'list',
      key: 'list:Customer?rtn',
      label: 'Customer',
      sub: 'region = South',
      path: '/admin/Customer',
      at: now - d * DAY,
    })
    events.push({
      kind: 'page',
      key: 'page:query-report/Sales Register',
      label: 'Sales Register',
      sub: 'Report',
      path: '/admin/query-report/Sales%20Register',
      at: now - d * DAY,
    })
  }
  const posted = await request.post('/api/events', {
    headers: { Authorization: `Bearer ${uToken}` },
    data: { events },
  })
  if (posted.status() !== 200) throw new Error(`seed events: ${posted.status()}`)
})

async function login(page: Page, usr: string, pwd: string) {
  await page.goto('/login')
  await page.fill('input[name=email]', usr)
  await page.fill('input[name=password]', pwd)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/admin/)
}

test('#101 P5: a detected routine can be pinned and survives reloads', async ({ page }) => {
  await login(page, USER, PWD)

  const card = page.getByTestId('routine-card')
  await expect(card).toBeVisible()
  await expect(card).toContainText('Customer')
  await expect(card).toContainText('Sales Register')

  await page.getByTestId('routine-pin').click()
  const chips = page.getByTestId('workspace-chips')
  await expect(chips).toBeVisible()
  await expect(page.getByTestId('routine-card')).toHaveCount(0)

  // The pin persists across a reload, and a chip navigates.
  await page.reload()
  await expect(page.getByTestId('workspace-chips')).toBeVisible()
  await page.getByTestId('workspace-chip').first().click()
  await expect(page).toHaveURL(/Customer|Sales/)
})

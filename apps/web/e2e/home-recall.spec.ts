import { anonymousTest as test, expect, adminToken, bearer, loginAs, tokenFor, type APIRequestContext } from './fixtures'

const USER = 'routine-e2e@x.com'
const PWD = 'routinepw123'
const DAY = 86_400_000

// #101 Phase 5: the routine suggestion + pinned workspace, for a dedicated
// user so the seeded multi-day trail never pollutes Administrator's feed.

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const token = await adminToken(request)
  const auth = bearer(token)
  // Re-runs find the user already there — save_row would then demand the
  // optimistic-concurrency timestamp, so create only when missing.
  const exists = await request.get(`/api/table/User/${encodeURIComponent(USER)}`, { headers: auth })
  if (exists.status() === 404) {
    const created = await request.post('/api/save_row', {
      headers: auth,
      data: { table: 'User', row: { row_id: USER, email: USER, full_name: 'Routine E2E', enabled: true } },
    })
    if (created.status() !== 201) throw new Error(`user: ${created.status()}`)
  }
  await request.post('/api/set_password', { headers: auth, data: { user: USER, password: PWD } })

  // Seed the habit AS that user: two list destinations on 5 distinct days,
  // all inside the server's 7-day timestamp trust window.
  const uToken = await tokenFor(request, USER, PWD)
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

test('#101 P5: a detected routine can be pinned and survives reloads', async ({ page }) => {
  await loginAs(page, USER, PWD)

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

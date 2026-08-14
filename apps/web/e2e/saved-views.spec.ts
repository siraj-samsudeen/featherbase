import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'SavedView DT'
const DOC = 'sv-target-row'
const FILTERS = encodeURIComponent(JSON.stringify([['note', '=', 'hot']]))

// #101 Phase 6: the same filter set applied 3× inside a week triggers the
// save-as-view nudge; the saved view becomes a chip that re-applies the
// whole set, can be shared, and can be deleted.

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const token = ((await login.json()) as { token: string }).token
  const auth = { Authorization: `Bearer ${token}` }
  const dt = await request.post('/api/table_def', {
    headers: auth,
    data: {
      name: DT,
      id_pattern: 'prompt',
      columns: [{ column_name: 'note', column_type: 'Data', in_list_view: true }],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  await request.post(`/api/table/${encodeURIComponent(DT)}`, {
    headers: auth,
    data: { row_id: DOC, note: 'hot' },
  })
  // Re-runs must start clean: drop Administrator's leftover views for DT.
  const existing = await request.get(`/api/saved_views?table=${encodeURIComponent(DT)}`, {
    headers: auth,
  })
  for (const v of ((await existing.json()) as { views: Array<{ row_id: string; mine: boolean }> })
    .views) {
    if (v.mine) await request.delete(`/api/saved_views/${v.row_id}`, { headers: auth })
  }
})

async function login(page: Page) {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/admin/)
}

test('#101 P6: three applications trigger the nudge; the saved view lives as a chip', async ({
  page,
}) => {
  await login(page)
  const listUrl = `/admin/${encodeURIComponent(DT)}?filters=${FILTERS}`

  // First two arrivals: no nudge yet. (The 600ms pause keeps each arrival
  // outside the client's same-arrival dedup window.)
  for (let i = 0; i < 2; i++) {
    await page.goto(listUrl)
    await expect(page.getByTestId('table-page')).toBeVisible()
    await expect(page.getByTestId('filter-nudge')).toHaveCount(0)
    await page.waitForTimeout(600)
  }

  // Third: the nudge offers to name the habit.
  await page.goto(listUrl)
  const nudge = page.getByTestId('filter-nudge')
  await expect(nudge).toBeVisible()
  await expect(nudge).toContainText('3×')
  await page.getByTestId('nudge-name').fill('Hot notes')
  await page.getByTestId('nudge-save').click()

  // The chip appears (active), the nudge is gone.
  const chip = page.getByTestId('saved-view-chip').filter({ hasText: 'Hot notes' })
  await expect(chip).toBeVisible()
  await expect(page.getByTestId('filter-nudge')).toHaveCount(0)

  // From a clean list, the chip re-applies the whole filter set.
  await page.goto(`/admin/${encodeURIComponent(DT)}`)
  await chip.click()
  await expect(page).toHaveURL(/filters=/)
  await expect(page.getByTestId('table-page')).toContainText(DOC)

  // Share it (control shows on the active own chip), then delete it.
  await page.getByTestId('saved-view-share').click()
  await expect(chip).toContainText('shared')
  await page.getByTestId('saved-view-delete').click()
  await expect(page.getByTestId('saved-view-chip')).toHaveCount(0)
})

test('#101 P6: "Not now" silences the nudge for that filter set', async ({ page }) => {
  await login(page)
  const otherFilters = encodeURIComponent(JSON.stringify([['note', '=', 'cold']]))
  const listUrl = `/admin/${encodeURIComponent(DT)}?filters=${otherFilters}`
  for (let i = 0; i < 3; i++) {
    await page.goto(listUrl)
    await expect(page.getByTestId('table-page')).toBeVisible()
    await page.waitForTimeout(600) // arrivals inside the dedup window count once
  }
  await expect(page.getByTestId('filter-nudge')).toBeVisible()
  await page.getByTestId('nudge-dismiss').click()
  await expect(page.getByTestId('filter-nudge')).toHaveCount(0)
  // A fourth application stays quiet — the dismissal is remembered.
  await page.goto(listUrl)
  await expect(page.getByTestId('table-page')).toBeVisible()
  await expect(page.getByTestId('filter-nudge')).toHaveCount(0)
})

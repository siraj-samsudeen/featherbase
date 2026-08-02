import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'Recents DT'
const DOC = 'quokka-recent-doc'

// #101 Phase 1: the command bar remembers what the operator visited — rows,
// filtered lists, searches — per user, and its empty focused state replays
// them (newest first, keyboard included).

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const token = ((await login.json()) as { token: string }).token
  const auth = { Authorization: `Bearer ${token}` }
  const dt = await request.post('/api/doctype', {
    headers: auth,
    data: {
      name: DT,
      id_pattern: 'prompt',
      columns: [{ column_name: 'note', column_type: 'Data', in_list_view: true }],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  const doc = await request.post(`/api/table/${encodeURIComponent(DT)}`, {
    headers: auth,
    data: { name: DOC, note: 'searchable' },
  })
  if (![201, 409].includes(doc.status())) throw new Error(`doc: ${doc.status()}`)
})

async function login(page: Page) {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/admin/)
}

test('#101: an empty command bar lists recent visits and replays them', async ({ page }) => {
  await login(page)

  // Build a trail: a filtered list, then a row.
  const filters = encodeURIComponent(JSON.stringify([['note', '=', 'searchable']]))
  await page.goto(`/admin/${encodeURIComponent(DT)}?filters=${filters}`)
  await expect(page.getByTestId('doctype-page')).toBeVisible()
  await page.goto(`/admin/${encodeURIComponent(DT)}/${DOC}`)
  await expect(page.getByTestId('form-view')).toBeVisible()
  await page.goto('/admin')

  // Focused + empty: the trail is listed newest first.
  const bar = page.getByTestId('awesomebar').locator('input')
  await bar.click()
  const recents = page.getByTestId('awesomebar-recent')
  await expect(recents.first()).toContainText(DOC)
  await expect(recents.nth(1)).toContainText(DT)
  await expect(recents.nth(1)).toContainText('note = searchable')

  // Clicking the list entry replays the URL, filters included.
  await recents.nth(1).click()
  await expect(page).toHaveURL(/filters=/)
  await expect(page.getByTestId('doctype-page')).toBeVisible()

  // Keyboard: ArrowDown moves the selection, Enter replays it. After the
  // list revisit the order is [list, row], so the second entry is the row.
  await page.goto('/admin')
  await bar.click()
  await expect(recents.first()).toBeVisible()
  await bar.press('ArrowDown')
  await bar.press('Enter')
  await expect(page).toHaveURL(new RegExp(`${encodeURIComponent(DT)}/${DOC}`))
  await expect(page.getByTestId('form-view')).toBeVisible()
})

test('#101 P2: the sidebar and the per-table strip replay the trail', async ({ page }) => {
  await login(page)
  const filters = encodeURIComponent(JSON.stringify([['note', '=', 'searchable']]))
  await page.goto(`/admin/${encodeURIComponent(DT)}?filters=${filters}`)
  await expect(page.getByTestId('doctype-page')).toBeVisible()
  await page.goto(`/admin/${encodeURIComponent(DT)}/${DOC}`)
  await expect(page.getByTestId('form-view')).toBeVisible()

  // Sidebar recall, zero keystrokes: the row we're on tops the group.
  const sidebar = page.getByTestId('sidebar-recents')
  await expect(sidebar.getByTestId('sidebar-recent').first()).toContainText(DOC)

  // Its filtered-view entry carries the filter summary and replays the URL.
  await sidebar
    .getByTestId('sidebar-recent')
    .filter({ hasText: 'note = searchable' })
    .first()
    .click()
  await expect(page).toHaveURL(/filters=/)
  await expect(page.getByTestId('doctype-page')).toBeVisible()

  // The strip above the grid shows this table's recent row + filter set.
  await page.goto(`/admin/${encodeURIComponent(DT)}`)
  const strip = page.getByTestId('recent-strip')
  await expect(strip.getByTestId('recent-strip-row').first()).toContainText(DOC)
  await expect(strip.getByTestId('recent-strip-view').first()).toContainText('note = searchable')

  // A view chip re-applies the whole filter set; a row chip opens the form.
  await strip.getByTestId('recent-strip-view').first().click()
  await expect(page).toHaveURL(/filters=/)
  await strip.getByTestId('recent-strip-row').first().click()
  await expect(page).toHaveURL(new RegExp(`${encodeURIComponent(DT)}/${DOC}`))
  await expect(page.getByTestId('form-view')).toBeVisible()
})

test('#101 P3: the trail reaches the server in debounced batches', async ({ page, request }) => {
  await login(page)
  await page.goto(`/admin/${encodeURIComponent(DT)}/${DOC}`)
  await expect(page.getByTestId('form-view')).toBeVisible()

  const auth = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const token = ((await auth.json()) as { token: string }).token

  // The client flushes after a ~3s debounce; poll the caller-scoped summary
  // until the visit shows up server-side.
  await expect
    .poll(
      async () => {
        const res = await request.get('/api/events/summary', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const body = (await res.json()) as { entries: Array<{ key: string }> }
        return body.entries.some((e) => e.key === `row:${DT}/${DOC}`)
      },
      { timeout: 15_000 },
    )
    .toBe(true)
})

test('#101 P5: resume tiles put yesterday one click away', async ({ page }) => {
  await login(page)

  // Build the trail: a search (opens the row), then back home.
  const bar = page.getByTestId('awesomebar').locator('input')
  await bar.fill('quokka-rec')
  await expect(page.getByTestId('awesomebar-doc').first()).toBeVisible()
  await bar.press('Enter')
  await expect(page.getByTestId('form-view')).toBeVisible()
  await page.goto('/admin')

  const strip = page.getByTestId('resume-strip')
  await expect(strip).toBeVisible()
  await expect(strip.getByTestId('resume-tile-row')).toContainText(DOC)

  // The search tile hands its query back to the command bar.
  await strip.getByTestId('resume-tile-search').click()
  await expect(bar).toHaveValue('quokka-rec')

  // The row tile resumes the form.
  await page.getByTestId('resume-tile-row').click()
  await expect(page).toHaveURL(new RegExp(`${encodeURIComponent(DT)}/${DOC}`))
  await expect(page.getByTestId('form-view')).toBeVisible()
})

test('#101: searches are remembered and offered back while typing', async ({ page }) => {
  await login(page)

  // Search and open the top hit via Enter — this records the search text.
  const bar = page.getByTestId('awesomebar').locator('input')
  await bar.fill('quokka-rec')
  await expect(page.getByTestId('awesomebar-doc').first()).toBeVisible()
  await bar.press('Enter')
  await expect(page).toHaveURL(new RegExp(`${encodeURIComponent(DT)}/${DOC}`))

  // Typing a prefix later offers the past search; clicking refills the bar.
  await page.goto('/admin')
  await bar.fill('quo')
  const chip = page.getByTestId('awesomebar-recent-search').first()
  await expect(chip).toContainText('quokka-rec')
  await chip.click()
  await expect(bar).toHaveValue('quokka-rec')
})

import { test, expect, adminToken, bearer, type APIRequestContext } from './fixtures'

const DT = 'Recents DT'
const DOC = 'quokka-recent-doc'

// #101 Phase 1: the command bar remembers what the operator visited — rows,
// filtered lists, searches — per user, and its empty focused state replays
// them (newest first, keyboard included).

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const token = await adminToken(request)
  const auth = bearer(token)
  const dt = await request.post('/api/table_def', {
    headers: auth,
    data: {
      name: DT,
      id_pattern: 'prompt',
      columns: [{ column_name: 'note', column_type: 'Data', in_list_view: true }],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  const doc = await request.post(`/api/table/${encodeURIComponent(DT)}`, {
    headers: auth,
    data: { row_id: DOC, note: 'searchable' },
  })
  if (![201, 409].includes(doc.status())) throw new Error(`doc: ${doc.status()}`)
})

// Migrated to the feather-testing-core DSL (docs/testing/e2e-dsl-migration.md).
// Every check here is either a regex URL match (assertPath is exact-match
// only) or a testid-addressed command-bar/sidebar/strip walk with keyboard
// input, so each test stays as one named step describing the whole trail;
// session.visit carries the plain navigations around it.
test('#101: an empty command bar lists recent visits and replays them', async ({ session }) => {
  // Build a trail: a filtered list, then a row.
  const filters = encodeURIComponent(JSON.stringify([['note', '=', 'searchable']]))
  await session.visit(`/admin/${encodeURIComponent(DT)}?filters=${filters}`)
  await session.step('build a trail, then replay it from the empty command bar', async ({ page }) => {
    await expect(page.getByTestId('table-page')).toBeVisible()
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
    await expect(page.getByTestId('table-page')).toBeVisible()

    await page.goto('/admin')

    // Keyboard: ArrowDown moves the selection, Enter replays it. After the
    // list revisit the order is [list, row], so the second entry is the row.
    await bar.click()
    await expect(recents.first()).toBeVisible()
    await bar.press('ArrowDown')
    await bar.press('Enter')
    await expect(page).toHaveURL(new RegExp(`${encodeURIComponent(DT)}/${DOC}`))
    await expect(page.getByTestId('form-view')).toBeVisible()
  })
})

test('#101 P2: the sidebar and the per-table strip replay the trail', async ({ session }) => {
  const filters = encodeURIComponent(JSON.stringify([['note', '=', 'searchable']]))
  await session.visit(`/admin/${encodeURIComponent(DT)}?filters=${filters}`)
  await session.step('sidebar recall and the per-table strip both replay the trail', async ({ page }) => {
    await expect(page.getByTestId('table-page')).toBeVisible()
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
    await expect(page.getByTestId('table-page')).toBeVisible()

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
})

test('#101 P3: the trail reaches the server in debounced batches', async ({ session, request }) => {
  await session.visit(`/admin/${encodeURIComponent(DT)}/${DOC}`)
  await session.step('the row visit is present', async ({ page }) => {
    await expect(page.getByTestId('form-view')).toBeVisible()
  })

  const token = await adminToken(request)

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

test('#101 P5: resume tiles put yesterday one click away', async ({ session }) => {
  await session.visit('/admin')
  await session.step('build a search trail, then use the resume tiles', async ({ page }) => {
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
})

test('#101: searches are remembered and offered back while typing', async ({ session }) => {
  await session.visit('/admin')
  await session.step('a past search is remembered and offered back while typing', async ({ page }) => {
    // Search and open the top hit via Enter — this records the search text.
    const bar = page.getByTestId('awesomebar').locator('input')
    await bar.fill('quokka-rec')
    await expect(page.getByTestId('awesomebar-doc').first()).toBeVisible()
    await bar.press('Enter')
    await expect(page).toHaveURL(new RegExp(`${encodeURIComponent(DT)}/${DOC}`))

    await page.goto('/admin')

    // Typing a prefix later offers the past search; clicking refills the bar.
    await bar.fill('quo')
    const chip = page.getByTestId('awesomebar-recent-search').first()
    await expect(chip).toContainText('quokka-rec')
    await chip.click()
    await expect(bar).toHaveValue('quokka-rec')
  })
})

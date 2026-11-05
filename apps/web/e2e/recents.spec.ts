import { tableSlug } from 'shared'
import { test, expect, adminToken, bearer, type APIRequestContext } from './fixtures'
import { urlFilters } from './nav-url'

const DT = 'Recents DT'
const DOC = 'quokka-recent-doc'
// The row as a person reads it (#476): the Table has no title column, so its
// title is its first readable value — never the id above.
const DOC_TITLE = 'searchable'

test('#827: typed results follow keyboard selection across groups', async ({ session }) => {
  await session.visit('/featherbase/admin/table/person')
  await session.step('choose the Table, new row, record and command with plain arrows', async ({ page }) => {
    const bar = page.getByRole('textbox', { name: 'Search or type a command' })
    for (const [target, path] of [
      ['awesomebar-table', '/featherbase/admin/table/person'],
      ['awesomebar-new', '/featherbase/admin/table/person/new'],
      ['awesomebar-doc', '/featherbase/admin/table/table/row/Person'],
    ]) {
      await page.keyboard.press('Meta+k')
      await bar.fill('person')
      const record = page.getByRole('option', { name: 'Person Table definition', exact: true })
      await expect(record).toBeVisible()
      const targetChoice = target === 'awesomebar-doc' ? record : page.getByTestId(target)
      const choices = page.getByTestId('awesomebar-results').locator('a, button')
      const count = await choices.count()
      for (let i = 0; i < count; i++) {
        await bar.press('ArrowDown')
        await expect(choices.nth(i)).toHaveAttribute('aria-selected', 'true')
        await expect(bar).toHaveAttribute('aria-activedescendant', await choices.nth(i).getAttribute('id') ?? '')
      }
      // Wrap in both directions before choosing the requested group.
      await bar.press('ArrowDown')
      await expect(choices.first()).toHaveAttribute('aria-selected', 'true')
      await bar.press('ArrowUp')
      await expect(choices.last()).toHaveAttribute('aria-selected', 'true')
      for (let i = 0; i < count; i++) {
        if (await targetChoice.getAttribute('aria-selected') === 'true') break
        await bar.press('ArrowUp')
      }
      await expect(targetChoice).toHaveAttribute('aria-selected', 'true')
      // Modified arrows must not change the result selection.
      await bar.press('Meta+ArrowDown')
      await expect(targetChoice).toHaveAttribute('aria-selected', 'true')
      await bar.press('Enter')
      await expect(page).toHaveURL(new RegExp(`${path}$`))
      await expect(page.getByTestId('awesomebar-results')).toBeHidden()
      await expect(bar).not.toBeFocused()
    }
    await page.keyboard.press('Meta+k')
    await bar.fill('go to')
    await expect(page.getByTestId('awesomebar-cmd-home')).toBeVisible()
    await bar.press('ArrowDown')
    await expect(page.getByTestId('awesomebar-cmd-home')).toHaveAttribute('aria-selected', 'true')
    await bar.press('Enter')
    await expect(page).toHaveURL(/\/featherbase\/admin(?:\/home\/home)?$/)
    await expect(page.getByTestId('awesomebar-results')).toBeHidden()
    await page.keyboard.press('Meta+k')
    await bar.fill('pers')
    await expect(page.getByTestId('awesomebar-recent-search')).toBeVisible()
    await bar.press('ArrowDown')
    await expect(page.getByTestId('awesomebar-recent-search')).toHaveAttribute('aria-selected', 'true')
    await bar.press('Enter')
    await expect(bar).toBeFocused()
    await expect(bar).toHaveValue('person')
    await bar.press('Escape')
    await expect(page.getByTestId('awesomebar-results')).toBeHidden()
    await page.keyboard.press('Meta+k')
    await expect(bar).toBeFocused()
    await expect(page.getByTestId('awesomebar-results')).toBeVisible()
  })
})

test('#827: a replacement search cannot activate the previous query record', async ({ session }) => {
  await session.visit('/featherbase/admin/all-tables')
  await session.step('replace a resolved query and press Enter within its debounce window', async ({ page }) => {
    const bar = page.getByRole('textbox', { name: 'Search or type a command' })
    await page.keyboard.press('Meta+k')
    await bar.fill('person')
    await expect(page.getByRole('option', { name: 'Person Table definition', exact: true })).toBeVisible()
    await bar.fill('Sign In Meth')
    await bar.press('Enter')
    await expect(bar).not.toBeFocused()
    await expect(page).not.toHaveURL(/\/all-tables$/)
    expect(decodeURIComponent(new URL(page.url()).pathname)).not.toContain('/table/table/row/Person')
  })
})

for (const activation of ['pointer', 'Enter', 'focused link'] as const) {
  for (const alreadyOpen of [false, true]) {
    test(`#822: ${activation} dismisses a Table destination${alreadyOpen ? ' already open' : ''}`, async ({ session }) => {
      await session.visit(alreadyOpen ? '/featherbase/admin/table/sign-in-method' : '/featherbase/admin/all-tables')
      await session.step('activate the destination, then reopen the command bar', async ({ page }) => {
        await expect(page.getByTestId('all-tables-link')).toBeVisible()
        const bar = page.getByRole('textbox', { name: 'Search or type a command' })
        await page.keyboard.press('Meta+k')
        await expect(bar).toBeFocused()
        await bar.fill('Sign In Method')
        const destination = page.getByTestId('awesomebar-table').filter({ hasText: 'Sign In Method' })
        await expect(destination).toBeVisible()
        if (activation === 'pointer') await destination.click()
        else if (activation === 'Enter') await bar.press('Enter')
        else {
          await bar.press('Tab')
          await expect(destination).toBeFocused()
          await page.keyboard.press('Enter')
        }
        await expect(page).toHaveURL(/\/featherbase\/admin\/table\/sign-in-method$/)
        await expect(page.getByTestId('table-page')).toBeVisible()
        await expect(page.getByTestId('awesomebar-results')).toBeHidden()
        await expect(bar).not.toBeFocused()
        await page.keyboard.press('Meta+k')
        await expect(bar).toBeFocused()
        await expect(page.getByTestId('awesomebar-recents')).toBeVisible()
        await expect(page.getByTestId('awesomebar-recent').filter({ hasText: 'Sign In Method' }).first()).toBeVisible()
      })
    })
  }
}

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

// Every check here is either a regex URL match (assertPath is exact-match
// only) or a testid-addressed command-bar/sidebar/strip walk with keyboard
// input, so each test stays as one named step describing the whole trail;
// session.visit carries the plain navigations around it.
test('#101: an empty command bar lists recent visits and replays them', async ({ session }) => {
  // Build a trail: a filtered list, then a row.
  const filters = encodeURIComponent(JSON.stringify([['note', '=', 'searchable']]))
  await session.visit(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}?filters=${filters}`)
  await session.step('build a trail, then replay it from the empty command bar', async ({ page }) => {
    await expect(page.getByTestId('table-page')).toBeVisible()
    await page.goto(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}/row/${DOC}`)
    await expect(page.getByTestId('form-view')).toBeVisible()
    await page.goto('/admin')

    // Focused + empty: the trail is listed newest first.
    const bar = page.getByTestId('awesomebar').locator('input')
    await bar.click()
    const recents = page.getByTestId('awesomebar-recent')
    await expect(recents.first()).toContainText(DOC_TITLE)
    await expect(recents.first()).not.toContainText(DOC)
    await expect(recents.nth(1)).toContainText(DT)
    await expect(recents.nth(1)).toContainText('Note = searchable')

    // Clicking the list entry replays the URL, filters included.
    await recents.nth(1).click()
    await expect.poll(() => urlFilters(page.url())).toContainEqual(['note', '=', 'searchable'])
    await expect(page.getByTestId('table-page')).toBeVisible()

    await page.goto('/admin')

    // Keyboard: ArrowDown moves the selection, Enter replays it. After the
    // list revisit the order is [list, row], so the second entry is the row.
    await bar.click()
    await expect(recents.first()).toBeVisible()
    await bar.press('ArrowDown')
    await bar.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}/row/${DOC}`))
    await expect(page.getByTestId('form-view')).toBeVisible()
  })
})

test('#101 P2: the sidebar and the per-table strip replay the trail', async ({ session }) => {
  const filters = encodeURIComponent(JSON.stringify([['note', '=', 'searchable']]))
  await session.visit(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}?filters=${filters}`)
  await session.step('sidebar recall and the per-table strip both replay the trail', async ({ page }) => {
    await expect(page.getByTestId('table-page')).toBeVisible()
    await page.goto(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}/row/${DOC}`)
    await expect(page.getByTestId('form-view')).toBeVisible()

    // Sidebar recall, zero keystrokes: the row we're on tops the group.
    const sidebar = page.getByTestId('sidebar-recents')
    await expect(sidebar.getByTestId('sidebar-recent').first()).toContainText(DOC_TITLE)
    await expect(sidebar.getByTestId('sidebar-recent').first()).not.toContainText(DOC)

    // Its filtered-view entry carries the filter summary and replays the URL.
    await sidebar
      .getByTestId('sidebar-recent')
      .filter({ hasText: 'Note = searchable' })
      .first()
      .click()
    await expect.poll(() => urlFilters(page.url())).toContainEqual(['note', '=', 'searchable'])
    await expect(page.getByTestId('table-page')).toBeVisible()

    // The strip above the grid shows this table's recent row + filter set.
    await page.goto(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}`)
    const strip = page.getByTestId('recent-strip')
    await expect(strip.getByTestId('recent-strip-row').first()).toContainText(DOC_TITLE)
    await expect(strip.getByTestId('recent-strip-view').first()).toContainText('Note = searchable')

    // A view chip re-applies the whole filter set; a row chip opens the form.
    await strip.getByTestId('recent-strip-view').first().click()
    await expect.poll(() => urlFilters(page.url())).toContainEqual(['note', '=', 'searchable'])
    await strip.getByTestId('recent-strip-row').first().click()
    await expect(page).toHaveURL(new RegExp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}/row/${DOC}`))
    await expect(page.getByTestId('form-view')).toBeVisible()
  })
})

test('#101 P3: the trail reaches the server in debounced batches', async ({ session, request }) => {
  await session.visit(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}/row/${DOC}`)
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
    await expect(strip.getByTestId('resume-tile-row')).toContainText(DOC_TITLE)
    await expect(strip.getByTestId('resume-tile-row')).not.toContainText(DOC)

    // The search tile hands its query back to the command bar.
    await strip.getByTestId('resume-tile-search').click()
    await expect(bar).toHaveValue('quokka-rec')

    // The row tile resumes the form.
    await page.getByTestId('resume-tile-row').click()
    await expect(page).toHaveURL(new RegExp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}/row/${DOC}`))
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
    await expect(page).toHaveURL(new RegExp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}/row/${DOC}`))

    await page.goto('/admin')

    // Typing a prefix later offers the past search; clicking refills the bar.
    await bar.fill('quo')
    const chip = page.getByTestId('awesomebar-recent-search').first()
    await expect(chip).toContainText('quokka-rec')
    await chip.click()
    await expect(bar).toHaveValue('quokka-rec')
  })
})

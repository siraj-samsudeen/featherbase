import { test, expect, adminAuth, adminToken, bearer } from './fixtures'
import { ensureListTableA, LIST_DT_A as DT_A } from './fixtures-ui'

// Owns its fixture rather than borrowing listview.spec's: this spec sorts
// before listview.spec alphabetically, so under an isolated fresh DB
// (pnpm --filter web e2e) it would self-skip on every run. The assertions
// below depend on the exact row count (30, with qty 0..29), so both specs
// call the one shared builder in ./fixtures-ui — idempotent in either
// direction: whichever runs first fills the Table, the other finds it full.
test.beforeAll(async ({ request }) => {
  await ensureListTableA(request, await adminAuth(request))
})

// Migrated to the feather-testing-core DSL (docs/testing/e2e-dsl-migration.md).
// The filter builder's controls are testid-addressed selects/inputs, not
// labelled fields, so every interaction stays inside named steps —
// `session.visit`/`assertHas` still carry navigation and the plain
// presence/text/count checks the DSL can express.
test('UI-003: filters narrow results, persist in the URL across reload, and are removable', async ({ session }) => {
  await session
    .visit(`/admin/${encodeURIComponent(DT_A)}`)
    .assertHas('[data-testid="list-total"]', { text: '30 total' })

  // qty >= 25 -> 5 rows
  await session.step('add a qty >= 25 filter', async ({ page }) => {
    await page.getByTestId('filter-field').selectOption('qty')
    await page.getByTestId('filter-op').selectOption('>=')
    await page.getByTestId('filter-value').fill('25')
    await page.getByTestId('filter-add').click()
    expect(page.url()).toContain('filters=')
  })
  await session
    .assertHas('[data-testid="list-total"]', { text: '5 total' })
    .assertHas('[data-testid="filter-chip"]', { count: 1 })

  // stack a like filter: title like %item-2% -> qty 25..29 all match item-2X
  await session.step('stack a title like "item-2" filter', async ({ page }) => {
    await page.getByTestId('filter-field').selectOption('title')
    await page.getByTestId('filter-op').selectOption('like')
    await page.getByTestId('filter-value').fill('item-2')
    await page.getByTestId('filter-add').click()
  })
  await session
    .assertHas('[data-testid="filter-chip"]', { count: 2 })
    .assertHas('[data-testid="list-total"]', { text: '5 total' })

  // narrow further: qty = 27 via like on exact title
  await session.step('narrow to title = "item-27"', async ({ page }) => {
    await page.getByTestId('filter-field').selectOption('title')
    await page.getByTestId('filter-op').selectOption('=')
    await page.getByTestId('filter-value').fill('item-27')
    await page.getByTestId('filter-add').click()
  })
  await session
    .assertHas('[data-testid="list-total"]', { text: '1 total' })
    .assertHas('[data-testid="list-rows"]', { text: 'item-27' })

  // reload: filters restored from URL, results still filtered
  await session.step('reload the page', async ({ page }) => {
    await page.reload()
  })
  await session
    .assertHas('[data-testid="filter-chip"]', { count: 3 })
    .assertHas('[data-testid="list-total"]', { text: '1 total' })

  // remove a chip -> widens again
  await session.step('remove the last filter chip', async ({ page }) => {
    await page.getByTestId('filter-chip').last().getByRole('button').click()
  })
  await session
    .assertHas('[data-testid="filter-chip"]', { count: 2 })
    .assertHas('[data-testid="list-total"]', { text: '5 total' })
})

// #87: a filtered list URL is shareable — it has to work when it arrives from
// somewhere other than an in-app navigation (pasted, bookmarked, typed). The
// router's search parser JSON-parses each value, so `filters` reaches the
// route as an Array; it used to be dropped for not being a string, taking the
// filters out of the address bar with it.
// Owns its fixture rather than borrowing listview.spec's: a regression test
// that silently skips on a fresh database is not a regression test.
const DT_COLD = 'UI Filter Cold'

test('#87: a filters URL applies when opened cold, not just when the app built it', async ({
  session,
  request,
}) => {
  const token = await adminToken(request)
  const auth = bearer(token)

  const meta = await request.get(`/api/table/${encodeURIComponent(DT_COLD)}:meta`, { headers: auth })
  if (meta.status() === 404) {
    await request.post('/api/table_def', {
      headers: auth,
      data: {
        name: DT_COLD,
        columns: [
          { column_name: 'title', column_type: 'Data', label: 'Title', in_list_view: true },
          { column_name: 'qty', column_type: 'Int', label: 'Qty', in_list_view: true },
        ],
      },
    })
  }
  // This table belongs to this test alone, so it is emptied and refilled to
  // exactly ten rows. Seeding "up to ten" instead would depend on what an
  // earlier run left behind, and the assertions below count rows exactly.
  const existing = await request.get(
    `/api/table/${encodeURIComponent(DT_COLD)}?limit_page_length=500`,
    { headers: auth },
  )
  for (const row of ((await existing.json()) as { data: { row_id: string }[] }).data) {
    await request.delete(`/api/table/${encodeURIComponent(DT_COLD)}/${row.row_id}`, { headers: auth })
  }
  for (let i = 0; i < 10; i++) {
    await request.post(`/api/table/${encodeURIComponent(DT_COLD)}`, {
      headers: auth,
      data: { title: `cold-${i}`, qty: i },
    })
  }

  // Typed by hand, never built by the app: qty >= 7 -> 3 of the 10 rows.
  // Filters are [field, op, value] triples (see `parsed` in router.tsx).
  const filters = encodeURIComponent(JSON.stringify([['qty', '>=', 7]]))
  await session.visit(`/admin/${encodeURIComponent(DT_COLD)}?filters=${filters}`)
  await session
    .assertHas('[data-testid="filter-chip"]', { count: 1 })
    .step('the list shows exactly 3 total', async ({ page }) => { await expect(page.getByTestId('list-total')).toHaveText('3 total') })
  // The parameter is still in the address bar — not silently stripped.
  await session.step('the filters param is still in the address bar', async ({ page }) => {
    expect(page.url()).toContain('filters=')
  })

  // And it survives a reload, the same as an app-built one.
  await session.step('reload the page', async ({ page }) => {
    await page.reload()
  })
  await session
    .assertHas('[data-testid="filter-chip"]', { count: 1 })
    .step('the list shows exactly 3 total', async ({ page }) => { await expect(page.getByTestId('list-total')).toHaveText('3 total') })

  // A URL is user input. Values that parse as JSON but are the wrong shape are
  // discarded, not handed to ListView — which indexes each entry as a triple
  // and would throw, blanking the page.
  for (const bad of ['{}', '[null]', '["qty",">=",7]', '[["qty"]]', 'not json']) {
    await session.visit(`/admin/${encodeURIComponent(DT_COLD)}?filters=${encodeURIComponent(bad)}`)
    await session
      .step('the list shows exactly 10 total', async ({ page }) => { await expect(page.getByTestId('list-total')).toHaveText('10 total') })
      .assertHas('[data-testid="filter-chip"]', { count: 0 })
  }
})

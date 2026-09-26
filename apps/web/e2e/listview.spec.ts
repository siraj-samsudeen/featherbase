import { test, expect, adminAuth } from './fixtures'
import { ensureListTableA, ensureTable, fillRows, LIST_DT_A as DT_A } from './fixtures-ui'

const DT_B = 'UI List B'

test.beforeAll(async ({ request }) => {
  const auth = await adminAuth(request)
  // The DT_A fill-to-30 is shared with filters.spec (./fixtures-ui): both
  // assert exact counts against it, and either may run first.
  await ensureListTableA(request, auth)
  await ensureTable(request, auth, {
    name: DT_B,
    columns: [
      { column_name: 'city', column_type: 'Data', label: 'City', in_list_view: true },
      { column_name: 'active', column_type: 'Check', label: 'Active', in_list_view: true },
    ],
  })
  await fillRows(request, auth, DT_B, 3, (i) => ({ city: `city-${i}`, active: i % 2 === 0 }))
})

// UI-002, migrated to the feather-testing-core DSL (docs/testing/e2e-dsl-migration.md):
// counts, sort clicks and pagination controls are all addressed by
// data-testid rather than a label or button name, so they stay in named
// steps — assertHas covers the plain presence/text/count checks the DSL CAN
// express.
test('UI-002: one generic ListView renders two different Tables with sort + pagination', async ({ session }) => {
  // --- Table A: metadata columns, pagination
  await session
    .visit(`/admin/${encodeURIComponent(DT_A)}`)
    .assertHas('[data-testid="col-title"]', { text: 'Title' })
    .assertHas('[data-testid="col-qty"]', { text: 'Qty' })
    .assertHas('[data-testid="list-total"]', { text: '30 total' })
    .assertHas('[data-testid="list-rows"] tr', { count: 20 })
    .assertHas('[data-testid="page-info"]', { text: '1–20 of 30' })

  await session.step('click to the second page', async ({ page }) => {
    await page.getByTestId('next-page').click()
  })
  await session
    .assertHas('[data-testid="page-info"]', { text: '21–30 of 30' })
    .assertHas('[data-testid="list-rows"] tr', { count: 10 })
  await session.step('pagination buttons flip state at the last page', async ({ page }) => {
    await expect(page.getByTestId('prev-page')).toBeEnabled()
    await expect(page.getByTestId('next-page')).toBeDisabled()
  })

  // --- Sorting: qty asc puts qty=0 first; desc puts qty=29 first
  await session.step('sort ascending by clicking the Qty column header', async ({ page }) => {
    await page.getByTestId('col-qty').click()
  })
  await session
    .assertHas('[data-testid="page-info"]', { text: '1–20 of 30' })
    .assertHas('[data-testid="list-rows"] tr:first-child', { text: 'item-00' })
  await session.step('sort descending by clicking Qty again', async ({ page }) => {
    await page.getByTestId('col-qty').click()
  })
  await session.assertHas('[data-testid="list-rows"] tr:first-child', { text: 'item-29' })

  // --- Table B: same component, entirely different columns
  await session
    .visit(`/admin/${encodeURIComponent(DT_B)}`)
    .assertHas('[data-testid="col-city"]', { text: 'City' })
    .assertHas('[data-testid="col-active"]', { text: 'Active' })
    .assertHas('[data-testid="list-total"]', { text: '3 total' })
    .assertHas('[data-testid="list-rows"] tr', { count: 3 })
    .assertHas('[data-testid="list-rows"]', { text: '✓' })

  // Row link navigates to the document route
  await session.step('click the first row link', async ({ page }) => {
    await page.getByTestId('list-rows').locator('tr').first().locator('a').click()
  })
  await session.assertHas('[data-testid="doc-page"]')
})

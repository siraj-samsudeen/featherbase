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

test('UI-002: one generic ListView renders two different Tables with sort + pagination', async ({ page }) => {
  // --- Table A: metadata columns, pagination
  await page.goto(`/admin/${encodeURIComponent(DT_A)}`)
  await expect(page.getByTestId('col-title')).toContainText('Title')
  await expect(page.getByTestId('col-qty')).toContainText('Qty')
  await expect(page.getByTestId('list-total')).toContainText('30 total')
  await expect(page.getByTestId('list-rows').locator('tr')).toHaveCount(20)
  await expect(page.getByTestId('page-info')).toContainText('1–20 of 30')

  await page.getByTestId('next-page').click()
  await expect(page.getByTestId('page-info')).toContainText('21–30 of 30')
  await expect(page.getByTestId('list-rows').locator('tr')).toHaveCount(10)
  await expect(page.getByTestId('prev-page')).toBeEnabled()
  await expect(page.getByTestId('next-page')).toBeDisabled()

  // --- Sorting: qty asc puts qty=0 first; desc puts qty=29 first
  await page.getByTestId('col-qty').click()
  await expect(page.getByTestId('page-info')).toContainText('1–20 of 30')
  await expect(page.getByTestId('list-rows').locator('tr').first()).toContainText('item-00')
  await page.getByTestId('col-qty').click()
  await expect(page.getByTestId('list-rows').locator('tr').first()).toContainText('item-29')

  // --- Table B: same component, entirely different columns
  await page.goto(`/admin/${encodeURIComponent(DT_B)}`)
  await expect(page.getByTestId('col-city')).toContainText('City')
  await expect(page.getByTestId('col-active')).toContainText('Active')
  await expect(page.getByTestId('list-total')).toContainText('3 total')
  await expect(page.getByTestId('list-rows').locator('tr')).toHaveCount(3)
  await expect(page.getByTestId('list-rows')).toContainText('✓')

  // Row link navigates to the document route
  await page.getByTestId('list-rows').locator('tr').first().locator('a').click()
  await expect(page.getByTestId('doc-page')).toBeVisible()
})

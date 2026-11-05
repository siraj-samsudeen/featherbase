// #742: quick filters follow the columns a person sees. These journeys need a
// real browser: the page address, real layout at desktop and phone widths, and
// the rows a real server returns. The box rules themselves are component tests
// (test/quick-filters.test.tsx).
//
// SWITCH is the only Table whose columns a journey switches, and each journey
// that switches one switches it back, so the others read the Table's defaults.
import { test, expect, adminAuth, type Page } from './fixtures'
import { ensureTable, fillRows } from './fixtures-ui'
import { tableHref } from 'shared'

const SWITCH = 'E2E Quick Switch'
const BOXES = 'E2E Quick Boxes'
const enc = encodeURIComponent

test.beforeAll(async ({ request }) => {
  const auth = await adminAuth(request)
  await ensureTable(request, auth, {
    name: SWITCH,
    columns: [
      { column_name: 'section', column_type: 'Data', label: 'Section', in_list_view: true },
      { column_name: 'remarks', column_type: 'Data', label: 'Remarks' },
      { column_name: 'floor', column_type: 'Choice', label: 'Floor', choices: 'Ground\nFirst', in_list_view: true },
    ],
  })
  await fillRows(request, auth, SWITCH, 3, (i) => ({ section: `section-${i}`, floor: i < 2 ? 'Ground' : 'First' }))
  // Eight columns that can take a box, so the desktop row shows six.
  await ensureTable(request, auth, {
    name: BOXES,
    columns: [
      { column_name: 'store', column_type: 'Choice', label: 'Store', choices: 'KKL\nTVM', in_list_view: true },
      { column_name: 'lob', column_type: 'Data', label: 'LOB', in_list_view: true },
      { column_name: 'main_category', column_type: 'Data', label: 'Main Category', in_list_view: true },
      { column_name: 'category', column_type: 'Data', label: 'Category', in_list_view: true },
      { column_name: 'section', column_type: 'Data', label: 'Section', in_list_view: true },
      { column_name: 'floor', column_type: 'Choice', label: 'Floor', choices: 'Ground\nFirst', in_list_view: true },
      { column_name: 'owner_name', column_type: 'Data', label: 'Owner', in_list_view: true },
      { column_name: 'active', column_type: 'Check', label: 'Active', in_list_view: true },
    ],
  })
  const rows = [
    { store: 'KKL', floor: 'Ground', owner_name: 'Asha', active: true },
    { store: 'KKL', floor: 'First', owner_name: 'Ravi', active: false },
    { store: 'TVM', floor: 'Ground', owner_name: 'Meena', active: true },
    { store: 'TVM', floor: 'First', owner_name: 'Kumar', active: true },
  ]
  await fillRows(request, auth, BOXES, rows.length, (i) => ({
    ...rows[i], lob: 'Textiles', main_category: 'Women', category: 'Sarees', section: `section-${i}`,
  }))
})

const boxes = (page: Page) =>
  page
    .locator('[data-testid="standard-filters"] [data-testid^="std-filter-"]:not([data-testid="std-filter-more"])')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.replace('std-filter-', '')))

async function switchColumn(page: Page, column: string) {
  if (!(await page.getByTestId('list-columns-popup').isVisible())) await page.getByTestId('list-columns').click()
  const toggle = page.getByTestId(`list-col-toggle-${column}`)
  const was = await toggle.isChecked()
  const saved = page.waitForResponse((r) => r.url().includes('/api/user_settings/') && r.request().method() === 'PUT')
  await toggle.click()
  await saved
  await expect(toggle).toBeChecked({ checked: !was })
}

test('Switching a column on and off makes its box appear and go', async ({ session }) => {
  await session.visit(`${tableHref(SWITCH)}`).assertHas('[data-testid="list-total"]', { text: '3 total' })
  await session.step('switch Remarks on: its box appears in its place', async ({ page }) => {
    await switchColumn(page, 'remarks')
    await expect.poll(() => boxes(page)).toEqual(['section', 'remarks', 'floor'])
  })
  await session.step('switch Remarks off again: its box goes', async ({ page }) => {
    await switchColumn(page, 'remarks')
    await expect.poll(() => boxes(page)).toEqual(['section', 'floor'])
  })
})

test('Filtering a column and hiding it keeps the filter on', async ({ session }) => {
  await session.visit(`${tableHref(SWITCH)}`).assertHas('[data-testid="list-total"]', { text: '3 total' })
  await session.step('pick Ground in the Floor box', async ({ page }) => {
    await page.getByTestId('std-filter-floor').selectOption('Ground')
  })
  await session.assertHas('[data-testid="list-total"]', { text: '2 total' })
  await session.step('switch Floor off: its box goes, the filter stays', async ({ page }) => {
    await switchColumn(page, 'floor')
    await expect(page.getByTestId('std-filter-floor')).toHaveCount(0)
  })
  await session
    .assertHas('[data-testid="list-total"]', { text: '2 total' })
    .assertHas('[data-testid="filter-chip"]', { text: 'Floor = Ground' })
  await session.step('remove the chip, then switch Floor back on', async ({ page }) => {
    await page.getByTestId('filter-chip').getByLabel('Remove filter').click()
    await expect(page.getByTestId('list-total')).toHaveText('3 total')
    await switchColumn(page, 'floor')
  })
})

test('Picking a Choice in Add filter from its dropdown narrows the rows', async ({ session }) => {
  await session.visit(`${tableHref(BOXES)}`).assertHas('[data-testid="list-total"]', { text: '4 total' })
  await session.step('add Floor = Ground by picking, not typing', async ({ page }) => {
    await page.getByTestId('filter-field').selectOption('floor')
    await expect(page.getByTestId('filter-op').locator('option')).toHaveText(['=', '!='])
    await page.getByTestId('filter-value').selectOption('Ground')
    await page.getByTestId('filter-add').click()
  })
  await session
    .assertHas('[data-testid="list-total"]', { text: '2 total' })
    .assertHas('[data-testid="filter-chip"]', { text: 'Floor = Ground' })
})

test('Picking Yes in the Active box and in Add filter shows the right rows', async ({ session }) => {
  await session.visit(`${tableHref(BOXES)}`).assertHas('[data-testid="list-total"]', { text: '4 total' })
  await session.step('pick Yes in the Active box (after +2 more)', async ({ page }) => {
    await page.getByTestId('std-filter-more').click()
    await page.getByTestId('std-filter-active').selectOption('Yes')
  })
  await session.assertHas('[data-testid="list-total"]', { text: '3 total' })
  await session.step('the page address holds the word Yes', async ({ page }) => {
    // The router stores the filters as a JSON string inside the search value.
    const filters = JSON.parse(JSON.parse(new URL(page.url()).searchParams.get('filters')!) as string) as unknown[]
    expect(filters).toEqual([['active', '=', 'Yes']])
    await page.getByTestId('std-filter-active').selectOption('')
    await expect(page.getByTestId('list-total')).toHaveText('4 total')
  })
  await session.step('add Active = No in Add filter', async ({ page }) => {
    await page.getByTestId('filter-field').selectOption('active')
    await page.getByTestId('filter-value').selectOption('No')
    await page.getByTestId('filter-add').click()
  })
  await session
    .assertHas('[data-testid="list-total"]', { text: '1 total' })
    .assertHas('[data-testid="filter-chip"]', { text: 'Active = No' })
})

// Deliberate deep links: the journey is a link someone changed by hand.
test('A hand-edited link saying "true" shows the active rows, and one saying "maybe" shows none', async ({ session }) => {
  await session
    .visit(`${tableHref(BOXES)}?filters=${enc(JSON.stringify([['active', '=', 'true']]))}`)
    .assertHas('[data-testid="list-total"]', { text: '3 total' })
  await session
    .visit(`${tableHref(BOXES)}?filters=${enc(JSON.stringify([['active', '=', 'maybe']]))}`)
    .assertHas('[data-testid="filter-chip"]', { text: 'Active = maybe' })
  await session.step('no rows, and no error', async ({ page }) => {
    await expect(page.getByTestId('list-total')).toHaveText('0 total')
    await expect(page.getByRole('alert')).toHaveCount(0)
  })
})

test('Eight possible boxes show six plus "+2 more", and a box in use stays showing', async ({ session }) => {
  // assertHas reads its text as a pattern, and "+" is a pattern character: exact
  // text checks stay raw expects.
  await session.visit(`${tableHref(BOXES)}`)
  await session.step('six boxes, in column order, then +2 more', async ({ page }) => {
    await expect(page.getByTestId('std-filter-more')).toHaveText('+2 more')
    expect(await boxes(page)).toEqual(['store', 'lob', 'main_category', 'category', 'section', 'floor'])
  })
  await session.visit(`${tableHref(BOXES)}?filters=${enc(JSON.stringify([['owner_name', 'like', '%Asha%']]))}`)
  await session.step('the Owner box shows, holding its value', async ({ page }) => {
    await expect(page.getByTestId('std-filter-more')).toHaveText('+1 more')
    expect(await boxes(page)).toEqual(['store', 'lob', 'main_category', 'category', 'section', 'floor', 'owner_name'])
    await expect(page.getByTestId('std-filter-owner_name')).toHaveValue('Asha')
  })
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })

  test('On a phone the filters fold with a count, open stacked, and the rows come straight after them', async ({ session }) => {
    const two = JSON.stringify([['store', '=', 'KKL'], ['floor', '=', 'Ground']])
    await session.visit(`${tableHref(BOXES)}?filters=${enc(two)}`)
    await session.step('folded: no filter control shows, and the rows come next', async ({ page }) => {
      await expect(page.getByTestId('filters-toggle')).toHaveText('Filters (2)')
      await expect(page.getByTestId('standard-filters')).toHaveCount(0)
      await expect(page.getByTestId('filter-field')).toHaveCount(0)
      const toggle = (await page.getByTestId('filters-toggle').boundingBox())!
      const rows = (await page.getByTestId('list-rows').boundingBox())!
      // Only the list's own Select all / Sort by line sits between them.
      expect(rows.y - (toggle.y + toggle.height)).toBeLessThan(160)
    })
    await session.step('open: four boxes stacked, Floor too since it holds a value, then +3 more', async ({ page }) => {
      await page.getByTestId('filters-toggle').click()
      expect(await boxes(page)).toEqual(['store', 'lob', 'main_category', 'category', 'floor'])
      await expect(page.getByTestId('std-filter-more')).toHaveText('+3 more')
      const tops = await Promise.all(['store', 'lob'].map(async (c) => (await page.getByTestId(`std-filter-${c}`).boundingBox())!))
      expect(tops[1].y).toBeGreaterThan(tops[0].y + tops[0].height - 1)
    })
    await session.step('Add filter sits on one line', async ({ page }) => {
      const parts = await Promise.all(
        ['filter-field', 'filter-op', 'filter-value', 'filter-add'].map(async (id) => (await page.getByTestId(id).boundingBox())!),
      )
      for (const p of parts) expect(Math.abs(p.y - parts[0].y)).toBeLessThan(2)
      expect(parts[3].x + parts[3].width).toBeLessThanOrEqual(375)
      // The column is the widest part, so its name (here "Row ID") is not cut off.
      const field = page.getByTestId('filter-field')
      expect(await field.evaluate((el: HTMLSelectElement) => el.scrollWidth <= el.clientWidth)).toBe(true)
      expect(parts[0].width).toBeGreaterThan(parts[2].width)
    })
  })
})

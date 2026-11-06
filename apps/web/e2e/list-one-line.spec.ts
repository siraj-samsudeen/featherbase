// #1015, #1016, #1017 (spec: list-view "A list row is one line", "A list's
// controls leave the room to its rows"): what only real layout can witness:
// row heights, clipping, sideways scrolling, boxes lining up.
import { tableSlug } from 'shared'
import { test, expect, adminAuth, type Page } from './fixtures'
import { ensureTable, fillRows } from './fixtures-ui'

const TARGET = 'UI One Line Cluster'
const WIDE = 'UI One Line Wide'
const LONG_NOTE = 'The site sits beside the old canal road and takes deliveries at the north gate before nine in the morning, while the south gate is kept for staff. '.repeat(4).trim()
const EXTRA = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet']
const url = `/featherbase/admin/table/${encodeURIComponent(tableSlug(WIDE))}`

test.beforeAll(async ({ request }) => {
  const auth = await adminAuth(request)
  await ensureTable(request, auth, {
    name: TARGET, id_pattern: 'prompt', title_column: 'cluster_name',
    columns: [{ column_name: 'cluster_name', column_type: 'Data', label: 'Cluster name', in_list_view: true }],
  })
  await fillRows(request, auth, TARGET, 1, () => ({ row_id: 'C1', cluster_name: 'The Northern Coastal Cluster' }))
  await ensureTable(request, auth, {
    name: WIDE, title_column: 'site_name',
    columns: [
      { column_name: 'site_name', column_type: 'Data', label: 'Name', in_list_view: true },
      { column_name: 'state', column_type: 'Choice', label: 'State', choices: 'Tamil Nadu\nAndhra Pradesh', in_list_view: true },
      { column_name: 'cluster', column_type: 'Reference', reference_table: TARGET, label: 'Cluster', in_list_view: true },
      { column_name: 'area', column_type: 'Data', label: 'Area', in_list_view: true },
      { column_name: 'note', column_type: 'Long Text', label: 'Note', in_list_view: true },
      { column_name: 'qty', column_type: 'Int', label: 'A very long column label that must not make the header row any taller than one line', in_list_view: true },
      ...EXTRA.map((c) => ({ column_name: c, column_type: 'Int', label: `Column ${c}`, in_list_view: true })),
    ],
  })
  await fillRows(request, auth, WIDE, 3, (i) => ({
    site_name: `Site ${i}`,
    state: i % 2 ? 'Andhra Pradesh' : 'Tamil Nadu',
    cluster: 'C1',
    area: 'Tamil Nadu',
    note: i === 0 ? LONG_NOTE : i === 1 ? 'first line\nsecond line\nthird line' : 'short',
    qty: i,
    ...Object.fromEntries(EXTRA.map((c) => [c, 1000 + i])),
  }))
})

const scrollArea = (page: Page) => page.getByTestId('list-table-scroll')
const noteCell = (page: Page) => page.getByTestId('list-rows').getByTestId('cell-note').filter({ hasText: 'canal road' })
const layout = (page: Page) => page.getByRole('group', { name: 'List layout' })

async function openWide(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(url)
  await expect(page.getByTestId('list-total')).toContainText('3 total')
  await expect(page.getByTestId('list-rows').getByText('The Northern Coastal Cluster').first()).toBeVisible()
}

test('#1015: every row and the header are one line, however long a value is', async ({ session }) => {
  await session.step('compare row heights', async ({ page }) => {
    await openWide(page)
    const heights = await page.getByTestId('list-rows').locator('tr').evaluateAll((rows) => rows.map((r) => r.getBoundingClientRect().height))
    expect(heights).toHaveLength(3)
    expect(Math.max(...heights), 'every row is one line of text').toBeLessThan(44)
    // The last row alone has no line under it.
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1)
    const header = await page.locator('[data-testid="list-table-scroll"] thead tr').evaluate((r) => r.getBoundingClientRect().height)
    expect(header).toBeLessThan(44)
  })
})

test('#1015: a long value is clipped at a maximum width and shows in full on hover', async ({ session }) => {
  await session.step('hover the clipped note, then a value that fits', async ({ page }) => {
    await openWide(page)
    const clip = noteCell(page).locator('xpath=ancestor::div[1]')
    expect(await clip.evaluate((el) => el.getBoundingClientRect().width)).toBeLessThanOrEqual(321)
    expect(await clip.evaluate((el) => getComputedStyle(el).textOverflow)).toBe('ellipsis')
    await clip.hover()
    await expect(clip).toHaveAttribute('title', LONG_NOTE)
    const fits = page.getByTestId('list-rows').getByTestId('cell-alpha').first().locator('xpath=ancestor::div[1]')
    await fits.hover()
    await expect(fits).not.toHaveAttribute('title')
  })
})

test('#1015: more columns to the right are signalled, and the name stays in view', async ({ session }) => {
  await session.step('scroll to the far right', async ({ page }) => {
    await openWide(page)
    const more = page.getByTestId('list-more-columns')
    await expect(more).toBeVisible()
    const nameLink = page.getByTestId('list-rows').getByRole('link', { name: 'Site 0' })
    const before = (await nameLink.boundingBox())!.x
    await more.getByRole('button').click()
    await expect.poll(() => scrollArea(page).evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    await scrollArea(page).evaluate((el) => { el.scrollLeft = el.scrollWidth })
    await expect(more).toHaveCount(0)
    const area = (await scrollArea(page).boundingBox())!
    const after = (await nameLink.boundingBox())!.x
    expect(after).toBeGreaterThanOrEqual(area.x)
    expect(after).toBeLessThanOrEqual(before)
    // Nothing shows through the name column: its cell paints a solid colour.
    const paint = await nameLink.evaluate((el) => getComputedStyle(el.closest('td')!).backgroundColor)
    expect(paint).not.toBe('rgba(0, 0, 0, 0)')
  })
})

test('#1015: Compact fits without the sideways hint, and stays one line', async ({ session }) => {
  await session.step('switch to Compact', async ({ page }) => {
    await openWide(page)
    await layout(page).getByRole('button', { name: 'Compact' }).click()
    await expect(page.getByTestId('list-more-columns')).toHaveCount(0)
    const heights = await page.getByTestId('list-rows').locator('tr').evaluateAll((rows) => rows.map((r) => r.getBoundingClientRect().height))
    expect(Math.max(...heights)).toBeLessThan(44)
    // The choice is remembered for this person; leave the Table as the others expect it.
    await layout(page).getByRole('button', { name: 'Table', exact: true }).click()
    await expect(layout(page).getByRole('button', { name: 'Table', exact: true })).toHaveAttribute('aria-pressed', 'true')
  })
})

test('#1015: a short value keeps one line in full, and a list uses a wide window', async ({ session }) => {
  await session.step('measure a short value, then widen the window', async ({ page }) => {
    await openWide(page)
    const area = page.getByTestId('list-rows').getByTestId('cell-area').first()
    await expect(area).toHaveText('Tamil Nadu')
    expect(await area.locator('xpath=ancestor::div[1]').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    const at1280 = await scrollArea(page).evaluate((el) => el.clientWidth)
    await page.setViewportSize({ width: 1680, height: 900 })
    await expect.poll(() => scrollArea(page).evaluate((el) => el.clientWidth)).toBeGreaterThan(at1280 + 300)
  })
})

test('#1015: columns stay as wide as their content when everything fits', async ({ session }) => {
  await session.step('switch to Compact and measure', async ({ page }) => {
    await openWide(page)
    await layout(page).getByRole('button', { name: 'Compact' }).click()
    await expect(page.getByTestId('col-note')).toHaveCount(0)
    const name = await page.getByTestId('list-rows').locator('tr').first().locator('td').nth(1).evaluate((el) => el.getBoundingClientRect().width)
    expect(name).toBeLessThan(120)
    await layout(page).getByRole('button', { name: 'Table', exact: true }).click()
    await expect(layout(page).getByRole('button', { name: 'Table', exact: true })).toHaveAttribute('aria-pressed', 'true')
  })
})

test('#1019: clicking a link filter shows the values, and typing goes to its search box', async ({ session }) => {
  await session.step('click the Cluster filter', async ({ page }) => {
    await openWide(page)
    await page.getByTestId('std-filter-cluster').click()
    const list = page.getByTestId('link-options-cluster')
    await expect(list.getByTestId('link-option')).toHaveText(['The Northern Coastal Cluster'])
    await expect(list.getByRole('searchbox')).toBeFocused()
    await page.keyboard.type('zzz')
    await expect(list).toContainText('No matches')
    await list.getByRole('searchbox').fill('Northern')
    await list.getByTestId('link-option').click()
    await expect(page.getByTestId('std-filter-cluster')).toHaveValue('The Northern Coastal Cluster')
  })
})

test('#1015: on a phone a long column label leaves the page where it is', async ({ session }) => {
  await session.step('measure the sort control at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto(url)
    await expect(page.getByTestId('list-sort-by')).toBeVisible()
    const box = (await page.getByTestId('list-sort-by').boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(375)
    expect(await page.locator('main').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  })
})

test('#1016: the filter boxes line up', async ({ session }) => {
  await session.step('measure the filter row', async ({ page }) => {
    await openWide(page)
    const boxes = await page.getByTestId('standard-filters').locator('input, select').evaluateAll((els) =>
      els.map((e) => { const r = e.getBoundingClientRect(); return { top: r.top, height: r.height } }))
    expect(boxes).toHaveLength(4)
    for (const box of boxes) expect(box).toEqual(boxes[0])
  })
})

test('#1017: the first row starts in the top two fifths of a desktop window, with every admin menu showing', async ({ session }) => {
  await session.step('measure the first row', async ({ page }) => {
    await openWide(page)
    // A notice across the window's top lasts until the instance is set up; it isn't one of the list's controls.
    const top = await page.evaluate(() => {
      const row = document.querySelector('[data-testid="list-rows"] tr')!.getBoundingClientRect().top
      const notices = [...document.querySelectorAll('[data-testid="health-banner"], [data-testid="setup-banner"]')]
      return row - notices.reduce((sum, notice) => sum + notice.getBoundingClientRect().height, 0)
    })
    expect(top).toBeLessThanOrEqual(800 * 0.4)
  })
})

test('#1017: a wider font keeps the filters and layout choices on one line', async ({ session }) => {
  await session.step('measure the controls in a wide font', async ({ page }) => {
    await openWide(page)
    await page.addStyleTag({ content: 'main * { font-family: "DejaVu Sans", Verdana, sans-serif !important }' })
    const box = (await page.getByTestId('standard-filters').locator('input, select').first().boundingBox())!
    const layoutBox = (await layout(page).boundingBox())!
    expect(layoutBox.y, 'the layout choices did not wrap under the filters').toBeLessThan(box.y + box.height)
  })
})

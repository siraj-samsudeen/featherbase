// #820: a Choice column's quick filter is a list of choices to tick. These
// journeys need a real browser for real layout; the filter rules themselves
// are component tests (test/choice-filters-in.test.tsx).
import { test, expect, adminAuth } from './fixtures'
import { ensureTable, fillRows } from './fixtures-ui'
import { tableHref } from 'shared'

// Eight Choice columns: the widest a desktop row of six boxes gets.
const CHOICES = 'E2E Choice Ticks'
const CHOICE_COLUMNS = ['floor', 'zone_1', 'zone_2', 'zone_3', 'zone_4', 'zone_5', 'zone_6', 'zone_7']

test.beforeAll(async ({ request }) => {
  const auth = await adminAuth(request)
  await ensureTable(request, auth, {
    name: CHOICES,
    columns: CHOICE_COLUMNS.map((c) => ({
      column_name: c,
      column_type: 'Choice',
      label: c.replace('_', ' '),
      choices: 'Ground\nFirst Floor\nSecond Floor',
      in_list_view: true,
    })),
  })
  await fillRows(request, auth, CHOICES, 2, (i) => ({ floor: i ? 'Ground' : 'First Floor' }))
})

test('At 1280, six Choice boxes and "+2 more" share one line', async ({ session }) => {
  await session.visit(`${tableHref(CHOICES)}`)
  await session.step('six boxes, then +2 more, all at the same height', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(page.getByTestId('std-filter-more')).toHaveText('+2 more')
    const ends = await Promise.all(
      [...CHOICE_COLUMNS.slice(0, 6).map((c) => `std-filter-${c}`), 'std-filter-more'].map(
        async (id) => (await page.getByTestId(id).boundingBox())!,
      ),
    )
    // One line: every box and the button end at the same height.
    for (const b of ends) expect(Math.abs(b.y + b.height - (ends[0].y + ends[0].height))).toBeLessThan(2)
  })
})

import { test, expect, adminAuth, type Page } from './fixtures'

// #1185: a long record title pushes the action row onto its own line, so
// "Record actions" sits at the left of the content column. The menu used to
// line up with the button's right edge regardless, and the column (a scroll
// container) clipped the part that stuck out to the left.

/** How far each of the menu's buttons sticks out of the area its clipping ancestors and the window leave visible. */
async function overflow(page: Page, label: string) {
  return page.evaluate((name) => {
    const menu = document.querySelector(`[role="group"][aria-label="${name}"]`)!
    let left = 0
    let right = document.documentElement.clientWidth
    for (let a = menu.parentElement; a; a = a.parentElement) {
      if (getComputedStyle(a).overflowX === 'visible') continue
      const box = a.getBoundingClientRect()
      left = Math.max(left, box.left)
      right = Math.min(right, box.right)
    }
    return [...menu.querySelectorAll('a, button')].map((item) => {
      const box = item.getBoundingClientRect()
      return { item: item.textContent, left: Math.max(0, left - box.left), right: Math.max(0, box.right - right) }
    })
  }, label)
}

test.use({ viewport: { width: 1280, height: 800 } })

test('Record actions stays fully visible when a long title puts it at the left of the page', async ({ session, request }) => {
  const headers = await adminAuth(request)
  const saved = await request.post('/api/save_row', {
    headers,
    data: { table: 'Person', row: { full_name: `Priya Example ${Date.now()} · Regional buyer for the northern stores and the seasonal festival range` } },
  })
  expect(saved.status()).toBe(201)
  const { row_id } = await saved.json() as { row_id: string }

  await session
    .visit(`/featherbase/admin/table/Person/row/${row_id}`)
    .clickButton('Record actions')
    .step('every action in the menu is inside the visible area', async ({ page }) => {
      const items = await overflow(page, 'Record actions')
      expect(items.map((entry) => entry.item)).toContain('Delete')
      for (const entry of items) expect(entry, entry.item ?? '').toMatchObject({ left: 0, right: 0 })
      await expect(page.getByRole('group', { name: 'Record actions' })).toHaveAttribute('data-align', 'start')
    })
})

test('Record actions still lines up with the button’s right edge when there is room', async ({ session }) => {
  await session
    .visit('/featherbase/admin/table/Person/row/Administrator')
    .clickButton('Record actions')
    .step('the menu ends at the button’s right edge, fully visible', async ({ page }) => {
      await expect(page.getByRole('group', { name: 'Record actions' })).toHaveAttribute('data-align', 'end')
      for (const entry of await overflow(page, 'Record actions')) expect(entry, entry.item ?? '').toMatchObject({ left: 0, right: 0 })
    })
})

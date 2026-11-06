import { tableSlug } from 'shared'
import { test, expect, adminAuth } from './fixtures'

const DT = 'KB E2E Doc'

let docName: string

test.beforeAll(async ({ request }) => {
  const headers = await adminAuth(request)
  const dt = await request.post('/api/table_def', {
    headers,
    data: { name: DT, columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }] },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  const doc = await request.post(`/api/table/${encodeURIComponent(DT)}`, { headers, data: { title: 'orig' } })
  docName = ((await doc.json()) as { row_id: string }).row_id
})

// UI-015: Ctrl/Cmd+S saves the current form. Keyboard
// shortcuts and `[data-field]` addressing aren't expressible by DSL verbs,
// so they stay in named steps; assertHas covers the plain checks around them.
test('UI-015: Ctrl+S saves the form', async ({ session }) => {
  await session.visit(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}/row/${docName}`).assertHas('[data-testid="form-view"]')
  await session.step('fill the title field and press Ctrl+S', async ({ page }) => {
    await page.locator('[data-field=title]').fill(`kb-${Date.now()}`)
    await page.keyboard.press('Control+s')
  })
  await session.assertHas('[data-testid="form-banner"]', { text: 'Saved' })
})

// UI-015, #1018: g then n opens a new document of the current Table.
test('UI-015: g then n opens a new document', async ({ session }) => {
  await session.visit(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}`).assertHas('[data-testid="list-view"]')
  await session.step('press g then n', async ({ page }) => {
    // Nothing has focus on a page just opened. No click to get there: the middle
    // of the page may be a filter box or a Table's link, whatever earlier specs left.
    await page.keyboard.press('g')
    await page.keyboard.press('n')
    await expect(page).toHaveURL(new RegExp(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}/new`))
  })
  await session.assertHas('[data-testid="form-view"]')
})

// #1018: the key press and the width are what the browser alone can witness.
test('#1018: Ctrl+B and the control give the content the width of the sidebar, and a reload remembers', async ({ session }) => {
  await session.visit(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}`).assertHas('[data-testid="list-view"]')
  await session.step('collapse by keyboard, reopen by the control', async ({ page }) => {
    // Wider than the 1024px reading width of other pages, where the list has to
    // get the sidebar's 240px too. Measured on the list: the page around it
    // growing is not the table getting the room.
    await page.setViewportSize({ width: 1440, height: 800 })
    const sidebar = page.getByTestId('admin-sidebar')
    const control = page.getByTestId('sidebar-collapse')
    const list = page.getByTestId('list-view')
    await expect(sidebar).toBeVisible()
    const before = (await list.boundingBox())!
    const controlAt = (await control.boundingBox())!

    await page.keyboard.press('Control+b')
    await expect(sidebar).toBeHidden()
    await expect.poll(async () => (await list.boundingBox())!.width).toBe(before.width + 240)
    // The control stays exactly where it was, so a second click reopens.
    expect((await control.boundingBox())!.x).toBe(controlAt.x)

    await page.reload()
    await expect(list).toBeVisible()
    await expect(sidebar).toBeHidden()

    await control.click()
    await expect(sidebar).toBeVisible()
    await page.reload()
    await expect(list).toBeVisible()
    await expect(sidebar).toBeVisible()
  })
})

// #1018: only a Table's list takes the whole width; other pages keep their
// reading width, collapsed or not.
test('#1018: a page that is not a list keeps its reading width', async ({ session }) => {
  await session.visit('/featherbase/admin/all-tables').assertHas('[data-testid="admin-sidebar"]')
  await session.step('collapse on a wide window', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 })
    await page.keyboard.press('Control+b')
    await expect(page.getByTestId('admin-sidebar')).toBeHidden()
    await expect.poll(async () => (await page.locator('main > div').boundingBox())!.width).toBe(1024)
    await page.keyboard.press('Control+b')
    await expect(page.getByTestId('admin-sidebar')).toBeVisible()
  })
})

// UI-015: the "g then d" leader sequence navigates to the Admin home.
test('UI-015: g then d navigates to the Admin home', async ({ session }) => {
  await session.visit(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}/row/${docName}`).assertHas('[data-testid="form-view"]')
  await session.step('press g then d after clicking off any input', async ({ page }) => {
    await page.locator('body').click() // ensure focus is not in an input
    await page.keyboard.press('g')
    await page.keyboard.press('d')
    // #80: the Admin home now lands on the first visible Home Page.
    await expect(page).toHaveURL(/\/admin(\/home\/|$)/)
  })
})

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
    await page.locator('body').click()
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
    const sidebar = page.getByTestId('admin-sidebar')
    const control = page.getByTestId('sidebar-collapse')
    const main = page.locator('main')
    await expect(sidebar).toBeVisible()
    const before = (await main.boundingBox())!
    const controlAt = (await control.boundingBox())!

    await page.locator('body').click()
    await page.keyboard.press('Control+b')
    await expect(sidebar).toBeHidden()
    await expect.poll(async () => (await main.boundingBox())!.width).toBe(before.width + 240)
    // The control stays exactly where it was, so a second click reopens.
    expect((await control.boundingBox())!.x).toBe(controlAt.x)

    await page.reload()
    await expect(page.getByTestId('list-view')).toBeVisible()
    await expect(sidebar).toBeHidden()

    await control.click()
    await expect(sidebar).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('list-view')).toBeVisible()
    await expect(sidebar).toBeVisible()
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

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

// UI-015: Ctrl/Cmd+S saves the current form. Migrated to the
// feather-testing-core DSL (docs/testing/e2e-dsl-migration.md): keyboard
// shortcuts and `[data-field]` addressing aren't expressible by DSL verbs,
// so they stay in named steps; assertHas covers the plain checks around them.
test('UI-015: Ctrl+S saves the form', async ({ session }) => {
  await session.visit(`/admin/${encodeURIComponent(DT)}/${docName}`).assertHas('[data-testid="form-view"]')
  await session.step('fill the title field and press Ctrl+S', async ({ page }) => {
    await page.locator('[data-field=title]').fill(`kb-${Date.now()}`)
    await page.keyboard.press('Control+s')
  })
  await session.assertHas('[data-testid="form-banner"]', { text: 'Saved' })
})

// UI-015: Ctrl/Cmd+B opens a new document of the current Table.
test('UI-015: Ctrl+B opens a new document', async ({ session }) => {
  await session.visit(`/admin/${encodeURIComponent(DT)}`).assertHas('[data-testid="list-view"]')
  await session.step('press Ctrl+B', async ({ page }) => {
    await page.keyboard.press('Control+b')
    await expect(page).toHaveURL(new RegExp(`/admin/${encodeURIComponent(DT)}/new`))
  })
  await session.assertHas('[data-testid="form-view"]')
})

// UI-015: the "g then d" leader sequence navigates to the Admin home.
test('UI-015: g then d navigates to the Admin home', async ({ session }) => {
  await session.visit(`/admin/${encodeURIComponent(DT)}/${docName}`).assertHas('[data-testid="form-view"]')
  await session.step('press g then d after clicking off any input', async ({ page }) => {
    await page.locator('body').click() // ensure focus is not in an input
    await page.keyboard.press('g')
    await page.keyboard.press('d')
    // #80: the Admin home now lands on the first visible Home Page.
    await expect(page).toHaveURL(/\/admin(\/home\/|$)/)
  })
})

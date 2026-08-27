import { test, expect, adminAuth, type Page } from './fixtures'

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

// UI-015: Ctrl/Cmd+S saves the current form.
test('UI-015: Ctrl+S saves the form', async ({ page }) => {
  await page.goto(`/admin/${encodeURIComponent(DT)}/${docName}`)
  await expect(page.getByTestId('form-view')).toBeVisible()
  await page.locator('[data-field=title]').fill(`kb-${Date.now()}`)
  await page.keyboard.press('Control+s')
  await expect(page.getByTestId('form-banner')).toContainText('Saved')
})

// UI-015: Ctrl/Cmd+B opens a new document of the current Table.
test('UI-015: Ctrl+B opens a new document', async ({ page }) => {
  await page.goto(`/admin/${encodeURIComponent(DT)}`)
  await expect(page.getByTestId('list-view')).toBeVisible()
  await page.keyboard.press('Control+b')
  await expect(page).toHaveURL(new RegExp(`/admin/${encodeURIComponent(DT)}/new`))
  await expect(page.getByTestId('form-view')).toBeVisible()
})

// UI-015: the "g then d" leader sequence navigates to the Admin home.
test('UI-015: g then d navigates to the Admin home', async ({ page }) => {
  await page.goto(`/admin/${encodeURIComponent(DT)}/${docName}`)
  await expect(page.getByTestId('form-view')).toBeVisible()
  await page.locator('body').click() // ensure focus is not in an input
  await page.keyboard.press('g')
  await page.keyboard.press('d')
  // #80: the Admin home now lands on the first visible Home Page.
  await expect(page).toHaveURL(/\/admin(\/home\/|$)/)
})

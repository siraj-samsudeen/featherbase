import { test, expect, adminAuth } from './fixtures'

// #832: a link cell in a grid of nested rows (a person's roles) offers the
// linked Table's rows. The grid scrolls sideways, which would cut off a list
// that drops below its only row; the list floats over the page instead. Set
// NESTED_LINK_SHOTS to a directory to also save screenshots.
const SHOTS = process.env.NESTED_LINK_SHOTS

test.use({ viewport: { width: 1280, height: 800 } })

test("a person's role is picked from a list that the grid does not cut off", async ({ session, request }) => {
  const auth = await adminAuth(request)
  const made = await request.post('/api/save_row', {
    headers: auth,
    data: { table: 'Person', row: { email: `nested-link-${Date.now()}@example.com`, enabled: true } },
  })
  expect(made.status()).toBe(201)
  const { row_id } = (await made.json()) as { row_id: string }

  await session.visit(`/admin/Person/${encodeURIComponent(row_id)}`).assertHas('[data-testid="add-row-roles"]')

  await session.step('typing "Sys" in the new role offers System Manager, fully visible over the page', async ({ page }) => {
    await page.getByTestId('add-row-roles').click()
    const cell = page.getByTestId('table-roles').locator('[data-childfield="role"]')
    await cell.fill('Sys')
    const option = page.getByTestId('link-options-role').getByTestId('link-option').filter({ hasText: 'System Manager' })
    await expect(option).toBeVisible()
    const box = (await option.boundingBox())!
    // The option itself is what a click at its centre lands on: not hidden
    // under the grid's frame or another element.
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.textContent, [box.x + box.width / 2, box.y + box.height / 2])).toBe('System Manager')
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/role-picker-open.png` })
    await option.click()
    await expect(cell).toHaveValue('System Manager')
  })

  await session.step('saving keeps System Manager as the role', async ({ page }) => {
    await page.getByTestId('form-save').click()
    await expect(page.getByTestId('form-banner')).toHaveText('Saved')
    const stored = await request.get(`/api/table/Person/${encodeURIComponent(row_id)}`, { headers: auth })
    expect(((await stored.json()) as { roles: { role: string }[] }).roles.map((r) => r.role)).toEqual(['System Manager'])
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/role-picked-saved.png` })
  })
})

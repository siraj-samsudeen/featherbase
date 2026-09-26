import { test, expect, adminAuth } from './fixtures'
import { ensureFormFixtures, FORM_DT as DT } from './fixtures-ui'

let docName = ''

test.beforeAll(async ({ request }) => {
  docName = await ensureFormFixtures(request, await adminAuth(request))
})

// UI-004/UI-005, migrated to the feather-testing-core DSL
// (docs/testing/e2e-dsl-migration.md). FormView's fields are addressed by
// `[data-field=...]`, not a `<label>`, so every control check stays a named
// step; `session.visit` still carries the navigation and `assertHas` the
// plain-presence checks the DSL can express.
test('UI-004: FormView renders every field type as the correct control', async ({ session }) => {
  await session
    .visit(`/admin/${encodeURIComponent(DT)}/${docName}`)
    .assertHas('[data-testid="form-view"]')

  await session.step('every column type renders the correct control', async ({ page }) => {
    // Data -> text input with value
    await expect(page.locator('[data-field=title]')).toHaveAttribute('type', 'text')
    await expect(page.locator('[data-field=title]')).toHaveValue('form fixture')
    // Int -> number input
    await expect(page.locator('[data-field=qty]')).toHaveAttribute('type', 'number')
    await expect(page.locator('[data-field=qty]')).toHaveValue('4')
    // Check -> checked checkbox
    await expect(page.locator('[data-field=done]')).toBeChecked()
    // Select -> select with the right option chosen
    await expect(page.locator('select[data-field=stage]')).toHaveValue('Open')
    // Date -> date picker input
    await expect(page.locator('[data-field=due]')).toHaveAttribute('type', 'date')
    await expect(page.locator('[data-field=due]')).toHaveValue('2026-08-01')
    // Link -> combobox input holding the linked name
    await expect(page.locator('[data-field=customer]')).toHaveAttribute('role', 'combobox')
    await expect(page.locator('[data-field=customer]')).toHaveValue('Formco')
    // Text -> textarea
    await expect(page.locator('textarea[data-field=notes]')).toContainText('multi')
    // Table -> child grid with both rows
    const grid = page.getByTestId('table-items')
    await expect(grid.locator('tbody tr')).toHaveCount(2)
    await expect(grid.locator('tbody tr').first().locator('[data-childfield=item]')).toHaveValue('bolt')
  })
})

test('UI-005: save persists edits, shows dirty state and field-wise server errors inline', async ({ session }) => {
  await session
    .visit(`/admin/${encodeURIComponent(DT)}/${docName}`)
    .assertHas('[data-testid="form-status"]', { text: 'Saved' })

  await session.step('form-save starts disabled on a clean document', async ({ page }) => {
    await expect(page.getByTestId('form-save')).toBeDisabled()
  })

  // Edit -> dirty -> save -> persisted
  await session.step('edit the title field directly', async ({ page }) => {
    await page.locator('[data-field=title]').fill('edited via form')
  })
  await session.assertHas('[data-testid="form-status"]', { text: 'Not saved' })
  await session.step('save the edit', async ({ page }) => {
    await page.getByTestId('form-save').click()
  })
  await session.assertHas('[data-testid="form-banner"]', { text: 'Saved' })
  await session.step('reload persists the edit', async ({ page }) => {
    await page.reload()
    await expect(page.locator('[data-field=title]')).toHaveValue('edited via form')
  })

  // Server-side field error surfaces inline at the exact field
  await session.step('an over-long title is refused inline at the field', async ({ page }) => {
    await page.locator('[data-field=title]').fill('x'.repeat(150))
    await page.getByTestId('form-save').click()
    await expect(page.getByTestId('error-title')).toBeVisible()
  })
  await session.assertHas('[data-testid="form-status"]', { text: 'Not saved' })

  // Fix it and save again
  await session.step('fix the field and save again', async ({ page }) => {
    await page.locator('[data-field=title]').fill('recovered')
    await page.getByTestId('form-save').click()
  })
  await session.assertHas('[data-testid="form-banner"]', { text: 'Saved' })
})

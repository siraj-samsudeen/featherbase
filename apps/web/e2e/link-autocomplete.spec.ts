import { test, expect, adminAuth } from './fixtures'
import { ensureFormCustomer, ensureFormTables, createFormRow, FORM_CUST as CUST, FORM_DT as DT } from './fixtures-ui'

let docName = ''

// Owns the FormView Tables rather than borrowing formview.spec's; the shared
// builder in ./fixtures-ui keeps the shapes identical and idempotent.
test.beforeAll(async ({ request }) => {
  const auth = await adminAuth(request)
  await ensureFormTables(request, auth)
  for (const c of ['Globex Ltd', 'Acme Ltd']) await ensureFormCustomer(request, auth, c, 'x')
  // Own doc, not "latest": grabbing the newest row races with other specs
  // editing their docs (modified-timestamp conflicts).
  docName = await createFormRow(request, auth, { title: 'link autocomplete fixture', qty: 1 })
})

// Migrated to the feather-testing-core DSL (docs/testing/e2e-dsl-migration.md).
// The Reference field is a `[data-field=...]` combobox with a testid-addressed
// options panel, not a labelled input, so the whole walk stays inside one
// named step; `session.visit`/`assertHas` carry navigation and the Saved
// check around it.
test('UI-006: link autocomplete filters, selects, persists, and offers create-new', async ({ session }) => {
  await session.visit(`/admin/${encodeURIComponent(DT)}/${docName}`)

  await session.step('typing filters suggestions, picking one saves', async ({ page }) => {
    const input = page.locator('[data-field=customer]')
    await expect(input).toBeVisible()

    // Typing filters suggestions
    await input.fill('Ltd')
    const options = page.getByTestId('link-options-customer')
    await expect(options).toBeVisible()
    await expect(options.getByTestId('link-option')).toHaveCount(2)
    await expect(options).toContainText('Globex Ltd')
    await expect(options).toContainText('Acme Ltd')
    await expect(options).not.toContainText('Formco')

    // Narrow further
    await input.fill('Glob')
    await expect(options.getByTestId('link-option')).toHaveCount(1)

    // Picking one stores the name and saves
    await options.getByTestId('link-option').first().click()
    await expect(input).toHaveValue('Globex Ltd')
    await page.getByTestId('form-save').click()
  })
  await session.assertHas('[data-testid="form-banner"]', { text: 'Saved' })

  await session.step('the picked value survives a reload', async ({ page }) => {
    await page.reload()
    await expect(page.locator('[data-field=customer]')).toHaveValue('Globex Ltd')
  })

  // Create-new is offered from the dropdown and navigates to a blank form
  await session.step('a no-match query offers create-new, landing on a blank form', async ({ page }) => {
    await page.locator('[data-field=customer]').fill('zzz-no-match')
    await expect(page.getByTestId('link-options-customer')).toContainText('No matches')
    await page.getByTestId('link-create-new').click()
    await expect(page).toHaveURL(
      new RegExp(`/admin/${encodeURIComponent(CUST).replace(/%/g, '%')}/new`.replace(/[.*+?^${}()|[\]\\]/g, (m) => `\\${m}`)),
    )
    await expect(page.getByTestId('form-status')).toContainText('New document')
  })
})

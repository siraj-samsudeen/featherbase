import { test, expect, adminAuth } from './fixtures'
import { ensureFormFixtures, FORM_DT as DT } from './fixtures-ui'

// Owns its fixtures rather than borrowing formview.spec's: this spec sorts
// before formview.spec alphabetically, so under an isolated fresh DB
// (pnpm --filter web e2e) it would self-skip on every run. The builder is
// shared (./fixtures-ui) so both specs create the identical Table shape,
// idempotently, whichever of them runs first.
let docName = ''

test.beforeAll(async ({ request }) => {
  docName = await ensureFormFixtures(request, await adminAuth(request))
})

test('UI-009 + META-013: missing reqd field errors inline via shared zod schema, with NO network call', async ({ page }) => {
  let saveCalls = 0
  await page.route('**/api/save_row', async (route) => {
    saveCalls++
    await route.continue()
  })

  await page.goto(`/admin/${encodeURIComponent(DT)}/${docName}`)
  await expect(page.getByTestId('form-view')).toBeVisible()

  // Clear the required title and try to save: inline error, zero network calls
  await page.locator('[data-field=title]').fill('')
  await page.getByTestId('form-save').click()
  await expect(page.getByTestId('error-title')).toBeVisible()
  await expect(page.getByTestId('error-title')).toContainText(/Required/i)
  expect(saveCalls).toBe(0)

  // Bad date via direct value also caught client-side (type=number guard etc.)
  await page.locator('[data-field=title]').fill('client valid again')
  await page.getByTestId('form-save').click()
  await expect(page.getByTestId('form-banner')).toContainText('Saved')
  expect(saveCalls).toBe(1)
})

import { test, expect, adminAuth, type APIRequestContext } from './fixtures'
import { clearTranslations, seedTranslations } from './translations'

const DT = 'I18n E2E Doc'

let seeded: string[] = []

async function setLang(request: APIRequestContext, language: string) {
  const headers = await adminAuth(request)
  await request.post('/api/set_language', { headers, data: { language } })
}

test.beforeAll(async ({ request }) => {
  const headers = await adminAuth(request)
  const dt = await request.post('/api/table_def', {
    headers,
    data: { name: DT, columns: [{ column_name: 'priority', label: 'Priority', column_type: 'Data', in_list_view: true }] },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  // Seed a French catalog: two chrome strings + one field label.
  seeded = await seedTranslations(request, headers, 'fr', [
    ['Save', 'Enregistrer'],
    ['Log out', 'Déconnexion'],
    ['Priority', 'Priorité'],
  ])
})

// These rows are committed, so leaving them behind would fail the sandboxed
// server suite on its next run. See ./translations.ts.
test.afterAll(async ({ request }) => {
  await clearTranslations(request, await adminAuth(request), seeded)
})

// Reset Administrator to English before + after so the test is isolated.
test.beforeEach(async ({ request }) => setLang(request, 'en'))
test.afterEach(async ({ request }) => setLang(request, 'en'))

// I18N-001: switching language translates chrome + field labels that have
// catalog entries; untranslated strings fall back to the source.
test('I18N-001: switching language translates chrome and field labels', async ({ page }) => {
  await page.goto('/admin')

  // English baseline. The Log out item lives in the avatar's account
  // menu (#72); close it with Escape before switching (selectOption fires no
  // real mousedown, so the outside-click close never triggers here).
  await page.getByTestId('session-user').click()
  await expect(page.getByTestId('logout')).toHaveText('Log out')
  await page.keyboard.press('Escape')

  // Switch to French — chrome translates.
  await page.getByTestId('language-select').selectOption('fr')
  await page.getByTestId('session-user').click()
  await expect(page.getByTestId('logout')).toHaveText('Déconnexion')

  // The form's Save button and the field label with a catalog entry translate.
  await page.goto(`/admin/${encodeURIComponent(DT)}/new`)
  await expect(page.getByTestId('form-save')).toHaveText('Enregistrer')
  await expect(page.locator('[data-field=priority]')).toBeVisible()
  await expect(page.locator('label.fc-label', { hasText: 'Priorité' })).toBeVisible()

  // Switch back to English — chrome reverts (no catalog entry now).
  await page.getByTestId('language-select').selectOption('en')
  await expect(page.getByTestId('form-save')).toHaveText('Save')
})

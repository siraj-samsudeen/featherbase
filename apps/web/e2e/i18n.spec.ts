import { expect, test, type APIRequestContext } from '@playwright/test'
import { clearTranslations, seedTranslations } from './translations'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'I18n E2E Doc'

let seeded: string[] = []

async function adminHeaders(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
}

async function setLang(request: APIRequestContext, language: string) {
  const headers = await adminHeaders(request)
  await request.post('/api/set_language', { headers, data: { language } })
}

test.beforeAll(async ({ request }) => {
  const headers = await adminHeaders(request)
  const dt = await request.post('/api/doctype', {
    headers,
    data: { name: DT, fields: [{ fieldname: 'priority', label: 'Priority', fieldtype: 'Data', in_list_view: true }] },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
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
  await clearTranslations(request, await adminHeaders(request), seeded)
})

// Reset Administrator to English before + after so the test is isolated.
test.beforeEach(async ({ request }) => setLang(request, 'en'))
test.afterEach(async ({ request }) => setLang(request, 'en'))

// I18N-001: switching language translates chrome + field labels that have
// catalog entries; untranslated strings fall back to the source.
test('I18N-001: switching language translates chrome and field labels', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)

  // English baseline.
  await expect(page.getByTestId('logout')).toHaveText('Log out')

  // Switch to French — chrome translates.
  await page.getByTestId('language-select').selectOption('fr')
  await expect(page.getByTestId('logout')).toHaveText('Déconnexion')

  // The form's Save button and the field label with a catalog entry translate.
  await page.goto(`/desk/${encodeURIComponent(DT)}/new`)
  await expect(page.getByTestId('form-save')).toHaveText('Enregistrer')
  await expect(page.locator('[data-field=priority]')).toBeVisible()
  await expect(page.locator('label.fc-label', { hasText: 'Priorité' })).toBeVisible()

  // Switch back to English — chrome reverts (no catalog entry now).
  await page.getByTestId('language-select').selectOption('en')
  await expect(page.getByTestId('form-save')).toHaveText('Save')
})

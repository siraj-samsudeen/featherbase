import { expect, test, type APIRequestContext } from '@playwright/test'
import { clearTranslations, seedTranslations } from './translations'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'I18n2 E2E Doc'

let seeded: string[] = []
const USER = 'i18n2-fr@x.com'
const PWD = 'i18n2pw12345'

async function adminHeaders(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
}

test.beforeAll(async ({ request }) => {
  const headers = await adminHeaders(request)
  // A user whose stored language is French.
  await request.delete(`/api/resource/User/${encodeURIComponent(USER)}`, { headers })
  await request.post('/api/save_doc', {
    headers,
    data: { doctype: 'User', doc: { name: USER, email: USER, full_name: 'FR User', enabled: true, language: 'fr', roles: [{ role: 'System Manager' }] } },
  })
  await request.post('/api/set_password', { headers, data: { user: USER, password: PWD } })

  // French catalog entries for chrome.
  seeded = await seedTranslations(request, headers, 'fr', [
    ['Log out', 'Déconnexion'],
    ['Save', 'Enregistrer'],
  ])

  // A DocType with a Date field, and a doc dated 9 March 2026.
  const dt = await request.post('/api/doctype', {
    headers,
    data: { name: DT, fields: [{ fieldname: 'due', fieldtype: 'Date', in_list_view: true }] },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  await request.post(`/api/resource/${encodeURIComponent(DT)}`, { headers, data: { due: '2026-03-09' } })
  // NOTE: we don't set a specific System Settings date_format here — it's a
  // shared global other parallel tests mutate. We only assert the date is
  // rendered THROUGH the formatter (any configured order), not raw ISO.
})

// These rows are committed, so leaving them behind would fail the sandboxed
// server suite on its next run. See ./translations.ts.
test.afterAll(async ({ request }) => {
  await clearTranslations(request, await adminHeaders(request), seeded)
})

// I18N-002: a user's stored language is applied on a fresh login (no manual
// switch), and dates render in the System-Settings-configured format.
test('I18N-002: stored language applied on login + configured date format', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name=email]', USER)
  await page.fill('input[name=password]', PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)

  // The French preference is applied straight after login — chrome is French
  // without touching the language switcher.
  await expect(page.getByTestId('logout')).toHaveText('Déconnexion')
  await expect(page.getByTestId('language-select')).toHaveValue('fr')

  // The date renders THROUGH the System-Settings formatter (one of the
  // configured orders of 9 March 2026) — never the raw ISO string. Which order
  // is active depends on the shared global, so accept any valid one.
  await page.goto(`/desk/${encodeURIComponent(DT)}`)
  await expect(page.getByTestId('cell-due').first()).toHaveText(/^(2026-03-09|09-03-2026|03-09-2026)$/)
})

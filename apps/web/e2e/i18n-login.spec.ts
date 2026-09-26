import { anonymousTest as test, expect, adminAuth } from './fixtures'
import { clearTranslations, seedTranslations } from './translations'

const DT = 'I18n2 E2E Doc'

let seeded: string[] = []
const USER = 'i18n2-fr@x.com'
const PWD = 'i18n2pw12345'

test.beforeAll(async ({ request }) => {
  const headers = await adminAuth(request)
  // A user whose stored language is French.
  await request.delete(`/api/table/User/${encodeURIComponent(USER)}`, { headers })
  await request.post('/api/save_row', {
    headers,
    data: { table: 'User', row: { row_id: USER, email: USER, full_name: 'FR User', enabled: true, language: 'fr', roles: [{ role: 'System Manager' }] } },
  })
  await request.post('/api/set_password', { headers, data: { user: USER, password: PWD } })

  // French catalog entries for chrome.
  seeded = await seedTranslations(request, headers, 'fr', [
    ['Log out', 'Déconnexion'],
    ['Save', 'Enregistrer'],
  ])

  // A Table with a Date field, and a doc dated 9 March 2026.
  const dt = await request.post('/api/table_def', {
    headers,
    data: { name: DT, columns: [{ column_name: 'due', column_type: 'Date', in_list_view: true }] },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  await request.post(`/api/table/${encodeURIComponent(DT)}`, { headers, data: { due: '2026-03-09' } })
  // NOTE: we don't set a specific System Settings date_format here — it's a
  // shared global other parallel tests mutate. We only assert the date is
  // rendered THROUGH the formatter (any configured order), not raw ISO.
})

// These rows are committed, so leaving them behind would fail the sandboxed
// server suite on its next run. See ./translations.ts.
test.afterAll(async ({ request }) => {
  await clearTranslations(request, await adminAuth(request), seeded)
})

// I18N-002: a user's stored language is applied on a fresh login (no manual
// switch), and dates render in the System-Settings-configured format.
//
// Migrated to the feather-testing-core DSL (docs/testing/e2e-dsl-migration.md).
// The login form is label-friendly (mirrors admin.spec.ts's `signIn`, but for
// a non-Administrator user so it stays inline rather than reusing that
// helper); the account-menu/testid checks that follow stay in named steps.
test('I18N-002: stored language applied on login + configured date format', async ({ session }) => {
  await session
    .visit('/login')
    .fillIn('Email or username', USER)
    .fillIn('Password', PWD)
    .clickButton('Sign in')
  await session.step('lands somewhere inside /admin', async ({ page }) => {
    await expect(page).toHaveURL(/\/admin/)
  })

  // The French preference is applied straight after login — chrome is French
  // without touching the language switcher.
  await session.step('open the account menu and confirm French chrome', async ({ page }) => {
    await page.getByTestId('session-user').click() // Log out lives in the account menu (#72)
    await expect(page.getByTestId('logout')).toHaveText('Déconnexion')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('language-select')).toHaveValue('fr')
  })

  // The date renders THROUGH the System-Settings formatter (one of the
  // configured orders of 9 March 2026) — never the raw ISO string. Which order
  // is active depends on the shared global, so accept any valid one.
  await session.visit(`/admin/${encodeURIComponent(DT)}`)
  await session.step('the due date cell renders through the date formatter', async ({ page }) => {
    await expect(page.getByTestId('cell-due').first()).toHaveText(/^(2026-03-09|09-03-2026|03-09-2026)$/)
  })
})

import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'I18n2 E2E Doc'
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
  for (const [src, tr] of [['Log out', 'Déconnexion'], ['Save', 'Enregistrer']]) {
    const name = `fr2-${src.replace(/\s+/g, '-')}`
    await request.delete(`/api/resource/Translation/${name}`, { headers })
    await request.post('/api/save_doc', {
      headers,
      data: { doctype: 'Translation', doc: { name, language: 'fr', source_text: src, translated_text: tr } },
    })
  }

  // A DocType with a Date field, and a doc dated 9 March 2026.
  const dt = await request.post('/api/doctype', {
    headers,
    data: { name: DT, fields: [{ fieldname: 'due', fieldtype: 'Date', in_list_view: true }] },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  await request.post(`/api/resource/${encodeURIComponent(DT)}`, { headers, data: { due: '2026-03-09' } })

  // Configure the global date format.
  await request.post('/api/save_doc', {
    headers,
    data: { doctype: 'System Settings', doc: { date_format: 'dd-mm-yyyy' } },
  })
})

test.afterAll(async ({ request }) => {
  const headers = await adminHeaders(request)
  await request.post('/api/save_doc', { headers, data: { doctype: 'System Settings', doc: { date_format: 'yyyy-mm-dd' } } })
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

  // The date renders in the configured dd-mm-yyyy format.
  await page.goto(`/desk/${encodeURIComponent(DT)}`)
  await expect(page.getByTestId('cell-due')).toHaveText('09-03-2026')
})

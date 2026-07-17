import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'CS E2E Order'
const DT_BAD = 'CS E2E Bad'

async function adminHeaders(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
}

async function makeDocType(request: APIRequestContext, name: string) {
  const headers = await adminHeaders(request)
  const res = await request.post('/api/doctype', {
    headers,
    data: {
      name,
      fields: [
        { fieldname: 'qty', fieldtype: 'Int', in_list_view: true },
        { fieldname: 'total', fieldtype: 'Int', in_list_view: true },
      ],
    },
  })
  if (![201, 409].includes(res.status())) throw new Error(`doctype ${name}: ${res.status()}`)
}

async function makeClientScript(request: APIRequestContext, name: string, dt: string, script: string) {
  const headers = await adminHeaders(request)
  await request.delete(`/api/resource/Client%20Script/${name}`, { headers })
  const res = await request.post('/api/save_doc', {
    headers,
    data: { doctype: 'Client Script', doc: { name, reference_doctype: dt, script, enabled: true } },
  })
  if (res.status() !== 201) throw new Error(`client script ${name}: ${res.status()} ${await res.text()}`)
}

test.beforeAll(async ({ request }) => {
  await makeDocType(request, DT)
  await makeDocType(request, DT_BAD)
  // Auto-fill total = qty * 10 whenever qty changes.
  await makeClientScript(
    request,
    'cs-e2e-autofill',
    DT,
    `frappe.ui.form.on('${DT}', { qty: function(frm){ frm.set_value('total', (frm.get_value('qty') || 0) * 10) } })`,
  )
  // A deliberately broken script (throws at load).
  await makeClientScript(request, 'cs-e2e-broken', DT_BAD, `throw new Error('boom in client script')`)
})

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)
}

// CUST-003: a client script auto-fills a field on change.
test('CUST-003: a client script auto-fills a field on change', async ({ page }) => {
  await login(page)
  await page.goto(`/desk/${encodeURIComponent(DT)}/new`)
  await expect(page.getByTestId('form-view')).toBeVisible()

  await page.locator('[data-field=qty]').fill('7')
  // Blur to fire the change handler.
  await page.locator('[data-field=qty]').blur()
  await expect(page.locator('[data-field=total]')).toHaveValue('70')

  // Changing qty again re-runs the script.
  await page.locator('[data-field=qty]').fill('3')
  await page.locator('[data-field=qty]').blur()
  await expect(page.locator('[data-field=total]')).toHaveValue('30')
})

// CUST-003: a broken client script surfaces an error but does not crash the Desk.
test('CUST-003: a broken client script surfaces an error without crashing', async ({ page }) => {
  await login(page)
  await page.goto(`/desk/${encodeURIComponent(DT_BAD)}/new`)

  // The form still renders and the error is shown.
  await expect(page.getByTestId('form-view')).toBeVisible()
  await expect(page.getByTestId('client-script-error')).toContainText('boom in client script')

  // The Desk is still interactive: the field edits and the form is usable.
  await page.locator('[data-field=qty]').fill('5')
  await expect(page.locator('[data-field=qty]')).toHaveValue('5')
  await expect(page.getByTestId('session-user')).toBeVisible()
})

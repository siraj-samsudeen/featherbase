import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'SS E2E Form'

async function adminHeaders(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
}

test.beforeAll(async ({ request }) => {
  const headers = await adminHeaders(request)
  const dt = await request.post('/api/doctype', {
    headers,
    data: { name: DT, fields: [{ fieldname: 'amount', fieldtype: 'Int', in_list_view: true }] },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  await request.delete('/api/resource/Server%20Script/ss-e2e-reject', { headers })
  const s = await request.post('/api/save_doc', {
    headers,
    data: {
      doctype: 'Server Script',
      doc: {
        name: 'ss-e2e-reject',
        script_type: 'Document Event',
        reference_doctype: DT,
        event: 'validate',
        script: 'if (doc.amount < 0) frappe.throw("Amount cannot be negative")',
        enabled: true,
      },
    },
  })
  if (s.status() !== 201) throw new Error(`script: ${s.status()} ${await s.text()}`)
})

// CUST-004: a server script rejecting a save surfaces the error in the form
// (without crashing the Desk), and a valid save goes through.
test('CUST-004: a rejecting server script blocks the save in the form UI', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)

  await page.goto(`/desk/${encodeURIComponent(DT)}/new`)
  await expect(page.getByTestId('form-view')).toBeVisible()

  // A negative amount is rejected by the server script — the error shows.
  await page.locator('[data-field=amount]').fill('-5')
  await page.getByTestId('form-save').click()
  await expect(page.getByTestId('form-banner')).toContainText('Amount cannot be negative')
  // The Desk is still alive and interactive.
  await expect(page.getByTestId('session-user')).toBeVisible()

  // A valid amount saves fine.
  await page.locator('[data-field=amount]').fill('42')
  await page.getByTestId('form-save').click()
  await page.waitForURL(new RegExp(`/desk/${encodeURIComponent(DT)}/`))
  await expect(page.getByTestId('form-status')).toHaveText('Saved')
})

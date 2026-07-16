import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const CUST = 'UI Rn Cust'
const ORDER = 'UI Rn Order'

// DOC-012 (UI): rename a document from its form; a document linking to the
// old name now points at the new name.

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const token = ((await login.json()) as { token: string }).token
  const auth = { Authorization: `Bearer ${token}` }
  for (const [name, fields] of [
    [CUST, [{ fieldname: 'city', fieldtype: 'Data' }]],
    [ORDER, [{ fieldname: 'customer', fieldtype: 'Link', options: CUST, in_list_view: true }]],
  ] as [string, unknown[]][]) {
    const res = await request.post('/api/doctype', {
      headers: auth,
      data: { name, autoname: 'prompt', fields },
    })
    if (![201, 409].includes(res.status())) throw new Error(`${name}: ${res.status()}`)
  }
  await request.delete(`/api/resource/${encodeURIComponent(ORDER)}/RN-ORD`, { headers: auth })
  await request.delete(`/api/resource/${encodeURIComponent(CUST)}/OldCo`, { headers: auth })
  await request.delete(`/api/resource/${encodeURIComponent(CUST)}/NewCo`, { headers: auth })
  const c = await request.post(`/api/resource/${encodeURIComponent(CUST)}`, {
    headers: auth,
    data: { name: 'OldCo', city: 'X' },
  })
  if (c.status() !== 201) throw new Error(`cust: ${c.status()}`)
  const o = await request.post(`/api/resource/${encodeURIComponent(ORDER)}`, {
    headers: auth,
    data: { name: 'RN-ORD', customer: 'OldCo' },
  })
  if (o.status() !== 201) throw new Error(`order: ${o.status()}`)
})

test('DOC-012: rename from the form cascades to linking documents', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)

  await page.goto(`/desk/${encodeURIComponent(CUST)}/OldCo`)
  await page.getByTestId('form-rename').click()
  await page.getByTestId('rename-input').fill('NewCo')
  await page.getByTestId('rename-confirm').click()

  // Lands on the renamed document.
  await expect(page).toHaveURL(new RegExp(`${encodeURIComponent(CUST)}/NewCo`))
  await expect(page.getByTestId('form-view')).toContainText('NewCo')

  // The order's Link now points at the new name.
  await page.goto(`/desk/${encodeURIComponent(ORDER)}/RN-ORD`)
  await expect(page.locator('[data-field=customer]')).toHaveValue('NewCo')
})

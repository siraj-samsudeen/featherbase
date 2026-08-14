import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'Ps Ui Target'

// CUST-002: override a field label; the form shows the new label; the base
// definition is unchanged (restored when the setter is removed).

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const headers = { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
  const dt = await request.post('/api/doctype', {
    headers,
    data: { name: DT, id_pattern: 'prompt', columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }] },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  await request.delete(`/api/table/${encodeURIComponent(DT)}/ps-doc`, { headers })
  await request.post(`/api/table/${encodeURIComponent(DT)}`, {
    headers,
    data: { row_id: 'ps-doc', title: 'hi' },
  })
  // Clean any prior setter.
  await request.delete(`/api/table/Metadata%20Override/${encodeURIComponent(`${DT}-title-label`)}`, { headers })
})

test('CUST-002: a label override shows in the form and reverts when removed', async ({ page, request }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const headers = { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }

  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/admin/)

  // Base label.
  await page.goto(`/admin/${encodeURIComponent(DT)}/ps-doc`)
  const label = page.locator('label', { hasText: 'Title' })
  await expect(label.first()).toBeVisible()

  // Add a Property Setter via the API (Customize-Form mechanism).
  const ps = await request.post('/api/save_doc', {
    headers,
    data: {
      doctype: 'Metadata Override',
      doc: { row_id: `${DT}-title-label`, table_name: DT, column_name: 'title', property: 'label', value: 'Headline' },
    },
  })
  expect([200, 201]).toContain(ps.status())

  // Reload → the form shows the new label.
  await page.reload()
  await expect(page.locator('label', { hasText: 'Headline' }).first()).toBeVisible()

  // Base docfield unchanged: removing the setter reverts the label.
  await request.delete(`/api/table/Metadata%20Override/${encodeURIComponent(`${DT}-title-label`)}`, { headers })
  await page.reload()
  await expect(page.locator('label', { hasText: 'Title' }).first()).toBeVisible()
  await expect(page.locator('label', { hasText: 'Headline' })).toHaveCount(0)
})

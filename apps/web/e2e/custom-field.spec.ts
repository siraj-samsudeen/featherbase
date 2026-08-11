import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'Cf Target'
const FIELD = 'priority_note'

// CUST-001: a custom field appears in the generic form and list views.

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const headers = { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
  const dt = await request.post('/api/doctype', {
    headers,
    data: { name: DT, id_pattern: 'prompt', columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }] },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)

  // Add the custom field (idempotent across runs).
  await request.delete(`/api/table/Custom%20Field/${encodeURIComponent(`${DT}-${FIELD}`)}`, { headers })
  const cf = await request.post('/api/save_doc', {
    headers,
    data: {
      doctype: 'Custom Field',
      doc: { row_id: `${DT}-${FIELD}`, dt: DT, column_name: FIELD, label: 'Priority Note', column_type: 'Data', in_list_view: true },
    },
  })
  if (![201, 200].includes(cf.status())) throw new Error(`custom field: ${cf.status()}`)

  await request.delete(`/api/table/${encodeURIComponent(DT)}/cf-doc`, { headers })
  await request.post(`/api/table/${encodeURIComponent(DT)}`, {
    headers,
    data: { row_id: 'cf-doc', title: 'has custom', [FIELD]: 'urgent' },
  })
})

test('CUST-001: the custom field renders in the form and the list', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/admin/)

  // Form shows the custom field with its saved value.
  await page.goto(`/admin/${encodeURIComponent(DT)}/cf-doc`)
  await expect(page.locator(`[data-field=${FIELD}]`)).toHaveValue('urgent')

  // List shows a column for the in_list_view custom field.
  await page.goto(`/admin/${encodeURIComponent(DT)}`)
  await expect(page.getByTestId(`col-${FIELD}`)).toBeVisible()
  await expect(page.getByTestId('list-rows')).toContainText('urgent')
})

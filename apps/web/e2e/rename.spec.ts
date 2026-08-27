import { test, expect, adminToken, bearer, type APIRequestContext } from './fixtures'

const CUST = 'UI Rn Cust'
const ORDER = 'UI Rn Order'

// DOC-012 (UI): rename a document from its form; a document linking to the
// old name now points at the new name.

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const token = await adminToken(request)
  const auth = bearer(token)
  for (const [name, columns] of [
    [CUST, [{ column_name: 'city', column_type: 'Data' }]],
    [ORDER, [{ column_name: 'customer', column_type: 'Reference', reference_table: CUST, in_list_view: true }]],
  ] as [string, unknown[]][]) {
    const res = await request.post('/api/table_def', {
      headers: auth,
      data: { name, id_pattern: 'prompt', columns },
    })
    if (![201, 409].includes(res.status())) throw new Error(`${name}: ${res.status()}`)
  }
  await request.delete(`/api/table/${encodeURIComponent(ORDER)}/RN-ORD`, { headers: auth })
  await request.delete(`/api/table/${encodeURIComponent(CUST)}/OldCo`, { headers: auth })
  await request.delete(`/api/table/${encodeURIComponent(CUST)}/NewCo`, { headers: auth })
  const c = await request.post(`/api/table/${encodeURIComponent(CUST)}`, {
    headers: auth,
    data: { row_id: 'OldCo', city: 'X' },
  })
  if (c.status() !== 201) throw new Error(`cust: ${c.status()}`)
  const o = await request.post(`/api/table/${encodeURIComponent(ORDER)}`, {
    headers: auth,
    data: { row_id: 'RN-ORD', customer: 'OldCo' },
  })
  if (o.status() !== 201) throw new Error(`order: ${o.status()}`)
})

test('DOC-012: rename from the form cascades to linking documents', async ({ page }) => {
  await page.goto(`/admin/${encodeURIComponent(CUST)}/OldCo`)
  await page.getByTestId('form-rename').click()
  await page.getByTestId('rename-input').fill('NewCo')
  await page.getByTestId('rename-confirm').click()

  // Lands on the renamed document.
  await expect(page).toHaveURL(new RegExp(`${encodeURIComponent(CUST)}/NewCo`))
  await expect(page.getByTestId('form-view')).toContainText('NewCo')

  // The order's Link now points at the new name.
  await page.goto(`/admin/${encodeURIComponent(ORDER)}/RN-ORD`)
  await expect(page.locator('[data-field=customer]')).toHaveValue('NewCo')
})

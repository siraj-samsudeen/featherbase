import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'Bulk DT'

// UI-012: select rows, bulk edit a field, bulk delete.

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const token = ((await login.json()) as { token: string }).token
  const auth = { Authorization: `Bearer ${token}` }
  const dt = await request.post('/api/doctype', {
    headers: auth,
    data: {
      name: DT,
      fields: [
        { fieldname: 'title', fieldtype: 'Data', label: 'Title', in_list_view: true },
        { fieldname: 'stage', fieldtype: 'Data', label: 'Stage', in_list_view: true },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  const listed = (await (
    await request.get(`/api/resource/${encodeURIComponent(DT)}?limit_page_length=100`, { headers: auth })
  ).json()) as { data: { name: string }[] }
  for (const row of listed.data)
    await request.delete(`/api/resource/${encodeURIComponent(DT)}/${row.name}`, { headers: auth })
  for (const title of ['one', 'two', 'three', 'four', 'five']) {
    await request.post(`/api/resource/${encodeURIComponent(DT)}`, {
      headers: auth,
      data: { title, stage: 'draft' },
    })
  }
})

test('UI-012: bulk edit a field then bulk delete selected rows', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)

  await page.goto(`/desk/${encodeURIComponent(DT)}`)
  await expect(page.getByTestId('list-total')).toContainText('5 total')

  // Select 3 rows and bulk-edit the stage field.
  const checks = page.getByTestId('row-check')
  await checks.nth(0).check()
  await checks.nth(1).check()
  await checks.nth(2).check()
  await expect(page.getByTestId('bulk-count')).toContainText('3 selected')
  await page.getByTestId('bulk-edit-field').selectOption('stage')
  await page.getByTestId('bulk-edit-value').fill('done')
  await page.getByTestId('bulk-edit-apply').click()
  await expect(page.getByTestId('bulk-bar')).toHaveCount(0)
  // Exactly 3 stage cells read 'done' (exact match — substring matching
  // catches transient re-render states and flakes).
  await expect(
    page.getByTestId('list-rows').locator('td').filter({ hasText: /^done$/ }),
  ).toHaveCount(3)

  // Token for API verification.
  const token = await page.evaluate(() => localStorage.getItem('fc_token'))
  const listed = (await (
    await page.request.get(`/api/resource/${encodeURIComponent(DT)}?limit_page_length=100`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json()) as { data: { name: string }[] }
  expect(listed.data.length).toBe(5)

  // Select-all then bulk delete removes every row on the page.
  await page.getByTestId('select-all').check()
  await expect(page.getByTestId('bulk-count')).toContainText('5 selected')
  await page.getByTestId('bulk-delete').click()
  await expect(page.getByTestId('list-total')).toContainText('0 total')
  const after = (await (
    await page.request.get(`/api/resource/${encodeURIComponent(DT)}?limit_page_length=100`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json()) as { data: { name: string }[] }
  expect(after.data.length).toBe(0)
})

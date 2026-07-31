import { expect, test } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'Naming Demo'

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL(/\/admin/)
}

async function token(request: import('@playwright/test').APIRequestContext) {
  const res = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return ((await res.json()) as { token: string }).token
}

// NAM-001: the builder derives a series from the Table name, the digit count is
// selectable down to a bare 1/2/3, and the pattern reaches the server.
test('NAM-001: build a Table with a naming series; rows are named from it', async ({
  page,
  request,
}) => {
  const auth = { Authorization: `Bearer ${await token(request)}` }
  const exists = await request.get(`/api/table/${encodeURIComponent(DT)}:meta`, { headers: auth })
  test.skip(exists.status() === 200, `${DT} already exists in this DB; skipping the create path`)

  await login(page)
  await page.goto('/admin/new-table')
  await expect(page.getByTestId('doctype-builder')).toBeVisible()

  // Series is the default, and its prefix follows the Table name.
  await expect(page.getByTestId('dt-naming')).toHaveValue('series')
  await page.getByTestId('dt-name').fill(DT)
  await expect(page.getByTestId('dt-naming-prefix')).toHaveValue('NAMING-DEMO-')
  await expect(page.getByTestId('dt-naming-preview')).toContainText('NAMING-DEMO-001')

  // Override both prefix and digit count — 1 digit gives a bare 1, 2, 3.
  await page.getByTestId('dt-naming-prefix').fill('ND-')
  await page.getByTestId('dt-naming-digits').selectOption('1')
  await expect(page.getByTestId('dt-naming-preview')).toContainText('ND-1, ND-2, ND-3')

  const row = page.getByTestId('dt-fields').locator('tbody tr[data-columnrow]').first()
  await row.locator('[data-rowfield=column_name]').fill('title')
  await row.locator('[data-rowfield=in_list_view]').check()
  await page.getByTestId('dt-create').click()
  await expect(page.getByTestId('list-view')).toBeVisible()

  // The server stored the pattern the UI composed.
  const meta = await request.get(`/api/table/${encodeURIComponent(DT)}:meta`, { headers: auth })
  expect(((await meta.json()) as { id_pattern: string }).id_pattern).toBe('ND-.#')

  // And a row saved through the form is named from the series, not a hash.
  await page.goto(`/admin/${encodeURIComponent(DT)}/new`)
  await page.locator('[data-field=title]').fill('first')
  await page.getByTestId('form-save').click()
  await expect(page.getByTestId('form-status')).toContainText('Saved')
  await expect(page).toHaveURL(/\/admin\/Naming%20Demo\/ND-1$/)
})

// NAM-001: an already-created Table can be switched to a series afterwards —
// the case an Excel import that landed on hash ids needs.
test('NAM-001: change an existing Table to a series from the list view', async ({
  page,
  request,
}) => {
  const auth = { Authorization: `Bearer ${await token(request)}` }
  const created = await request.post('/api/doctype', {
    headers: auth,
    data: { name: DT, columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }] },
  })
  // 409 = a previous run already made it; either way it exists now.
  expect([201, 409]).toContain(created.status())

  // Start from random ids, whatever earlier runs left behind.
  await request.put(`/api/doctype/${encodeURIComponent(DT)}/id_pattern`, {
    headers: auth,
    data: { id_pattern: 'hash' },
  })

  await login(page)
  await page.goto(`/admin/${encodeURIComponent(DT)}`)
  await page.getByTestId('open-naming').click()
  await expect(page.getByTestId('table-naming')).toBeVisible()
  await expect(page.getByTestId('naming-naming')).toHaveValue('hash')

  // Switching to a series offers the Table-derived prefix without typing.
  await page.getByTestId('naming-naming').selectOption('series')
  await expect(page.getByTestId('naming-naming-prefix')).toHaveValue('NAMING-DEMO-')
  await page.getByTestId('naming-naming-prefix').fill('EXISTING-')
  await page.getByTestId('naming-save').click()
  await expect(page.getByTestId('naming-saved')).toBeVisible()

  const meta = await request.get(`/api/table/${encodeURIComponent(DT)}:meta`, { headers: auth })
  expect(((await meta.json()) as { id_pattern: string }).id_pattern).toBe('EXISTING-.###')

  // A bad pattern is refused with the server's field-wise message.
  const bad = await request.put(`/api/doctype/${encodeURIComponent(DT)}/id_pattern`, {
    headers: auth,
    data: { id_pattern: 'EXISTING-' },
  })
  expect(bad.status()).toBe(417)
})

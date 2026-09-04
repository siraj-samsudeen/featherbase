import { test, expect, adminAuth } from './fixtures'

const DT = 'Naming Demo'

// NAM-001 (client half). Series *naming* itself is owned by
// apps/server/test/naming.test.ts; what only the browser can see is the
// builder's own derivation — the prefix it composes from the Table name, the
// preview it renders for a digit count, and the fact that the pattern the UI
// composed is the one that reaches the server. Cited as evidence for
// IMP-R6.shape in docs/design/requirements-framework.md (Part II).

test('NAM-001: the builder derives the series prefix and preview from the Table name', async ({
  page,
  request,
}) => {
  const auth = await adminAuth(request)
  const exists = await request.get(`/api/table/${encodeURIComponent(DT)}:meta`, { headers: auth })
  test.skip(exists.status() === 200, `${DT} already exists in this DB; skipping the create path`)

  await page.goto('/admin/new-table')
  await expect(page.getByTestId('table-builder')).toBeVisible()

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
})

// NAM-001: an already-created Table can be switched to a series afterwards —
// the case an Excel import that landed on hash ids needs.
test('NAM-001: switching an existing Table to a series offers the derived prefix', async ({
  page,
  request,
}) => {
  const auth = await adminAuth(request)
  const created = await request.post('/api/table_def', {
    headers: auth,
    data: { name: DT, columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }] },
  })
  // 409 = a previous run already made it; either way it exists now.
  expect([201, 409]).toContain(created.status())

  // Start from random ids, whatever earlier runs left behind.
  await request.put(`/api/table_def/${encodeURIComponent(DT)}/id_pattern`, {
    headers: auth,
    data: { id_pattern: 'hash' },
  })

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

  // A bad pattern is refused with the server's field-wise message. This is the
  // only coverage PUT :name/id_pattern has; the server suite does not test the
  // endpoint (see the batch-1 PR note) — move it there before deleting it here.
  const bad = await request.put(`/api/table_def/${encodeURIComponent(DT)}/id_pattern`, {
    headers: auth,
    data: { id_pattern: 'EXISTING-' },
  })
  expect(bad.status()).toBe(417)
})

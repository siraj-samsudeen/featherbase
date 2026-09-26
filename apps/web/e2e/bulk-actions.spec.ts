import { test, expect, adminToken, bearer, type APIRequestContext } from './fixtures'

const DT = 'Bulk DT'

// UI-012: select rows, bulk edit a field, bulk delete.
// Migrated to the feather-testing-core DSL (docs/testing/e2e-dsl-migration.md):
// checkboxes and bulk controls are testid-addressed with no accessible label
// distinct from their siblings, so the whole flow stays in named steps;
// assertHas covers the plain count check around it.

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const token = await adminToken(request)
  const auth = bearer(token)
  const dt = await request.post('/api/table_def', {
    headers: auth,
    data: {
      name: DT,
      columns: [
        { column_name: 'title', column_type: 'Data', label: 'Title', in_list_view: true },
        { column_name: 'stage', column_type: 'Data', label: 'Stage', in_list_view: true },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  const listed = (await (
    await request.get(`/api/table/${encodeURIComponent(DT)}?limit_page_length=100`, { headers: auth })
  ).json()) as { data: { row_id: string }[] }
  for (const row of listed.data)
    await request.delete(`/api/table/${encodeURIComponent(DT)}/${row.row_id}`, { headers: auth })
  for (const title of ['one', 'two', 'three', 'four', 'five']) {
    await request.post(`/api/table/${encodeURIComponent(DT)}`, {
      headers: auth,
      data: { title, stage: 'draft' },
    })
  }
})

test('UI-012: bulk edit a field then bulk delete selected rows', async ({ session }) => {
  await session
    .visit(`/admin/${encodeURIComponent(DT)}`)
    .assertHas('[data-testid="list-total"]', { text: '5 total' })

  await session.step('select 3 rows and bulk-edit the stage field', async ({ page }) => {
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
  })

  await session.step('the API confirms all 5 rows still exist', async ({ page }) => {
    const token = await page.evaluate(() => localStorage.getItem('fc_token'))
    const listed = (await (
      await page.request.get(`/api/table/${encodeURIComponent(DT)}?limit_page_length=100`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as { data: { row_id: string }[] }
    expect(listed.data.length).toBe(5)
  })

  await session.step('select-all then bulk delete removes every row on the page', async ({ page }) => {
    await page.getByTestId('select-all').check()
    await expect(page.getByTestId('bulk-count')).toContainText('5 selected')
    await page.getByTestId('bulk-delete').click()
    await expect(page.getByTestId('list-total')).toContainText('0 total')
    const token = await page.evaluate(() => localStorage.getItem('fc_token'))
    const after = (await (
      await page.request.get(`/api/table/${encodeURIComponent(DT)}?limit_page_length=100`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as { data: { row_id: string }[] }
    expect(after.data.length).toBe(0)
  })
})

import { test, expect, adminToken, bearer, type APIRequestContext } from './fixtures'
import { deleteTableIfExists } from './cleanup'

const DT = 'Bulk DT'

// UI-012: select rows, bulk edit a field, bulk delete (confirmed first, #327).
// Checkboxes and bulk controls are testid-addressed with no accessible label
// distinct from their siblings, so the whole flow stays in named steps;
// assertHas covers the plain count check around it.

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const token = await adminToken(request)
  const auth = bearer(token)
  // A leftover run's edited rows can't be deleted one by one (their history
  // blocks it, #321), so the leftover Table goes as a whole.
  await deleteTableIfExists(request, token, DT)
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
  if (dt.status() !== 201) throw new Error(`table: ${dt.status()}`)
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

  // The three edited rows now have history, which blocks deleting them
  // (#321, owner decision 27-Oct-2026); the two untouched rows can go.
  await session.step('bulk delete removes the selected rows', async ({ page }) => {
    const drafts = page.getByTestId('list-rows').locator('tr').filter({ hasText: /^.*draft.*$/ })
    await expect(drafts).toHaveCount(2)
    for (const row of await drafts.all()) await row.getByTestId('row-check').check()
    await expect(page.getByTestId('bulk-count')).toContainText('2 selected')
    await page.getByTestId('bulk-delete').click()
    await expect(page.getByRole('dialog', { name: 'Delete 2 rows?' })).toBeVisible()
    await page.getByTestId('bulk-delete-confirm').click()
    await expect(page.getByTestId('list-total')).toContainText('3 total')
    const token = await page.evaluate(() => localStorage.getItem('fc_token'))
    const after = (await (
      await page.request.get(`/api/table/${encodeURIComponent(DT)}?limit_page_length=100`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as { data: { row_id: string }[] }
    expect(after.data.length).toBe(3)
  })
})

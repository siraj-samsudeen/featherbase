import { anonymousTest as test, expect, adminToken, signIn } from './fixtures'
import { deleteTableIfExists } from './cleanup'

// #1014: a browser alone sees the whole path: a file dropped, a link column's
// Table picked, Check's report, then a new Table whose link opens its row.
const TARGET = 'Link Cluster'
const NEW_TABLE = 'Link Stores'

test('a new Table imports with a working link to an existing Table', async ({ session, page, request }) => {
  const token = await adminToken(request)
  const headers = { Authorization: `Bearer ${token}` }
  await deleteTableIfExists(request, token, NEW_TABLE)
  await deleteTableIfExists(request, token, TARGET)
  await request.post('/api/table_def', {
    headers,
    data: {
      name: TARGET,
      id_pattern: 'field:cluster_code',
      title_column: 'cluster_name',
      columns: [
        { column_name: 'cluster_code', column_type: 'Data' },
        { column_name: 'cluster_name', column_type: 'Data' },
      ],
    },
  })
  await request.post('/api/save_row', { headers, data: { table: TARGET, row: { cluster_code: 'VLM', cluster_name: 'Vellayambalam' } } })

  await signIn(session).click('Import Data')
  await session
    .dropFile('[data-testid="iw-dropzone"]', 'e2e/fixtures/link-stores.csv')
    .assertHas('[data-testid="iw-file-name"]', { text: 'link-stores\\.csv' })
    .step('a new Table with its link column typed Reference', async ({ page }) => {
      await page.getByTestId('iw-new-name-0').fill(NEW_TABLE)
      const row = page.getByTestId('iw-new-grid-0').locator('tbody tr[data-columnrow]').nth(1)
      await row.locator('[data-rowfield=column_type]').selectOption('Reference')
      await expect(page.getByTestId('iw-links-unpicked')).toContainText('Choose the Table that Cluster links to')
      await expect(page.getByTestId('iw-import')).toBeDisabled()
      await row.getByRole('combobox', { name: 'Table Cluster links to' }).selectOption(TARGET)
      await expect(page.getByTestId('iw-links-unpicked')).toHaveCount(0)
    })
    .step('Check reports the value with no row, and makes nothing', async ({ page }) => {
      await page.getByTestId('iw-check').click()
      await expect(page.getByTestId('iw-check-0')).toContainText(`"NOPE" is not a row of ${TARGET}`)
      expect((await request.get(`/api/table/${encodeURIComponent(NEW_TABLE)}:meta`, { headers })).status()).toBe(404)
    })
    .step('Import lands the good rows', async ({ page }) => {
      await page.getByTestId('iw-import').click()
      await expect(page.getByTestId('iw-results')).toContainText(NEW_TABLE)
    })

  await page.goto(`/featherbase/admin/table/${encodeURIComponent(NEW_TABLE)}`)
  const link = page.getByRole('link', { name: /Vellayambalam/ }).first()
  await expect(link).toBeVisible()
  // A plain click opens the row in the list's drill pane; the link's address is its row page.
  await expect(link).toHaveAttribute('href', /\/row\/VLM$/)
  await page.goto((await link.getAttribute('href'))!)
  await expect(page.getByRole('main')).toContainText('Vellayambalam')
})

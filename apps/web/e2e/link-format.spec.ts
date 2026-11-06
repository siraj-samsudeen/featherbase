import { anonymousTest as test, expect, adminToken, signIn } from './fixtures'
import { deleteTableIfExists } from './cleanup'

// #1020: a person chooses a format on the Table's settings page, and a link to
// that Table reads that way in a list on another Table, for each of the four.
const CLUSTER = 'Format Cluster'
const STORE = 'Format Store'

test('each link format, chosen on the settings page, is how a link reads', async ({ session, page, request }) => {
  const token = await adminToken(request)
  const headers = { Authorization: `Bearer ${token}` }
  await deleteTableIfExists(request, token, STORE)
  await deleteTableIfExists(request, token, CLUSTER)
  await request.post('/api/table_def', {
    headers,
    data: {
      name: CLUSTER,
      id_pattern: 'field:cluster_code',
      title_column: 'cluster_name',
      columns: [
        { column_name: 'cluster_code', column_type: 'Data' },
        { column_name: 'cluster_name', column_type: 'Data' },
      ],
    },
  })
  await request.post('/api/save_row', { headers, data: { table: CLUSTER, row: { cluster_code: 'VLM', cluster_name: 'Vellayambalam' } } })
  await request.post('/api/table_def', {
    headers,
    data: {
      name: STORE,
      columns: [
        { column_name: 'store_name', column_type: 'Data', in_list_view: true },
        { column_name: 'cluster', column_type: 'Reference', reference_table: CLUSTER, in_list_view: true },
      ],
    },
  })
  await request.post('/api/save_row', { headers, data: { table: STORE, row: { store_name: 'East', cluster: 'VLM' } } })

  await signIn(session)
  const list = page.getByTestId('cell-cluster')
  await session.step('a Table that never chose reads Name (code)', async ({ page }) => {
    await page.goto(`/featherbase/admin/table/${encodeURIComponent(STORE)}`)
    await expect(list).toHaveText('Vellayambalam (VLM)')
  })

  for (const [label, text] of [
    ['Code (name)', 'VLM (Vellayambalam)'],
    ['Name only', 'Vellayambalam'],
    ['Code only', 'VLM'],
    ['Name (code)', 'Vellayambalam (VLM)'],
  ]) {
    await session.step(`${label} reads ${text}`, async ({ page }) => {
      await page.goto(`/featherbase/admin/table/${encodeURIComponent(CLUSTER)}/naming`)
      await page.getByRole('combobox', { name: 'How links read' }).selectOption({ label })
      await expect(page.getByTestId('link-format-preview')).toContainText(text)
      await page.getByTestId('link-format-save').click()
      await expect(page.getByTestId('link-format-saved')).toBeVisible()
      await page.goto(`/featherbase/admin/table/${encodeURIComponent(STORE)}`)
      await expect(list).toHaveText(text)
    })
  }
})

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

// The verifier's differences: a report and Explore's chip read the format, and a
// Table with no title column reads it everywhere, from a row's stand-in title.
test('the format holds on a report, an Explore chip and a Table with no title column', async ({ session, page, request }) => {
  const token = await adminToken(request)
  const headers = { Authorization: `Bearer ${token}` }
  const cluster = 'Format Report Cluster'
  const store = 'Format Report Store'
  const standIn = 'Format Stand In'
  const refs = 'Format Stand In Refs'
  for (const t of [refs, standIn, store, cluster]) await deleteTableIfExists(request, token, t)
  await request.post('/api/table_def', { headers, data: {
    name: cluster, id_pattern: 'field:cluster_code', title_column: 'cluster_name', link_format: 'name',
    columns: [{ column_name: 'cluster_code', column_type: 'Data' }, { column_name: 'cluster_name', column_type: 'Data' }],
  } })
  await request.post('/api/save_row', { headers, data: { table: cluster, row: { cluster_code: 'VLM', cluster_name: 'Vellayambalam' } } })
  await request.post('/api/table_def', { headers, data: {
    name: store, columns: [
      { column_name: 'store_name', column_type: 'Data', in_list_view: true },
      { column_name: 'cluster', column_type: 'Reference', reference_table: cluster, in_list_view: true },
    ],
  } })
  await request.post('/api/save_row', { headers, data: { table: store, row: { store_name: 'East', cluster: 'VLM' } } })
  await request.post('/api/table_def', { headers, data: {
    name: standIn, id_pattern: 'field:code', link_format: 'code_name',
    columns: [{ column_name: 'code', column_type: 'Data' }, { column_name: 'label', column_type: 'Data' }],
  } })
  await request.post('/api/save_row', { headers, data: { table: standIn, row: { code: '1517', label: 'Kurti Z' } } })
  await request.post('/api/table_def', { headers, data: {
    name: refs, columns: [{ column_name: 'item', column_type: 'Reference', reference_table: standIn, in_list_view: true }],
  } })
  const saved = await request.post('/api/save_row', { headers, data: { table: refs, row: {} } })
  const { row_id } = (await saved.json()) as { row_id: string }

  await signIn(session)
  await session.step('a report reads the link by the format', async ({ page }) => {
    await page.goto(`/featherbase/admin/table/${encodeURIComponent(store)}/view/report`)
    await expect(page.getByTestId('report-row').first()).toContainText('Vellayambalam')
    await expect(page.getByTestId('report-row').first()).not.toContainText('VLM')
  })

  await session.step('an Explore chip reads the row by the format', async ({ page }) => {
    const search = new URLSearchParams({ root: cluster, select: JSON.stringify(['VLM']) })
    await page.goto(`/featherbase/admin/explore?${search}`)
    await expect(page.getByTestId('explore-chip').first()).toHaveText(`${cluster}: Vellayambalam×`)
  })

  await session.step('a no-title Table: the box and its options read the format, found by name or code', async ({ page }) => {
    await page.goto(`/featherbase/admin/table/${encodeURIComponent(refs)}/row/${encodeURIComponent(row_id)}`)
    const box = page.getByRole('combobox', { name: 'item' })
    for (const typed of ['Kurti', '151']) {
      await box.fill(typed)
      await expect(page.getByTestId('link-option').first()).toHaveText('1517 (Kurti Z)')
    }
    await page.getByTestId('link-option').first().dispatchEvent('mousedown')
    await expect(box).toHaveValue('1517 (Kurti Z)')
  })

  await session.step("the row's own page reads the same, with no dot left", async ({ page }) => {
    await page.goto(`/featherbase/admin/table/${encodeURIComponent(standIn)}/row/1517`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('1517 (Kurti Z)')
    await expect(page.getByTestId('breadcrumbs')).toContainText('1517 (Kurti Z)')
  })
})

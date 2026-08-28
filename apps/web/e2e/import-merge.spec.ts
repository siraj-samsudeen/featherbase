import { test, expect, adminToken, type APIRequestContext, type Page } from './fixtures'
import * as XLSX from 'xlsx'
import { deleteTableIfExists } from './cleanup'

// #201 (issue #197): several sheets of the same shape become ONE Table.
// The reported case: eleven sheets of section data, one per supermarket in a
// chain, which the wizard could only turn into eleven Tables.

const MERGED_DT = 'Merge Sections'

// Three store sheets that are "the same shape" the way real workbooks are:
// store 2 shouts its header, store 3 uses an underscore and has a trailing
// space. All three must fold to one column. Store 3 also carries a column the
// others lack, which is kept and left blank for them.
function workbook(): Buffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Merge Zone', 'Merge Floor', 'Merge Count'],
      ['Fresh', 'Ground', 12],
      ['Dairy', 'First', 8],
    ]),
    'Store 001',
  )
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['MERGE ZONE', 'Merge Floor', 'Merge_Count'],
      ['Frozen', 'Second', 5],
    ]),
    'Store 002',
  )
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Merge Zone ', 'merge floor', 'Merge Count', 'Merge Note'],
      ['Grocery', 'Ground', 21, 'relaid'],
    ]),
    'Store 003',
  )
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

test.beforeEach(async ({ request }) => {
  const token = await adminToken(request)
  for (const name of [MERGED_DT, 'Store 001', 'Store 002', 'Store 003'])
    await deleteTableIfExists(request, token, name)
})

test('three sheets merge into one Table, folding the spellings apart from case and spaces', async ({
  page,
  request,
}) => {
  const token = await adminToken(request)
  const headers = { Authorization: `Bearer ${token}` }
  await page.goto('/admin')
  await page.getByTestId('import-data-link').click()
  await page.getByTestId('iw-file-input').setInputFiles({
    name: 'chain sections.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: workbook(),
  })
  await expect(page.getByTestId('iw-overview')).toBeVisible()

  // Take all three, and say what they are: one Table, not three.
  await page.getByTestId('iw-ov-master').check()
  await page.getByTestId('iw-ov-mode-merge').check()
  await page.getByTestId('iw-ov-merge-name').fill(MERGED_DT)
  // The tally answers "and what will that give me?" before committing.
  await expect(page.getByTestId('iw-ov-tally')).toContainText('4 rows will be imported')
  await expect(page.getByTestId('iw-ov-tally')).toContainText('1 Table')
  await page.getByTestId('iw-ov-continue').click()

  // ONE card for the group, not three.
  await expect(page.getByTestId('iw-group-0')).toContainText('3 sheets → one Table')
  await expect(page.getByTestId('iw-sheet-1')).toHaveCount(0)
  await expect(page.getByTestId('iw-sheet-2')).toHaveCount(0)

  // Folded to four columns: zone, floor, count — plus the note only store 3
  // has, which is kept rather than dropped.
  const grid = page.getByTestId('iw-new-grid-0').locator('tbody tr[data-columnrow]')
  await expect(grid).toHaveCount(4)
  await expect(grid.nth(0).locator('[data-rowfield=column_name]')).toHaveValue('merge_zone')
  await expect(grid.nth(1).locator('[data-rowfield=column_name]')).toHaveValue('merge_floor')
  await expect(grid.nth(2).locator('[data-rowfield=column_name]')).toHaveValue('merge_count')

  // The sheets that lack that column say so, so the blanks are not a mystery.
  await expect(page.getByTestId('iw-group-members-0')).toContainText('Store 001')
  await expect(page.getByTestId('iw-group-members-0')).toContainText('no Merge Note')

  await page.getByTestId('iw-import').click()
  await expect(page.getByTestId('iw-result-0')).toContainText('Imported 4 rows')

  // Every sheet's rows landed in the one Table, under the folded columns.
  const rows = await request.get(
    `/api/table/${encodeURIComponent(MERGED_DT)}?fields=${encodeURIComponent(
      '["merge_zone","merge_floor","merge_count","merge_note"]',
    )}&limit_page_length=50`,
    { headers },
  )
  const data = ((await rows.json()) as { data: Record<string, unknown>[] }).data
  expect(data).toHaveLength(4)
  // 'MERGE ZONE' and 'Merge Zone ' folded onto the same column as 'Merge Zone'.
  expect(data.map((r) => r.merge_zone).sort()).toEqual(['Dairy', 'Fresh', 'Frozen', 'Grocery'])
  // 'merge floor' folded too — every row has a floor, none stranded.
  expect(data.every((r) => r.merge_floor)).toBe(true)
  // The column only store 3 had is filled for its row and empty elsewhere.
  expect(data.filter((r) => r.merge_note === 'relaid')).toHaveLength(1)

  // The three sheets produced no Tables of their own.
  const tables = await request.get('/api/table/Table?limit_page_length=500', { headers })
  const names = ((await tables.json()) as { data: { row_id: string }[] }).data.map((t) => t.row_id)
  expect(names).toContain(MERGED_DT)
  expect(names).not.toContain('Store 001')
  expect(names).not.toContain('Store 002')

  await deleteTableIfExists(request, token, MERGED_DT)
})

test('a merged run is logged per sheet under one run id, so reverting takes back all of them', async ({
  page,
  request,
}) => {
  const token = await adminToken(request)
  const headers = { Authorization: `Bearer ${token}` }
  await page.goto('/admin')
  await page.getByTestId('import-data-link').click()
  await page.getByTestId('iw-file-input').setInputFiles({
    name: 'chain sections.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: workbook(),
  })
  await page.getByTestId('iw-ov-master').check()
  await page.getByTestId('iw-ov-mode-merge').check()
  await page.getByTestId('iw-ov-merge-name').fill(MERGED_DT)
  await page.getByTestId('iw-ov-continue').click()
  await page.getByTestId('iw-import').click()
  await expect(page.getByTestId('iw-result-0')).toContainText('Imported 4 rows')

  // IMP-011: one Import Log part per member sheet — the provenance that a
  // single blended batch would destroy — all sharing one run id (RVT-R1).
  const logs = await request.get(
    `/api/table/${encodeURIComponent('Import Log')}?fields=${encodeURIComponent(
      '["sheet_name","run_id","inserted","table_created"]',
    )}&filters=${encodeURIComponent(JSON.stringify([['ref_table', '=', MERGED_DT]]))}` +
      '&limit_page_length=50',
    { headers },
  )
  const parts = (
    (await logs.json()) as {
      data: { sheet_name: string; run_id: string; inserted: number; table_created: number }[]
    }
  ).data
  expect(parts.map((p) => p.sheet_name).sort()).toEqual(['Store 001', 'Store 002', 'Store 003'])
  expect(new Set(parts.map((p) => p.run_id)).size).toBe(1)
  // The Table is created once, not once per member sheet.
  expect(parts.filter((p) => p.table_created).length).toBe(1)

  // One revert takes back the whole group, not one sheet of it.
  await page.getByTestId('iw-revert-open-0').click()
  await expect(page.getByTestId('iw-revert-preview-0')).toContainText('delete 4 added rows')
  await page.getByTestId('iw-revert-confirm-0').click()
  await expect(page.getByTestId('iw-revert-result-0')).toContainText('4 deleted')

  const count = await request.get(`/api/table/${encodeURIComponent(MERGED_DT)}:count`, { headers })
  expect(((await count.json()) as { count: number }).count).toBe(0)

  await deleteTableIfExists(request, token, MERGED_DT)
})

test('choosing separate still makes one Table per sheet', async ({ page, request }) => {
  const token = await adminToken(request)
  const headers = { Authorization: `Bearer ${token}` }
  await page.goto('/admin')
  await page.getByTestId('import-data-link').click()
  await page.getByTestId('iw-file-input').setInputFiles({
    name: 'chain sections.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: workbook(),
  })
  await page.getByTestId('iw-ov-sheet-0').check()
  await page.getByTestId('iw-ov-sheet-1').check()
  await page.getByTestId('iw-ov-mode-separate').check()
  await expect(page.getByTestId('iw-ov-tally')).toContainText('2 Tables')
  await page.getByTestId('iw-ov-continue').click()

  // Two targets, walked one at a time (#202), and no group pill on either.
  await expect(page.getByTestId('iw-step-of')).toContainText('Table 1 of 2')
  await expect(page.getByTestId('iw-sheet-0')).toBeVisible()
  await expect(page.getByTestId('iw-sheet-1')).toHaveCount(0)
  await expect(page.getByTestId('iw-group-0')).toHaveCount(0)
  await page.getByTestId('iw-next').click()
  await expect(page.getByTestId('iw-sheet-1')).toBeVisible()
  await expect(page.getByTestId('iw-sheet-0')).toHaveCount(0)

  await page.getByTestId('iw-import').click()
  await expect(page.getByTestId('iw-result-0')).toContainText('Imported 2 rows')
  await expect(page.getByTestId('iw-result-1')).toContainText('Imported 1 row')

  for (const name of ['Store 001', 'Store 002']) await deleteTableIfExists(request, token, name)
  void headers
})

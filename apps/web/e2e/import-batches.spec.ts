import { test, expect, adminToken, type APIRequestContext, type Page } from './fixtures'
import * as XLSX from 'xlsx'
import { deleteTableIfExists } from './cleanup'

// #206/#207 (issue #197): "since here by mistake it created these 11 tables,
// I did not have an easy way to see these tables came from where and delete
// them all in one."
//
// The Import Log always held the facts — a row per part per target. What it
// could not say is that eleven Tables were ONE thing the user did.

const ONE = 'Batch Sheet One'
const TWO = 'Batch Sheet Two'
const THREE = 'Batch Sheet Three'
const EXISTING = 'Batch Preexisting Table'

function workbook(): Buffer {
  const wb = XLSX.utils.book_new()
  for (const [sheet, header] of [
    ['Alpha', 'Bch Alpha'],
    ['Beta', 'Bch Beta'],
    ['Gamma', 'Bch Gamma'],
  ] as const) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([[header, 'Bch Note'], ['a', 'x'], ['b', 'y']]),
      sheet,
    )
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

async function tableNames(request: APIRequestContext, token: string) {
  const res = await request.get('/api/table/Table?limit_page_length=500', {
    headers: { Authorization: `Bearer ${token}` },
  })
  return ((await res.json()) as { data: { row_id: string }[] }).data.map((t) => t.row_id)
}

test.beforeEach(async ({ request }) => {
  const token = await adminToken(request)
  for (const n of [ONE, TWO, THREE, EXISTING, 'Alpha', 'Beta', 'Gamma']) {
    await deleteTableIfExists(request, token, n)
  }
})

test('three sheets become one import, and go away together', async ({ page, request }) => {
  const token = await adminToken(request)
  await page.goto('/admin')
  await page.getByTestId('import-data-link').click()
  await page.getByTestId('iw-file-input').setInputFiles({
    name: 'batch fixture.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: workbook(),
  })
  await page.getByTestId('iw-ov-master').check()
  await page.getByTestId('iw-ov-continue').click()
  await page.getByTestId('iw-new-name-0').fill(ONE)
  await page.getByTestId('iw-next').click()
  await page.getByTestId('iw-new-name-1').fill(TWO)
  await page.getByTestId('iw-next').click()
  await page.getByTestId('iw-new-name-2').fill(THREE)
  await page.getByTestId('iw-import').click()
  await expect(page.getByTestId('iw-done')).toContainText('Import complete.')

  // The link the owner went looking for and could not find.
  await page.getByTestId('iw-batches-link').click()
  await expect(page.getByTestId('import-batches')).toBeVisible()

  // ONE entry for the file, listing all three Tables — not three unrelated
  // runs to be matched up by timestamp.
  const card = page.locator('[data-testid^="ib-batch-"]').first()
  await expect(card).toContainText('batch fixture.xlsx')
  for (const name of [ONE, TWO, THREE]) {
    await expect(card.getByTestId(`ib-target-${name}`)).toBeVisible()
    await expect(card.getByTestId(`ib-created-${name}`)).toBeVisible()
  }
  await expect(card).toContainText('6 rows added')

  // And the whole import can be taken back in one action — with the Tables
  // named before anything happens.
  await expect(card.locator('[data-testid^="ib-delete-"]')).toContainText(
    'Delete the 3 Tables this import created',
  )
  await card.locator('[data-testid^="ib-delete-"]').click()
  await expect(card.locator('[data-testid^="ib-confirm-"]').first()).toContainText(ONE)
  await card.locator('[data-testid^="ib-confirm-go-"]').click()

  // Reported by the page, because the batch itself is gone: its Import Log
  // rows pointed at Tables that no longer exist.
  await expect(page.getByTestId('ib-outcome')).toContainText('Deleted')
  await expect(page.getByTestId('ib-outcome')).toContainText('no longer listed')
  const names = await tableNames(request, token)
  for (const name of [ONE, TWO, THREE]) expect(names).not.toContain(name)
})

test('a Table that only received rows is never deleted with the batch', async ({
  page,
  request,
}) => {
  const token = await adminToken(request)
  const headers = { Authorization: `Bearer ${token}` }
  // A Table that exists BEFORE the import, with a row of its own.
  await request.post('/api/table_def', {
    headers,
    data: {
      name: EXISTING,
      columns: [
        { column_name: 'bch_alpha', column_type: 'Data' },
        { column_name: 'bch_note', column_type: 'Data' },
      ],
    },
  })
  await request.post('/api/save_row', {
    headers,
    data: { table: EXISTING, row: { bch_alpha: 'pre-existing', bch_note: 'mine' } },
  })

  await page.goto('/admin')
  await page.getByTestId('import-data-link').click()
  await page.getByTestId('iw-file-input').setInputFiles({
    name: 'batch mixed.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: workbook(),
  })
  await page.getByTestId('iw-ov-sheet-0').check()
  await page.getByTestId('iw-ov-sheet-1').check()
  await page.getByTestId('iw-ov-continue').click()
  // Sheet 1 (Alpha) onto the pre-existing Table; sheet 2 into a new one.
  await page.getByTestId('iw-target-0').click()
  await page.getByTestId(`iw-target-opt-0-${EXISTING}`).click()
  await page.getByTestId('iw-next').click()
  await page.getByTestId('iw-new-name-1').fill(TWO)
  await page.getByTestId('iw-import').click()
  await expect(page.getByTestId('iw-done')).toContainText('Import complete.')

  await page.getByTestId('iw-batches-link').click()
  const card = page.locator('[data-testid^="ib-batch-"]').first()
  await expect(card.getByTestId(`ib-appended-${EXISTING}`)).toContainText('existing Table')
  await expect(card.getByTestId(`ib-created-${TWO}`)).toBeVisible()

  // The button counts only what the import CREATED. Deleting the Table the
  // rows merely went INTO would destroy data this import never made — that
  // is what the per-run revert is for.
  await expect(card.locator('[data-testid^="ib-delete-"]')).toContainText(
    'Delete the 1 Table this import created',
  )
  await card.locator('[data-testid^="ib-delete-"]').click()
  await expect(card.locator('[data-testid^="ib-confirm-"]').first()).not.toContainText(EXISTING)
  await card.locator('[data-testid^="ib-confirm-go-"]').click()
  await expect(page.getByTestId('ib-outcome')).toContainText('Deleted')

  const names = await tableNames(request, token)
  expect(names).not.toContain(TWO)
  expect(names).toContain(EXISTING)
  // And its own row is untouched.
  const rows = await request.get(`/api/table/${encodeURIComponent(EXISTING)}:count`, { headers })
  expect(((await rows.json()) as { count: number }).count).toBe(3)

  await deleteTableIfExists(request, token, EXISTING)
})

test('a merge group is one Table in the import, not one per sheet', async ({ page, request }) => {
  const token = await adminToken(request)
  await page.goto('/admin')
  await page.getByTestId('import-data-link').click()
  await page.getByTestId('iw-file-input').setInputFiles({
    name: 'batch merged.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: workbook(),
  })
  await page.getByTestId('iw-ov-master').check()
  await page.getByTestId('iw-ov-mode-merge').check()
  await page.getByTestId('iw-ov-merge-name').fill(ONE)
  await page.getByTestId('iw-ov-continue').click()
  await page.getByTestId('iw-import').click()
  // Wait for the run to finish: navigating mid-import would unmount the
  // wizard between its per-sheet parts and log only the first.
  await expect(page.getByTestId('iw-done')).toContainText('Import complete.')

  await page.goto('/admin/imports')
  const card = page.locator('[data-testid^="ib-batch-"]').first()
  // #201 sends a part per member sheet. The import must still read as the
  // one Table the user asked for, naming the sheets that fed it.
  await expect(card.locator('[data-testid^="ib-target-"]')).toHaveCount(1)
  await expect(card.getByTestId(`ib-target-${ONE}`)).toContainText('3 sheets')
  await expect(card.getByTestId(`ib-target-${ONE}`)).toContainText('Alpha, Beta, Gamma')

  await deleteTableIfExists(request, token, ONE)
})

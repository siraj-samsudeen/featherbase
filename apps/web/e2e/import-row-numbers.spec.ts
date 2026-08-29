import { test, expect, adminToken } from './fixtures'
import * as XLSX from 'xlsx'
import { deleteTableIfExists } from './cleanup'

// #115 / IMP-I1 at the browser tier: the only row number a user ever sees
// is Excel's own. A blank row above a bad row must NOT shift the blame —
// before the fix, the wizard would have named row 5 for a defect the user
// sees at row 6 in Excel, and they'd go fix an innocent neighbour.

const DT = 'Row Number Truth'

function workbook() {
  // The sheet is laid out so the numbers below are Excel's own:
  const truth = XLSX.utils.aoa_to_sheet([
    ['Truth SKU', 'Truth Count'], // row 1 — header
    ['a', 1], //                     row 2
    ['', ''], //                     row 3 — entirely blank
    ['b', 2], //                     row 4
    ['c', 3], //                     row 5
    ['d', 'abc'], //                 row 6 — 'abc' cannot land in Int
    ['e', 4], //                     row 7
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, truth, 'Truth')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

test('#115: a blank row does not shift the blame — failures name the TRUE Excel row', async ({
  page,
  request,
}) => {
  const token = await adminToken(request)
  const headers = { Authorization: `Bearer ${token}` }
  await deleteTableIfExists(request, token, DT)

  // Pre-create the target so the sheet auto-matches onto an existing Table.
  const created = await request.post('/api/table_def', {
    headers,
    data: {
      name: DT,
      columns: [
        { column_name: 'truth_sku', label: 'Truth SKU', column_type: 'Data', in_list_view: true },
        { column_name: 'truth_count', label: 'Truth Count', column_type: 'Int', in_list_view: true },
      ],
    },
  })
  expect(created.status()).toBe(201)

  await page.goto('/admin')
  await page.getByTestId('import-data-link').click()
  await expect(page.getByTestId('import-wizard')).toBeVisible()

  await page.getByTestId('iw-file-input').setInputFiles({
    name: 'truth.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: workbook(),
  })

  await expect(page.getByTestId('iw-target-0')).toHaveValue(DT)
  // The blank row is not data: 5 rows, not 6.
  await expect(page.getByTestId('import-wizard')).toContainText('5 rows')

  // Dry-run: the bad Int row is at Excel row 6 — and the wizard must say 6,
  // not 5, despite the blank row 3 above it having been dropped.
  await page.getByTestId('iw-check').click()
  await expect(page.getByTestId('iw-check-0')).toContainText('4 rows ready')
  await expect(page.getByTestId('iw-check-0')).toContainText('1 with problems')
  await expect(page.getByTestId('iw-check-0')).toContainText('row 6:')
  await expect(page.getByTestId('iw-check-0')).not.toContainText('row 5')

  // The preview grid opens on problems and highlights the SAME rows the
  // messages row_id: row 6 is flagged, its innocent neighbour row 5 is not,
  // and the blank row 3 still occupies its own numbered place.
  await expect(page.getByTestId('iw-preview-row-0-6')).toHaveAttribute('data-failed', 'true')
  await expect(page.getByTestId('iw-preview-row-0-6')).toContainText('abc')
  await expect(page.getByTestId('iw-preview-row-0-5')).not.toHaveAttribute('data-failed', 'true')
  await expect(page.getByTestId('iw-preview-row-0-3')).toBeVisible()
  await expect(page.getByTestId('iw-preview-row-0-2')).toContainText('a')

  // Teardown — self-cleaning via table deletion (spec 0003).
  const del = await request.delete(`/api/table_def/${encodeURIComponent(DT)}`, { headers })
  expect(del.status()).toBe(200)
})

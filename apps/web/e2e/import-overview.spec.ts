import { test, expect, adminToken, type APIRequestContext, type Page } from './fixtures'
import * as XLSX from 'xlsx'
import { deleteTableIfExists } from './cleanup'

// #199/#200 (issue #197): the file overview. A workbook opens on a list of
// sheets — no column grids — with the sheets the workbook was hiding in their
// own collapsed section, and NOTHING selected until the user says so.

const PICKED_DT = 'Overview Picked'

// Two visible sheets and two the workbook hides — one ordinary, one very
// hidden, which only VBA can set and which the overview names distinctly.
function workbook(): Buffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Ov Ref', 'Ov Amount'],
      ['P-1', 10],
      ['P-2', 20],
    ]),
    'Picked',
  )
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Ov Other', 'Ov Qty'],
      ['Q-1', 1],
    ]),
    'Ignored',
  )
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Lookup Key', 'Lookup Value'],
      ['k', 'v'],
    ]),
    'Tucked',
  )
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Scratch A', 'Scratch B'],
      [1, 2],
    ]),
    'Buried',
  )
  wb.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 0 }, { Hidden: 1 }, { Hidden: 2 }] }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

// The wizard suggests an existing Table by column overlap, so a Table left
// behind by an earlier test turns sheet 0's new-Table grid into a mapping
// grid and every assertion below drifts. Pre-clean, per spec 0003's
// hermeticity dividend (see cleanup.ts).
test.beforeEach(async ({ request }) => {
  const token = await adminToken(request)
  for (const name of [PICKED_DT, 'Ignored', 'Tucked', 'Buried', 'Picked'])
    await deleteTableIfExists(request, token, name)
})

async function dropWorkbook(page: Page) {
  await page.getByTestId('import-data-link').click()
  await expect(page.getByTestId('import-wizard')).toBeVisible()
  await page.getByTestId('iw-file-input').setInputFiles({
    name: 'overview fixture.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: workbook(),
  })
  await expect(page.getByTestId('iw-overview')).toBeVisible()
}

test('the overview lists sheets only, sections the hidden ones, and starts empty', async ({
  page,
}) => {
  await page.goto('/admin')
  await dropWorkbook(page)

  // Sheets only — none of the column grids the wizard used to open on.
  await expect(page.getByTestId('iw-new-grid-0')).toHaveCount(0)
  await expect(page.getByTestId('iw-mapping-0')).toHaveCount(0)

  // Two sections: visible above, hidden below, each counting its own.
  await expect(page.getByTestId('iw-ov-section-visible')).toContainText('Visible sheets (2)')
  await expect(page.getByTestId('iw-ov-section-hidden')).toContainText('Hidden sheets (2)')
  // 'very hidden' is not flattened into 'hidden' — the workbook meant more.
  await expect(page.getByTestId('iw-ov-row-3')).toContainText('very hidden')
  await expect(page.getByTestId('iw-ov-row-2')).toContainText('hidden')

  // #200's whole point: nothing is included by default.
  await expect(page.getByTestId('iw-ov-count')).toHaveText('0 of 4 sheets selected')
  for (const i of [0, 1, 2, 3]) {
    await expect(page.getByTestId(`iw-ov-sheet-${i}`)).not.toBeChecked()
  }

  // Continuing with nothing chosen is refused in words, not a dead button.
  await page.getByTestId('iw-ov-continue').click()
  await expect(page.getByTestId('iw-ov-refusal')).toBeVisible()
  await expect(page.getByTestId('iw-overview')).toBeVisible()
})

test('group toggles act on their own section, and the master reports tri-state', async ({
  page,
}) => {
  await page.goto('/admin')
  await dropWorkbook(page)

  // "Select all visible" must leave the hidden sheets alone.
  await page.getByTestId('iw-ov-all-visible').click()
  await expect(page.getByTestId('iw-ov-count')).toHaveText('2 of 4 sheets selected')
  await expect(page.getByTestId('iw-ov-sheet-0')).toBeChecked()
  await expect(page.getByTestId('iw-ov-sheet-1')).toBeChecked()
  await expect(page.getByTestId('iw-ov-sheet-2')).not.toBeChecked()

  // A partial selection reports itself rather than picking a side.
  await expect(
    page.getByTestId('iw-ov-master').evaluate((el: HTMLInputElement) => el.indeterminate),
  ).resolves.toBe(true)

  // The same control clears the group it filled.
  await page.getByTestId('iw-ov-all-visible').click()
  await expect(page.getByTestId('iw-ov-count')).toHaveText('0 of 4 sheets selected')

  // Hidden sheets are reachable and selectable, in their own group.
  await page.getByTestId('iw-ov-all-hidden').click()
  await expect(page.getByTestId('iw-ov-count')).toHaveText('2 of 4 sheets selected')
  await expect(page.getByTestId('iw-ov-sheet-2')).toBeChecked()
  await expect(page.getByTestId('iw-ov-sheet-0')).not.toBeChecked()

  // Master selects everything, and then reads as fully checked.
  await page.getByTestId('iw-ov-master').check()
  await expect(page.getByTestId('iw-ov-count')).toHaveText('4 of 4 sheets selected')
  await expect(
    page.getByTestId('iw-ov-master').evaluate((el: HTMLInputElement) => el.indeterminate),
  ).resolves.toBe(false)
})

test('only the chosen sheet reaches the column step, and importing it leaves the rest alone', async ({
  page,
  request,
}) => {
  const token = await adminToken(request)
  await page.goto('/admin')
  await dropWorkbook(page)

  // One sheet of four.
  await page.getByTestId('iw-ov-sheet-0').check()
  await expect(page.getByTestId('iw-ov-tally')).toContainText('2 rows will be imported')
  await expect(page.getByTestId('iw-ov-tally')).toContainText('3 left out')
  await page.getByTestId('iw-ov-continue').click()

  // The column step shows that sheet and no other.
  await expect(page.getByTestId('iw-sheet-0')).toBeVisible()
  await expect(page.getByTestId('iw-sheet-1')).toHaveCount(0)
  await expect(page.getByTestId('iw-sheet-2')).toHaveCount(0)
  await expect(page.getByTestId('iw-chosen-count')).toHaveText('1 of 4 sheets selected')

  await page.getByTestId('iw-new-name-0').fill(PICKED_DT)
  await page.getByTestId('iw-import').click()
  await expect(page.getByTestId('iw-result-0')).toContainText('Imported 2 rows')

  // The three sheets left unselected created nothing — the defect that made
  // one import produce eleven unwanted Tables.
  const tables = await request.get('/api/table/Table?limit_page_length=500', {
    headers: { Authorization: `Bearer ${token}` },
  })
  const names = ((await tables.json()) as { data: { row_id: string }[] }).data.map((t) => t.row_id)
  expect(names).toContain(PICKED_DT)
  expect(names).not.toContain('Ignored')
  expect(names).not.toContain('Tucked')
  expect(names).not.toContain('Buried')

  await deleteTableIfExists(request, token, PICKED_DT)
})

test('going back to the overview keeps the choices already made', async ({ page }) => {
  await page.goto('/admin')
  await dropWorkbook(page)

  await page.getByTestId('iw-ov-sheet-0').check()
  await page.getByTestId('iw-ov-continue').click()
  await page.getByTestId('iw-new-name-0').fill('Renamed Before Going Back')

  await page.getByTestId('iw-back-to-overview').click()
  await expect(page.getByTestId('iw-ov-sheet-0')).toBeChecked()
  await expect(page.getByTestId('iw-ov-count')).toHaveText('1 of 4 sheets selected')

  // The rename survives the round trip — leaving the step is not a reset.
  await page.getByTestId('iw-ov-continue').click()
  await expect(page.getByTestId('iw-new-name-0')).toHaveValue('Renamed Before Going Back')
})

test('a CSV has nothing to choose, so the overview never appears', async ({ page }) => {
  await page.goto('/admin')
  await page.getByTestId('import-data-link').click()
  await page.getByTestId('iw-file-input').setInputFiles({
    name: 'single.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Solo Ref,Solo Amount\nS-1,5\n'),
  })
  await expect(page.getByTestId('iw-overview')).toHaveCount(0)
  await expect(page.getByTestId('iw-new-grid-0')).toBeVisible()
})

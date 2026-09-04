import { test, expect, adminToken, type APIRequestContext, type Page } from './fixtures'
import * as XLSX from 'xlsx'
import { deleteTableIfExists } from './cleanup'

// #202 (issue #197): the column step walks ONE target at a time.
//
// The owner's workbook had seventeen sheets. Every one of them, with its full
// column grid, arrived on a single screen — and there was nowhere to "import
// and then go to that screen where the row is imported" and come back to,
// because there was no *here* to come back to.

const ONE = 'Step One'
const TWO = 'Step Two'
const THREE = 'Step Three'

function workbook(): Buffer {
  const wb = XLSX.utils.book_new()
  for (const [sheet, header] of [
    ['Alpha', 'Stp Alpha'],
    ['Beta', 'Stp Beta'],
    ['Gamma', 'Stp Gamma'],
  ] as const) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([[header, 'Stp Note'], ['a', 'x'], ['b', 'y']]),
      sheet,
    )
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

async function openColumns(page: Page) {
  await page.getByTestId('import-data-link').click()
  await page.getByTestId('iw-file-input').setInputFiles({
    name: 'stepper fixture.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: workbook(),
  })
  await page.getByTestId('iw-ov-master').check()
  await page.getByTestId('iw-ov-continue').click()
  await expect(page.getByTestId('iw-stepper')).toBeVisible()
}

async function tableNames(request: APIRequestContext, token: string) {
  const res = await request.get('/api/table/Table?limit_page_length=500', {
    headers: { Authorization: `Bearer ${token}` },
  })
  return ((await res.json()) as { data: { row_id: string }[] }).data.map((t) => t.row_id)
}

test.beforeEach(async ({ request }) => {
  const token = await adminToken(request)
  for (const n of [ONE, TWO, THREE, 'Alpha', 'Beta', 'Gamma']) {
    await deleteTableIfExists(request, token, n)
  }
})

test('three sheets are three steps, not three stacked cards', async ({ page }) => {
  await page.goto('/admin')
  await openColumns(page)

  await expect(page.getByTestId('iw-step-of')).toContainText('Table 1 of 3')
  await expect(page.getByTestId('iw-step-of')).toContainText('Alpha')
  // Exactly one card is on screen. This is the whole point.
  await expect(page.locator('[data-testid^="iw-sheet-"]:not([data-testid*="preview"])')).toHaveCount(
    1,
  )
  await expect(page.getByTestId('iw-sheet-0')).toBeVisible()

  // But the sequence is never hidden — all three are listed and reachable.
  await expect(page.getByTestId('iw-step-strip').locator('button')).toHaveCount(3)
  await expect(page.getByTestId('iw-step-1')).toContainText('Beta')

  // Previous is disabled at the start; Next walks forward.
  await expect(page.getByTestId('iw-prev')).toBeDisabled()
  await page.getByTestId('iw-next').click()
  await expect(page.getByTestId('iw-step-of')).toContainText('Table 2 of 3')
  await expect(page.getByTestId('iw-sheet-1')).toBeVisible()
  await expect(page.getByTestId('iw-sheet-0')).toHaveCount(0)

  // Jumping by the strip lands where it says.
  await page.getByTestId('iw-step-2').click()
  await expect(page.getByTestId('iw-step-of')).toContainText('Table 3 of 3')
  await expect(page.getByTestId('iw-next')).toBeDisabled()
})

test('a step is edited, imported on its own, and the next two are untouched', async ({
  page,
  request,
}) => {
  const token = await adminToken(request)
  await page.goto('/admin')
  await openColumns(page)

  await page.getByTestId('iw-new-name-0').fill(ONE)
  // The per-target button names what it will do — rows and Table, not "all".
  await expect(page.getByTestId('iw-import-one')).toContainText(`Import 2 rows into ${ONE}`)
  await page.getByTestId('iw-import-one').click()

  await expect(page.getByTestId('iw-result-0')).toContainText(`Imported 2 rows into ${ONE}`)
  // Only THAT target was committed. A per-target import that quietly ran the
  // rest would be the eleven-unwanted-Tables bug again.
  const names = await tableNames(request, token)
  expect(names).toContain(ONE)
  expect(names).not.toContain('Beta')
  expect(names).not.toContain('Gamma')

  // The run is not over, and does not claim to be. "Import complete." after
  // target 1 of 3 would be a lie.
  await expect(page.getByTestId('iw-done')).toContainText('Imported 1; 2 still to import.')
  await expect(page.getByTestId('iw-import')).toBeEnabled()
  // And it walked on to the next thing needing a decision rather than
  // leaving the user to find it.
  await expect(page.getByTestId('iw-step-of')).toContainText('Table 2 of 3')
  await expect(page.getByTestId('iw-step-0')).toHaveAttribute('data-state', 'done')
  await expect(page.getByTestId('iw-step-1')).toHaveAttribute('data-state', 'todo')

  await deleteTableIfExists(request, token, ONE)
})

test('a finished import stays readable while you work on the next sheet', async ({
  page,
  request,
}) => {
  const token = await adminToken(request)
  await page.goto('/admin')
  await openColumns(page)

  await page.getByTestId('iw-new-name-0').fill(ONE)
  await page.getByTestId('iw-import-one').click()
  await expect(page.getByTestId('iw-result-0')).toBeVisible()

  // The complaint this work started from: "I clicked on see the rows
  // imported and when I came back nothing was visible." The result lives
  // outside the card, so stepping away cannot take it with it.
  await expect(page.getByTestId('iw-step-of')).toContainText('Table 2 of 3')
  await expect(page.getByTestId('iw-sheet-0')).toHaveCount(0)
  await expect(page.getByTestId('iw-result-0')).toContainText(`Imported 2 rows into ${ONE}`)
  // Including the way to undo it.
  await expect(page.getByTestId('iw-revert-open-0')).toBeVisible()

  // Coming back to the finished step offers no second import of it.
  await page.getByTestId('iw-step-0').click()
  await expect(page.getByTestId('iw-import-one')).toHaveCount(0)
  await expect(page.getByTestId('iw-import-one-done')).toContainText(`${ONE} imported`)

  await deleteTableIfExists(request, token, ONE)
})

test('the bulk button finishes the rest without re-importing what landed', async ({
  page,
  request,
}) => {
  const token = await adminToken(request)
  await page.goto('/admin')
  await openColumns(page)

  await page.getByTestId('iw-new-name-0').fill(ONE)
  await page.getByTestId('iw-import-one').click()
  await expect(page.getByTestId('iw-result-0')).toBeVisible()

  // Now on step 2. Name the remaining two and take them together.
  await page.getByTestId('iw-new-name-1').fill(TWO)
  await page.getByTestId('iw-next').click()
  await page.getByTestId('iw-new-name-2').fill(THREE)
  await expect(page.getByTestId('iw-import')).toContainText('Import the remaining 2 Tables')
  await page.getByTestId('iw-import').click()

  await expect(page.getByTestId('iw-done')).toContainText('Import complete.')
  await expect(page.getByTestId('iw-result-1')).toContainText(`Imported 2 rows into ${TWO}`)
  await expect(page.getByTestId('iw-result-2')).toContainText(`Imported 2 rows into ${THREE}`)
  // Step 1 was skipped by the bulk run rather than run twice — re-sending it
  // would have doubled its rows.
  await expect(page.getByTestId('iw-result-0')).toContainText('Imported 2 rows')

  const rows = await request.get(`/api/table/${encodeURIComponent(ONE)}:count`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(((await rows.json()) as { count: number }).count).toBe(2)

  for (const n of [ONE, TWO, THREE]) await deleteTableIfExists(request, token, n)
})

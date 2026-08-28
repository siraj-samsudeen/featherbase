import { test, expect, adminToken, type APIRequestContext, type Page } from './fixtures'
import * as XLSX from 'xlsx'
import { deleteTableIfExists } from './cleanup'

// #204 (issue #197): the owner's sequence, exactly.
//
// "I imported one of the sheets and then there was an error in the second
// sheet. I clicked on preview or see the rows imported and went, and when I
// came back nothing was visible."
//
// Every decision about every sheet lived in component state and died with the
// route. Going to look at what you just imported destroyed the work of
// planning the rest.

const ONE = 'Resume One'
const TWO = 'Resume Two'

function workbook(): Buffer {
  const wb = XLSX.utils.book_new()
  for (const [sheet, header] of [
    ['Alpha', 'Rsm Alpha'],
    ['Beta', 'Rsm Beta'],
    ['Gamma', 'Rsm Gamma'],
  ] as const) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([[header, 'Rsm Note'], ['a', 'x'], ['b', 'y']]),
      sheet,
    )
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

async function dropWorkbook(page: Page) {
  await page.getByTestId('iw-file-input').setInputFiles({
    name: 'resume fixture.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: workbook(),
  })
}

test.beforeEach(async ({ request }) => {
  const token = await adminToken(request)
  for (const n of [ONE, TWO, 'Alpha', 'Beta', 'Gamma']) await deleteTableIfExists(request, token, n)
})

test('going to look at the imported rows and coming back resumes everything', async ({
  page,
  request,
}) => {
  const token = await adminToken(request)
  await page.goto('/admin')
  await page.getByTestId('import-data-link').click()
  await dropWorkbook(page)
  await page.getByTestId('iw-ov-master').check()
  await page.getByTestId('iw-ov-continue').click()

  // Import sheet 1, then plan sheet 2 — the state worth not losing.
  await page.getByTestId('iw-new-name-0').fill(ONE)
  await page.getByTestId('iw-import-one').click()
  await expect(page.getByTestId('iw-result-0')).toContainText(`Imported 2 rows into ${ONE}`)
  await expect(page.getByTestId('iw-step-of')).toContainText('Table 2 of 3')
  await page.getByTestId('iw-new-name-1').fill(TWO)

  // Now do the thing that used to destroy it: follow the result link to see
  // the rows that landed.
  await page.getByTestId('iw-result-0').getByRole('link', { name: ONE }).click()
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(ONE)))

  // And come back.
  await page.getByTestId('import-data-link').click()

  // The file is still loaded, the step is where it was, the name typed into
  // sheet 2 is still typed, and the finished import is still on screen.
  await expect(page.getByTestId('iw-file-name')).toContainText('resume fixture.xlsx')
  await expect(page.getByTestId('iw-step-of')).toContainText('Table 2 of 3')
  await expect(page.getByTestId('iw-new-name-1')).toHaveValue(TWO)
  await expect(page.getByTestId('iw-result-0')).toContainText(`Imported 2 rows into ${ONE}`)
  await expect(page.getByTestId('iw-step-0')).toHaveAttribute('data-state', 'done')

  // And the resumed run finishes without re-importing what already landed.
  await page.getByTestId('iw-import-one').click()
  await expect(page.getByTestId('iw-result-1')).toContainText(`Imported 2 rows into ${TWO}`)
  const count = await request.get(`/api/table/${encodeURIComponent(ONE)}:count`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(((await count.json()) as { count: number }).count).toBe(2)

  for (const n of [ONE, TWO]) await deleteTableIfExists(request, token, n)
})

test('a full page reload resumes too', async ({ page, request }) => {
  const token = await adminToken(request)
  await page.goto('/admin')
  await page.getByTestId('import-data-link').click()
  await dropWorkbook(page)
  await page.getByTestId('iw-ov-master').check()
  await page.getByTestId('iw-ov-continue').click()
  await page.getByTestId('iw-new-name-0').fill(ONE)
  await page.getByTestId('iw-next').click()
  await page.getByTestId('iw-new-name-1').fill(TWO)

  await page.reload()

  // Not just the route: the parsed workbook itself came back, so the columns
  // are there to work on rather than a request to drop the file again.
  await expect(page.getByTestId('iw-step-of')).toContainText('Table 2 of 3')
  await expect(page.getByTestId('iw-resume')).toHaveCount(0)
  await expect(page.getByTestId('iw-new-name-1')).toHaveValue(TWO)
  await page.getByTestId('iw-prev').click()
  await expect(page.getByTestId('iw-new-name-0')).toHaveValue(ONE)

  void token
})

test('a finished import is not resumed — coming back starts the next one', async ({
  page,
  request,
}) => {
  const token = await adminToken(request)
  await page.goto('/admin')
  await page.getByTestId('import-data-link').click()
  await dropWorkbook(page)
  // Two sheets, so the run does not auto-navigate to a lone new Table's list
  // view — the point here is what the wizard looks like on the way back.
  await page.getByTestId('iw-ov-sheet-0').check()
  await page.getByTestId('iw-ov-sheet-1').check()
  await page.getByTestId('iw-ov-continue').click()
  await page.getByTestId('iw-new-name-0').fill(ONE)
  await page.getByTestId('iw-next').click()
  await page.getByTestId('iw-new-name-1').fill(TWO)
  await page.getByTestId('iw-import').click()
  await expect(page.getByTestId('iw-done')).toContainText('Import complete.')

  // Nothing is left to resume, and /admin/import is where the NEXT import
  // starts — so it must come back clean rather than replaying a run that is
  // over.
  await page.reload()
  await expect(page.getByTestId('iw-stepper')).toHaveCount(0)
  await expect(page.getByTestId('iw-resume')).toHaveCount(0)
  await expect(page.getByTestId('iw-dropzone')).toContainText('Drag & drop')

  for (const n of [ONE, TWO]) await deleteTableIfExists(request, token, n)
})

test('starting over forgets the file and every choice about it', async ({ page }) => {
  await page.goto('/admin')
  await page.getByTestId('import-data-link').click()
  await dropWorkbook(page)
  await page.getByTestId('iw-ov-master').check()
  await page.getByTestId('iw-ov-continue').click()
  await page.getByTestId('iw-new-name-0').fill(ONE)

  await page.getByTestId('iw-start-over').click()
  await expect(page.getByTestId('iw-stepper')).toHaveCount(0)
  await expect(page.getByTestId('iw-dropzone')).toContainText('Drag & drop')

  // And it stays forgotten across a reload — otherwise "start over" would
  // only be a repaint.
  await page.reload()
  await expect(page.getByTestId('iw-stepper')).toHaveCount(0)
  await expect(page.getByTestId('iw-dropzone')).toContainText('Drag & drop')
})

test('when the rows do not fit, the decisions still do', async ({ page }) => {
  await page.goto('/admin')
  await page.getByTestId('import-data-link').click()

  // Simulate the big-workbook case: refuse to store the rows, which is what
  // a 17-sheet file does to a few megabytes of sessionStorage. The decisions
  // are small and must survive regardless.
  await page.evaluate(() => {
    const real = Storage.prototype.setItem
    Storage.prototype.setItem = function guarded(this: Storage, key: string, value: string) {
      if (key === 'featherbase:import-wizard-data') throw new DOMException('QuotaExceededError')
      return real.call(this, key, value)
    }
  })

  await dropWorkbook(page)
  await page.getByTestId('iw-ov-master').check()
  await page.getByTestId('iw-ov-continue').click()
  await page.getByTestId('iw-new-name-0').fill(ONE)
  // Said BEFORE leaving, not discovered on return.
  await expect(page.getByTestId('iw-too-big')).toContainText('drop the file again')

  await page.reload()

  // The work survived; only the file is being asked for.
  await expect(page.getByTestId('iw-resume')).toContainText('Your work on resume fixture.xlsx')
  await expect(page.getByTestId('iw-resume')).toContainText('3 Tables planned')
  await expect(page.getByTestId('iw-file-name')).toContainText('again to carry on')

  // Dropping the same file picks up exactly where it left off.
  await dropWorkbook(page)
  await expect(page.getByTestId('iw-resume')).toHaveCount(0)
  await expect(page.getByTestId('iw-step-of')).toContainText('Table 1 of 3')
  await expect(page.getByTestId('iw-new-name-0')).toHaveValue(ONE)
})

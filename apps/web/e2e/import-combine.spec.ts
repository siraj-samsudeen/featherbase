import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import * as XLSX from 'xlsx'
import { deleteTableIfExists } from './cleanup'

// #211 (issue #197): combining columns folding could never join.
//
// The owner's case: some sheets label the store column `Store Code`
// (STR-009), others `Store Name` (Anna Nagar). The values look nothing alike,
// which is exactly why nothing should propose it (Q5 — no guessing) and why
// the user must be able to say it themselves.

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'Combine Sections'

async function adminToken(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return ((await login.json()) as { token: string }).token
}

async function login(page: Page) {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL(/\/admin/)
}

// Two sheets naming the same real-world thing differently, and no sheet
// carrying both — the common case, where there is nothing to resolve.
function workbook(): Buffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Cmb Store Code', 'Cmb Zone'],
      ['STR-009', 'Fresh'],
      ['STR-009', 'Dairy'],
    ]),
    'By Code',
  )
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Cmb Store Name', 'Cmb Zone'],
      ['Anna Nagar', 'Frozen'],
    ]),
    'By Name',
  )
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

async function openMergedGroup(page: Page) {
  await page.getByTestId('import-data-link').click()
  await page.getByTestId('iw-file-input').setInputFiles({
    name: 'combine fixture.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: workbook(),
  })
  await expect(page.getByTestId('iw-overview')).toBeVisible()
  await page.getByTestId('iw-ov-master').check()
  await page.getByTestId('iw-ov-mode-merge').check()
  await page.getByTestId('iw-ov-merge-name').fill(DT)
  await page.getByTestId('iw-ov-continue').click()
  await expect(page.getByTestId('iw-group-0')).toBeVisible()
}

test.beforeEach(async ({ request }) => {
  const token = await adminToken(request)
  for (const name of [DT, 'By Code', 'By Name']) await deleteTableIfExists(request, token, name)
})

test('folding leaves the two store columns apart — nothing is guessed', async ({ page }) => {
  await login(page)
  await openMergedGroup(page)

  // Three columns, because `Cmb Store Code` and `Cmb Store Name` fold to
  // nothing in common. Featherbase does NOT propose that they are one.
  const grid = page.getByTestId('iw-new-grid-0').locator('tbody tr[data-columnrow]')
  await expect(grid).toHaveCount(3)
  await expect(grid.nth(0).locator('[data-rowfield=column_name]')).toHaveValue('cmb_store_code')
  await expect(grid.nth(2).locator('[data-rowfield=column_name]')).toHaveValue('cmb_store_name')

  // The invitation to say so is there, and says what it is for.
  await expect(page.getByTestId('iw-combine-0')).toContainText('store code and a store name')
})

test('the user combines them, and every row lands in one column', async ({ page, request }) => {
  const token = await adminToken(request)
  const headers = { Authorization: `Bearer ${token}` }
  await login(page)
  await openMergedGroup(page)

  // Tick the two store columns (rows 0 and 2 of the grid).
  await page.getByTestId('iw-combine-pick-0-0').check()
  await page.getByTestId('iw-combine-pick-0-2').check()

  // Sample values are shown for both, so "same thing?" is answerable.
  await expect(page.getByTestId('iw-combine-sample-0-cmb_store_code')).toContainText('STR-009')
  await expect(page.getByTestId('iw-combine-sample-0-cmb_store_name')).toContainText('Anna Nagar')

  // No sheet has both, so there is nothing to resolve — and it says so
  // rather than asking a question with no consequence.
  await expect(page.getByTestId('iw-combine-no-overlap-0')).toBeVisible()

  await page.getByTestId('iw-combine-name-0').fill('Store')
  await page.getByTestId('iw-combine-go-0').click()

  // Two columns became one, and the grid says who did it.
  const grid = page.getByTestId('iw-new-grid-0').locator('tbody tr[data-columnrow]')
  await expect(grid).toHaveCount(2)
  await expect(page.getByTestId('iw-combine-0')).toContainText('combined by you')

  await page.getByTestId('iw-import').click()
  await expect(page.getByTestId('iw-result-0')).toContainText('Imported 3 rows')

  const rows = await request.get(
    `/api/table/${encodeURIComponent(DT)}?fields=${encodeURIComponent(
      '["store","cmb_zone"]',
    )}&limit_page_length=20`,
    { headers },
  )
  const data = ((await rows.json()) as { data: Record<string, unknown>[] }).data
  expect(data).toHaveLength(3)
  // Both spellings feed the one column — the whole point.
  expect(data.map((r) => r.store).sort()).toEqual(['Anna Nagar', 'STR-009', 'STR-009'])

  await deleteTableIfExists(request, token, DT)
})

test('a combine can be undone, and the columns come back', async ({ page }) => {
  await login(page)
  await openMergedGroup(page)

  await page.getByTestId('iw-combine-pick-0-0').check()
  await page.getByTestId('iw-combine-pick-0-2').check()
  await page.getByTestId('iw-combine-name-0').fill('Store')
  await page.getByTestId('iw-combine-go-0').click()
  await expect(page.getByTestId('iw-new-grid-0').locator('tbody tr[data-columnrow]')).toHaveCount(2)

  await page.getByTestId('iw-uncombine-0').click()
  // Back to three, so a wrong call is not a dead end.
  await expect(page.getByTestId('iw-new-grid-0').locator('tbody tr[data-columnrow]')).toHaveCount(3)
})

test('a sheet holding BOTH columns must be given a rule', async ({ page, request }) => {
  const token = await adminToken(request)
  const headers = { Authorization: `Bearer ${token}` }
  await login(page)

  // Sheet 1 carries both. Silently picking one would be a data-loss bug.
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Cmb Store Code', 'Cmb Store Name', 'Cmb Zone'],
      ['STR-001', 'Anna Nagar', 'Fresh'],
    ]),
    'Both',
  )
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Cmb Store Name', 'Cmb Zone'],
      ['T Nagar', 'Dairy'],
    ]),
    'Name Only',
  )
  await page.getByTestId('import-data-link').click()
  await page.getByTestId('iw-file-input').setInputFiles({
    name: 'overlap fixture.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
  })
  await page.getByTestId('iw-ov-master').check()
  await page.getByTestId('iw-ov-mode-merge').check()
  await page.getByTestId('iw-ov-merge-name').fill(DT)
  await page.getByTestId('iw-ov-continue').click()

  await page.getByTestId('iw-combine-pick-0-0').check()
  await page.getByTestId('iw-combine-pick-0-1').check()

  // The overlap is named, with the sheet that causes it.
  await expect(page.getByTestId('iw-combine-overlap-0')).toContainText('Both')
  await page.getByTestId('iw-combine-rule-join-0').check()
  await page.getByTestId('iw-combine-name-0').fill('Store')
  await page.getByTestId('iw-combine-go-0').click()

  await page.getByTestId('iw-import').click()
  await expect(page.getByTestId('iw-result-0')).toContainText('Imported 2 rows')

  const rows = await request.get(
    `/api/table/${encodeURIComponent(DT)}?fields=${encodeURIComponent('["store"]')}`,
    { headers },
  )
  const data = ((await rows.json()) as { data: Record<string, unknown>[] }).data
  // 'join' kept BOTH values on the row that had both, and the lone value on
  // the row that had one. Nothing was silently dropped.
  expect(data.map((r) => r.store).sort()).toEqual(['STR-001 · Anna Nagar', 'T Nagar'])

  await deleteTableIfExists(request, token, DT)
})

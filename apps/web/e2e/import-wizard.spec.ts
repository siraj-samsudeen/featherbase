import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import * as XLSX from 'xlsx'

// IMP-010: the Import wizard — multi-sheet workbooks, rename-tolerant
// existing-Table suggestions, column mapping, dry-run, Choice detection.

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const NEW_DT = 'Wizard Orders' // created by the wizard from sheet 1
const EXISTING_DT = 'Wizard Stock' // pre-created; sheet 2 must find it despite its junk name

async function adminToken(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return ((await login.json()) as { token: string }).token
}

async function login(page: Page) {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL(/\/desk/)
}

function workbook() {
  // Sheet 1: headers are unique to this spec so no existing Table can match
  // -> new Table. `Status` values repeat enough for Choice detection.
  const orders = XLSX.utils.aoa_to_sheet([
    ['Wizard Ref', 'Wizard Amount', 'Status'],
    ['A-1', 10.5, 'Open'],
    ['A-2', 20, 'Closed'],
    ['A-3', 12, 'Open'],
    ['A-4', 7.25, 'Closed'],
    ['A-5', 99, 'Open'],
    ['A-6', 1, 'Closed'],
  ])
  // Sheet 2: headers match Wizard Stock's columns exactly, but the sheet
  // name is meaningless — the suggestion must come from column overlap.
  // One bad row (Int column gets text) for the dry-run to catch.
  const stock = XLSX.utils.aoa_to_sheet([
    ['Wizard SKU', 'Bin Count', 'Restock Level'],
    ['Widget', 12, 5],
    ['Gadget', 'many', 10],
    ['Sprocket', 7, 2],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, orders, 'Orders')
  XLSX.utils.book_append_sheet(wb, stock, 'export-final-v2 (3)')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

test('IMP-010: multi-sheet workbook — one sheet to a new Table, one mapped onto a renamed existing Table, dry-run first', async ({
  page,
  request,
}) => {
  const token = await adminToken(request)
  const headers = { Authorization: `Bearer ${token}` }
  const exists = await request.get(`/api/table/${encodeURIComponent(NEW_DT)}:meta`, { headers })
  test.skip(exists.status() === 200, `${NEW_DT} already exists in this DB; skipping create path`)

  // Pre-create the existing target the renamed sheet must find.
  const created = await request.post('/api/doctype', {
    headers,
    data: {
      name: EXISTING_DT,
      columns: [
        { column_name: 'wizard_sku', label: 'Wizard SKU', column_type: 'Data', in_list_view: true },
        { column_name: 'bin_count', label: 'Bin Count', column_type: 'Int', in_list_view: true },
        { column_name: 'restock_level', label: 'Restock Level', column_type: 'Int' },
      ],
    },
  })
  expect([201, 409]).toContain(created.status()) // 409 = already there from a prior run
  const before = (await (
    await request.get(`/api/table/${encodeURIComponent(EXISTING_DT)}:count`, { headers })
  ).json()) as { count: number }

  await login(page)
  await page.getByTestId('import-data-link').click()
  await expect(page.getByTestId('import-wizard')).toBeVisible()

  await page.getByTestId('iw-file-input').setInputFiles({
    name: 'q3 numbers FINAL.xlsx', // junk file name: nothing can be inferred from it
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: workbook(),
  })

  await expect(page.getByTestId('iw-file-name')).toContainText('2 sheets')

  // Sheet 1 defaulted to a new Table named from the sheet, Choice detected.
  await expect(page.getByTestId('iw-target-0')).toHaveValue('__new__')
  await expect(page.getByTestId('iw-new-name-0')).toHaveValue('Orders')
  const grid = page.getByTestId('iw-new-grid-0').locator('tbody tr')
  await expect(grid.nth(2).locator('[data-rowfield=column_type]')).toHaveValue('Choice')
  // IMP-012: the editable display label sits beside the machine name.
  await expect(grid.nth(2).locator('[data-rowfield=label]')).toHaveValue('Status')
  await expect(grid.nth(2).locator('[data-rowfield=column_name]')).toHaveValue('status_1')
  await expect(grid.nth(2)).toContainText('Closed, Open')
  // Rename the new Table so re-runs and other specs can't collide.
  await page.getByTestId('iw-new-name-0').fill(NEW_DT)

  // Sheet 2: the junk-named sheet was matched to Wizard Stock by columns —
  // and says so out loud (IMP-011: an unnoticed auto-match must not quietly
  // route rows into a lookalike Table).
  await expect(page.getByTestId('iw-target-1')).toHaveValue(EXISTING_DT)
  await expect(page.getByTestId('iw-auto-matched-1')).toContainText(EXISTING_DT)
  await expect(page.getByTestId('iw-mapped-count-1')).toContainText('3 of 3')

  // Dry-run: the bad Int row is caught before anything is written.
  await page.getByTestId('iw-check').click()
  await expect(page.getByTestId('iw-check-1')).toContainText('2 rows ready, 1 with problems')
  await expect(page.getByTestId('iw-check-1')).toContainText('row 3')
  const mid = (await (
    await request.get(`/api/table/${encodeURIComponent(EXISTING_DT)}:count`, { headers })
  ).json()) as { count: number }
  expect(mid.count).toBe(before.count) // dry run wrote nothing

  // Import (skipping the bad row), both sheets land.
  await page.getByTestId('iw-import').click()
  await expect(page.getByTestId('iw-done')).toBeVisible()
  await expect(page.getByTestId('iw-result-0')).toContainText(`Imported 6 rows into ${NEW_DT}`)
  await expect(page.getByTestId('iw-result-1')).toContainText(
    `Imported 2 rows into ${EXISTING_DT}`,
  )

  const newCount = (await (
    await request.get(`/api/table/${encodeURIComponent(NEW_DT)}:count`, { headers })
  ).json()) as { count: number }
  expect(newCount.count).toBe(6)
  const after = (await (
    await request.get(`/api/table/${encodeURIComponent(EXISTING_DT)}:count`, { headers })
  ).json()) as { count: number }
  expect(after.count).toBe(before.count + 2)

  // IMP-011: the import history recorded both sheets, and the wizard links it.
  await expect(page.getByTestId('iw-history-link')).toBeVisible()
  const logRes = await request.get(
    `/api/table/${encodeURIComponent('Import Log')}?fields=${encodeURIComponent(
      '["ref_table","sheet_name","table_created","inserted","failed"]',
    )}&filters=${encodeURIComponent(JSON.stringify([['file_name', '=', 'q3 numbers FINAL.xlsx']]))}`,
    { headers },
  )
  const logRows = ((await logRes.json()) as { data: Record<string, unknown>[] }).data
  const byTable = Object.fromEntries(logRows.map((r) => [r.ref_table as string, r]))
  expect(byTable[NEW_DT]).toMatchObject({ sheet_name: 'Orders', table_created: true })
  expect(Number(byTable[NEW_DT].inserted)).toBe(6)
  expect(byTable[EXISTING_DT]).toMatchObject({ sheet_name: 'export-final-v2 (3)' })
  expect(Number(byTable[EXISTING_DT].inserted)).toBe(2)
  expect(Number(byTable[EXISTING_DT].failed)).toBe(1)

  // The new Table's Choice column is real server-side metadata.
  const meta = (await (
    await request.get(`/api/table/${encodeURIComponent(NEW_DT)}:meta`, { headers })
  ).json()) as { columns: { column_name: string; column_type: string; choices: string | null }[] }
  const status = meta.columns.find((c) => c.column_name === 'status_1')
  expect(status?.column_type).toBe('Choice')
  expect(status?.choices).toBe('Closed\nOpen')
})

test('IMP-010: the list view Import button preselects that Table as the target', async ({
  page,
  request,
}) => {
  const token = await adminToken(request)
  const headers = { Authorization: `Bearer ${token}` }
  const exists = await request.get(`/api/table/${encodeURIComponent(EXISTING_DT)}:meta`, {
    headers,
  })
  test.skip(exists.status() !== 200, `${EXISTING_DT} missing; first spec was skipped`)
  const before = (await (
    await request.get(`/api/table/${encodeURIComponent(EXISTING_DT)}:count`, { headers })
  ).json()) as { count: number }

  await login(page)
  await page.goto(`/desk/${encodeURIComponent(EXISTING_DT)}`)
  await page.getByTestId('open-import').click()
  await expect(page.getByTestId('import-wizard')).toBeVisible()

  const csv = 'Wizard SKU,Bin Count,Restock Level\nCog,4,1'
  await page.getByTestId('iw-file-input').setInputFiles({
    name: 'anything at all.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  })
  await expect(page.getByTestId('iw-target-0')).toHaveValue(EXISTING_DT)
  // The peek link opens the target's list in a new tab (no wizard-state loss).
  await expect(page.getByTestId('iw-view-target-0')).toHaveAttribute(
    'href',
    `/desk/${encodeURIComponent(EXISTING_DT)}`,
  )
  await expect(page.getByTestId('iw-view-target-0')).toHaveAttribute('target', '_blank')

  await page.getByTestId('iw-import').click()
  // Single-sheet import navigates to the target Table's list.
  await expect(page).toHaveURL(new RegExp(`/desk/Wizard%20Stock`))
  await expect(page.getByTestId('list-rows')).toContainText('Cog')

  const after = (await (
    await request.get(`/api/table/${encodeURIComponent(EXISTING_DT)}:count`, { headers })
  ).json()) as { count: number }
  expect(after.count).toBe(before.count + 1)
})

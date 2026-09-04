import { test, expect, adminToken } from './fixtures'
import * as XLSX from 'xlsx'
import { deleteTableIfExists } from './cleanup'

// IMP-010: the Import wizard — multi-sheet workbooks, rename-tolerant
// existing-Table suggestions, column mapping, dry-run, Choice detection.

const NEW_DT = 'Wizard Orders' // created by the wizard from sheet 1
const EXISTING_DT = 'Wizard Stock' // pre-created; sheet 2 must find it despite its junk name

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
  await deleteTableIfExists(request, token, NEW_DT)

  // Pre-create the existing target the renamed sheet must find.
  const created = await request.post('/api/table_def', {
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

  await page.goto('/admin')
  await page.getByTestId('import-data-link').click()
  await expect(page.getByTestId('import-wizard')).toBeVisible()

  await page.getByTestId('iw-file-input').setInputFiles({
    name: 'q3 numbers FINAL.xlsx', // junk file name: nothing can be inferred from it
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: workbook(),
  })

  await expect(page.getByTestId('iw-file-name')).toContainText('2 sheets')

  // #199/#200: a workbook opens on the overview with nothing selected. Both
  // sheets are wanted here, so take them both and go on to the columns.
  await expect(page.getByTestId('iw-ov-count')).toHaveText('0 of 2 sheets selected')
  await page.getByTestId('iw-ov-master').check()
  await page.getByTestId('iw-ov-continue').click()

  // Sheet 1 defaulted to a new Table named from the sheet, Choice detected.
  await expect(page.getByTestId('iw-target-0')).toHaveValue('New Table…')
  await expect(page.getByTestId('iw-new-name-0')).toHaveValue('Orders')
  // NAM-002 contract, same as the Table Builder: the locked Row ID row heads
  // the grid, and column assertions select [data-columnrow] so it can never
  // shift them again (#94).
  await expect(
    page.getByTestId('iw-new-grid-0').locator('tbody tr').first(),
  ).toHaveAttribute('data-testid', 'iw-row-id-0')
  const grid = page.getByTestId('iw-new-grid-0').locator('tbody tr[data-columnrow]')
  await expect(grid.nth(2).locator('[data-rowfield=column_type]')).toHaveValue('Choice')
  // IMP-012: the editable display label sits beside the machine name.
  await expect(grid.nth(2).locator('[data-rowfield=label]')).toHaveValue('Status')
  await expect(grid.nth(2).locator('[data-rowfield=column_name]')).toHaveValue('status_1')
  await expect(grid.nth(2)).toContainText('Closed, Open')
  // Rename the new Table so re-runs and other specs can't collide.
  await page.getByTestId('iw-new-name-0').fill(NEW_DT)

  // #202: one target at a time. Sheet 2's card is a step away, and the
  // stepper says where we are.
  await expect(page.getByTestId('iw-step-of')).toContainText('Table 1 of 2')
  await expect(page.getByTestId('iw-sheet-1')).toHaveCount(0)
  await page.getByTestId('iw-next').click()
  await expect(page.getByTestId('iw-step-of')).toContainText('Table 2 of 2')
  await expect(page.getByTestId('iw-sheet-0')).toHaveCount(0)

  // Sheet 2: the junk-named sheet was matched to Wizard Stock by columns —
  // and says so out loud (IMP-011: an unnoticed auto-match must not quietly
  // route rows into a lookalike Table).
  await expect(page.getByTestId('iw-target-1')).toHaveValue(EXISTING_DT)
  await expect(page.getByTestId('iw-auto-matched-1')).toContainText(EXISTING_DT)
  await expect(page.getByTestId('iw-mapped-count-1')).toContainText('3 of 3')

  // Dry-run: the bad Int row is caught before anything is written. #202
  // scopes it to the target on screen, which is this one.
  await page.getByTestId('iw-check').click()
  await expect(page.getByTestId('iw-check-1')).toContainText('2 rows ready, 1 with problems')
  await expect(page.getByTestId('iw-check-1')).toContainText('row 3')
  const mid = (await (
    await request.get(`/api/table/${encodeURIComponent(EXISTING_DT)}:count`, { headers })
  ).json()) as { count: number }
  expect(mid.count).toBe(before.count) // dry run wrote nothing

  // Import (skipping the bad row), both sheets land — the bulk button takes
  // every target that has not landed yet, from whichever step you are on.
  await page.getByTestId('iw-import').click()
  await expect(page.getByTestId('iw-done')).toBeVisible()
  // #202: both results are readable at once, outside the one card on screen.
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

test('IMP-013: leave a sheet out, drop a column, and drive the target picker', async ({
  page,
  request,
}) => {
  const token = await adminToken(request)
  const headers = { Authorization: `Bearer ${token}` }
  await deleteTableIfExists(request, token, 'Wizard Keep')

  const keep = XLSX.utils.aoa_to_sheet([
    ['Pick A', 'Pick B', 'Pick C'],
    ['a1', 'b1', 'c1'],
    ['a2', 'b2', 'c2'],
  ])
  const drop = XLSX.utils.aoa_to_sheet([
    ['Drop Only'],
    ['never imported'],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, keep, 'Wizard Keep')
  XLSX.utils.book_append_sheet(wb, drop, 'Wizard Drop')
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  await page.goto('/admin')
  await page.getByTestId('import-data-link').click()
  await page.getByTestId('iw-file-input').setInputFiles({
    name: 'pick and skip.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
  })

  // #200: a sheet is excluded by not choosing it on the overview. The target
  // picker no longer carries a skip of its own — one act, one place.
  await expect(page.getByTestId('iw-overview')).toBeVisible()
  await page.getByTestId('iw-ov-sheet-0').check()
  await expect(page.getByTestId('iw-ov-tally')).toContainText('1 left out')
  await page.getByTestId('iw-ov-continue').click()
  // The sheet left behind is absent from the column step entirely.
  await expect(page.getByTestId('iw-sheet-1')).toHaveCount(0)

  // The picker searches and pins its action: filtering to nonsense still
  // leaves "New Table…" reachable without a scroll-back.
  await page.getByTestId('iw-target-0').click()
  await page.getByTestId('iw-target-search-0').fill('zzzznope')
  await expect(page.getByTestId('iw-target-new-0')).toBeVisible()
  await page.keyboard.press('Escape')

  // Drop the middle column of sheet 1.
  const grid = page.getByTestId('iw-new-grid-0').locator('tbody tr[data-columnrow]')
  await grid.nth(1).locator('[data-rowfield=include]').uncheck()

  // Only sheet 1's 2 rows count now.
  await expect(page.getByTestId('iw-import')).toContainText('Import 2 rows')
  await page.getByTestId('iw-import').click()

  // Single active sheet: lands on the new Table's list.
  await expect(page).toHaveURL(new RegExp('/admin/Wizard%20Keep'))

  // pick_b was excluded; the sheet left off the overview created nothing.
  const meta = (await (
    await request.get(`/api/table/${encodeURIComponent('Wizard Keep')}:meta`, { headers })
  ).json()) as { columns: { column_name: string }[] }
  const names = meta.columns.map((c) => c.column_name)
  expect(names).toEqual(expect.arrayContaining(['pick_a', 'pick_c']))
  expect(names).not.toContain('pick_b')
  const count = await request.get(`/api/table/${encodeURIComponent('Wizard Keep')}:count`, {
    headers,
  })
  expect(((await count.json()) as { count: number }).count).toBe(2)
  const dropped = await request.get(`/api/table/${encodeURIComponent('Wizard Drop')}:meta`, {
    headers,
  })
  expect(dropped.status()).toBe(404)
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

  await page.goto(`/admin/${encodeURIComponent(EXISTING_DT)}`)
  await page.getByTestId('open-import').click()
  await expect(page.getByTestId('import-wizard')).toBeVisible()

  // Unique per run: this spec appends to a persistent Table, so a fixed SKU
  // would accumulate across runs and break the exactly-one-row assertion.
  const sku = `Cog-${Date.now()}`
  const csv = `Wizard SKU,Bin Count,Restock Level\n${sku},4,1`
  await page.getByTestId('iw-file-input').setInputFiles({
    name: 'anything at all.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  })
  await expect(page.getByTestId('iw-target-0')).toHaveValue(EXISTING_DT)
  // The peek link opens the target's list in a new tab (no wizard-state loss),
  // and the Table's CURRENT row count sits beside it — distinct from the
  // sheet's own row count in the card header.
  await expect(page.getByTestId('iw-view-target-0')).toHaveAttribute(
    'href',
    `/admin/${encodeURIComponent(EXISTING_DT)}`,
  )
  await expect(page.getByTestId('iw-view-target-0')).toHaveAttribute('target', '_blank')
  await expect(page.getByTestId('iw-target-count-0')).toContainText(
    `holds ${before.count} rows now`,
  )

  // IMP-013: skipping a mapped column is a checkbox, not a select option.
  await page.getByTestId('iw-map-use-0-2').uncheck()
  await expect(page.getByTestId('iw-mapped-count-0')).toContainText('2 of 3')

  await page.getByTestId('iw-import').click()
  // Single-sheet import navigates to the target Table's list.
  await expect(page).toHaveURL(new RegExp(`/admin/Wizard%20Stock`))
  await expect(page.getByTestId('list-rows')).toContainText(sku)

  const after = (await (
    await request.get(`/api/table/${encodeURIComponent(EXISTING_DT)}:count`, { headers })
  ).json()) as { count: number }
  expect(after.count).toBe(before.count + 1)

  // The unchecked column stayed out of the imported row.
  const rows = (await (
    await request.get(
      `/api/table/${encodeURIComponent(EXISTING_DT)}?fields=${encodeURIComponent(
        '["wizard_sku","restock_level"]',
      )}&filters=${encodeURIComponent(JSON.stringify([['wizard_sku', '=', sku]]))}`,
      { headers },
    )
  ).json()) as { data: { restock_level: unknown }[] }
  expect(rows.data).toHaveLength(1)
  expect(rows.data[0].restock_level).toBeNull()
})

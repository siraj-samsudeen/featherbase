import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import * as XLSX from 'xlsx'
import { deleteTableIfExists } from './cleanup'

// IMP-006: drag & drop a CSV/Excel file -> inferred Table + imported rows.

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const CSV_DT = 'Import Sales' // from "import sales.csv"
const XLSX_DT = 'Import Inventory' // from "import inventory.xlsx"

const CSV = [
  'Customer Name,Qty,Unit Price,Ship Date,Paid',
  'Alice,2,9.99,2026-01-15,yes',
  'Bob,5,12.5,2026-02-01,no',
  'Chandra,1,3.25,2026-02-10,yes',
].join('\n')

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

test('IMP-006: drop a CSV; inferred schema prefills the builder; create imports the rows', async ({
  page,
  request,
}) => {
  const token = await adminToken(request)
  await deleteTableIfExists(request, token, CSV_DT)

  await login(page)
  await page.getByTestId('new-doctype-link').click()
  await expect(page.getByTestId('doctype-builder')).toBeVisible()

  // A real drag-and-drop onto the dropzone (DataTransfer built in-page).
  const dataTransfer = await page.evaluateHandle((csv) => {
    const dt = new DataTransfer()
    dt.items.add(new File([csv], 'import sales.csv', { type: 'text/csv' }))
    return dt
  }, CSV)
  await page.getByTestId('dt-dropzone').dispatchEvent('drop', { dataTransfer })

  // Inference prefills everything from the file.
  await expect(page.getByTestId('dt-file-name')).toContainText('import sales.csv')
  await expect(page.getByTestId('dt-file-name')).toContainText('3 rows')
  await expect(page.getByTestId('dt-name')).toHaveValue(CSV_DT)
  const grid = page.getByTestId('dt-fields').locator('tbody tr[data-columnrow]')
  await expect(grid).toHaveCount(5)
  const expectType = async (row: number, name: string, type: string) => {
    await expect(grid.nth(row).locator('[data-rowfield=column_name]')).toHaveValue(name)
    await expect(grid.nth(row).locator('[data-rowfield=column_type]')).toHaveValue(type)
  }
  await expectType(0, 'customer_name', 'Data')
  await expectType(1, 'qty', 'Int')
  await expectType(2, 'unit_price', 'Float')
  await expectType(3, 'ship_date', 'Date')
  await expectType(4, 'paid', 'Check')
  await expect(page.getByTestId('dt-preview')).toContainText('Alice')

  await page.getByTestId('dt-create').click()

  // Lands on the new Table's list with the imported rows visible.
  await expect(page).toHaveURL(new RegExp('/admin/Import%20Sales'))
  await expect(page.getByTestId('list-rows')).toContainText('Alice')
  await expect(page.getByTestId('list-rows')).toContainText('Chandra')

  // Server-side truth: inferred types persisted, rows really inserted.
  const meta = await request.get(`/api/table/${encodeURIComponent(CSV_DT)}:meta`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = (await meta.json()) as { columns: { column_name: string; column_type: string }[] }
  const types = Object.fromEntries(body.columns.map((c) => [c.column_name, c.column_type]))
  expect(types).toMatchObject({
    customer_name: 'Data',
    qty: 'Int',
    unit_price: 'Float',
    ship_date: 'Date',
    paid: 'Check',
  })
  const count = await request.get(`/api/table/${encodeURIComponent(CSV_DT)}:count`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(((await count.json()) as { count: number }).count).toBe(3)
})

test('IMP-006: a real .xlsx imports the same way (via the file picker)', async ({
  page,
  request,
}) => {
  const token = await adminToken(request)
  await deleteTableIfExists(request, token, XLSX_DT)

  const ws = XLSX.utils.aoa_to_sheet([
    ['Item', 'On Hand', 'Reorder At'],
    ['Widget', 12, 5],
    ['Gadget', 3, 10],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Stock')
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  await login(page)
  await page.getByTestId('new-doctype-link').click()
  await page.getByTestId('dt-file-input').setInputFiles({
    name: 'import inventory.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
  })

  await expect(page.getByTestId('dt-name')).toHaveValue(XLSX_DT)
  const grid = page.getByTestId('dt-fields').locator('tbody tr[data-columnrow]')
  await expect(grid).toHaveCount(3)
  await expect(grid.nth(0).locator('[data-rowfield=column_name]')).toHaveValue('item')
  await expect(grid.nth(1).locator('[data-rowfield=column_type]')).toHaveValue('Int')

  await page.getByTestId('dt-create').click()
  await expect(page).toHaveURL(new RegExp('/admin/Import%20Inventory'))
  await expect(page.getByTestId('list-rows')).toContainText('Widget')
  await expect(page.getByTestId('list-rows')).toContainText('Gadget')

  const count = await request.get(`/api/table/${encodeURIComponent(XLSX_DT)}:count`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(((await count.json()) as { count: number }).count).toBe(2)
})

test('IMP-006: a non-tabular file is refused with a message', async ({ page }) => {
  await login(page)
  await page.getByTestId('new-doctype-link').click()
  await page.getByTestId('dt-file-input').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello'),
  })
  await expect(page.getByTestId('dt-error')).toContainText('not a CSV or Excel file')
})

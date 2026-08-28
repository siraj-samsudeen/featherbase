import { test, expect, adminAuth, type APIRequestContext } from './fixtures'

const DT = 'Set4 Item'

async function setSettings(request: APIRequestContext, row: Record<string, unknown>) {
  const headers = await adminAuth(request)
  const res = await request.post('/api/save_row', { headers, data: { table: 'System Settings', row } })
  if (res.status() !== 201) throw new Error(`save settings: ${res.status()}`)
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ request }) => {
  const headers = await adminAuth(request)
  // A Table with a Date and a Currency field, both shown in the list.
  const dt = await request.post('/api/table_def', {
    headers,
    data: {
      name: DT,
      id_pattern: 'prompt',
      columns: [
        { column_name: 'due', column_type: 'Date', in_list_view: true },
        { column_name: 'amount', column_type: 'Currency', in_list_view: true },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  // A known row: 9 March 2026, amount 1234.5.
  await request.post(`/api/table/${encodeURIComponent(DT)}`, {
    headers,
    data: { row_id: 'set4-doc', due: '2026-03-09', amount: 1234.5 },
  })
  // Start from a known global format.
  await setSettings(request, { date_format: 'dd-mm-yyyy', currency: 'USD', currency_precision: 2 })
})

test.afterAll(async ({ request }) => {
  // Restore defaults so the global single doesn't leak into other specs.
  await setSettings(request, { date_format: 'yyyy-mm-dd', currency: 'USD', currency_precision: 2 })
})

// SET-004: System Settings are applied globally to rendering — the date
// format and currency precision flow into list cells and form previews, and
// changing the setting re-renders without any per-Table code.
test('SET-004: date format and currency precision render globally', async ({ page }) => {
  // List: the Date cell honors dd-mm-yyyy and the Currency cell honors
  // precision 2 with the USD symbol.
  await page.goto(`/admin/${encodeURIComponent(DT)}`)
  await expect(page.getByTestId('cell-due')).toHaveText('09-03-2026')
  await expect(page.getByTestId('cell-amount')).toHaveText('$1,234.50')

  // Form: the preview under the native inputs reflects the same global format.
  await page.goto(`/admin/${encodeURIComponent(DT)}/set4-doc`)
  await expect(page.getByTestId('form-view')).toBeVisible()
  await expect(page.getByTestId('preview-due')).toHaveText('09-03-2026')
  await expect(page.getByTestId('preview-amount')).toHaveText('$1,234.50')

  // Change the global date format; the same list re-renders in the new format
  // with no code change to the Table.
  await setSettings(page.request, { date_format: 'mm-dd-yyyy' })
  await page.goto(`/admin/${encodeURIComponent(DT)}`)
  await expect(page.getByTestId('cell-due')).toHaveText('03-09-2026')

  // And bumping currency precision to 3 flows through too.
  await setSettings(page.request, { currency_precision: 3 })
  await page.reload()
  await expect(page.getByTestId('cell-amount')).toHaveText('$1,234.500')
})

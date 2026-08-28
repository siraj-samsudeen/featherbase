import { test, expect, adminAuth, type APIRequestContext } from './fixtures'

const DT = 'Prn DT'
const ITEM = 'Prn Item'

// PRN-001: print view shows labels + values and child tables, no app chrome.

let docName = ''

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const headers = await adminAuth(request)
  const item = await request.post('/api/table_def', {
    headers,
    data: {
      name: ITEM,
      kind: 'sub_table',
      columns: [
        { column_name: 'product', column_type: 'Data' },
        { column_name: 'qty', column_type: 'Int' },
      ],
    },
  })
  if (![201, 409].includes(item.status())) throw new Error(`item: ${item.status()}`)
  const dt = await request.post('/api/table_def', {
    headers,
    data: {
      name: DT,
      id_pattern: 'prompt',
      columns: [
        { column_name: 'customer', column_type: 'Data', label: 'Customer' },
        { column_name: 'lines', column_type: 'Sub-table', row_table: ITEM, label: 'Lines' },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  docName = 'prn-doc'
  await request.delete(`/api/table/${encodeURIComponent(DT)}/${docName}`, { headers })
  const doc = await request.post('/api/save_row', {
    headers,
    data: {
      table: DT,
      row: {
        row_id: docName,
        customer: 'Wayne Enterprises',
        lines: [
          { product: 'Widget', qty: 3 },
          { product: 'Gadget', qty: 7 },
        ],
      },
    },
  })
  if (doc.status() !== 201) throw new Error(`row: ${doc.status()}`)
})

test('PRN-001: print view shows labels, values, and child tables with no chrome', async ({
  page,
}) => {
  // Reach print view via the form's Print button.
  await page.goto(`/admin/${encodeURIComponent(DT)}/${docName}`)
  await page.getByTestId('form-print').click()
  await expect(page).toHaveURL(new RegExp(`/print/${encodeURIComponent(DT)}/${docName}`))

  // No app chrome: navbar/sidebar/awesomebar absent.
  await expect(page.getByTestId('awesomebar')).toHaveCount(0)
  await expect(page.getByTestId('table-nav')).toHaveCount(0)

  // Labels + values shown.
  await expect(page.getByTestId('print-view')).toBeVisible()
  await expect(page.getByTestId('print-docname')).toContainText(docName)
  await expect(page.getByTestId('print-field-customer')).toContainText('Customer')
  await expect(page.getByTestId('print-field-customer')).toContainText('Wayne Enterprises')

  // Child table rendered with rows.
  await expect(page.getByTestId('print-table-lines')).toBeVisible()
  await expect(page.getByTestId('print-table-row')).toHaveCount(2)
  await expect(page.getByTestId('print-table-lines')).toContainText('Widget')
  await expect(page.getByTestId('print-table-lines')).toContainText('Gadget')
})

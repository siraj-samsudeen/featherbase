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

// Migrated to the feather-testing-core DSL (docs/testing/e2e-dsl-migration.md):
// the round trip through the form's Print button and the URL-regex landing
// check aren't expressible by assertPath (which is exact-match only), so they
// stay in a step; the rest is plain presence/text/count assertHas checks.
test('PRN-001: print view shows labels, values, and child tables with no chrome', async ({
  session,
}) => {
  await session.visit(`/admin/${encodeURIComponent(DT)}/${docName}`)
  await session.step('click Print and land on the print view', async ({ page }) => {
    await page.getByTestId('form-print').click()
    await expect(page).toHaveURL(new RegExp(`/print/${encodeURIComponent(DT)}/${docName}`))
  })

  await session
    // No app chrome: navbar/sidebar/awesomebar absent.
    .assertHas('[data-testid="awesomebar"]', { count: 0 })
    .assertHas('[data-testid="table-nav"]', { count: 0 })
    // Labels + values shown.
    .assertHas('[data-testid="print-view"]')
    .assertHas('[data-testid="print-docname"]', { text: docName })
    .assertHas('[data-testid="print-field-customer"]', { text: 'Customer' })
    .assertHas('[data-testid="print-field-customer"]', { text: 'Wayne Enterprises' })
    // Child table rendered with rows.
    .assertHas('[data-testid="print-table-lines"]')
    .assertHas('[data-testid="print-table-row"]', { count: 2 })
    .assertHas('[data-testid="print-table-lines"]', { text: 'Widget' })
    .assertHas('[data-testid="print-table-lines"]', { text: 'Gadget' })
})

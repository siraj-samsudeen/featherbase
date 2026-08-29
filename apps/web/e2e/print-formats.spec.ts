import { test, expect, adminAuth, type APIRequestContext } from './fixtures'

const DT = 'Pf DT'

// PRN-002: two formats for one Table produce visibly different output;
// the default format is respected when none is named.

let docName = ''

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const headers = await adminAuth(request)
  const dt = await request.post('/api/table_def', {
    headers,
    data: {
      name: DT,
      id_pattern: 'prompt',
      columns: [
        { column_name: 'customer', column_type: 'Data' },
        { column_name: 'amount', column_type: 'Int' },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  docName = 'pf-doc'
  await request.delete(`/api/table/${encodeURIComponent(DT)}/${docName}`, { headers })
  await request.post(`/api/table/${encodeURIComponent(DT)}`, {
    headers,
    data: { row_id: docName, customer: 'Stark Industries', amount: 500 },
  })

  // Two formats: an "Invoice" default and a terse "Receipt".
  for (const fmt of [
    {
      row_id: 'Pf Invoice',
      ref_table: DT,
      is_default: true,
      template:
        '<div data-testid="tpl-invoice"><h2>INVOICE</h2><p>Bill to: {{ customer }}</p><p>Total: {{ amount }}</p></div>',
    },
    {
      row_id: 'Pf Receipt',
      ref_table: DT,
      is_default: false,
      template: '<div data-testid="tpl-receipt">RECEIPT — {{ customer }} paid {{ amount }}</div>',
    },
  ]) {
    await request.delete(`/api/table/Print%20Format/${encodeURIComponent(fmt.row_id)}`, { headers })
    const res = await request.post('/api/table/Print%20Format', { headers, data: fmt })
    if (res.status() !== 201) throw new Error(`format ${fmt.row_id}: ${res.status()}`)
  }
})

test('PRN-002: default format respected; a second format renders differently', async ({
  page,
}) => {
  // No format named → the default (Invoice) is used, interpolated.
  await page.goto(`/print/${encodeURIComponent(DT)}/${docName}`)
  await expect(page.getByTestId('print-format-body')).toHaveAttribute('data-format', 'Pf Invoice')
  await expect(page.getByTestId('tpl-invoice')).toBeVisible()
  await expect(page.getByTestId('tpl-invoice')).toContainText('Bill to: Stark Industries')
  await expect(page.getByTestId('tpl-invoice')).toContainText('Total: 500')
  await expect(page.getByTestId('print-view')).not.toContainText('RECEIPT')

  // Switch to the Receipt format → visibly different output.
  await page.getByTestId('print-format-picker').selectOption('Pf Receipt')
  await expect(page.getByTestId('tpl-receipt')).toBeVisible()
  await expect(page.getByTestId('tpl-receipt')).toContainText('RECEIPT — Stark Industries paid 500')
  await expect(page.getByTestId('tpl-invoice')).toHaveCount(0)

  // The picker choice is a shareable URL.
  await page.goto(`/print/${encodeURIComponent(DT)}/${docName}?format=Pf%20Receipt`)
  await expect(page.getByTestId('tpl-receipt')).toBeVisible()

  // Explicitly choosing Standard (auto) falls back to the metadata layout.
  await page.goto(`/print/${encodeURIComponent(DT)}/${docName}`)
  await page.getByTestId('print-format-picker').selectOption('standard')
  await expect(page.getByTestId('print-auto-layout')).toBeVisible()
})

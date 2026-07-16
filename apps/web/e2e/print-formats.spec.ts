import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'Pf DT'

// PRN-002: two formats for one DocType produce visibly different output;
// the default format is respected when none is named.

let docName = ''

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const headers = { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
  const dt = await request.post('/api/doctype', {
    headers,
    data: {
      name: DT,
      autoname: 'prompt',
      fields: [
        { fieldname: 'customer', fieldtype: 'Data' },
        { fieldname: 'amount', fieldtype: 'Int' },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  docName = 'pf-doc'
  await request.delete(`/api/resource/${encodeURIComponent(DT)}/${docName}`, { headers })
  await request.post(`/api/resource/${encodeURIComponent(DT)}`, {
    headers,
    data: { name: docName, customer: 'Stark Industries', amount: 500 },
  })

  // Two formats: an "Invoice" default and a terse "Receipt".
  for (const fmt of [
    {
      name: 'Pf Invoice',
      doc_type: DT,
      is_default: true,
      template:
        '<div data-testid="tpl-invoice"><h2>INVOICE</h2><p>Bill to: {{ customer }}</p><p>Total: {{ amount }}</p></div>',
    },
    {
      name: 'Pf Receipt',
      doc_type: DT,
      is_default: false,
      template: '<div data-testid="tpl-receipt">RECEIPT — {{ customer }} paid {{ amount }}</div>',
    },
  ]) {
    await request.delete(`/api/resource/Print%20Format/${encodeURIComponent(fmt.name)}`, { headers })
    const res = await request.post('/api/resource/Print%20Format', { headers, data: fmt })
    if (res.status() !== 201) throw new Error(`format ${fmt.name}: ${res.status()}`)
  }
})

test('PRN-002: default format respected; a second format renders differently', async ({
  page,
}) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)

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

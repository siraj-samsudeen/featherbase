import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'Prn DT'
const ITEM = 'Prn Item'

// PRN-001: print view shows labels + values and child tables, no app chrome.

let docName = ''

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const headers = { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
  const item = await request.post('/api/doctype', {
    headers,
    data: {
      name: ITEM,
      istable: true,
      fields: [
        { fieldname: 'product', fieldtype: 'Data' },
        { fieldname: 'qty', fieldtype: 'Int' },
      ],
    },
  })
  if (![201, 409].includes(item.status())) throw new Error(`item: ${item.status()}`)
  const dt = await request.post('/api/doctype', {
    headers,
    data: {
      name: DT,
      autoname: 'prompt',
      fields: [
        { fieldname: 'customer', fieldtype: 'Data', label: 'Customer' },
        { fieldname: 'lines', fieldtype: 'Table', options: ITEM, label: 'Lines' },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  docName = 'prn-doc'
  await request.delete(`/api/resource/${encodeURIComponent(DT)}/${docName}`, { headers })
  const doc = await request.post('/api/save_doc', {
    headers,
    data: {
      doctype: DT,
      doc: {
        name: docName,
        customer: 'Wayne Enterprises',
        lines: [
          { product: 'Widget', qty: 3 },
          { product: 'Gadget', qty: 7 },
        ],
      },
    },
  })
  if (doc.status() !== 201) throw new Error(`doc: ${doc.status()}`)
})

test('PRN-001: print view shows labels, values, and child tables with no chrome', async ({
  page,
}) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)

  // Reach print view via the form's Print button.
  await page.goto(`/desk/${encodeURIComponent(DT)}/${docName}`)
  await page.getByTestId('form-print').click()
  await expect(page).toHaveURL(new RegExp(`/print/${encodeURIComponent(DT)}/${docName}`))

  // No app chrome: navbar/sidebar/awesomebar absent.
  await expect(page.getByTestId('awesomebar')).toHaveCount(0)
  await expect(page.getByTestId('doctype-nav')).toHaveCount(0)

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

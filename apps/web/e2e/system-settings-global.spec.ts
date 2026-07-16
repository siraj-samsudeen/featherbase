import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'Set4 Item'

async function adminHeaders(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
}

async function setSettings(request: APIRequestContext, doc: Record<string, unknown>) {
  const headers = await adminHeaders(request)
  const res = await request.post('/api/save_doc', { headers, data: { doctype: 'System Settings', doc } })
  if (res.status() !== 201) throw new Error(`save settings: ${res.status()}`)
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ request }) => {
  const headers = await adminHeaders(request)
  // A DocType with a Date and a Currency field, both shown in the list.
  const dt = await request.post('/api/doctype', {
    headers,
    data: {
      name: DT,
      autoname: 'prompt',
      fields: [
        { fieldname: 'due', fieldtype: 'Date', in_list_view: true },
        { fieldname: 'amount', fieldtype: 'Currency', in_list_view: true },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  // A known doc: 9 March 2026, amount 1234.5.
  await request.post(`/api/resource/${encodeURIComponent(DT)}`, {
    headers,
    data: { name: 'set4-doc', due: '2026-03-09', amount: 1234.5 },
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
// changing the setting re-renders without any per-DocType code.
test('SET-004: date format and currency precision render globally', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)

  // List: the Date cell honors dd-mm-yyyy and the Currency cell honors
  // precision 2 with the USD symbol.
  await page.goto(`/desk/${encodeURIComponent(DT)}`)
  await expect(page.getByTestId('cell-due')).toHaveText('09-03-2026')
  await expect(page.getByTestId('cell-amount')).toHaveText('$1,234.50')

  // Form: the preview under the native inputs reflects the same global format.
  await page.goto(`/desk/${encodeURIComponent(DT)}/set4-doc`)
  await expect(page.getByTestId('form-view')).toBeVisible()
  await expect(page.getByTestId('preview-due')).toHaveText('09-03-2026')
  await expect(page.getByTestId('preview-amount')).toHaveText('$1,234.50')

  // Change the global date format; the same list re-renders in the new format
  // with no code change to the DocType.
  await setSettings(page.request, { date_format: 'mm-dd-yyyy' })
  await page.goto(`/desk/${encodeURIComponent(DT)}`)
  await expect(page.getByTestId('cell-due')).toHaveText('03-09-2026')

  // And bumping currency precision to 3 flows through too.
  await setSettings(page.request, { currency_precision: 3 })
  await page.reload()
  await expect(page.getByTestId('cell-amount')).toHaveText('$1,234.500')
})

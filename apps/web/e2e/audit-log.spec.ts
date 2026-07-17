import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'Audit E2E Item'

async function adminHeaders(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
}

async function logCount(request: APIRequestContext, doctype: string, filters: unknown[]) {
  const headers = await adminHeaders(request)
  const res = (await (
    await request.get(
      `/api/resource/${encodeURIComponent(doctype)}?filters=${encodeURIComponent(JSON.stringify(filters))}&limit_page_length=1`,
      { headers },
    )
  ).json()) as { total: number }
  return res.total
}

test.beforeAll(async ({ request }) => {
  const headers = await adminHeaders(request)
  const dt = await request.post('/api/doctype', {
    headers,
    data: { name: DT, fields: [{ fieldname: 'title', fieldtype: 'Data', in_list_view: true }] },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  await request.post(`/api/resource/${encodeURIComponent(DT)}`, { headers, data: { title: 'row1' } })
})

async function login(page: Page) {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)
}

// PLAT-007: a login and a CSV export each produce an audit log row.
test('PLAT-007: login writes an Activity Log row', async ({ page, request }) => {
  const before = await logCount(request, 'Activity Log', [['operation', '=', 'login']])
  await login(page) // this login should append a row
  await expect.poll(() => logCount(request, 'Activity Log', [['operation', '=', 'login']])).toBeGreaterThan(before)
})

test('PLAT-007: a CSV export writes an Access Log row', async ({ page, request }) => {
  await login(page)
  const before = await logCount(request, 'Access Log', [
    ['operation', '=', 'export'],
    ['reference_doctype', '=', DT],
  ])

  await page.goto(`/desk/${encodeURIComponent(DT)}/view/report`)
  await expect(page.getByTestId('export-csv')).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByTestId('export-csv').click()
  await download

  await expect
    .poll(() =>
      logCount(request, 'Access Log', [
        ['operation', '=', 'export'],
        ['reference_doctype', '=', DT],
      ]),
    )
    .toBeGreaterThan(before)
})

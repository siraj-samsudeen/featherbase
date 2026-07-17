import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'Dash E2E Task'
const DASH = 'Dash E2E Board'

async function adminHeaders(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
}

// Known data: 3 Open, 2 Closed, 1 Pending → 6 total, 3 open.
const STATUSES = ['Open', 'Open', 'Open', 'Closed', 'Closed', 'Pending']

test.beforeAll(async ({ request }) => {
  const headers = await adminHeaders(request)
  const dt = await request.post('/api/doctype', {
    headers,
    data: {
      name: DT,
      fields: [
        { fieldname: 'title', fieldtype: 'Data', in_list_view: true },
        { fieldname: 'status', fieldtype: 'Select', options: 'Open\nClosed\nPending', in_list_view: true },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  // Clear any docs from a prior run so the counts are exact.
  const existing = (await (
    await request.get(`/api/resource/${encodeURIComponent(DT)}?limit_page_length=500`, { headers })
  ).json()) as { data: { name: string }[] }
  for (const d of existing.data) await request.delete(`/api/resource/${encodeURIComponent(DT)}/${d.name}`, { headers })

  for (const status of STATUSES)
    await request.post(`/api/resource/${encodeURIComponent(DT)}`, { headers, data: { title: 't', status } })

  await request.delete(`/api/resource/Dashboard/${encodeURIComponent(DASH)}`, { headers })
  const dash = await request.post('/api/save_doc', {
    headers,
    data: {
      doctype: 'Dashboard',
      doc: {
        name: DASH,
        label: 'E2E Board',
        config: JSON.stringify({
          cards: [
            { label: 'All Tasks', doctype: DT },
            { label: 'Open Tasks', doctype: DT, filters: [['status', '=', 'Open']] },
          ],
          charts: [{ label: 'By Status', doctype: DT, group_by: 'status' }],
        }),
      },
    },
  })
  if (dash.status() !== 201) throw new Error(`dashboard: ${dash.status()} ${await dash.text()}`)
})

// UI-026: a dashboard shows a count card and a bar chart that match the data.
test('UI-026: dashboard number cards and bar chart match the underlying data', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)

  await page.goto(`/desk/dashboard/${encodeURIComponent(DASH)}`)
  await expect(page.getByTestId('dashboard-title')).toBeVisible()

  // Number cards match the counts.
  await expect(page.getByTestId('card-value-All Tasks')).toHaveText('6')
  await expect(page.getByTestId('card-value-Open Tasks')).toHaveText('3')

  // Bar chart values match the grouped counts.
  await expect(page.getByTestId('bar-value-Open')).toHaveText('3')
  await expect(page.getByTestId('bar-value-Closed')).toHaveText('2')
  await expect(page.getByTestId('bar-value-Pending')).toHaveText('1')
})

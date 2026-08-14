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
  const dt = await request.post('/api/table_def', {
    headers,
    data: {
      name: DT,
      columns: [
        { column_name: 'title', column_type: 'Data', in_list_view: true },
        { column_name: 'stage', column_type: 'Choice', choices: 'Open\nClosed\nPending', in_list_view: true },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  // Clear any docs from a prior run so the counts are exact.
  const existing = (await (
    await request.get(`/api/table/${encodeURIComponent(DT)}?limit_page_length=500`, { headers })
  ).json()) as { data: { row_id: string }[] }
  for (const d of existing.data) await request.delete(`/api/table/${encodeURIComponent(DT)}/${d.row_id}`, { headers })

  for (const stage of STATUSES)
    await request.post(`/api/table/${encodeURIComponent(DT)}`, { headers, data: { title: 't', stage } })

  await request.delete(`/api/table/Dashboard/${encodeURIComponent(DASH)}`, { headers })
  const dash = await request.post('/api/save_row', {
    headers,
    data: {
      table: 'Dashboard',
      row: {
        row_id: DASH,
        label: 'E2E Board',
        config: JSON.stringify({
          cards: [
            { label: 'All Tasks', table: DT },
            { label: 'Open Tasks', table: DT, filters: [['stage', '=', 'Open']] },
          ],
          charts: [{ label: 'By Status', table: DT, group_by: 'stage' }],
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
  await page.waitForURL(/\/admin/)

  await page.goto(`/admin/dashboard/${encodeURIComponent(DASH)}`)
  await expect(page.getByTestId('dashboard-title')).toBeVisible()

  // Number cards match the counts.
  await expect(page.getByTestId('card-value-All Tasks')).toHaveText('6')
  await expect(page.getByTestId('card-value-Open Tasks')).toHaveText('3')

  // Bar chart values match the grouped counts.
  await expect(page.getByTestId('bar-value-Open')).toHaveText('3')
  await expect(page.getByTestId('bar-value-Closed')).toHaveText('2')
  await expect(page.getByTestId('bar-value-Pending')).toHaveText('1')
})

import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'Rc E2E Sale'
const REPORT = 'Rc E2E Report'
const DASH = 'Rc E2E Board'

async function adminHeaders(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
}

// Known data: North 100, South 50, North 25 → grouped by region: North 2, South 1.
const ROWS: [string, number][] = [
  ['North', 100],
  ['South', 50],
  ['North', 25],
]

test.beforeAll(async ({ request }) => {
  const headers = await adminHeaders(request)
  const dt = await request.post('/api/doctype', {
    headers,
    data: {
      name: DT,
      fields: [
        { fieldname: 'region', fieldtype: 'Select', options: 'North\nSouth', in_list_view: true },
        { fieldname: 'amount', fieldtype: 'Int', in_list_view: true },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  const existing = (await (
    await request.get(`/api/resource/${encodeURIComponent(DT)}?limit_page_length=500`, { headers })
  ).json()) as { data: { name: string }[] }
  for (const d of existing.data) await request.delete(`/api/resource/${encodeURIComponent(DT)}/${d.name}`, { headers })
  for (const [region, amount] of ROWS)
    await request.post(`/api/resource/${encodeURIComponent(DT)}`, { headers, data: { region, amount } })

  // A saved Report Builder report over the DocType.
  await request.delete(`/api/resource/Report/${encodeURIComponent(REPORT)}`, { headers })
  await request.post('/api/save_doc', {
    headers,
    data: {
      doctype: 'Report',
      doc: { name: REPORT, ref_doctype: DT, report_type: 'Report Builder', config: { columns: ['region', 'amount'], filters: [] } },
    },
  })

  // An empty dashboard to pin onto.
  await request.delete(`/api/resource/Dashboard/${encodeURIComponent(DASH)}`, { headers })
  await request.post('/api/save_doc', {
    headers,
    data: { doctype: 'Dashboard', doc: { name: DASH, label: 'RC Board', config: { cards: [], charts: [] } } },
  })
})

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)
}

test('RPT-006: chart reflects report data and pinning shows it on the dashboard', async ({ page }) => {
  await login(page)

  // Open the saved report; group by region so the chart shows per-region counts.
  await page.goto(`/desk/${encodeURIComponent(DT)}/view/report?report=${encodeURIComponent(REPORT)}`)
  await expect(page.getByTestId('report-view')).toBeVisible()
  await page.getByTestId('report-groupby').selectOption('region')

  // The chart reflects the report data: North 2, South 1.
  await expect(page.getByTestId('report-chart')).toBeVisible()
  await expect(page.getByTestId('chart-bar-value-North')).toHaveText('2')
  await expect(page.getByTestId('chart-bar-value-South')).toHaveText('1')

  // Pin the chart to the dashboard.
  await page.getByTestId('pin-dashboard').selectOption(DASH)
  await page.getByTestId('pin-chart').click()
  await expect(page.getByTestId('pin-msg')).toContainText(`Pinned to ${DASH}`)

  // The dashboard now shows the pinned report chart, recomputed from live data.
  await page.goto(`/desk/dashboard/${encodeURIComponent(DASH)}`)
  await expect(page.getByTestId(`chart-${REPORT}`)).toBeVisible()
  await expect(page.getByTestId('bar-value-North')).toHaveText('2')
  await expect(page.getByTestId('bar-value-South')).toHaveText('1')
})

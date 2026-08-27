import { test, expect, adminAuth, loginAs, type APIRequestContext } from './fixtures'

const DT = 'Audit E2E Item'

async function logCount(request: APIRequestContext, table: string, filters: unknown[]) {
  const headers = await adminAuth(request)
  const res = (await (
    await request.get(
      `/api/table/${encodeURIComponent(table)}?filters=${encodeURIComponent(JSON.stringify(filters))}&limit_page_length=1`,
      { headers },
    )
  ).json()) as { total: number }
  return res.total
}

test.beforeAll(async ({ request }) => {
  const headers = await adminAuth(request)
  const dt = await request.post('/api/table_def', {
    headers,
    data: { name: DT, columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }] },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  await request.post(`/api/table/${encodeURIComponent(DT)}`, { headers, data: { title: 'row1' } })
})

// PLAT-007: a login and a CSV export each produce an audit log row.
test('PLAT-007: login writes an Activity Log row', async ({ page, request }) => {
  const before = await logCount(request, 'Activity Log', [['operation', '=', 'login']])
  // The subject of this test IS the login, so it signs in for real rather
  // than riding the suite's stored session.
  await loginAs(page)
  await expect.poll(() => logCount(request, 'Activity Log', [['operation', '=', 'login']])).toBeGreaterThan(before)
})

test('PLAT-007: a CSV export writes an Access Log row', async ({ page, request }) => {
  const before = await logCount(request, 'Access Log', [
    ['operation', '=', 'export'],
    ['ref_table', '=', DT],
  ])

  await page.goto(`/admin/${encodeURIComponent(DT)}/view/report`)
  await expect(page.getByTestId('export-csv')).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByTestId('export-csv').click()
  await download

  await expect
    .poll(() =>
      logCount(request, 'Access Log', [
        ['operation', '=', 'export'],
        ['ref_table', '=', DT],
      ]),
    )
    .toBeGreaterThan(before)
})

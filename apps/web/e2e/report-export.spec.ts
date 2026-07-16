import { expect, test, type APIRequestContext } from '@playwright/test'
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'RPT Task'

// RPT-003: downloaded CSV (and XLSX) match the on-screen rows including
// grouping order.

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const token = ((await login.json()) as { token: string }).token
  const auth = { Authorization: `Bearer ${token}` }
  const dt = await request.post('/api/doctype', {
    headers: auth,
    data: {
      name: DT,
      fields: [
        { fieldname: 'title', fieldtype: 'Data', label: 'Title', in_list_view: true },
        { fieldname: 'status', fieldtype: 'Select', label: 'Status', options: 'Open\nClosed', in_list_view: true },
        { fieldname: 'qty', fieldtype: 'Int', label: 'Qty', in_list_view: true },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  const listed = (await (
    await request.get(`/api/resource/${encodeURIComponent(DT)}?limit_page_length=100`, { headers: auth })
  ).json()) as { data: { name: string }[] }
  for (const row of listed.data)
    await request.delete(`/api/resource/${encodeURIComponent(DT)}/${row.name}`, { headers: auth })
  for (const [title, status, qty] of [
    ['alpha', 'Open', 1],
    ['bravo', 'Open', 2],
    ['charlie', 'Closed', 5],
  ] as [string, string, number][]) {
    await request.post(`/api/resource/${encodeURIComponent(DT)}`, {
      headers: auth,
      data: { title, status, qty },
    })
  }
})

test('RPT-003: CSV and XLSX downloads match on-screen rows and grouping order', async ({
  page,
}) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)

  await page.goto(`/desk/${encodeURIComponent(DT)}/view/report`)
  await expect(page.getByTestId('report-row')).toHaveCount(3)
  await page.getByTestId('report-groupby').selectOption('status')
  await expect(page.getByTestId('group-header')).toHaveCount(2)

  // On-screen order: group headers + member titles, top to bottom.
  const screenTitles: string[] = []
  for (const row of await page.getByTestId('report-row').all()) {
    screenTitles.push((await row.locator('td').nth(1).innerText()).trim())
  }
  const screenGroups: string[] = []
  for (const g of await page.getByTestId('group-header').all()) {
    screenGroups.push((await g.getAttribute('data-group'))!)
  }

  // CSV download.
  const [csvDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-csv').click(),
  ])
  const csvPath = await csvDownload.path()
  const csv = readFileSync(csvPath!, 'utf8')
  const lines = csv.split('\n')
  expect(lines[0]).toBe('Name,Title,Status,Qty')

  // Rebuild expected line order from the screen: each group header then its
  // member rows, ending with the grand total.
  const csvTitles = lines
    .slice(1)
    .map((l) => l.split(',')[1])
    .filter((t) => t && t !== '')
  expect(csvTitles).toEqual(screenTitles)

  const groupLines = lines.filter((l) => /^\w+ \(\d+\)/.test(l))
  expect(groupLines.length).toBe(3) // 2 groups + grand total
  expect(groupLines[0].startsWith(`${screenGroups[0]} (`)).toBe(true)
  expect(groupLines[1].startsWith(`${screenGroups[1]} (`)).toBe(true)
  // Sums: Open sum 3, Closed sum 5, grand total 8 — verify the qty column.
  const sums = Object.fromEntries(
    groupLines.map((l) => {
      const cells = l.split(',')
      return [cells[0].split(' (')[0], cells[3]]
    }),
  )
  expect(sums.Open).toBe('3')
  expect(sums.Closed).toBe('5')
  expect(sums.Total).toBe('8')

  // XLSX download parses to the same grid.
  const [xlsxDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-xlsx').click(),
  ])
  const wb = XLSX.read(readFileSync((await xlsxDownload.path())!), { type: 'buffer' })
  const grid = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
  })
  expect(grid[0]).toEqual(['Name', 'Title', 'Status', 'Qty'])
  const xlsxTitles = grid
    .slice(1)
    .map((r) => r[1])
    .filter((t) => t != null && t !== '')
  expect(xlsxTitles).toEqual(screenTitles)
})

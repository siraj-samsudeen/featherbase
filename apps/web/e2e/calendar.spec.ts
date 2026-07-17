import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'Cal DT'

// UI-021: docs appear on their dates; dragging an event updates the date
// field. Dates are chosen inside the current month so the calendar's default
// month shows them.
const now = new Date()
const pad = (n: number) => String(n).padStart(2, '0')
const monthPrefix = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
const DAY_FROM = `${monthPrefix}-10`
const DAY_TO = `${monthPrefix}-20`

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const headers = { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
  const dt = await request.post('/api/doctype', {
    headers,
    data: {
      name: DT,
      autoname: 'prompt',
      fields: [
        { fieldname: 'title', fieldtype: 'Data', in_list_view: true },
        { fieldname: 'due', fieldtype: 'Date', in_list_view: true },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  const listed = (await (await request.get(`/api/resource/${encodeURIComponent(DT)}?limit_page_length=100`, { headers })).json()) as { data: { name: string }[] }
  for (const r of listed.data) await request.delete(`/api/resource/${encodeURIComponent(DT)}/${r.name}`, { headers })
  await request.post(`/api/resource/${encodeURIComponent(DT)}`, { headers, data: { name: 'evt-1', title: 'Deadline', due: DAY_FROM } })
})

test('UI-021: events appear on their date and dragging updates the date field', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)

  await page.goto(`/desk/${encodeURIComponent(DT)}`)
  await page.getByTestId('open-calendar').click()
  await expect(page.getByTestId('calendar-view')).toBeVisible()

  // The event shows on its date cell.
  const fromCell = page.getByTestId(`cal-cell-${DAY_FROM}`)
  const toCell = page.getByTestId(`cal-cell-${DAY_TO}`)
  await expect(fromCell.getByTestId('cal-event')).toHaveCount(1)
  await expect(toCell.getByTestId('cal-event')).toHaveCount(0)

  // Drag the event from the 10th to the 20th.
  const ev = page.locator('[data-event="evt-1"]')
  const evBox = await ev.boundingBox()
  const toBox = await toCell.boundingBox()
  await page.mouse.move(evBox!.x + evBox!.width / 2, evBox!.y + evBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(toBox!.x + toBox!.width / 2, toBox!.y + toBox!.height / 2, { steps: 8 })
  await page.mouse.up()

  await expect(toCell.getByTestId('cal-event')).toHaveCount(1, { timeout: 10_000 })
  await expect(fromCell.getByTestId('cal-event')).toHaveCount(0)

  // The date field changed in the DB.
  const token = await page.evaluate(() => localStorage.getItem('fc_token'))
  const doc = (await (
    await page.request.get(`/api/resource/${encodeURIComponent(DT)}/evt-1`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json()) as { due: string }
  expect(String(doc.due).slice(0, 10)).toBe(DAY_TO)
})

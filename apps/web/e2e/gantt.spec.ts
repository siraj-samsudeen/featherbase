import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'Gantt E2E Project'

async function adminHeaders(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
}

let taskA = ''

test.beforeAll(async ({ request }) => {
  const headers = await adminHeaders(request)
  const dt = await request.post('/api/doctype', {
    headers,
    data: {
      name: DT,
      fields: [
        { fieldname: 'title', fieldtype: 'Data', in_list_view: true },
        { fieldname: 'start_date', fieldtype: 'Date', in_list_view: true },
        { fieldname: 'end_date', fieldtype: 'Date', in_list_view: true },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  const existing = (await (
    await request.get(`/api/resource/${encodeURIComponent(DT)}?limit_page_length=500`, { headers })
  ).json()) as { data: { name: string }[] }
  for (const d of existing.data) await request.delete(`/api/resource/${encodeURIComponent(DT)}/${d.name}`, { headers })

  // Task A: 2026-03-02 → 2026-03-05 (4 days). Task B: 2026-03-04 → 2026-03-06 (3 days).
  const a = await request.post(`/api/resource/${encodeURIComponent(DT)}`, {
    headers,
    data: { title: 'Design', start_date: '2026-03-02', end_date: '2026-03-05' },
  })
  taskA = ((await a.json()) as { name: string }).name
  await request.post(`/api/resource/${encodeURIComponent(DT)}`, {
    headers,
    data: { title: 'Build', start_date: '2026-03-04', end_date: '2026-03-06' },
  })
})

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)
}

test('UI-022: bars span the correct ranges', async ({ page }) => {
  await login(page)
  await page.goto(`/desk/${encodeURIComponent(DT)}/view/gantt`)
  await expect(page.getByTestId('gantt-view')).toBeVisible()

  const barA = page.getByTestId(`gantt-bar-${taskA}`)
  await expect(barA).toHaveAttribute('data-start', '2026-03-02')
  await expect(barA).toHaveAttribute('data-end', '2026-03-05')
  await expect(barA).toHaveAttribute('data-days', '4') // Mar 2,3,4,5

  // The bar's pixel width reflects its span: 4 days × 40px/day = 160px.
  const box = await barA.boundingBox()
  expect(box).not.toBeNull()
  expect(Math.round(box!.width)).toBe(160)
})

test('UI-022: resizing a bar updates the end date', async ({ page }) => {
  await login(page)
  await page.goto(`/desk/${encodeURIComponent(DT)}/view/gantt`)
  const barA = page.getByTestId(`gantt-bar-${taskA}`)
  await expect(barA).toHaveAttribute('data-end', '2026-03-05')

  // Drag the right handle +2 day-columns (80px) → end moves 2026-03-05 → 03-07.
  const handle = page.getByTestId(`gantt-resize-${taskA}`)
  const hb = (await handle.boundingBox())!
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  await page.mouse.move(hb.x + hb.width / 2 + 80, hb.y + hb.height / 2, { steps: 5 })
  await page.mouse.up()

  // The bar re-renders from the persisted date.
  await expect(barA).toHaveAttribute('data-end', '2026-03-07')
  await expect(barA).toHaveAttribute('data-days', '6') // Mar 2..7

  // And the change is persisted server-side.
  const check = await page.request.get(`/api/resource/${encodeURIComponent(DT)}/${taskA}`, {
    headers: { Authorization: `Bearer ${await (async () => {
      const l = await page.request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
      return ((await l.json()) as { token: string }).token
    })()}` },
  })
  expect(((await check.json()) as { end_date: string }).end_date).toContain('2026-03-07')
})

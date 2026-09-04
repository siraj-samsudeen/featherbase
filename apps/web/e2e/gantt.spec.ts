import { test, expect, adminAuth } from './fixtures'

const DT = 'Gantt E2E Project'

let taskA = ''

test.beforeAll(async ({ request }) => {
  const headers = await adminAuth(request)
  const dt = await request.post('/api/table_def', {
    headers,
    data: {
      name: DT,
      columns: [
        { column_name: 'title', column_type: 'Data', in_list_view: true },
        { column_name: 'start_date', column_type: 'Date', in_list_view: true },
        { column_name: 'end_date', column_type: 'Date', in_list_view: true },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  const existing = (await (
    await request.get(`/api/table/${encodeURIComponent(DT)}?limit_page_length=500`, { headers })
  ).json()) as { data: { row_id: string }[] }
  for (const d of existing.data) await request.delete(`/api/table/${encodeURIComponent(DT)}/${d.row_id}`, { headers })

  // Task A: 2026-03-02 → 2026-03-05 (4 days). Task B: 2026-03-04 → 2026-03-06 (3 days).
  const a = await request.post(`/api/table/${encodeURIComponent(DT)}`, {
    headers,
    data: { title: 'Design', start_date: '2026-03-02', end_date: '2026-03-05' },
  })
  taskA = ((await a.json()) as { row_id: string }).row_id
  await request.post(`/api/table/${encodeURIComponent(DT)}`, {
    headers,
    data: { title: 'Build', start_date: '2026-03-04', end_date: '2026-03-06' },
  })
})

test('UI-022: bars span the correct ranges', async ({ page }) => {
  await page.goto(`/admin/${encodeURIComponent(DT)}/view/gantt`)
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
  await page.goto(`/admin/${encodeURIComponent(DT)}/view/gantt`)
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
  const check = await page.request.get(`/api/table/${encodeURIComponent(DT)}/${taskA}`, {
    headers: await adminAuth(page.request),
  })
  expect(((await check.json()) as { end_date: string }).end_date).toContain('2026-03-07')
})

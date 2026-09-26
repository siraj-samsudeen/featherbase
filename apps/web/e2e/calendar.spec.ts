import { test, expect, adminAuth, type APIRequestContext } from './fixtures'

const DT = 'Calendar header responsiveness with a very long Table name'

// UI-021: docs appear on their dates; dragging an event updates the date
// field. Dates are chosen inside the current month so the calendar's default
// month shows them. Migrated to the feather-testing-core DSL
// (docs/testing/e2e-dsl-migration.md): mouse-drag mechanics and the
// date-cell/testid checks around them stay in named steps.
const now = new Date()
const pad = (n: number) => String(n).padStart(2, '0')
const monthPrefix = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
const DAY_FROM = `${monthPrefix}-10`
const DAY_TO = `${monthPrefix}-20`

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const headers = await adminAuth(request)
  const dt = await request.post('/api/table_def', {
    headers,
    data: {
      name: DT,
      id_pattern: 'prompt',
      columns: [
        { column_name: 'title', column_type: 'Data', in_list_view: true },
        { column_name: 'due', column_type: 'Date', in_list_view: true },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  const listed = (await (await request.get(`/api/table/${encodeURIComponent(DT)}?limit_page_length=100`, { headers })).json()) as { data: { row_id: string }[] }
  for (const r of listed.data) await request.delete(`/api/table/${encodeURIComponent(DT)}/${r.row_id}`, { headers })
  await request.post(`/api/table/${encodeURIComponent(DT)}`, { headers, data: { row_id: 'evt-1', title: 'Deadline', due: DAY_FROM } })
})

test('UI-021: events appear on their date and dragging updates the date field', async ({
  session,
}) => {
  await session.visit(`/admin/${encodeURIComponent(DT)}`).clickLink('Calendar').assertHas('[data-testid="calendar-view"]')

  await session
    .within(`[data-testid="cal-cell-${DAY_FROM}"]`, (cell) =>
      cell.assertHas('[data-testid="cal-event"]', { count: 1 }),
    )
    .within(`[data-testid="cal-cell-${DAY_TO}"]`, (cell) =>
      cell.refuteHas('[data-testid="cal-event"]'),
    )

  await session.step('drag the event from the 10th to the 20th', async ({ page }) => {
    const toCell = page.getByTestId(`cal-cell-${DAY_TO}`)
    const ev = page.locator('[data-event="evt-1"]')
    const evBox = await ev.boundingBox()
    const toBox = await toCell.boundingBox()
    await page.mouse.move(evBox!.x + evBox!.width / 2, evBox!.y + evBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(toBox!.x + toBox!.width / 2, toBox!.y + toBox!.height / 2, { steps: 8 })
    await page.mouse.up()

  })
  await session
    .within(`[data-testid="cal-cell-${DAY_TO}"]`, (cell) =>
      cell.assertHas('[data-testid="cal-event"]', { count: 1, timeout: 10_000 }),
    )
    .within(`[data-testid="cal-cell-${DAY_FROM}"]`, (cell) =>
      cell.refuteHas('[data-testid="cal-event"]'),
    )

  await session.step('the date field changed in the DB', async ({ page }) => {
    const token = await page.evaluate(() => localStorage.getItem('fc_token'))
    const doc = (await (
      await page.request.get(`/api/table/${encodeURIComponent(DT)}/evt-1`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as { due: string }
    expect(String(doc.due).slice(0, 10)).toBe(DAY_TO)
  })
})

test.describe('Calendar header responsiveness', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('keeps its long title, month navigation, and List view link reachable on a phone', async ({ session }) => {
    await session
      .visit(`/admin/${encodeURIComponent(DT)}/view/calendar`)
      .assertHas('[data-testid="calendar-view"]')
      .within('h1', (heading) => heading.assertExactText(`${DT} — Calendar`))
      .within('main', (main) =>
        main
          .assertNoHorizontalOverflow()
          .assertHorizontallyContained('h1')
          .assertHorizontallyContained('[data-testid="cal-prev"]')
          .assertHorizontallyContained('[data-testid="cal-next"]')
          .assertHorizontallyContained('[data-testid="cal-to-list"]'),
      )
  })
})

test.describe('Calendar header desktop layout', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('keeps its long title, month navigation, and List view link reachable on desktop', async ({ session }) => {
    await session
      .visit(`/admin/${encodeURIComponent(DT)}/view/calendar`)
      .assertHas('[data-testid="calendar-view"]')
      .within('h1', (heading) => heading.assertExactText(`${DT} — Calendar`))
      .within('main', (main) =>
        main
          .assertNoHorizontalOverflow()
          .assertHorizontallyContained('h1')
          .assertHorizontallyContained('[data-testid="cal-prev"]')
          .assertHorizontallyContained('[data-testid="cal-next"]')
          .assertHorizontallyContained('[data-testid="cal-to-list"]'),
      )
  })
})

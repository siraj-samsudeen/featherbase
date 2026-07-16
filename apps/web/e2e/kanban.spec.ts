import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'Kb DT'

// UI-020: drag a card to another column; the underlying field value changes
// in the DB.

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
        { fieldname: 'stage', fieldtype: 'Select', options: 'Todo\nDoing\nDone', in_list_view: true },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  // Fresh dataset.
  const listed = (await (await request.get(`/api/resource/${encodeURIComponent(DT)}?limit_page_length=100`, { headers })).json()) as { data: { name: string }[] }
  for (const r of listed.data) await request.delete(`/api/resource/${encodeURIComponent(DT)}/${r.name}`, { headers })
  await request.post(`/api/resource/${encodeURIComponent(DT)}`, { headers, data: { name: 'card-a', title: 'Card A', stage: 'Todo' } })
})

test('UI-020: dragging a card to another column updates its field in the DB', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)

  // Reach the Kanban from the list.
  await page.goto(`/desk/${encodeURIComponent(DT)}`)
  await page.getByTestId('open-kanban').click()
  await expect(page.getByTestId('kanban-view')).toBeVisible()

  // Card A starts in Todo.
  const todoCol = page.getByTestId('kanban-column-Todo')
  const doneCol = page.getByTestId('kanban-column-Done')
  await expect(todoCol.getByTestId('kanban-card')).toHaveCount(1)
  await expect(doneCol.getByTestId('kanban-card')).toHaveCount(0)

  // Drag Card A from Todo to Done using pointer events.
  const card = page.locator('[data-card="card-a"]')
  const cardBox = await card.boundingBox()
  const doneBox = await doneCol.boundingBox()
  await page.mouse.move(cardBox!.x + cardBox!.width / 2, cardBox!.y + cardBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(doneBox!.x + doneBox!.width / 2, doneBox!.y + 40, { steps: 8 })
  await page.mouse.up()

  // The card moved on screen…
  await expect(doneCol.getByTestId('kanban-card')).toHaveCount(1, { timeout: 10_000 })
  await expect(todoCol.getByTestId('kanban-card')).toHaveCount(0)

  // …and the field changed in the DB.
  const token = await page.evaluate(() => localStorage.getItem('fc_token'))
  const doc = (await (
    await page.request.get(`/api/resource/${encodeURIComponent(DT)}/card-a`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json()) as { stage: string }
  expect(doc.stage).toBe('Done')
})

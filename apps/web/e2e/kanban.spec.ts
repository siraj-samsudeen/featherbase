import { test, expect, adminAuth, type APIRequestContext } from './fixtures'

const DT = 'Kb DT'

// UI-020: drag a card to another column; the underlying field value changes
// in the DB. Migrated to the feather-testing-core DSL
// (docs/testing/e2e-dsl-migration.md): drag mechanics and DB verification
// aren't expressible by DSL verbs, so they stay in named steps.

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const headers = await adminAuth(request)
  const dt = await request.post('/api/table_def', {
    headers,
    data: {
      name: DT,
      id_pattern: 'prompt',
      columns: [
        { column_name: 'title', column_type: 'Data', in_list_view: true },
        { column_name: 'stage', column_type: 'Choice', choices: 'Todo\nDoing\nDone', in_list_view: true },
      ],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  // Fresh dataset.
  const listed = (await (await request.get(`/api/table/${encodeURIComponent(DT)}?limit_page_length=100`, { headers })).json()) as { data: { row_id: string }[] }
  for (const r of listed.data) await request.delete(`/api/table/${encodeURIComponent(DT)}/${r.row_id}`, { headers })
  await request.post(`/api/table/${encodeURIComponent(DT)}`, { headers, data: { row_id: 'card-a', title: 'Card A', stage: 'Todo' } })
})

test('UI-020: dragging a card to another column updates its field in the DB', async ({
  session,
}) => {
  // Reach the Kanban from the list.
  await session.visit(`/admin/${encodeURIComponent(DT)}`)
  await session.step('reach the Kanban from the list', async ({ page }) => {
    await page.getByTestId('open-kanban').click()
  })
  await session.assertHas('[data-testid="kanban-view"]')

  await session.step('Card A starts in Todo', async ({ page }) => {
    const todoCol = page.getByTestId('kanban-column-Todo')
    const doneCol = page.getByTestId('kanban-column-Done')
    await expect(todoCol.getByTestId('kanban-card')).toHaveCount(1)
    await expect(doneCol.getByTestId('kanban-card')).toHaveCount(0)
  })

  await session.step('drag Card A from Todo to Done using pointer events', async ({ page }) => {
    const todoCol = page.getByTestId('kanban-column-Todo')
    const doneCol = page.getByTestId('kanban-column-Done')
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
  })

  await session.step('…and the field changed in the DB', async ({ page }) => {
    const token = await page.evaluate(() => localStorage.getItem('fc_token'))
    const doc = (await (
      await page.request.get(`/api/table/${encodeURIComponent(DT)}/card-a`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as { stage: string }
    expect(doc.stage).toBe('Done')
  })
})

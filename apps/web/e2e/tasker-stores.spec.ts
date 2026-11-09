import { test, expect, ensureRuntimeApp, admitTaskerAdmin } from './fixtures'

test.beforeAll(async ({ request }) => {
  await ensureRuntimeApp(request, 'tasker')
  await admitTaskerAdmin(request)
})

function day(offset: number) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

test('tasker_store_summary: a store’s overdue count opens its late task, and the task shows its store and dates', async ({ session, request }) => {
  const headers = await ensureRuntimeApp(request, 'tasker')
  // E2E commits real rows, so this run's store has its own name.
  const storeName = `Keelkattalai Store ${Date.now()}`
  const save = async (table: string, row: Record<string, unknown>) => {
    const response = await request.post('/api/save_row', { headers, data: { table, row } })
    expect(response.status()).toBe(201)
    return await response.json() as { row_id: string }
  }
  const store = await save('tasker.store', { store_name: storeName })
  const project = await save('tasker.project', { project_name: `Diwali readiness ${Date.now()}` })
  await save('tasker.task', { task_title: `Reconcile stock variance ${storeName}`, project: project.row_id, store: store.row_id, start_date: day(-6), due_date: day(-2) })
  await save('tasker.task', { task_title: `Roster billing staff ${storeName}`, project: project.row_id, store: store.row_id, start_date: day(3) })

  await session
    .visit('/tasker/')
    .within('.tasker-nav-stores', tab => tab.click('Stores'))
    .assertHas('table[aria-label="Work by store"]', { text: storeName })
    .clickButton(`${storeName}: 1 overdue task`)
    .within(`section[aria-label="${storeName} · Overdue"]`, list => list
      .assertText(`Reconcile stock variance ${storeName}`)
      .refuteText(`Roster billing staff ${storeName}`)
      .click(`Reconcile stock variance ${storeName}`))

  await session.step('the task link opens its details by address', async ({ page }) => {
    await expect(page).toHaveURL(/#task=/)
    const detail = page.getByRole('region', { name: 'Task detail content' })
    await expect(detail.getByRole('combobox', { name: 'Task store' })).toHaveValue(store.row_id)
    await expect(detail.getByLabel('Start date')).toHaveValue(day(-6))
    await expect(detail.getByLabel('Due date')).toHaveValue(day(-2))
    await expect(detail.getByText('Overdue by 2 days')).toBeVisible()
  })
})

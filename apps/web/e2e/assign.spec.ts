import { anonymousTest as test, expect, ADMIN_PWD, adminAuth, loginAs } from './fixtures'

const DT = 'Asg DT'
const ASSIGNEE = 'asg-user@x.com'
const ASSIGNEE_PWD = 'asgpw12345'

let docName = ''

test.beforeAll(async ({ request }) => {
  const headers = await adminAuth(request)
  const dt = await request.post('/api/table_def', {
    headers,
    data: { name: DT, id_pattern: 'prompt', columns: [{ column_name: 'title', column_type: 'Data', in_list_view: true }] },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  // Assignee user needs read on ToDo + this DT to see their list; grant via a role.
  await request.post('/api/save_row', { headers, data: { table: 'Role', row: { row_id: 'Asg Role' } } })
  for (const rd of ['ToDo', DT])
    await request.post('/api/save_row', {
      headers,
      data: { table: 'Permission', row: { ref_table: rd, role: 'Asg Role', tier: 'basic', can_read: true } },
    })
  await request.post('/api/save_row', {
    headers,
    data: { table: 'User', row: { row_id: ASSIGNEE, email: ASSIGNEE, full_name: 'Asg User', roles: [{ role: 'Asg Role' }] } },
  })
  await request.post('/api/set_password', { headers, data: { user: ASSIGNEE, password: ASSIGNEE_PWD } })
  // Clear assignee notifications.
  const notifs = (await (
    await request.get(`/api/table/Notification%20Log?filters=${encodeURIComponent(JSON.stringify([['for_user', '=', ASSIGNEE]]))}&limit_page_length=200`, { headers })
  ).json()) as { data: { row_id: string }[] }
  for (const n of notifs.data) await request.delete(`/api/table/Notification%20Log/${n.row_id}`, { headers })

  docName = `asg-${Date.now()}`
  const doc = await request.post(`/api/table/${encodeURIComponent(DT)}`, { headers, data: { row_id: docName, title: 'assign me' } })
  if (doc.status() !== 201) throw new Error(`row: ${doc.status()}`)
})

test('EML-006: assigning creates a ToDo in the assignee list and notifies them', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const a = await ctxA.newPage()
  const b = await ctxB.newPage()

  await loginAs(a, 'Administrator', ADMIN_PWD)
  await loginAs(b, ASSIGNEE, ASSIGNEE_PWD)

  // B sits in the Admin; wait for realtime to connect.
  await b.goto('/admin')
  await expect(b.getByTestId('session-user')).toBeVisible()
  await b.waitForTimeout(1000)
  await expect(b.getByTestId('unread-count')).toHaveCount(0)

  // A opens the doc and assigns it to B.
  await a.goto(`/admin/${encodeURIComponent(DT)}/${docName}`)
  await a.getByTestId('assign-to').fill(ASSIGNEE)
  await a.getByTestId('assign-submit').click()
  await expect(a.getByTestId('assignee')).toContainText(ASSIGNEE)

  // B's unread badge pops live (RT-003).
  await expect(b.getByTestId('unread-count')).toBeVisible({ timeout: 10_000 })

  // The ToDo is visible in B's ToDo list.
  await b.goto('/admin/ToDo')
  await expect(b.getByTestId('list-rows')).toContainText(ASSIGNEE)
  await expect(b.getByTestId('list-rows')).toContainText(docName)

  await ctxA.close()
  await ctxB.close()
})

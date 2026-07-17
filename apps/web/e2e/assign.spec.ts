import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'Asg DT'
const ASSIGNEE = 'asg-user@x.com'
const ASSIGNEE_PWD = 'asgpw12345'

async function adminAuth(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
}

async function loginAs(page: Page, email: string, pwd: string) {
  await page.goto('/login')
  await page.fill('input[name=email]', email)
  await page.fill('input[name=password]', pwd)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)
}

let docName = ''

test.beforeAll(async ({ request }) => {
  const headers = await adminAuth(request)
  const dt = await request.post('/api/doctype', {
    headers,
    data: { name: DT, autoname: 'prompt', fields: [{ fieldname: 'title', fieldtype: 'Data', in_list_view: true }] },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  // Assignee user needs read on ToDo + this DT to see their list; grant via a role.
  await request.post('/api/save_doc', { headers, data: { doctype: 'Role', doc: { name: 'Asg Role' } } })
  for (const rd of ['ToDo', DT])
    await request.post('/api/save_doc', {
      headers,
      data: { doctype: 'DocPerm', doc: { ref_doctype: rd, role: 'Asg Role', permlevel: 0, can_read: true } },
    })
  await request.post('/api/save_doc', {
    headers,
    data: { doctype: 'User', doc: { name: ASSIGNEE, email: ASSIGNEE, full_name: 'Asg User', roles: [{ role: 'Asg Role' }] } },
  })
  await request.post('/api/set_password', { headers, data: { user: ASSIGNEE, password: ASSIGNEE_PWD } })
  // Clear assignee notifications.
  const notifs = (await (
    await request.get(`/api/resource/Notification%20Log?filters=${encodeURIComponent(JSON.stringify([['for_user', '=', ASSIGNEE]]))}&limit_page_length=200`, { headers })
  ).json()) as { data: { name: string }[] }
  for (const n of notifs.data) await request.delete(`/api/resource/Notification%20Log/${n.name}`, { headers })

  docName = `asg-${Date.now()}`
  const doc = await request.post(`/api/resource/${encodeURIComponent(DT)}`, { headers, data: { name: docName, title: 'assign me' } })
  if (doc.status() !== 201) throw new Error(`doc: ${doc.status()}`)
})

test('EML-006: assigning creates a ToDo in the assignee list and notifies them', async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const a = await ctxA.newPage()
  const b = await ctxB.newPage()

  await loginAs(a, 'Administrator', ADMIN_PWD)
  await loginAs(b, ASSIGNEE, ASSIGNEE_PWD)

  // B sits in the Desk; wait for realtime to connect.
  await b.goto('/desk')
  await expect(b.getByTestId('session-user')).toBeVisible()
  await b.waitForTimeout(1000)
  await expect(b.getByTestId('unread-count')).toHaveCount(0)

  // A opens the doc and assigns it to B.
  await a.goto(`/desk/${encodeURIComponent(DT)}/${docName}`)
  await a.getByTestId('assign-to').fill(ASSIGNEE)
  await a.getByTestId('assign-submit').click()
  await expect(a.getByTestId('assignee')).toContainText(ASSIGNEE)

  // B's unread badge pops live (RT-003).
  await expect(b.getByTestId('unread-count')).toBeVisible({ timeout: 10_000 })

  // The ToDo is visible in B's ToDo list.
  await b.goto('/desk/ToDo')
  await expect(b.getByTestId('list-rows')).toContainText(ASSIGNEE)
  await expect(b.getByTestId('list-rows')).toContainText(docName)

  await ctxA.close()
  await ctxB.close()
})

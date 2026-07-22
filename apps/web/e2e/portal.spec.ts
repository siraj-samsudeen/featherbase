import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'Portal E2E Ticket'
const ROLE = 'Portal E2E User'
const ALICE = 'portal-alice@x.com'
const BOB = 'portal-bob@x.com'
const PWD = 'portalpw12345'

async function token(request: APIRequestContext, usr: string, pwd: string) {
  const r = await request.post('/api/login', { data: { usr, pwd } })
  return ((await r.json()) as { token: string }).token
}

let bobDoc = ''

test.beforeAll(async ({ request }) => {
  const admin = await token(request, 'Administrator', ADMIN_PWD)
  const H = { Authorization: `Bearer ${admin}` }

  const dt = await request.post('/api/doctype', {
    headers: H,
    data: { name: DT, fields: [{ fieldname: 'subject', fieldtype: 'Data', in_list_view: true }] },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)

  await request.post('/api/save_doc', { headers: H, data: { doctype: 'Role', doc: { name: ROLE } } })
  // if_owner grant: website users only ever see/created their own tickets.
  await request.post('/api/save_doc', {
    headers: H,
    data: {
      doctype: 'DocPerm',
      doc: { ref_doctype: DT, role: ROLE, if_owner: true, can_read: true, can_write: true, can_create: true },
    },
  })
  for (const u of [ALICE, BOB]) {
    await request.delete(`/api/resource/User/${encodeURIComponent(u)}`, { headers: H })
    await request.post('/api/save_doc', {
      headers: H,
      data: { doctype: 'User', doc: { name: u, email: u, enabled: true, roles: [{ role: ROLE }] } },
    })
    await request.post('/api/set_password', { headers: H, data: { user: u, password: PWD } })
  }

  // Clear tickets left by an earlier run — the row-count assertion below only
  // holds if Alice owns exactly one. (The users are recreated above, but the
  // documents they own survive.)
  const existing = (await (
    await request.get(`/api/resource/${encodeURIComponent(DT)}?limit=100`, { headers: H })
  ).json()) as { data?: { name: string }[] }
  for (const d of existing.data ?? [])
    await request.delete(`/api/resource/${encodeURIComponent(DT)}/${d.name}`, { headers: H })

  // Each user creates their own ticket (owner = creator).
  const aTok = await token(request, ALICE, PWD)
  await request.post(`/api/resource/${encodeURIComponent(DT)}`, {
    headers: { Authorization: `Bearer ${aTok}` },
    data: { subject: 'Alice cannot log in' },
  })
  const bTok = await token(request, BOB, PWD)
  const b = await request.post(`/api/resource/${encodeURIComponent(DT)}`, {
    headers: { Authorization: `Bearer ${bTok}` },
    data: { subject: 'Bob billing question' },
  })
  bobDoc = ((await b.json()) as { name: string }).name
})

async function loginUI(page: import('@playwright/test').Page, usr: string) {
  await page.goto('/login')
  await page.fill('input[name=email]', usr)
  await page.fill('input[name=password]', PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/(desk|portal)/)
}

test('WEB-003: portal user sees only their own documents', async ({ page }) => {
  await loginUI(page, ALICE)
  await page.goto(`/portal/${encodeURIComponent(DT)}`)

  await expect(page.getByTestId('portal-title')).toContainText(DT)
  await expect(page.getByTestId('portal-user')).toContainText(ALICE)
  // Alice's own ticket is listed; Bob's is not.
  await expect(page.getByTestId('portal-list')).toContainText('Alice cannot log in')
  await expect(page.getByTestId('portal-list')).not.toContainText('Bob billing question')
  await expect(page.getByTestId('portal-row')).toHaveCount(1)
})

test("WEB-003: opening another user's document returns 403", async ({ page }) => {
  await loginUI(page, ALICE)
  // Directly navigate to Bob's ticket — the API denies it (if_owner).
  await page.goto(`/portal/${encodeURIComponent(DT)}/${encodeURIComponent(bobDoc)}`)
  await expect(page.getByTestId('portal-forbidden')).toBeVisible()
  await expect(page.getByTestId('portal-doc')).toHaveCount(0)
})

test('WEB-003: the owner CAN open their own document', async ({ page }) => {
  await loginUI(page, BOB)
  await page.goto(`/portal/${encodeURIComponent(DT)}/${encodeURIComponent(bobDoc)}`)
  await expect(page.getByTestId('portal-doc')).toBeVisible()
  await expect(page.getByTestId('portal-field-subject')).toContainText('Bob billing question')
})

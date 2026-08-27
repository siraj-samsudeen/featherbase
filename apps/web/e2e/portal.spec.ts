import { anonymousTest as test, expect, ADMIN_PWD, loginAs, tokenFor } from './fixtures'

const DT = 'Portal E2E Ticket'
const ROLE = 'Portal E2E User'
const ALICE = 'portal-alice@x.com'
const BOB = 'portal-bob@x.com'
const PWD = 'portalpw12345'
// A website user lands wherever their role allows — /admin or the portal.
const LANDING = /\/(admin|portal)/

let bobDoc = ''

test.beforeAll(async ({ request }) => {
  const admin = await tokenFor(request, 'Administrator', ADMIN_PWD)
  const H = { Authorization: `Bearer ${admin}` }

  const dt = await request.post('/api/table_def', {
    headers: H,
    data: { name: DT, columns: [{ column_name: 'subject', column_type: 'Data', in_list_view: true }] },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)

  await request.post('/api/save_row', { headers: H, data: { table: 'Role', row: { row_id: ROLE } } })
  // own_rows_only grant: website users only ever see/created their own tickets.
  await request.post('/api/save_row', {
    headers: H,
    data: {
      table: 'Permission',
      row: { ref_table: DT, role: ROLE, own_rows_only: true, can_read: true, can_write: true, can_create: true },
    },
  })
  for (const u of [ALICE, BOB]) {
    await request.delete(`/api/table/User/${encodeURIComponent(u)}`, { headers: H })
    await request.post('/api/save_row', {
      headers: H,
      data: { table: 'User', row: { row_id: u, email: u, enabled: true, roles: [{ role: ROLE }] } },
    })
    await request.post('/api/set_password', { headers: H, data: { user: u, password: PWD } })
  }

  // Each user creates their own ticket (owner = creator).
  const aTok = await tokenFor(request, ALICE, PWD)
  await request.post(`/api/table/${encodeURIComponent(DT)}`, {
    headers: { Authorization: `Bearer ${aTok}` },
    data: { subject: 'Alice cannot log in' },
  })
  const bTok = await tokenFor(request, BOB, PWD)
  const b = await request.post(`/api/table/${encodeURIComponent(DT)}`, {
    headers: { Authorization: `Bearer ${bTok}` },
    data: { subject: 'Bob billing question' },
  })
  bobDoc = ((await b.json()) as { row_id: string }).row_id
})

test('WEB-003: portal user sees only their own documents', async ({ page }) => {
  await loginAs(page, ALICE, PWD, LANDING)
  await page.goto(`/portal/${encodeURIComponent(DT)}`)

  await expect(page.getByTestId('portal-title')).toContainText(DT)
  await expect(page.getByTestId('portal-user')).toContainText(ALICE)
  // Alice's own ticket is listed; Bob's is not.
  await expect(page.getByTestId('portal-list')).toContainText('Alice cannot log in')
  await expect(page.getByTestId('portal-list')).not.toContainText('Bob billing question')
  await expect(page.getByTestId('portal-row')).toHaveCount(1)
})

test("WEB-003: opening another user's document returns 403", async ({ page }) => {
  await loginAs(page, ALICE, PWD, LANDING)
  // Directly navigate to Bob's ticket — the API denies it (if_owner).
  await page.goto(`/portal/${encodeURIComponent(DT)}/${encodeURIComponent(bobDoc)}`)
  await expect(page.getByTestId('portal-forbidden')).toBeVisible()
  await expect(page.getByTestId('portal-doc')).toHaveCount(0)
})

test('WEB-003: the owner CAN open their own document', async ({ page }) => {
  await loginAs(page, BOB, PWD, LANDING)
  await page.goto(`/portal/${encodeURIComponent(DT)}/${encodeURIComponent(bobDoc)}`)
  await expect(page.getByTestId('portal-doc')).toBeVisible()
  await expect(page.getByTestId('portal-field-subject')).toContainText('Bob billing question')
})

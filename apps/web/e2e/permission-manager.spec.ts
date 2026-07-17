import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'PM E2E Doc'
const ROLE = 'PM E2E Role'
const USER = 'pm-e2e-user@x.com'
const PWD = 'pme2euser123'

async function adminHeaders(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
}

async function userToken(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: USER, pwd: PWD } })
  return ((await login.json()) as { token: string }).token
}

let seedName: string

test.beforeAll(async ({ request }) => {
  const headers = await adminHeaders(request)
  const dt = await request.post('/api/doctype', {
    headers,
    data: { name: DT, fields: [{ fieldname: 'title', fieldtype: 'Data', in_list_view: true }] },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  await request.post('/api/save_doc', { headers, data: { doctype: 'Role', doc: { name: ROLE } } })
  // Clear any DocPerm rows left by earlier runs so exactly one row exists.
  const existing = (await (
    await request.get(
      `/api/resource/DocPerm?filters=${encodeURIComponent(JSON.stringify([['ref_doctype', '=', DT]]))}&limit_page_length=200`,
      { headers },
    )
  ).json()) as { data: { name: string }[] }
  for (const p of existing.data) await request.delete(`/api/resource/DocPerm/${p.name}`, { headers })
  // Start with read + write + create so the role's user can save.
  await request.post('/api/save_doc', {
    headers,
    data: { doctype: 'DocPerm', doc: { ref_doctype: DT, role: ROLE, can_read: true, can_write: true, can_create: true } },
  })
  await request.post('/api/save_doc', {
    headers,
    data: { doctype: 'User', doc: { name: USER, email: USER, enabled: true, roles: [{ role: ROLE }] } },
  })
  await request.post('/api/set_password', { headers, data: { user: USER, password: PWD } })
  // Seed a document the role's user will try to save (update).
  const seed = await request.post(`/api/resource/${encodeURIComponent(DT)}`, {
    headers,
    data: { title: 'seed' },
  })
  seedName = ((await seed.json()) as { name: string }).name
})

// Updating an existing doc needs write permission — that is the "save ability"
// the verify targets. Loads the doc for its modified stamp, then saves it.
async function trySave(request: APIRequestContext, title: string) {
  const token = await userToken(request)
  const auth = { Authorization: `Bearer ${token}` }
  const doc = (await (
    await request.get(`/api/resource/${encodeURIComponent(DT)}/${seedName}`, { headers: auth })
  ).json()) as { modified: string }
  return request.put(`/api/resource/${encodeURIComponent(DT)}/${seedName}`, {
    headers: auth,
    data: { title, modified: doc.modified },
  })
}

// SET-003: revoking write for a role in the UI immediately removes that role's
// user's ability to save.
test('SET-003: revoking write in the manager UI blocks the role user from saving', async ({ page, request }) => {
  // The role's user CAN save (update) before the change.
  const before = await trySave(request, 'before')
  expect(before.status()).toBe(200)

  // Admin opens the permission manager and unchecks Write for the role.
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)

  await page.goto(`/desk/permissions/${encodeURIComponent(DT)}`)
  await expect(page.getByTestId('permission-manager')).toBeVisible()
  const writeBox = page.getByTestId(`perm-${ROLE}-can_write`)
  await expect(writeBox).toBeChecked()
  await writeBox.uncheck()
  await page.getByTestId('perm-save').click()
  await expect(page.getByTestId('perm-saved')).toBeVisible()

  // The role's user can no longer save — the change took effect immediately.
  const after = await trySave(request, 'after')
  expect(after.status()).toBe(403)

  // Reloading the manager shows the revoked state persisted.
  await page.reload()
  await expect(page.getByTestId(`perm-${ROLE}-can_write`)).not.toBeChecked()
})

import { anonymousTest as test, expect, adminAuth, type Page } from './fixtures'
import type { APIRequestContext } from '@playwright/test'

// #488: two addresses of one instance (playwright.config.ts INSTANCE_ADDRESSES):
// admin.localhost opens Admin, dash.localhost opens Feather Dash, whose interim
// root is the sales target report. A person lands where they can do something,
// handed between the two with a one-time code; each address keeps its own
// sign-in. Runs only against the isolated stack, which lists both names.
const port = process.env.E2E_WEB_PORT ?? '5193' // the isolated web port (playwright.config.ts)
const ADMIN = `http://admin.localhost:${port}`
const DASH = `http://dash.localhost:${port}`
const VIEWER_ROLE = 'Sales Target Viewer'
const PASSWORD = 'addresses-pw-488'

test.skip(process.env.E2E_ISOLATED !== '1', 'needs the isolated stack, whose server lists the two addresses')

async function person(request: APIRequestContext, name: string, roles: string[]): Promise<string> {
  const headers = await adminAuth(request)
  const role = await request.get(`/api/table/Role/${encodeURIComponent(VIEWER_ROLE)}`, { headers })
  if (role.status() !== 200) await request.post('/api/save_row', { headers, data: { table: 'Role', row: { row_id: VIEWER_ROLE } } })
  const email = `${name}.${Date.now()}@example.com`
  const made = await request.post('/api/save_row', {
    headers,
    data: { table: 'Person', row: { email, full_name: name, enabled: true, roles: roles.map((r) => ({ role: r })) } },
  })
  if (made.status() !== 201) throw new Error(`create person: ${made.status()} ${await made.text()}`)
  const { row_id } = (await made.json()) as { row_id: string }
  const set = await request.post('/api/set_password', { headers, data: { user: row_id, password: PASSWORD } })
  if (!set.ok()) throw new Error(`set password: ${set.status()}`)
  return email
}

async function signInAt(page: Page, origin: string, usr: string) {
  await page.goto(`${origin}/featherbase/login`)
  await page.fill('input[name=email]', usr)
  await page.fill('input[name=password]', PASSWORD)
  await page.click('button[type=submit]')
}

test('a report viewer signing in on the admin address lands on the app address', async ({ session, page, request }) => {
  const viewer = await person(request, 'Dash Viewer', [VIEWER_ROLE])
  await session.step('sign in on the admin address', async () => signInAt(page, ADMIN, viewer))
  await session.step('handed to the app address, on its report, signed in there', async () => {
    await expect(page).toHaveURL(`${DASH}/featherbase/sales-target`, { timeout: 15_000 })
    expect(await page.evaluate(() => localStorage.getItem('fc_token'))).toBeTruthy()
  })
})

test('Google sign-in hands a report viewer from the admin address to the app address', async ({ session, page, request }) => {
  const email = await person(request, 'GoogleDashViewer', [VIEWER_ROLE])
  const headers = await adminAuth(request)
  const filters = encodeURIComponent(JSON.stringify([['email', '=', email]]))
  const people = await (await request.get(`/api/table/Person?filters=${filters}`, { headers })).json()
  const invited = await request.post(`/api/people/${people.data[0].row_id}/identities`, {
    headers, data: { method: 'google', email },
  })
  expect(invited.status(), await invited.text()).toBe(201)
  await session.step('approve the invited identity on the mock Google provider', async () => {
    await page.goto(`${ADMIN}/featherbase/login`)
    await page.getByTestId('google-login').click()
    await page.getByTestId('mock-email').fill(email)
    await page.getByTestId('mock-approve').click()
  })
  await session.step('the one-time OAuth session hands off and signs in on the app address', async () => {
    await expect(page).toHaveURL(`${DASH}/featherbase/sales-target`)
    await expect(page.getByTestId('session-user')).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('fc_token'))).toBeTruthy()
    await page.reload()
    await expect(page).toHaveURL(`${DASH}/featherbase/sales-target`)
    await expect(page.getByTestId('session-user')).toBeVisible()
  })
})

test('a System Manager signing in on the admin address stays on it', async ({ session, page, request }) => {
  const manager = await person(request, 'Admin Manager', ['System Manager'])
  await session.step('sign in on the admin address', async () => signInAt(page, ADMIN, manager))
  await session.step('stays in the Admin on the admin address', async () => {
    await expect(page).toHaveURL(new RegExp(`^${ADMIN}/featherbase/admin`), { timeout: 15_000 })
  })
})

test("the app's address sends / and Admin pages to the app's root, as a production server does", async ({ session, page, request }) => {
  // Someone the Admin would let in, so only the address keeps them out of it.
  const both = await person(request, 'Dash Admin Too', ['System Manager', VIEWER_ROLE])
  await session.step('signed in on the app address', async () => {
    await signInAt(page, DASH, both)
    await expect(page).toHaveURL(`${DASH}/featherbase/sales-target`, { timeout: 15_000 })
  })
  await session.step('an Admin page goes to the report', async () => {
    await page.goto(`${DASH}/featherbase/admin/home`)
    await expect(page).toHaveURL(`${DASH}/featherbase/sales-target`)
  })
  await session.step('/ goes to the report', async () => {
    await page.goto(`${DASH}/`)
    await expect(page).toHaveURL(`${DASH}/featherbase/sales-target`)
  })
})

test('signing out on one address ends only that address’s session', async ({ session, page, request }) => {
  // Both: they can use Admin and open the app, so each address keeps them.
  const both = await person(request, 'Both Addresses', ['System Manager', VIEWER_ROLE])
  await session.step('signed in on both addresses', async () => {
    await signInAt(page, ADMIN, both)
    await expect(page).toHaveURL(new RegExp(`^${ADMIN}/featherbase/admin`), { timeout: 15_000 })
    await signInAt(page, DASH, both)
    await expect(page).toHaveURL(`${DASH}/featherbase/sales-target`, { timeout: 15_000 })
  })
  await session.step('sign out on the app address', async () => {
    await page.getByTestId('session-user').click()
    await page.getByTestId('logout').click()
    await expect(page).toHaveURL(new RegExp(`^${DASH}/featherbase/login`))
  })
  await session.step('the app address asks for a sign-in again', async () => {
    await page.goto(`${DASH}/featherbase/sales-target`)
    await expect(page).toHaveURL(new RegExp(`^${DASH}/featherbase/login`))
  })
  await session.step('the admin address is still signed in', async () => {
    await page.goto(`${ADMIN}/featherbase/admin`)
    await expect(page).toHaveURL(new RegExp(`^${ADMIN}/featherbase/admin`))
    await expect(page.locator('input[name=password]')).toHaveCount(0)
  })
})

// #501 item 4: a public web form link opens on the app's address too, signed
// out — never sent to the report and from there to sign-in.
test("a public web form link opens on the app's address, signed out", async ({ session, page, request }) => {
  const headers = await adminAuth(request)
  const table = 'Address Form 501'
  const made = await request.post('/api/table_def', {
    headers,
    data: { name: table, columns: [{ column_name: 'note', label: 'Note', column_type: 'Data', reqd: true }] },
  })
  if (![201, 409].includes(made.status())) throw new Error(`table: ${made.status()}`)
  await request.delete('/api/table/Web%20Form/address-form-501', { headers })
  const form = await request.post('/api/save_row', {
    headers,
    data: { table: 'Web Form', row: { row_id: 'address-form-501', title: 'Address Form', route: 'address-form-501', ref_table: table, web_fields: ['note'], published: true } },
  })
  if (form.status() !== 201) throw new Error(`web form: ${form.status()} ${await form.text()}`)
  await session.step('open the form link on the app address', async () => {
    await page.goto(`${DASH}/featherbase/form/address-form-501`)
  })
  await session.step('the form is shown there, with no sign-in', async () => {
    await expect(page.getByTestId('web-form-title')).toHaveText('Address Form')
    await expect(page).toHaveURL(`${DASH}/featherbase/form/address-form-501`)
    await expect(page.locator('input[name=password]')).toHaveCount(0)
  })
})

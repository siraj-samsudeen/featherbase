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

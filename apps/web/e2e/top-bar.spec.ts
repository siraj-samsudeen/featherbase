import { anonymousTest as test, expect, adminAuth, type Page } from './fixtures'
import type { APIRequestContext } from '@playwright/test'

// #489 (design D3, "One top bar on every address"): the shared top bar on the
// two addresses of one instance (playwright.config.ts INSTANCE_ADDRESSES):
// admin.localhost opens Admin, dash.localhost opens Feather Dash. What jsdom
// cannot show lives here: the hand-off "Open Admin" follows across hosts,
// widths, sideways scroll and real Tab order. Set TOP_BAR_SHOTS to a directory
// to also save reference screenshots of the bar.
const port = process.env.E2E_WEB_PORT ?? '5193'
const ADMIN = `http://admin.localhost:${port}`
const DASH = `http://dash.localhost:${port}`
const VIEWER_ROLE = 'Sales Target Viewer'
const PASSWORD = 'top-bar-pw-489'
const SHOTS = process.env.TOP_BAR_SHOTS

test.skip(process.env.E2E_ISOLATED !== '1', 'needs the isolated stack, whose server lists the two addresses')

async function person(request: APIRequestContext, name: string, roles: string[]): Promise<string> {
  const headers = await adminAuth(request)
  const role = await request.get(`/api/table/Role/${encodeURIComponent(VIEWER_ROLE)}`, { headers })
  if (role.status() !== 200) await request.post('/api/save_row', { headers, data: { table: 'Role', row: { row_id: VIEWER_ROLE } } })
  const email = `${name.toLowerCase().replace(/\s+/g, '.')}.${Date.now()}@example.com`
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

/** Someone who can use Admin and open the app, signed in on the app's address. */
async function onDash(page: Page, request: APIRequestContext, name: string) {
  const both = await person(request, name, ['System Manager', VIEWER_ROLE])
  await signInAt(page, DASH, both)
  await expect(page).toHaveURL(`${DASH}/featherbase/sales-target`, { timeout: 15_000 })
  await expect(page.getByTestId('session-user')).toBeVisible()
  return both
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

test("Open Admin on the app's address reaches the Admin address, signed in there", async ({ session, page, request }) => {
  await onDash(page, request, 'Open Admin')
  await session.step('the bar on the app address is named Feather Dash', async () => {
    await expect(page.getByTestId('top-bar-name')).toHaveText('Feather Dash')
  })
  await session.step('Open Admin hands the person to the Admin address', async () => {
    await page.getByTestId('open-admin').click()
    await expect(page).toHaveURL(new RegExp(`^${ADMIN}/featherbase/admin`), { timeout: 15_000 })
  })
  await session.step('they are signed in there, under the Admin bar', async () => {
    await expect(page.getByTestId('session-user')).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Switch application' })).toHaveValue('/featherbase/admin')
    await expect(page.locator('input[name=password]')).toHaveCount(0)
  })
})

test("the Account menu's Sign-in methods stays on the app's address", async ({ session, page, request }) => {
  await onDash(page, request, 'Dash Methods')
  await session.step('open Sign-in methods from the Account menu', async () => {
    await page.getByTestId('session-user').click()
    await page.getByTestId('account-sign-in-methods').click()
  })
  await session.step('the account page opens on the app address, with the bar and no Admin menus', async () => {
    await expect(page).toHaveURL(`${DASH}/featherbase/account/sign-in-methods`)
    await expect(page.getByTestId('sign-in-methods')).toBeVisible()
    await expect(page.getByTestId('top-bar-name')).toHaveText('Feather Dash')
    await expect(page.getByTestId('awesomebar')).toHaveCount(0)
    await expect(page.getByTestId('notif-bell')).toHaveCount(0)
  })
})

test('the Sign-in methods page is served on the Admin address too', async ({ session, page, request }) => {
  const manager = await person(request, 'Admin Methods', ['System Manager'])
  await signInAt(page, ADMIN, manager)
  await expect(page).toHaveURL(new RegExp(`^${ADMIN}/featherbase/admin`), { timeout: 15_000 })
  await session.step('open the account page from the Account menu', async () => {
    await page.getByTestId('session-user').click()
    await page.getByTestId('account-sign-in-methods').click()
  })
  await session.step('it opens under a bar named Featherbase Admin, with no Admin menus', async () => {
    await expect(page).toHaveURL(`${ADMIN}/featherbase/account/sign-in-methods`)
    await expect(page.getByTestId('top-bar-name')).toHaveText('Featherbase Admin')
    await expect(page.getByTestId('admin-sidebar')).toHaveCount(0)
  })
})

test('signed out, the sign-in page has no bar', async ({ page }) => {
  await page.goto(`${DASH}/featherbase/login`)
  await expect(page.locator('input[name=password]')).toBeVisible()
  await expect(page.getByTestId('top-bar')).toHaveCount(0)
})

test.describe('at 1280px', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('Tab walks the bar in visual order on the app address', async ({ session, page, request }) => {
    await onDash(page, request, 'Tab Order')
    await session.step('from the name: Open Admin, the three theme choices, then the Account menu', async () => {
      await page.getByTestId('top-bar-name').focus()
      const reached: string[] = []
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('Tab')
        reached.push(await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? ''))
      }
      expect(reached).toEqual(['open-admin', 'theme-light', 'theme-dark', 'theme-device', 'session-user'])
    })
    await session.step('Space opens the Account menu; Escape closes it and focus returns to the avatar', async () => {
      await page.keyboard.press('Space')
      await expect(page.getByTestId('account-menu')).toBeVisible()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('account-menu')).toHaveCount(0)
      await expect(page.getByTestId('session-user')).toBeFocused()
    })
  })

  test('the bar is the same frame on both addresses', async ({ session, page, request }) => {
    const both = await onDash(page, request, 'Same Frame')
    const frame = () => page.getByTestId('top-bar').evaluate((el) => {
      const s = getComputedStyle(el)
      return { height: el.getBoundingClientRect().height, padding: s.padding, border: s.borderBottom, background: s.backgroundColor }
    })
    const dash = await frame()
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/dash-1280-light.png` })
    await signInAt(page, ADMIN, both)
    await expect(page).toHaveURL(new RegExp(`^${ADMIN}/featherbase/admin`), { timeout: 15_000 })
    await expect(page.getByTestId('session-user')).toBeVisible()
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-1280-light.png` })
    await session.step('height, padding, border and background match', async () => {
      expect(await frame()).toEqual(dash)
    })
  })
})

test.describe('at 375px', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('on the app address the name stays on one line and nothing scrolls sideways', async ({ session, page, request }) => {
    await onDash(page, request, 'Phone Dash')
    await session.step('one line, no sideways scroll', async () => {
      const name = page.getByTestId('top-bar-name')
      const box = await name.boundingBox()
      expect(box!.height).toBeLessThanOrEqual(56)
      expect(await noSidewaysScroll(page)).toBe(true)
    })
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/dash-375-light.png` })
    await session.step('Open Admin and the theme toggle are in the Account menu, above Sign-in methods', async () => {
      await expect(page.getByTestId('top-bar-right').getByTestId('open-admin')).toHaveCount(0)
      await page.getByTestId('session-user').click()
      const menu = page.getByTestId('account-menu')
      await expect(menu.getByTestId('open-admin')).toBeVisible()
      await expect(menu.getByTestId('theme-toggle')).toBeVisible()
      const y = async (id: string) => (await menu.getByTestId(id).boundingBox())!.y
      expect(await y('open-admin')).toBeLessThan(await y('account-sign-in-methods'))
      expect(await y('theme-toggle')).toBeLessThan(await y('account-sign-in-methods'))
      await page.keyboard.press('Escape')
    })
  })

  test("the bar's row is the same height on both addresses", async ({ session, page, request }) => {
    const both = await onDash(page, request, 'Phone Frame')
    const height = async () => (await page.getByTestId('top-bar').boundingBox())!.height
    const dash = await height()
    await signInAt(page, ADMIN, both)
    await expect(page).toHaveURL(new RegExp(`^${ADMIN}/featherbase/admin`), { timeout: 15_000 })
    await expect(page.getByTestId('session-user')).toBeVisible()
    await session.step('the same height', async () => {
      expect(await height()).toBe(dash)
    })
  })

  test('on the Admin address nothing scrolls sideways', async ({ session, page, request }) => {
    const manager = await person(request, 'Phone Admin', ['System Manager'])
    await signInAt(page, ADMIN, manager)
    await expect(page).toHaveURL(new RegExp(`^${ADMIN}/featherbase/admin`), { timeout: 15_000 })
    await expect(page.getByTestId('session-user')).toBeVisible()
    await session.step('no sideways scroll', async () => {
      expect(await noSidewaysScroll(page)).toBe(true)
    })
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-375-light.png` })
  })
})

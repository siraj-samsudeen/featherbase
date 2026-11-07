import { anonymousTest as test, expect, adminAuth, ensureRuntimeApp, type Page } from './fixtures'
import type { APIRequestContext } from '@playwright/test'
import { createServer, request as httpRequest } from 'node:http'
import { once } from 'node:events'

// #489 (design D3, "One top bar on every address"): the shared top bar on the
// two addresses of one instance (playwright.config.ts INSTANCE_ADDRESSES):
// admin.localhost opens Admin, barproof.localhost opens the bar-proof fixture
// app, which its Bar Reader role alone opens. What jsdom
// cannot show lives here: the hand-off "Open Admin" follows across hosts,
// widths, sideways scroll and real Tab order. Set TOP_BAR_SHOTS to a directory
// to also save reference screenshots of the bar.
const port = process.env.E2E_WEB_PORT ?? '5193'
const ADMIN = `http://admin.localhost:${port}`
const APP = `http://barproof.localhost:${port}`
const ROOT = `${APP}/barproof/`
const ACCOUNT = `${APP}/featherbase/account/sign-in-methods`
const VIEWER_ROLE = 'Bar Reader'
const PASSWORD = 'top-bar-pw-489'
const SHOTS = process.env.TOP_BAR_SHOTS

test.skip(process.env.E2E_ISOLATED !== '1', 'needs the isolated stack, whose server lists the two addresses')

test('the Admin bar remains named and usable when its public brand endpoint fails', async ({ session, page, request }) => {
  const manager = await person(request, 'Brand Outage Manager', ['System Manager'])
  let failures = 0
  // A real HTTP reverse proxy isolates the outage to the public brand endpoint.
  // Every other request reaches the same running application and database.
  const proxy = createServer((incoming, outgoing) => {
    if (incoming.url === '/api/brand') {
      failures++
      outgoing.writeHead(503, { 'content-type': 'text/plain' }).end('Brand temporarily unavailable')
      return
    }
    const upstream = httpRequest(`http://localhost:${port}${incoming.url}`, {
      method: incoming.method, headers: { ...incoming.headers, host: `localhost:${port}` },
    }, (response) => {
      outgoing.writeHead(response.statusCode!, response.headers)
      response.pipe(outgoing)
    })
    upstream.on('error', () => outgoing.writeHead(502).end())
    incoming.pipe(upstream)
  })
  proxy.listen(0, '127.0.0.1')
  await once(proxy, 'listening')
  const address = proxy.address() as { port: number }
  try {
    await session.step('sign in through the proxy while brand is unavailable', async () => {
      await signInAt(page, `http://127.0.0.1:${address.port}`, manager)
      await expect(page.getByTestId('admin-sidebar')).toBeVisible()
      // Login's StrictMode effects plus the bar's initial read and two retries.
      await expect.poll(() => failures).toBeGreaterThanOrEqual(5)
      // With installed apps this is a picker: its textContent includes every
      // option, but the label the person sees is the selected destination.
      await expect.poll(() => page.getByTestId('top-bar-name').evaluate((element) =>
        element instanceof HTMLSelectElement ? element.selectedOptions[0]?.textContent : element.textContent,
      )).toBe('Featherbase')
      await page.getByTestId('session-user').click()
      await expect(page.getByTestId('logout')).toBeVisible()
    })
  } finally {
    proxy.closeAllConnections()
    await new Promise<void>((resolve) => proxy.close(() => resolve()))
  }
})

async function person(request: APIRequestContext, name: string, roles: string[]): Promise<string> {
  const headers = await adminAuth(request)
  // Installing it brings its role.
  await ensureRuntimeApp(request, 'barproof')
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

/** Someone who can use Admin and open the app, signed in on the app's
 *  address and on its account page, the platform page every address serves.
 *  (The app's own pages carry the application dropdown, not Open Admin.) */
async function onApp(page: Page, request: APIRequestContext, name: string) {
  const both = await person(request, name, ['System Manager', VIEWER_ROLE])
  await signInAt(page, APP, both)
  await expect(page).toHaveURL(new RegExp(`^${ROOT}`), { timeout: 15_000 })
  await page.goto(ACCOUNT)
  await expect(page.getByTestId('session-user')).toBeVisible()
  return both
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

test("Open Admin on the app's address reaches the Admin address, signed in there", async ({ session, page, request }) => {
  await onApp(page, request, 'Open Admin')
  await session.step('the bar on the app address is named for the app', async () => {
    await expect(page.getByTestId('top-bar-name')).toHaveText('Bar proof')
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
  await onApp(page, request, 'App Methods')
  await session.step('open Sign-in methods from the Account menu', async () => {
    await page.getByTestId('session-user').click()
    await page.getByTestId('account-sign-in-methods').click()
  })
  await session.step('the account page opens on the app address, with the bar and no Admin menus', async () => {
    await expect(page).toHaveURL(ACCOUNT)
    await expect(page.getByTestId('sign-in-methods')).toBeVisible()
    await expect(page.getByTestId('top-bar-name')).toHaveText('Bar proof')
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
  await session.step('it opens in the Admin frame the person came from (#1006)', async () => {
    await expect(page).toHaveURL(`${ADMIN}/featherbase/account/sign-in-methods`)
    await expect(page.getByTestId('sign-in-methods')).toBeVisible()
    await expect(page.getByTestId('admin-sidebar')).toBeVisible()
  })
})

test('signed out, the sign-in page has no bar', async ({ page }) => {
  await page.goto(`${APP}/featherbase/login`)
  await expect(page.locator('input[name=password]')).toBeVisible()
  await expect(page.getByTestId('top-bar')).toHaveCount(0)
})

test.describe('at 1280px', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('Tab walks the bar in visual order on the app address', async ({ session, page, request }) => {
    await onApp(page, request, 'Tab Order')
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
    const both = await onApp(page, request, 'Same Frame')
    const frame = () => page.getByTestId('top-bar').evaluate((el) => {
      const s = getComputedStyle(el)
      return { height: el.getBoundingClientRect().height, padding: s.padding, border: s.borderBottom, background: s.backgroundColor }
    })
    const onAppFrame = await frame()
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/app-1280-light.png` })
    await signInAt(page, ADMIN, both)
    await expect(page).toHaveURL(new RegExp(`^${ADMIN}/featherbase/admin`), { timeout: 15_000 })
    await expect(page.getByTestId('session-user')).toBeVisible()
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/admin-1280-light.png` })
    await session.step('height, padding, border and background match', async () => {
      expect(await frame()).toEqual(onAppFrame)
    })
  })
})

test.describe('at 375px', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('on the app address the name stays on one line and nothing scrolls sideways', async ({ session, page, request }) => {
    await onApp(page, request, 'Phone App')
    await session.step('one line, no sideways scroll', async () => {
      const name = page.getByTestId('top-bar-name')
      const box = await name.boundingBox()
      expect(box!.height).toBeLessThanOrEqual(56)
      expect(await noSidewaysScroll(page)).toBe(true)
    })
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/app-375-light.png` })
    await session.step('Open Admin and the theme toggle are in the Account menu, above Sign-in methods', async () => {
      await expect(page.getByTestId('top-bar-right').getByTestId('open-admin')).toHaveCount(0)
      await page.getByTestId('session-user').click()
      const menu = page.getByTestId('account-menu')
      await expect(menu.getByTestId('open-admin')).toBeVisible()
      await expect(menu.getByTestId('theme-toggle')).toBeVisible()
      const y = async (id: string) => (await menu.getByTestId(id).boundingBox())!.y
      expect(await y('open-admin')).toBeLessThan(await y('account-sign-in-methods'))
      expect(await y('theme-toggle')).toBeLessThan(await y('account-sign-in-methods'))
    })
    await session.step('nothing in the Account menu wraps onto a second line', async () => {
      const menu = page.getByTestId('account-menu')
      const wrapped = await menu.locator('button, a').evaluateAll((els) =>
        els.filter((el) => {
          const lines = el.getClientRects().length
          const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20
          const text = el.textContent?.trim() ?? ''
          const range = document.createRange()
          range.selectNodeContents(el)
          const textHeight = range.getBoundingClientRect().height
          return text !== '' && (lines > 1 || textHeight > lineHeight * 1.5)
        }).map((el) => el.textContent?.trim()))
      expect(wrapped).toEqual([])
      await page.keyboard.press('Escape')
    })
  })

  test("the bar's row is the same height on both addresses", async ({ session, page, request }) => {
    const both = await onApp(page, request, 'Phone Frame')
    const height = async () => (await page.getByTestId('top-bar').boundingBox())!.height
    const onAppHeight = await height()
    await signInAt(page, ADMIN, both)
    await expect(page).toHaveURL(new RegExp(`^${ADMIN}/featherbase/admin`), { timeout: 15_000 })
    await expect(page.getByTestId('session-user')).toBeVisible()
    await session.step('the same height', async () => {
      expect(await height()).toBe(onAppHeight)
    })
  })

  // #502 follow-up: a long email address on the account page wraps inside its
  // card instead of running under the "End" button.
  test('on the account page a long email address wraps and End stays clickable', async ({ session, page, request }) => {
    const someone = await person(request, 'Averylongfirstname Averylongmiddlename Averylonglastname', [])
    await signInAt(page, ADMIN, someone)
    await expect(page.getByTestId('no-access')).toBeVisible({ timeout: 15_000 })
    await page.goto(`${ADMIN}/featherbase/account/sign-in-methods`)
    const row = page.getByTestId('identifier-group-email').locator('li').first()
    const end = row.getByRole('button', { name: 'End' })
    await expect(end).toBeVisible()
    await session.step('nothing scrolls sideways', async () => {
      expect(await noSidewaysScroll(page)).toBe(true)
    })
    await session.step('the address stays left of End, and End inside its card', async () => {
      const value = (await row.getByText(someone).boundingBox())!
      const button = (await end.boundingBox())!
      const card = (await page.getByTestId('person-identifiers').boundingBox())!
      expect(value.x + value.width).toBeLessThanOrEqual(button.x)
      expect(button.x + button.width).toBeLessThanOrEqual(card.x + card.width)
      await end.click({ trial: true })
    })
    await shot(page, 'item3-admin-address-account-long-email')
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

// #501: a page is named for where the person belongs, and the bar never
// offers to go where the person already is. Each check runs at both widths;
// with TOP_BAR_SHOTS set it also saves a screenshot and the tab's title.
async function shot(page: Page, name: string) {
  if (!SHOTS) return
  const { appendFile } = await import('node:fs/promises')
  const width = page.viewportSize()?.width
  await page.screenshot({ path: `${SHOTS}/${name}-${width}-light.png` })
  await appendFile(`${SHOTS}/titles.txt`, `${name}-${width}-light.png\t${await page.title()}\n`)
}

/** The Account menu's contents at phone width, the bar's at desktop width. */
async function openAdminShown(page: Page, phone: boolean) {
  if (!phone) return page.getByTestId('top-bar-right').getByTestId('open-admin').count()
  await page.getByTestId('session-user').click()
  await expect(page.getByTestId('account-menu')).toBeVisible()
  const count = await page.getByTestId('account-menu').getByTestId('open-admin').count()
  await page.keyboard.press('Escape')
  return count
}

for (const width of [1280, 375]) {
  const phone = width < 640
  test.describe(`#501 at ${width}px`, () => {
    test.use({ viewport: { width, height: phone ? 812 : 800 }, colorScheme: 'light' })

    test('the Admin screens are titled Featherbase', async ({ session, page, request }) => {
      const manager = await person(request, `Admin Title ${width}`, ['System Manager'])
      await signInAt(page, ADMIN, manager)
      await expect(page).toHaveURL(new RegExp(`^${ADMIN}/featherbase/admin`), { timeout: 15_000 })
      await expect(page.getByTestId('session-user')).toBeVisible()
      await session.step('the tab and the logo say Featherbase', async () => {
        await expect(page).toHaveTitle('Featherbase')
        await expect(page.getByRole('link', { name: 'Featherbase', exact: true })).toHaveAttribute('title', 'Featherbase')
      })
      await shot(page, 'item1-admin-address-admin')
    })

    test("on the app's address Open Admin is offered, and the account page keeps the app's name", async ({ session, page, request }) => {
      await onApp(page, request, `App Both ${width}`)
      await session.step('Open Admin is offered on the account page', async () => {
        expect(await openAdminShown(page, phone)).toBe(1)
      })
      await session.step('the account page is named for the app', async () => {
        await expect(page.getByTestId('top-bar-name')).toHaveText('Bar proof')
        await expect(page).toHaveTitle('Bar proof')
      })
      await shot(page, 'item3-app-address-account')
    })

    test('on the Admin address the account page is Featherbase for someone who can use Admin', async ({ session, page, request }) => {
      const manager = await person(request, `Account Admin ${width}`, ['System Manager'])
      await signInAt(page, ADMIN, manager)
      await expect(page).toHaveURL(new RegExp(`^${ADMIN}/featherbase/admin`), { timeout: 15_000 })
      await page.goto(`${ADMIN}/featherbase/account/sign-in-methods`)
      await session.step('bar and tab say Featherbase, with no Open Admin', async () => {
        // Here the name is the Admin shell's switcher: what shows is the chosen option.
        await expect(page.getByTestId('top-bar-name').locator('option:checked')).toHaveText('Featherbase')
        await expect(page).toHaveTitle('Featherbase')
        expect(await openAdminShown(page, phone)).toBe(0)
      })
      await shot(page, 'item3-admin-address-account-admin')
    })

    test("on the Admin address the account page names the app for someone who can open it but not Admin", async ({ session, page, request }) => {
      const viewer = await person(request, `Account Viewer ${width}`, [VIEWER_ROLE])
      await signInAt(page, ADMIN, viewer)
      await expect(page).toHaveURL(new RegExp(`^${ROOT}`), { timeout: 15_000 })
      await page.goto(`${ADMIN}/featherbase/account/sign-in-methods`)
      await session.step('bar and tab name the app', async () => {
        await expect(page.getByTestId('top-bar-name')).toHaveText('Bar proof')
        await expect(page).toHaveTitle('Bar proof')
      })
      await shot(page, 'item3-admin-address-account-viewer')
    })

    test('on the Admin address the account page is Featherbase for someone who can open nothing', async ({ session, page, request }) => {
      const nobody = await person(request, `Account Nobody ${width}`, [])
      await signInAt(page, ADMIN, nobody)
      await expect(page.getByTestId('no-access')).toBeVisible({ timeout: 15_000 })
      await page.goto(`${ADMIN}/featherbase/account/sign-in-methods`)
      await session.step('bar and tab say Featherbase', async () => {
        await expect(page.getByTestId('top-bar-name')).toHaveText('Featherbase')
        await expect(page).toHaveTitle('Featherbase')
      })
      await shot(page, 'item3-admin-address-account-nobody')
    })
  })
}

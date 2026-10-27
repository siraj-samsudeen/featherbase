import { anonymousTest as test, expect, adminAuth, ensureRuntimeApp, type Page } from './fixtures'
import type { APIRequestContext } from '@playwright/test'

// #650 (design D3): an installed app's own pages carry the shared top bar, the
// same TopBar as every other page, drawn by the platform's bar bundle into a
// host the server puts first in the app's document. playwright.config.ts lists
// `barproof.localhost`, which opens the bar-proof fixture app; its page
// (runtime-apps/fixtures/bar-proof/client/index.html) shows the store it read
// from the address on load and the one the bar's `featherbase:bar-change`
// event told it, and pins a box below the bar with `--featherbase-bar-height`.
// Its own styling (a serif face, dark red text on cream) is deliberately unlike
// the bar's. Set APP_BAR_SHOTS to a directory to also save screenshots.
const port = process.env.E2E_WEB_PORT ?? '5193'
const APP = `http://barproof.localhost:${port}`
const PAGE = `${APP}/barproof/`
const ACCOUNT = `${APP}/featherbase/account/sign-in-methods`
const PASSWORD = 'app-bar-pw-650'
const SHOTS = process.env.APP_BAR_SHOTS

test.skip(process.env.E2E_ISOLATED !== '1', 'needs the isolated stack, whose server lists the app address')

const STORES: [string, string][] = [
  ['Hill Road', 'S102'],
  ['Lake View', 'S103'],
  ['Riverside and Station Square Junction', 'S101'],
]

/** A Bar Reader responsible for the stores, with a password. */
async function reader(request: APIRequestContext, name: string): Promise<string> {
  await ensureRuntimeApp(request, 'placeroster')
  await ensureRuntimeApp(request, 'barproof')
  const headers = await adminAuth(request)
  const email = `${name.toLowerCase().replace(/\s+/g, '.')}.${Date.now()}@example.com`
  const made = await request.post('/api/save_row', {
    headers,
    data: { table: 'Person', row: { email, full_name: name, enabled: true, roles: [{ role: 'Bar Reader' }] } },
  })
  if (made.status() !== 201) throw new Error(`create person: ${made.status()} ${await made.text()}`)
  const { row_id } = (await made.json()) as { row_id: string }
  const set = await request.post('/api/set_password', { headers, data: { user: row_id, password: PASSWORD } })
  if (!set.ok()) throw new Error(`set password: ${set.status()}`)
  for (const [place, store] of STORES) {
    const position = await request.post('/api/save_row', {
      headers,
      data: { table: 'placeroster.position', row: { row_id: `${row_id}-${store}`, person: row_id, place, store, section: 'all' } },
    })
    if (position.status() !== 201) throw new Error(`position: ${position.status()} ${await position.text()}`)
  }
  return email
}

/** Signed in on the app's address, on the app's own page. */
async function onAppPage(page: Page, usr: string) {
  await page.goto(`${APP}/featherbase/login`)
  await page.fill('input[name=email]', usr)
  await page.fill('input[name=password]', PASSWORD)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL(new RegExp(`^${APP}/barproof/`), { timeout: 15_000 })
  await expect(page.locator('#bar-proof-page')).toBeVisible()
  await expect(page.getByTestId('session-user')).toBeVisible()
}

const bar = (page: Page) => page.getByTestId('top-bar')
const picker = (page: Page) => page.getByRole('combobox', { name: 'Store' })
const box = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())!
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
/** What a bar looks like, to compare the app page's bar with the account page's. */
const barLook = (page: Page) =>
  bar(page).evaluate((el) => {
    const s = getComputedStyle(el)
    return { height: Math.round(el.getBoundingClientRect().height), background: s.backgroundColor, border: s.borderBottomColor, font: s.fontFamily }
  })

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`at 1280px, ${scheme}`, () => {
    test.use({ viewport: { width: 1280, height: 800 }, colorScheme: scheme })

    test("the app's page carries the shared bar: the app's name, its picker, the theme and the Account menu", async ({ session, page, request }) => {
      await onAppPage(page, await reader(request, `Bar Page ${scheme}`))
      await session.step('left to right: name, picker, then theme, Account', async () => {
        await expect(page.getByTestId('top-bar-name')).toHaveText('Bar proof')
        const order = [
          (await box(page, 'top-bar-name')).x,
          (await picker(page).boundingBox())!.x,
          (await box(page, 'theme-toggle')).x,
          (await box(page, 'session-user')).x,
        ]
        expect(order).toEqual([...order].sort((a, b) => a - b))
      })
      // #659 (owner decision, 28-Oct-2026): a Bar Reader reads only the app's
      // own Tables, which do not open the Admin, so the bar offers none.
      await session.step('no Open Admin for a person who only reads the app', async () => {
        await expect(bar(page).getByTestId('open-admin')).toHaveCount(0)
      })
      await session.step('no app switcher, and nothing left of the old header', async () => {
        await expect(page.getByRole('combobox', { name: 'Switch application' })).toHaveCount(0)
        await expect(page.locator('[data-testid="runtime-shell"]')).toHaveCount(0)
      })
      await session.step('the Account menu holds Sign-in methods and Log out', async () => {
        await page.getByTestId('session-user').click()
        await expect(page.getByTestId('account-sign-in-methods')).toBeVisible()
        await expect(page.getByTestId('logout')).toBeVisible()
        if (SHOTS && scheme === 'light') await page.screenshot({ path: `${SHOTS}/app-bar-1280-menu-${scheme}.png` })
        await page.keyboard.press('Escape')
      })
      await session.step('it looks the same as the bar on the account page', async () => {
        const here = await barLook(page)
        await page.goto(ACCOUNT)
        await expect(page.getByTestId('account-layout')).toBeVisible()
        // #659: measured once the bar has settled, as it was on the app's page
        // (its name, picker and Account avatar drawn). Open Admin used to hold
        // the bar's height while the rest loaded; a Bar Reader no longer has it.
        await expect(page.getByTestId('session-user')).toBeVisible()
        await expect(picker(page)).toBeVisible()
        expect(await barLook(page)).toEqual(here)
      })
    })

    test("the app's content sits below the bar, full width, and the bar stays at the top as the page scrolls", async ({ session, page, request }) => {
      await onAppPage(page, await reader(request, `Bar Layout ${scheme}`))
      if (SHOTS && scheme === 'light') await page.screenshot({ path: `${SHOTS}/app-bar-1280-${scheme}.png` })
      await session.step('the app starts below the bar and spans the window', async () => {
        const top = await box(page, 'top-bar')
        const content = (await page.locator('#bar-proof-page').boundingBox())!
        expect(content.y).toBeGreaterThanOrEqual(top.y + top.height - 1)
        expect([Math.round(content.x), Math.round(content.width)]).toEqual([0, 1280])
      })
      await session.step('a box the app pins below the bar is not covered by it', async () => {
        const top = await box(page, 'top-bar')
        const pinned = (await page.locator('#pinned-under-bar').boundingBox())!
        expect(pinned.y).toBeGreaterThanOrEqual(top.y + top.height - 1)
      })
      await session.step('scrolled to the end, the bar is still at the top', async () => {
        await page.locator('#page-end').scrollIntoViewIfNeeded()
        expect((await box(page, 'top-bar')).y).toBe(0)
        const end = (await page.locator('#page-end').boundingBox())!
        expect(end.y).toBeGreaterThanOrEqual((await box(page, 'top-bar')).height - 1)
      })
    })

    test("the bar follows the person's theme, and the app's page keeps its own styling", async ({ session, page, request }) => {
      await onAppPage(page, await reader(request, `Bar Theme ${scheme}`))
      await session.step(`the bar is ${scheme}`, async () => {
        const background = await bar(page).evaluate((el) => getComputedStyle(el).backgroundColor)
        const [r, g, b] = background.match(/\d+/g)!.map(Number)
        const light = (r + g + b) / 3 > 128
        expect(light).toBe(scheme === 'light')
      })
      await session.step("the app's page is untouched: its colours, its face, its own theme on its root", async () => {
        const app = await page.evaluate(() => {
          const s = getComputedStyle(document.body)
          return { background: s.backgroundColor, color: s.color, serif: s.fontFamily.includes('Georgia'), theme: document.documentElement.getAttribute('data-theme') }
        })
        expect(app).toEqual({ background: 'rgb(250, 245, 230)', color: 'rgb(120, 20, 20)', serif: true, theme: 'app-owned' })
      })
      await session.step('switching the theme in the bar repaints the bar only', async () => {
        const other = scheme === 'light' ? 'dark' : 'light'
        await page.getByTestId(`theme-${other}`).click()
        const background = await bar(page).evaluate((el) => getComputedStyle(el).backgroundColor)
        const [r, g, b] = background.match(/\d+/g)!.map(Number)
        expect((r + g + b) / 3 > 128).toBe(other === 'light')
        expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(250, 245, 230)')
        await page.getByTestId('theme-device').click()
      })
    })

    test('a choice in the bar reaches the app, through the address and the bar-change event, without a reload', async ({ session, page, request }) => {
      await onAppPage(page, await reader(request, `Bar Choice ${scheme}`))
      await page.evaluate(() => ((window as unknown as { b650: boolean }).b650 = true))
      await session.step('choosing Lake View writes ?store=S103 and the app hears S103', async () => {
        await picker(page).click()
        await page.getByRole('option', { name: 'Lake View' }).click()
        await expect(page).toHaveURL(`${PAGE}?store=S103`)
        await expect(page.locator('#store-from-event')).toHaveText('S103')
        expect(await page.evaluate(() => (window as unknown as { b650?: boolean }).b650)).toBe(true)
      })
      await session.step('a refresh keeps it: the app reads it from the address, the picker shows it', async () => {
        await page.reload()
        await expect(page.locator('#store-on-load')).toHaveText('S103')
        await expect(picker(page)).toHaveText('Lake View')
      })
    })
  })

  test.describe(`at 375px, ${scheme}`, () => {
    test.use({ viewport: { width: 375, height: 812 }, colorScheme: scheme })

    test('the bar keeps its phone layout and nothing scrolls sideways', async ({ session, page, request }) => {
      await onAppPage(page, await reader(request, `Bar Phone ${scheme}`))
      await page.goto(`${PAGE}?store=S101`)
      await expect(picker(page)).toHaveText('Riverside and Station Square Junction')
      await session.step('the label is hidden, the value is cut to fit, the theme moves into the menu', async () => {
        expect(await page.getByTestId('top-bar').getByText('Store', { exact: true }).evaluate((el) => el.getBoundingClientRect().width)).toBeLessThanOrEqual(1)
        expect((await picker(page).boundingBox())!.width).toBeLessThanOrEqual(180)
        await expect(bar(page).getByTestId('theme-toggle')).toHaveCount(0)
        await page.getByTestId('session-user').click()
        await expect(page.getByTestId('account-menu').getByTestId('theme-toggle')).toBeVisible()
        // #659: no Open Admin in the menu either, for a person who only reads the app.
        await expect(page.getByTestId('account-menu').getByTestId('open-admin')).toHaveCount(0)
        if (SHOTS && scheme === 'light') await page.screenshot({ path: `${SHOTS}/app-bar-375-menu-${scheme}.png` })
        await page.keyboard.press('Escape')
      })
      await session.step('nothing scrolls sideways, closed or open', async () => {
        expect(await noSidewaysScroll(page)).toBe(true)
        if (SHOTS && scheme === 'light') await page.screenshot({ path: `${SHOTS}/app-bar-375-${scheme}.png` })
        await picker(page).click()
        await expect(page.getByRole('listbox', { name: 'Store' })).toBeVisible()
        expect(await noSidewaysScroll(page)).toBe(true)
      })
      await session.step("the app's content starts below the bar", async () => {
        await page.keyboard.press('Escape')
        const top = await box(page, 'top-bar')
        expect((await page.locator('#bar-proof-page').boundingBox())!.y).toBeGreaterThanOrEqual(top.y + top.height - 1)
      })
      await session.step('it looks the same as the bar on the account page', async () => {
        const here = await barLook(page)
        await page.goto(ACCOUNT)
        await expect(page.getByTestId('account-layout')).toBeVisible()
        // #659: measured once the bar has settled, as it was on the app's page
        // (its name, picker and Account avatar drawn). Open Admin used to hold
        // the bar's height while the rest loaded; a Bar Reader no longer has it.
        await expect(page.getByTestId('session-user')).toBeVisible()
        await expect(picker(page)).toBeVisible()
        expect(await barLook(page)).toEqual(here)
      })
    })
  })
}

// Owner decision, 27-Oct-2026: a page opened with no choice, or a choice that is
// not the reader's, gets the first store written into its address in place.
for (const [what, query] of [['no store', ''], ['a store that is not theirs', '?store=S999']]) {
  test.describe(`opened with ${what}`, () => {
    test.use({ viewport: { width: 1280, height: 800 } })

    test('the first store is written into the address in place, and Back goes to the page before', async ({ session, page, request }) => {
      await onAppPage(page, await reader(request, `Bar Fill ${query ? 'Unknown' : 'None'}`))
      await page.goto(ACCOUNT)
      await expect(page.getByTestId('account-layout')).toBeVisible()
      await session.step('the app page gets ?store=S102, and the app hears S102', async () => {
        await page.goto(`${PAGE}${query}`)
        await expect(page).toHaveURL(`${PAGE}?store=S102`)
        await expect(page.locator('#store-from-event')).toHaveText('S102')
        await expect(picker(page)).toHaveText('Hill Road')
      })
      await session.step('Back returns to the account page, not to the page without a choice', async () => {
        await page.goBack()
        await expect(page).toHaveURL(new RegExp(`^${ACCOUNT}`))
        await expect(page.getByTestId('account-layout')).toBeVisible()
      })
    })
  })
}

test('signed out, an app page still sends the person to sign in', async ({ page }) => {
  await page.goto(`${PAGE}?store=S103`)
  await expect(page).toHaveURL(`${APP}/featherbase/login?next=${encodeURIComponent('/barproof/?store=S103')}`)
})

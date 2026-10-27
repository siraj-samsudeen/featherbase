import { anonymousTest as test, expect, adminAuth, ensureRuntimeApp, type Page } from './fixtures'
import type { APIRequestContext } from '@playwright/test'

// #642 (design E8): the top-bar picker an app declares, on that app's own
// address. playwright.config.ts lists `barproof.localhost`, which opens the
// bar-proof fixture app; its `stores` read answers the reader's places from the
// place-roster fixture. The bar is drawn by the platform's shared top bar; on
// an installed app's address the page that carries it is the account page
// every address serves. What jsdom cannot show lives here: real widths,
// sideways scroll, the focus ring, a refresh and the browser's back button.
// Set PICKER_SHOTS to a directory to also save reference screenshots.
// The two fixture apps stay installed and enabled afterwards: disabling an app
// currently breaks global search for everyone (#648).
const port = process.env.E2E_WEB_PORT ?? '5193'
const APP = `http://barproof.localhost:${port}`
const ACCOUNT = `${APP}/featherbase/account/sign-in-methods`
const PASSWORD = 'bar-picker-pw-642'
const SHOTS = process.env.PICKER_SHOTS

test.skip(process.env.E2E_ISOLATED !== '1', 'needs the isolated stack, whose server lists the app address')

// Made-up places, listed in the order the roster's read answers them (by name).
const STORES: [string, string][] = [
  ['Hill Road', 'S102'],
  ['Lake View', 'S103'],
  ['Riverside and Station Square Junction', 'S101'],
]

/** A Bar Reader responsible for `places`, with a password. */
async function reader(request: APIRequestContext, name: string, places: [string, string][]): Promise<string> {
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
  for (const [place, store] of places) {
    const position = await request.post('/api/save_row', {
      headers,
      data: { table: 'placeroster.position', row: { row_id: `${row_id}-${store}`, person: row_id, place, store, section: 'all' } },
    })
    if (position.status() !== 201) throw new Error(`position: ${position.status()} ${await position.text()}`)
  }
  return email
}

/** Signed in on the app's address, on the account page under the shared bar. */
async function onAppAddress(page: Page, usr: string) {
  await page.goto(`${APP}/featherbase/login`)
  await page.fill('input[name=email]', usr)
  await page.fill('input[name=password]', PASSWORD)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL(new RegExp(`^${APP}/barproof/`), { timeout: 15_000 })
  await page.goto(ACCOUNT)
  await expect(page.getByTestId('session-user')).toBeVisible()
}

const picker = (page: Page) => page.getByRole('combobox', { name: 'Store' })
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const focusRing = (page: Page) =>
  picker(page).evaluate((el) => {
    const s = getComputedStyle(el)
    return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) }
  })

test.describe('at 1280px', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test("the picker sits in the bar after the app's name, offering the reader's own stores", async ({ session, page, request }) => {
    await onAppAddress(page, await reader(request, 'Picker Places', STORES))
    await session.step('labelled Store, between the name and the Account menu', async () => {
      await expect(page.getByTestId('top-bar').getByText('Store', { exact: true })).toBeVisible()
      const x = async (testId: string) => (await page.getByTestId(testId).boundingBox())!.x
      const at = (await picker(page).boundingBox())!.x
      expect(at).toBeGreaterThan(await x('top-bar-name'))
      expect(at).toBeLessThan(await x('session-user'))
    })
    await session.step("the label follows the app's name closely, as in the approved mockup", async () => {
      const name = (await page.getByTestId('top-bar-name').boundingBox())!
      const label = (await page.getByTestId('top-bar').getByText('Store', { exact: true }).boundingBox())!
      expect(label.x - (name.x + name.width)).toBeLessThanOrEqual(32)
    })
    await session.step('opened, it lists exactly the reader\'s stores, in the read\'s order', async () => {
      await picker(page).click()
      await expect(page.getByRole('listbox', { name: 'Store' }).getByRole('option')).toHaveText(STORES.map(([place]) => place))
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/picker-1280-open-light.png` })
    })
  })

  test('the choice is kept in the address, without a full reload', async ({ session, page, request }) => {
    await onAppAddress(page, await reader(request, 'Picker Address', STORES))
    await page.evaluate(() => ((window as unknown as { b5ui642: boolean }).b5ui642 = true))
    await session.step('choosing Lake View puts ?store=S103 in the address, in the same document', async () => {
      await picker(page).click()
      await page.getByRole('option', { name: 'Lake View' }).click()
      await expect(page).toHaveURL(`${ACCOUNT}?store=S103`)
      expect(await page.evaluate(() => (window as unknown as { b5ui642?: boolean }).b5ui642)).toBe(true)
    })
    await session.step('a refresh keeps it', async () => {
      await page.reload()
      await expect(picker(page)).toHaveText('Lake View')
    })
    await session.step('back steps through the earlier choices', async () => {
      await picker(page).click()
      await page.getByRole('option', { name: 'Hill Road' }).click()
      await expect(page).toHaveURL(`${ACCOUNT}?store=S102`)
      await page.goBack()
      await expect(page).toHaveURL(`${ACCOUNT}?store=S103`)
      await expect(picker(page)).toHaveText('Lake View')
    })
  })

  test('the keyboard reaches the picker, chooses with the arrows and Enter, and Escape closes it', async ({ session, page, request }) => {
    await onAppAddress(page, await reader(request, 'Picker Keys', STORES))
    await session.step('Tab from the name reaches the picker, which shows a focus ring', async () => {
      await expect(picker(page)).toBeVisible()
      await page.getByTestId('top-bar-name').focus()
      await page.keyboard.press('Tab')
      await expect(picker(page)).toBeFocused()
      const ring = await focusRing(page)
      expect(ring.style).not.toBe('none')
      expect(ring.width).toBeGreaterThanOrEqual(2)
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/picker-1280-focus-light.png` })
    })
    await session.step('ArrowDown opens the list; Escape closes it and keeps focus', async () => {
      await page.keyboard.press('ArrowDown')
      await expect(page.getByRole('listbox', { name: 'Store' })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('listbox', { name: 'Store' })).toBeHidden()
      await expect(picker(page)).toBeFocused()
    })
    await session.step('ArrowDown, ArrowDown, Enter chooses the second store', async () => {
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(`${ACCOUNT}?store=S103`)
      await expect(page.getByRole('listbox', { name: 'Store' })).toBeHidden()
    })
  })

  test('the focus ring shows in the dark theme too', async ({ session, page, request }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await onAppAddress(page, await reader(request, 'Picker Dark', STORES))
    await session.step('the focused picker has a ring', async () => {
      await expect(picker(page)).toBeVisible()
      await page.getByTestId('top-bar-name').focus()
      await page.keyboard.press('Tab')
      await expect(picker(page)).toBeFocused()
      const ring = await focusRing(page)
      expect(ring.style).not.toBe('none')
      expect(ring.width).toBeGreaterThanOrEqual(2)
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/picker-1280-focus-dark.png` })
    })
  })

  test('with one store the bar shows it as plain text, with no picker', async ({ session, page, request }) => {
    await onAppAddress(page, await reader(request, 'Picker One', [['Hill Road', 'S102']]))
    await session.step('the store is shown, and there is nothing to open', async () => {
      await expect(page.getByTestId('top-bar').getByText('Hill Road')).toBeVisible()
      await expect(picker(page)).toHaveCount(0)
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/picker-1280-one-light.png` })
    })
  })

  test('with no stores the control is not shown', async ({ session, page, request }) => {
    await onAppAddress(page, await reader(request, 'Picker None', []))
    await session.step('the bar has no Store control', async () => {
      await page.waitForLoadState('networkidle')
      await expect(page.getByTestId('top-bar').getByText('Store', { exact: true })).toHaveCount(0)
    })
  })
})

test.describe('at 375px', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('the picker stays in the bar: the label hides, the value stays, nothing scrolls sideways', async ({ session, page, request }) => {
    await onAppAddress(page, await reader(request, 'Picker Phone', STORES))
    await page.goto(`${ACCOUNT}?store=S101`)
    await session.step('the value is shown inside the bar, cut to fit', async () => {
      await expect(picker(page)).toHaveText('Riverside and Station Square Junction')
      const bar = (await page.getByTestId('top-bar').boundingBox())!
      const box = (await picker(page).boundingBox())!
      expect(box.y).toBeGreaterThanOrEqual(bar.y)
      expect(box.y + box.height).toBeLessThanOrEqual(bar.y + bar.height)
      expect(box.width).toBeLessThanOrEqual(180)
    })
    await session.step('the label is visually hidden and still names the picker', async () => {
      const label = page.getByTestId('top-bar').getByText('Store', { exact: true })
      expect(await label.evaluate((el) => el.getBoundingClientRect().width)).toBeLessThanOrEqual(1)
      await expect(picker(page)).toHaveAccessibleName('Store')
    })
    await session.step('nothing scrolls sideways, closed or open', async () => {
      expect(await noSidewaysScroll(page)).toBe(true)
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/picker-375-closed-light.png` })
      await picker(page).click()
      const list = page.getByRole('listbox', { name: 'Store' })
      await expect(list).toBeVisible()
      expect(await noSidewaysScroll(page)).toBe(true)
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/picker-375-open-light.png` })
      const box = (await list.boundingBox())!
      expect([box.x >= 0, box.x + box.width <= 375]).toEqual([true, true])
    })
  })

  // Verifier, round 1 on #649: on a phone the control follows the name, and the
  // free space comes after it, as in the approved mockup.
  test("the picker follows the app's name, with the free space after it", async ({ session, page, request }) => {
    await onAppAddress(page, await reader(request, 'Picker Phone Near', STORES))
    await session.step('the picker starts within 32px of the end of the name', async () => {
      expect(await gapAfterName(page, picker(page))).toBeLessThanOrEqual(32)
    })
  })

  test("one store, shown as plain text, follows the app's name", async ({ session, page, request }) => {
    await onAppAddress(page, await reader(request, 'Picker Phone One', [['Hill Road', 'S102']]))
    await session.step('the store starts within 32px of the end of the name', async () => {
      expect(await gapAfterName(page, page.getByTestId('top-bar').getByText('Hill Road'))).toBeLessThanOrEqual(32)
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/picker-375-one-light.png` })
    })
  })
})

/** From the right edge of the app's name to the left edge of `control`. */
async function gapAfterName(page: Page, control: ReturnType<Page['getByText']>) {
  await expect(control).toBeVisible()
  const name = (await page.getByTestId('top-bar-name').boundingBox())!
  return (await control.boundingBox())!.x - (name.x + name.width)
}

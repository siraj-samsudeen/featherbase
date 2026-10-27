import { anonymousTest as test, expect, adminAuth, type Page } from './fixtures'
import type { APIRequestContext, Route } from '@playwright/test'

// #500: when the live report cannot be opened, the Sales Target page says one
// plain sentence and offers "Try again", which reopens the report without a
// page reload. The failure is forced at the browser's network edge: the
// embed-session answer is the server's real 502 shape, and the embed origin is
// answered locally, so nothing leaves this machine. What jsdom cannot show
// lives here: real widths, sideways scroll and the busy button. Set
// SALES_TARGET_500_SHOTS to a directory to also save screenshots of the card.
const VIEWER_ROLE = 'Sales Target Viewer'
const PASSWORD = 'unavailable-pw-500'
const SHOTS = process.env.SALES_TARGET_500_SHOTS
const PLAIN = "The report couldn't load right now. Try again in a few minutes."
const PLAIN_NUMBERS = "The numbers couldn't load right now. Try again in a few minutes."
const SERVER_WORDING = 'embed API answered HTTP 500: Internal server error'

// The page's identity call reads this Table; a fresh e2e database has it only once the sales-target
// seed ran, so it is created here the way that seed does (apps/server/src/sales-target.ts). The
// reader gets no rows in it: the embed-session answer is scripted below either way.
const ASSIGNMENT_TABLE_DEF = {
  name: 'Sales Target Assignment',
  module: 'Sales Target',
  columns: [
    { column_name: 'employee', column_type: 'Reference', reference_table: 'Person', reqd: true, in_list_view: true },
    { column_name: 'plant_code', column_type: 'Data', reqd: true, in_list_view: true },
    { column_name: 'store_label', column_type: 'Data', in_list_view: true },
    { column_name: 'material_group', label: 'Subcategory', column_type: 'Data', reqd: true, in_list_view: true },
    { column_name: 'store_subcategory', column_type: 'Data', unique: true, read_only: true, in_list_view: true },
  ],
}

async function viewer(request: APIRequestContext): Promise<string> {
  const headers = await adminAuth(request)
  const meta = await request.get(`/api/table/${encodeURIComponent(ASSIGNMENT_TABLE_DEF.name)}:meta`, { headers })
  if (meta.status() === 404) {
    const made = await request.post('/api/table_def', { headers, data: ASSIGNMENT_TABLE_DEF })
    if (!made.ok()) throw new Error(`create assignment table: ${made.status()} ${await made.text()}`)
  }
  const role = await request.get(`/api/table/Role/${encodeURIComponent(VIEWER_ROLE)}`, { headers })
  if (role.status() !== 200) await request.post('/api/save_row', { headers, data: { table: 'Role', row: { row_id: VIEWER_ROLE } } })
  const email = `report.unavailable.${Date.now()}@example.com`
  const made = await request.post('/api/save_row', {
    headers,
    data: { table: 'Person', row: { email, full_name: 'Report Reader', enabled: true, roles: [{ role: VIEWER_ROLE }] } },
  })
  if (made.status() !== 201) throw new Error(`create person: ${made.status()} ${await made.text()}`)
  const { row_id } = (await made.json()) as { row_id: string }
  const set = await request.post('/api/set_password', { headers, data: { user: row_id, password: PASSWORD } })
  if (!set.ok()) throw new Error(`set password: ${set.status()}`)
  return email
}

/** Answers the page's embed-session calls in order; a held answer waits until released. */
async function scriptEmbedSession(page: Page) {
  const calls: Route[] = []
  await page.route('**/api/sales_target/embed_session**', (route) => {
    calls.push(route)
  })
  // The frame opens `<embed origin>/sandbox/`; answered here whatever origin the server names.
  await page.route('**/sandbox/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stub</title><p>stub report</p>' }),
  )
  const fail = (route: Route) =>
    route.fulfill({
      status: 502,
      json: { error: { type: 'EmbedSessionError', message: SERVER_WORDING, upstream_status: 500 } },
    })
  const succeed = (route: Route) => route.fulfill({ json: { session: 'stub-session' } })
  return { calls, fail, succeed }
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

for (const width of [1280, 375]) {
  test(`at ${width}px the unavailable card is plain, and Try again reopens the report in place`, async ({ session, page, request }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 800 })
    await page.emulateMedia({ colorScheme: 'light' })
    const embed = await scriptEmbedSession(page)
    const card = page.getByTestId('embed-state')
    const button = card.getByRole('button', { name: 'Try again' })

    await session.step('a viewer opens the report and the live report fails', async () => {
      const email = await viewer(request)
      await page.goto('/login')
      await page.fill('input[name=email]', email)
      await page.fill('input[name=password]', PASSWORD)
      await page.click('button[type=submit]')
      await expect(page).toHaveURL(/\/sales-target$/, { timeout: 15_000 })
      await expect.poll(() => embed.calls.length).toBe(1)
      await embed.fail(embed.calls[0])
    })

    await session.step('the card says one plain sentence, with no server wording', async () => {
      await expect(card).toHaveAttribute('data-state', 'error')
      await expect(card).toContainText('Report unavailable')
      await expect(card).toContainText(PLAIN)
      await expect(page.locator('body')).not.toContainText(SERVER_WORDING)
      await expect(page.locator('body')).not.toContainText('HTTP')
      expect(await noSidewaysScroll(page)).toBe(true)
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/unavailable-${width}-light-1-card.png`, fullPage: true })
    })

    // Marks the document, so a reload (which would drop the mark) cannot pass for a retry.
    await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true))

    await session.step('while Try again runs, the button is busy and cannot be pressed twice', async () => {
      await button.click()
      await expect.poll(() => embed.calls.length).toBe(2)
      await expect(button).toBeDisabled()
      await expect(button).toHaveAttribute('aria-busy', 'true')
      await button.click({ force: true })
      expect(embed.calls.length).toBe(2)
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/unavailable-${width}-light-2-retrying.png`, fullPage: true })
    })

    await session.step('a retry that fails again shows the same card, ready to press again', async () => {
      await embed.fail(embed.calls[1])
      await expect(button).toBeEnabled()
      await expect(card).toContainText(PLAIN)
      expect(await noSidewaysScroll(page)).toBe(true)
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/unavailable-${width}-light-3-failed-again.png`, fullPage: true })
    })

    await session.step('a retry that works shows the report, without a page reload', async () => {
      await button.click()
      await expect.poll(() => embed.calls.length).toBe(3)
      await embed.succeed(embed.calls[2])
      await expect(page.getByTestId('report-frame')).toBeVisible()
      await expect(card).toHaveCount(0)
      expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true)
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/unavailable-${width}-light-4-report.png`, fullPage: true })
    })
  })

  // The cached numbers' own failure: the same plain words, and one press of either card's Try again
  // retries both reads, with both buttons busy until both have answered.
  test(`at ${width}px the cached numbers' failure is plain too, and one Try again serves both cards`, async ({ session, page, request }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 800 })
    await page.emulateMedia({ colorScheme: 'light' })
    const embed = await scriptEmbedSession(page)
    const reads: Route[] = []
    await page.route('**/api/sales_target/report**', (route) => {
      reads.push(route)
    })
    const numbers = page.getByTestId('snapshot-error')
    const report = page.getByTestId('embed-state')

    await session.step('a viewer opens the report; the cached read and the live report both fail', async () => {
      const email = await viewer(request)
      await page.goto('/login')
      await page.fill('input[name=email]', email)
      await page.fill('input[name=password]', PASSWORD)
      await page.click('button[type=submit]')
      await expect(page).toHaveURL(/\/sales-target$/, { timeout: 15_000 })
      await expect.poll(() => reads.length).toBe(1)
      await expect.poll(() => embed.calls.length).toBe(1)
      await reads[0].fulfill({ status: 500, json: { error: { type: 'InternalError', message: 'Internal server error' } } })
      await embed.fail(embed.calls[0])
    })

    await session.step('the numbers card says one plain sentence, with no status or server wording', async () => {
      await expect(numbers).toContainText('Numbers unavailable')
      await expect(numbers).toContainText(PLAIN_NUMBERS)
      await expect(report).toContainText(PLAIN)
      await expect(page.locator('body')).not.toContainText('HTTP')
      await expect(page.locator('body')).not.toContainText('Internal server error')
      expect(await noSidewaysScroll(page)).toBe(true)
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/numbers-unavailable-${width}-light-1-card.png`, fullPage: true })
    })

    await session.step('one press retries both reads, and both cards show they are working', async () => {
      await numbers.getByRole('button', { name: 'Try again' }).click()
      await expect.poll(() => reads.length).toBe(2)
      await expect.poll(() => embed.calls.length).toBe(2)
      await expect(numbers.getByRole('button', { name: 'Try again' })).toHaveAttribute('aria-busy', 'true')
      await expect(report.getByRole('button', { name: 'Try again' })).toHaveAttribute('aria-busy', 'true')
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/numbers-unavailable-${width}-light-2-retrying.png`, fullPage: true })
    })

    await session.step('when both answer, both cards are gone', async () => {
      await embed.succeed(embed.calls[1])
      // The live report answered first: the numbers card is still waiting, so it stays busy.
      await expect(numbers.getByRole('button', { name: 'Try again', includeHidden: true })).toHaveAttribute('aria-busy', 'true')
      await reads[1].continue()
      await expect(page.getByTestId('report-frame')).toBeVisible()
      await expect(numbers).toHaveCount(0)
      await expect(report).toHaveCount(0)
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/numbers-unavailable-${width}-light-3-recovered.png`, fullPage: true })
    })
  })
}

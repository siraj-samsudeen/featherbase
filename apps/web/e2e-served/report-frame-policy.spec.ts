// #642 (E4): the Sales Target report frames its embed on its own page only.
// The server sets each page's frame policy on the document it serves, and a
// document keeps it through in-app navigation, so the web app takes a full
// load whenever it moves into or out of the report. This drives the real
// built app, served by the API server, against the local embed stand-in, and
// reads the real response headers. The trial's ~40 store staff reach the
// report exactly this way: by in-app navigation after signing in.
//
// Set E2E_SCREENSHOTS_DIR to keep a 1280px screenshot of each check.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type APIRequestContext, type Page, type Response } from '@playwright/test'
import { startStub, type Stub } from '../e2e/sales-target-stub'
import { STUB_ORIGIN, STUB_PORT } from '../playwright.served.config'

const REPORT = '/featherbase/sales-target'
const REPORT_ONLY = 'test_employee_1'
const MANAGER = 'served.manager@example.test'
const passwords: Record<string, string> = {
  [REPORT_ONLY]: `served-e2e-${Math.random().toString(36).slice(2)}-Report1`,
  [MANAGER]: `served-e2e-${Math.random().toString(36).slice(2)}-Manager1`,
}

let stub: Stub
let seedDir: string

async function adminHeaders(request: APIRequestContext) {
  const res = await request.post('/api/login', { data: { usr: 'Administrator', pwd: process.env.ADMIN_PASSWORD ?? 'admin' } })
  expect(res.status()).toBe(200)
  return { Authorization: `Bearer ${((await res.json()) as { token: string }).token}` }
}

test.beforeAll(async ({ request }, info) => {
  stub = await startStub(STUB_PORT)
  // The report's own seed (the same one an operator runs), with made-up
  // passwords and one made-up store for each employee.
  seedDir = mkdtempSync(path.join(tmpdir(), 'served-e2e-seed-'))
  writeFileSync(path.join(seedDir, '.env.local'), [1, 2, 3, 4]
    .map((n) => `TEST_EMPLOYEE_${n}_PASSWORD=${n === 1 ? passwords[REPORT_ONLY] : `served-e2e-unused-${n}-Password1`}`).join('\n'))
  writeFileSync(path.join(seedDir, 'assignments.json'), JSON.stringify([1, 2, 3, 4].map((n) => ({
    username: `test_employee_${n}`, display_name: `Employee ${n}`, plant_code: `990${n}`, store_label: `Test store 990${n}`, material_groups: [`90000000${n}`],
  }))))
  execFileSync('pnpm', ['--filter', 'server', 'seed:sales-target'], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'),
    env: { ...process.env, SERVER_URL: String(info.project.use.baseURL), SALES_TARGET_SHARED_ENV: path.join(seedDir, '.env.local') },
    stdio: 'pipe',
  })
  // A System Manager who also reads the report, for one store of their own.
  // Idempotent: a worker restarted after a failure runs this again.
  const headers = await adminHeaders(request)
  const enc = encodeURIComponent
  const find = async (table: string, filters: unknown[]) => {
    const res = await request.get(`/api/table/${enc(table)}?filters=${enc(JSON.stringify(filters))}&fields=${enc('["row_id"]')}`, { headers })
    expect(res.ok()).toBe(true)
    return ((await res.json()) as { data: { row_id: string }[] }).data[0]?.row_id
  }
  let manager = await find('Person', [['email', '=', MANAGER]])
  if (!manager) {
    const person = await request.post('/api/save_row', { headers, data: { table: 'Person', row: {
      email: MANAGER, full_name: 'Served Manager', enabled: true, roles: [{ role: 'System Manager' }, { role: 'Sales Target Viewer' }],
    } } })
    expect(person.ok()).toBe(true)
    manager = ((await person.json()) as { row_id: string }).row_id
  }
  expect((await request.post('/api/set_password', { headers, data: { user: manager, password: passwords[MANAGER] } })).ok()).toBe(true)
  if (!(await find('Sales Target Assignment', [['employee', '=', manager]])))
    expect((await request.post('/api/save_row', { headers, data: { table: 'Sales Target Assignment', row: {
      employee: manager, plant_code: '9905', store_label: 'Test store 9905', material_group: '900000005',
    } } })).ok()).toBe(true)
})

test.afterAll(async () => {
  await stub?.close()
  if (seedDir) rmSync(seedDir, { recursive: true, force: true })
})

/** What a page did: every document it loaded (path and response), and every
 *  frame-policy violation the browser reported, from page or console. */
function watch(page: Page) {
  const documents: { path: string; response: Promise<Response | null> }[] = []
  const violations: string[] = []
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      documents.push({ path: new URL(request.url()).pathname, response: request.response() })
  })
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to frame/i.test(message.text())) violations.push(message.text())
  })
  return {
    documents,
    violations,
    loaded: (p: string) => documents.filter((d) => d.path === p).length,
    async policyOf(p: string) {
      const last = [...documents].reverse().find((d) => d.path === p)
      const response = await last?.response
      return response?.headers()['content-security-policy'] ?? null
    },
  }
}

async function recordViolations(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = []
    ;(window as unknown as { __violations: string[] }).__violations = seen
    document.addEventListener('securitypolicyviolation', (e) => seen.push(`${e.violatedDirective} ${e.blockedURI}`))
  })
}
const pageViolations = (page: Page) => page.evaluate(() => (window as unknown as { __violations?: string[] }).__violations ?? [])
const documentPath = (page: Page) => page.evaluate(() => new URL((performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).name).pathname)

async function shoot(page: Page, name: string) {
  const dir = process.env.E2E_SCREENSHOTS_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: path.join(dir, `${name}.png`) })
}

/** The report's cached table reads the warehouse; here it is answered in the
 *  browser, so the server never reaches out. It is not what these checks are about. */
async function noCachedRead(page: Page) {
  await page.route('**/api/sales_target/report*', (route) => route.fulfill({ status: 200, json: { no_assignment: true } }))
}

async function signIn(page: Page, usr: string, base = '') {
  await page.goto(`${base}/featherbase/login`)
  await page.fill('input[name=email]', usr)
  await page.fill('input[name=password]', passwords[usr])
  await page.click('button[type=submit]')
}

/** The report's frame is on the page and its embed actually loaded inside it. */
async function expectFramedReport(page: Page) {
  await expect(page.getByTestId('report-frame')).toBeVisible()
  await expect(page.frameLocator('[data-testid=report-frame]').getByTestId('stub-banner')).toBeVisible()
}

test('a report-only reader signs in and lands on the report, in its own document, with its frame allowed', async ({ page }) => {
  await recordViolations(page)
  await noCachedRead(page)
  const seen = watch(page)
  await signIn(page, REPORT_ONLY)
  await page.waitForURL(`**${REPORT}`)
  await expectFramedReport(page)
  expect(await documentPath(page)).toBe(REPORT)
  expect(await seen.policyOf(REPORT)).toBe(`frame-src 'self' ${STUB_ORIGIN}`)
  // One full load into the report, and it stays put: no reload loop.
  await page.waitForTimeout(1500)
  expect(seen.documents.map((d) => d.path)).toEqual(['/featherbase/login', REPORT])
  // Still signed in after the reload: the report knows who they are.
  await expect(page.getByTestId('identity')).toContainText('Employee 1')
  expect(seen.violations).toEqual([])
  expect(await pageViolations(page)).toEqual([])
  await shoot(page, '1-report-only-sign-in')
})

test('the same reader refreshes the report, and opens it from a pasted link', async ({ page, context }) => {
  await recordViolations(page)
  await noCachedRead(page)
  await signIn(page, REPORT_ONLY)
  await page.waitForURL(`**${REPORT}`)
  await expectFramedReport(page)

  const seen = watch(page)
  await page.reload()
  await expectFramedReport(page)
  expect(await seen.policyOf(REPORT)).toBe(`frame-src 'self' ${STUB_ORIGIN}`)
  await page.waitForTimeout(1000)
  expect(seen.loaded(REPORT)).toBe(1)
  await shoot(page, '2a-refresh')

  const pasted = await context.newPage()
  await recordViolations(pasted)
  await noCachedRead(pasted)
  const pastedSeen = watch(pasted)
  await pasted.goto(REPORT)
  await expectFramedReport(pasted)
  await pasted.waitForTimeout(1000)
  expect(pastedSeen.documents.map((d) => d.path)).toEqual([REPORT])
  expect(await pastedSeen.policyOf(REPORT)).toBe(`frame-src 'self' ${STUB_ORIGIN}`)
  expect([...seen.violations, ...pastedSeen.violations, ...(await pageViolations(pasted))]).toEqual([])
  await shoot(pasted, '2b-pasted-link')
})

test('leaving the report for Sign-in methods drops the embed origin: a new document, whose policy would block it', async ({ page }) => {
  await recordViolations(page)
  await noCachedRead(page)
  await signIn(page, REPORT_ONLY)
  await page.waitForURL(`**${REPORT}`)
  await expectFramedReport(page)

  const seen = watch(page)
  await page.getByTestId('session-user').click()
  await page.getByTestId('account-sign-in-methods').click()
  await page.waitForURL('**/featherbase/account/sign-in-methods')
  await expect.poll(() => seen.loaded('/featherbase/account/sign-in-methods')).toBe(1)
  expect(await documentPath(page)).toBe('/featherbase/account/sign-in-methods')
  expect(await seen.policyOf('/featherbase/account/sign-in-methods')).toBe("frame-src 'self'")
  // Still signed in, with the shared top bar, after the full load.
  await expect(page.getByTestId('session-user')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Sign-in methods' })).toBeVisible()
  // An embed frame here is refused by the browser.
  await page.evaluate((src) => {
    const frame = document.createElement('iframe')
    frame.src = `${src}/sandbox/`
    document.body.append(frame)
  }, STUB_ORIGIN)
  // (The browser names a cross-origin frame by its origin alone.)
  await expect.poll(() => pageViolations(page)).toEqual([`frame-src ${STUB_ORIGIN}`])
  await shoot(page, '5-left-for-sign-in-methods')
})

/** An in-app navigation, as a link in the app makes one: the router follows
 *  the pushed history entry itself, with no request of its own. */
async function navigateInApp(page: Page, to: string) {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target)
  }, to)
}

test('a System Manager moves Admin → report → Admin: the frame is allowed on the report only', async ({ page }) => {
  await recordViolations(page)
  await noCachedRead(page)
  const seen = watch(page)
  await signIn(page, MANAGER)
  await page.waitForURL('**/featherbase/admin**')
  await expect(page.getByTestId('top-bar')).toBeVisible()
  expect(await seen.policyOf('/featherbase/login')).toBe("frame-src 'self'")
  await shoot(page, '3a-manager-admin')

  await navigateInApp(page, REPORT)
  await page.waitForURL(`**${REPORT}`)
  await expect.poll(() => seen.loaded(REPORT)).toBe(1)
  await expectFramedReport(page)
  expect(await documentPath(page)).toBe(REPORT)
  expect(await seen.policyOf(REPORT)).toBe(`frame-src 'self' ${STUB_ORIGIN}`)
  await shoot(page, '3b-manager-report')

  await navigateInApp(page, '/featherbase/admin')
  await page.waitForURL('**/featherbase/admin**')
  await expect.poll(() => seen.loaded('/featherbase/admin')).toBe(1)
  expect(await documentPath(page)).toBe('/featherbase/admin')
  expect(await seen.policyOf('/featherbase/admin')).toBe("frame-src 'self'")
  await page.waitForTimeout(1000)
  expect(seen.loaded(REPORT)).toBe(1)
  expect(seen.violations).toEqual([])
  await shoot(page, '3c-manager-back-to-admin')
})

test('on the address that opens Feather Dash, the report allows its frame too', async ({ page, baseURL }) => {
  const dash = baseURL!.replace('//localhost', '//dash.localhost')
  await recordViolations(page)
  await noCachedRead(page)
  const seen = watch(page)
  await signIn(page, REPORT_ONLY, dash)
  await page.waitForURL(`${dash}${REPORT}`)
  await expectFramedReport(page)
  expect(await documentPath(page)).toBe(REPORT)
  expect(await seen.policyOf(REPORT)).toBe(`frame-src 'self' ${STUB_ORIGIN}`)
  await page.waitForTimeout(1000)
  expect(seen.loaded(REPORT)).toBe(1)
  expect(seen.violations).toEqual([])
  expect(await pageViolations(page)).toEqual([])
  await shoot(page, '4-dash-address')
})

import { writeFile } from 'node:fs/promises'
import { anonymousTest, adminAuth, loginAs, type APIRequestContext } from './fixtures'

// Bounded, test-only evidence for #774's unreproduced initial-Welcome failure.
// Never record URLs with queries, arbitrary storage, auth data or response bodies.
type SetupDiagnostic = {
  event: string
  pathname: string
  homeEligible: boolean
  offer?: '1' | 'absent' | 'other'
  destination?: string
  administratorReady?: boolean
}

const test = anonymousTest.extend<{ setupDiagnostics: void }>({
  setupDiagnostics: [async ({ page }, use, testInfo) => {
    const events: SetupDiagnostic[] = []
    await page.exposeFunction('__captureSetupDiagnostic', (event: SetupDiagnostic) => {
      if (events.length < 200) events.push(event)
    })
    await page.addInitScript(() => {
      const w = window as unknown as {
        __captureSetupDiagnostic: (event: SetupDiagnostic) => Promise<void>
        __TSR_ROUTER__?: { navigate: (options: { to?: string }) => unknown }
        __setupDiagnosticSnapshot?: () => Promise<void>
      }
      const safePath = (path: string) => [
        '/featherbase/login', '/featherbase/admin', '/featherbase/admin/home/home',
        '/featherbase/admin/home/system', '/featherbase/admin/home/$name',
        '/featherbase/admin/setup', '/featherbase/admin/setup/people',
      ].includes(path) ? path : '<other>'
      const record = (event: string, extra: Partial<SetupDiagnostic> = {}) => w.__captureSetupDiagnostic({
        event,
        pathname: safePath(location.pathname),
        // Home eligibility, NOT the hook's private initial-path/ref decision.
        homeEligible: location.pathname === '/featherbase/admin' || location.pathname.startsWith('/featherbase/admin/home/'),
        ...extra,
      })
      const offer = (value: string | null): SetupDiagnostic['offer'] => value === null ? 'absent' : value === '1' ? '1' : 'other'
      const key = 'featherbase.offer-setup'
      const get = Storage.prototype.getItem
      const set = Storage.prototype.setItem
      const remove = Storage.prototype.removeItem
      Storage.prototype.getItem = function (name) {
        const value = get.call(this, name)
        if (this === sessionStorage && name === key) void record('offer-read', { offer: offer(value) })
        return value
      }
      Storage.prototype.setItem = function (name, value) {
        set.call(this, name, value)
        if (this === sessionStorage && name === key) void record('offer-set', { offer: offer(value) })
      }
      Storage.prototype.removeItem = function (name) {
        const previous = this === sessionStorage && name === key ? get.call(this, name) : null
        remove.call(this, name)
        if (this === sessionStorage && name === key) void record('offer-remove', { offer: offer(previous) })
      }
      // TanStack exposes this browser global itself. Observe its public navigate
      // entry point without changing arguments, return values or navigation order.
      let router: typeof w.__TSR_ROUTER__
      Object.defineProperty(window, '__TSR_ROUTER__', {
        configurable: true,
        get: () => router,
        set: (next: typeof router) => {
          if (next && next !== router) {
            const navigate = next.navigate
            next.navigate = function (options) {
              void record('navigation-intent', { destination: safePath(options.to ?? '') })
              return navigate.call(this, options)
            }
          }
          router = next
        },
      })
      w.__setupDiagnosticSnapshot = () => record('failure-snapshot', { offer: offer(get.call(sessionStorage, key)) })
      void record('document-start', { offer: offer(get.call(sessionStorage, key)) })
    })
    page.on('response', async (response) => {
      if (new URL(response.url()).pathname !== '/api/instance-health' || response.status() !== 200) return
      const data = await response.json().catch(() => null) as { setup?: { administrator_ready?: unknown } } | null
      if (typeof data?.setup?.administrator_ready !== 'boolean') return
      // Evaluate only whitelisted scalars; do not attach the response or URL.
      await page.evaluate((administratorReady) => {
        const w = window as unknown as { __captureSetupDiagnostic: (event: SetupDiagnostic) => Promise<void> }
        return w.__captureSetupDiagnostic({
          event: 'health-response',
          pathname: ['/featherbase/admin', '/featherbase/admin/home/home', '/featherbase/admin/setup'].includes(location.pathname) ? location.pathname : '<other>',
          homeEligible: location.pathname === '/featherbase/admin' || location.pathname.startsWith('/featherbase/admin/home/'),
          administratorReady,
        })
      }, data.setup.administrator_ready).catch(() => { /* document closed/navigating */ })
    })
    await use()
    if (testInfo.status !== testInfo.expectedStatus) {
      await page.evaluate(() => (window as unknown as { __setupDiagnosticSnapshot?: () => Promise<void> }).__setupDiagnosticSnapshot?.()).catch(() => {})
      // A standalone sanitized file can be read without opening an auth-bearing trace.
      const path = testInfo.outputPath('setup-offer-diagnostic.json')
      await writeFile(path, JSON.stringify(events, null, 2))
      await testInfo.attach('setup-offer-diagnostic', {
        path, contentType: 'application/json',
      })
    }
  }, { auto: true }],
})

// First-run setup (#465, task 6.1; checklist items 18–25 on #465). On an
// instance where no System Manager has an email address, the built-in
// Administrator sees a resumable welcome guide as they sign in. The isolated
// suite's database sends email to the sink, so each invitation comes back as
// a link to copy. Anyone a spec before this one made a System Manager with an
// address is switched off for the length of this file, and back on after.

type Headers = { Authorization: string }
let headers: Headers
const switchedOff: string[] = []
const pausedJobs: string[] = []
const ASHA = 'asha.setup@example.com'

async function patch(request: APIRequestContext, table: string, id: string, values: Record<string, unknown>) {
  const url = `/api/table/${encodeURIComponent(table)}/${encodeURIComponent(id)}`
  const current = (await (await request.get(url, { headers })).json()) as { updated_at: string }
  const res = await request.patch(url, { headers, data: { ...values, updated_at: current.updated_at } })
  if (res.status() !== 200) throw new Error(`patch ${table} ${id}: ${res.status()} ${await res.text()}`)
}

/** Enabled people other than the Administrator who are System Managers with an address. */
async function managersWithEmail(request: APIRequestContext): Promise<string[]> {
  const res = await request.get(`/api/table/Person?limit_page_length=500&fields=${encodeURIComponent(JSON.stringify(['row_id', 'email', 'enabled']))}`, { headers })
  const people = ((await res.json()) as { data: { row_id: string; email: string | null; enabled: boolean | number }[] }).data
  const out: string[] = []
  for (const p of people.filter((x) => x.enabled && x.email && x.row_id !== 'Administrator')) {
    const doc = (await (await request.get(`/api/table/Person/${encodeURIComponent(p.row_id)}`, { headers })).json()) as { roles?: { role: string }[] }
    if ((doc.roles ?? []).some((r) => r.role === 'System Manager')) out.push(p.row_id)
  }
  return out
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ request }) => {
  headers = await adminAuth(request)
  for (const id of await managersWithEmail(request)) {
    await patch(request, 'Person', id, { enabled: false })
    switchedOff.push(id)
  }
  // Other files deliberately leave failing scheduled jobs. This scenario
  // isolates ordinary unfinished setup, not those genuine operational faults.
  const fields = encodeURIComponent(JSON.stringify(['row_id', 'enabled']))
  const jobs = await request.get(`/api/table/Scheduled%20Job?limit_page_length=500&fields=${fields}`, { headers })
  const { data } = await jobs.json() as { data: { row_id: string; enabled: boolean | number }[] }
  for (const job of data.filter((job) => job.enabled)) {
    await patch(request, 'Scheduled Job', job.row_id, { enabled: false })
    pausedJobs.push(job.row_id)
  }
})

test.afterAll(async ({ request }) => {
  headers = await adminAuth(request)
  for (const id of switchedOff) await patch(request, 'Person', id, { enabled: true })
  // The person this file made is left switched off, so later files start as they would have.
  for (const id of await managersWithEmail(request)) if (!switchedOff.includes(id)) await patch(request, 'Person', id, { enabled: false })
  for (const id of pausedJobs) await patch(request, 'Scheduled Job', id, { enabled: true })
})

test('the welcome guide can be deferred and resumed without treating optional setup as a fault', async ({ session }) => {
  await session.step('sign in as Administrator', async ({ page }) => {
    await loginAs(page)
  })
  await session
    .assertHas('[data-testid="welcome-setup"]')
    .within('[data-testid="welcome-setup"] h1', (h) => h.assertExactText('Welcome to Featherbase'))
    .clickLink('Explore Featherbase')
    .assertHas('[data-testid="all-tables-link"]')
    .refuteHas('[data-testid="welcome-setup"]')
    .refuteHas('[data-testid="health-banner"]')
    .clickLink('Welcome')
    .assertHas('[data-testid="welcome-setup"]')
    .clickLink('Set up administrators')
    .assertHas('[data-testid="first-run-setup"]')
    .clickButton('Not now')
    .refuteHas('[data-testid="first-run-setup"]')
    .refuteHas('[data-testid="health-banner"]')
})

test('with the email sink: the person becomes a System Manager and their invitation is shown to copy', async ({ session }) => {
  await session.step('sign in as Administrator', async ({ page }) => {
    await loginAs(page)
  })
  await session
    .assertHas('[data-testid="welcome-setup"]')
    .clickLink('Set up administrators')
    .assertHas('[data-testid="first-run-setup"]')
    .fillIn('Full name', 'Asha Keeper')
    .fillIn('Email', ASHA)
    .clickButton('Invite')
    .within('[data-testid="setup-result"]', (r) =>
      r.assertText('Asha Keeper is invited as a System Manager')
        .within('[data-testid="setup-invitation"]', (inv) => inv.assertText('/featherbase/login').assertText(ASHA)))
    .clickButton('Continue to Admin')
    .refuteHas('[data-testid="first-run-setup"]')
    .visit('/admin/instance-health')
    .within('[data-testid="health-check-system-manager-email"] [data-testid="health-state"]', (s) => s.assertExactText('Passing'))
})

test('once someone has an address, signing in goes straight to the Admin', async ({ session }) => {
  await session.step('sign in as Administrator', async ({ page }) => {
    await loginAs(page)
  })
  await session
    .assertHas('[data-testid="import-data-link"]')
    .refuteHas('[data-testid="first-run-setup"]')
})

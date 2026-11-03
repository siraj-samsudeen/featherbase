import { anonymousTest as test, expect, adminAuth, loginAs, type APIRequestContext } from './fixtures'
import { ensureTable } from './fixtures-ui'

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

for (const width of [375, 1280]) {
  test(`a pending offer preserves a full-document new-row deep link at ${width}px`, async ({ session, request }) => {
    const table = 'Setup deep link'
    const path = `/featherbase/admin/${encodeURIComponent(table)}/new`
    await ensureTable(request, headers, {
      name: table, id_pattern: 'hash',
      columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }],
    })
    // A real operational fault gives us a visible barrier proving the delayed
    // health result has rendered, rather than a timer or a negative assertion.
    const method = `e2e_setup_missing_handler_${width}`
    const made = await request.post('/api/save_row', {
      headers, data: { table: 'Scheduled Job', row: { method, cadence: 'daily', enabled: true } },
    })
    expect(made.status()).toBe(201)
    const job = (await made.json()).row_id as string
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    try {
      // As in instance-health.spec.ts, wait for the worker's actual failure,
      // including its attempts, before the optimistic-lock cleanup can run.
      const filters = encodeURIComponent(JSON.stringify([['method', '=', method], ['job_status', '=', 'failed']]))
      await expect.poll(async () => {
        const response = await request.get(`/api/table/Background%20Job?filters=${filters}`, { headers })
        expect(response.status()).toBe(200)
        return (await response.json()).data.length
      }, { timeout: 15_000 }).toBe(1)
      await session.step('hold real readiness across sign-in and the new document', async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 })
        await page.route('**/api/instance-health', async (route) => {
          const response = await route.fetch()
          await held
          await route.fulfill({ response })
        })
        await loginAs(page)
        await expect(page.getByTestId('session-user')).toBeVisible()
        expect(await page.evaluate(() => sessionStorage.getItem('featherbase.offer-setup'))).toBe('1')
        // Deliberate full-document deep link: this is the reload boundary that
        // the original 375px form journey crossed, not SPA navigation.
        await page.goto(path)
        await expect(page.getByTestId('form-view')).toBeVisible()
        release()
      })
      await session
        .assertHas('[data-testid="health-banner"]')
        .assertPath(path)
        .assertHas('[data-testid="form-view"]')
        .refuteHas('[data-testid="welcome-setup"]')
      await session.step('the spent offer stays spent when returning home', async ({ page }) => {
        expect(await page.evaluate(() => sessionStorage.getItem('featherbase.offer-setup'))).toBeNull()
      })
      await session.visit('/featherbase/admin/home/system').assertHas('[data-testid="health-banner"]')
        .assertPath('/featherbase/admin/home/system').refuteHas('[data-testid="welcome-setup"]')
    } finally {
      release()
      await patch(request, 'Scheduled Job', job, { enabled: false })
    }
  })
}

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

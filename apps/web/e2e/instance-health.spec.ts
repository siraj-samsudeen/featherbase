import { test, expect, adminAuth, ensureAdminReaderRole, loginAs, type APIRequestContext } from './fixtures'

// Instance health (#465, tasks 5.3 and 5.4; checklist on #465). The health
// page on an instance using UI-managed settings, and the operational fault
// banner that only System Managers see until the fault is resolved.
//
// The isolated suite starts from a fresh database. Files signed in as
// Administrator run first, alphabetically, so this one runs before
// managed-settings.spec.ts (the only other spec that applies a settings file)
// and its first test sees an instance where the file was never applied.

const KEEPER = 'health-keeper@example.com'
const READER = 'health-reader@example.com'
const PASSWORD = 'health-e2e-password'

type Headers = { Authorization: string }
let headers: Headers
/** What this spec switched off, put back afterwards. */
const switchedOff: { table: string; row: string }[] = []

async function save(request: APIRequestContext, table: string, row: Record<string, unknown>) {
  const res = await request.post('/api/save_row', { headers, data: { table, row } })
  if (![200, 201].includes(res.status())) throw new Error(`save ${table}: ${res.status()} ${await res.text()}`)
  return (await res.json()) as { row_id: string }
}

async function patch(request: APIRequestContext, table: string, name: string, values: Record<string, unknown>) {
  const url = `/api/table/${encodeURIComponent(table)}/${encodeURIComponent(name)}`
  const current = (await (await request.get(url, { headers })).json()) as { updated_at: string }
  const res = await request.patch(url, { headers, data: { ...values, updated_at: current.updated_at } })
  if (res.status() !== 200) throw new Error(`patch ${table} ${name}: ${res.status()} ${await res.text()}`)
}

async function personByEmail(request: APIRequestContext, email: string): Promise<string | null> {
  const filters = encodeURIComponent(JSON.stringify([['email', '=', email]]))
  const found = (await (await request.get(`/api/table/Person?filters=${filters}`, { headers })).json()) as { data: { row_id: string }[] }
  return found.data[0]?.row_id ?? null
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ request }) => {
  headers = await adminAuth(request)
  // A person who can use the Admin but is not a System Manager.
  const role = await ensureAdminReaderRole(request)
  const reader = (await personByEmail(request, READER)) ?? (await save(request, 'Person', { email: READER, full_name: 'Health Reader', enabled: true, roles: [{ role }] })).row_id
  const set = await request.post('/api/set_password', { headers, data: { user: reader, password: PASSWORD } })
  if (set.status() !== 200) throw new Error(`set password: ${set.status()} ${await set.text()}`)
})

test.afterAll(async ({ request }) => {
  headers = await adminAuth(request)
  for (const { table, row } of switchedOff) await patch(request, table, row, { enabled: true })
})

test('a System Manager sees that a settings file is optional when using UI-managed settings', async ({ session }) => {
  await session
    .visit('/admin/instance-health')
    .assertHas('[data-testid="instance-health"]')
    .within('[data-testid="instance-health"] h1', (h) => h.assertExactText('Instance health'))
    .within('[data-testid="health-check-settings-applied"]', (card) =>
      card
        .within('[data-testid="health-state"]', (s) => s.assertExactText('Optional'))
        .within('[data-testid="health-message"]', (m) => m.assertExactText('Settings are managed in Featherbase. A managed settings file is optional.'))
        .refuteHas('[data-testid="health-fix"]'))
    .refuteHas('[data-testid="health-banner"]')
})

test('a person without the System Manager role does not see the banner (5.4)', async ({ session }) => {
  await session.step('sign in as the reader instead of Administrator', async ({ page }) => {
    await page.goto('/login')
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
    await page.context().clearCookies()
    await loginAs(page, READER, PASSWORD)
  })
  await session
    .visit('/admin/all-tables')
    .assertHas('[data-testid="all-tables-link"]')
    .refuteHas('[data-testid="health-banner"]')
    .refuteHas('[data-testid="instance-health-link"]')
})

test('the banner leads to the page, and disappears once every check passes (5.4)', async ({ session, request }) => {
  headers = await adminAuth(request)
  // Fix everything: a System Manager with an address, the file applied, and
  // nothing left that this test database cannot pass (its scheduled jobs and
  // the Google method, whose secret it does not have).
  const keeperId = (await personByEmail(request, KEEPER)) ?? (await save(request, 'Person', { email: KEEPER, full_name: 'Health Keeper', enabled: true, roles: [{ role: 'System Manager' }] })).row_id
  await patch(request, 'Person', keeperId, { enabled: true })
  const applied = await request.post('/api/instance-settings/apply', { headers, data: { file: { settings: {} } } })
  if (applied.status() !== 200) throw new Error(`apply: ${applied.status()} ${await applied.text()}`)
  const fields = encodeURIComponent(JSON.stringify(['row_id', 'enabled']))
  const jobs = (await (await request.get(`/api/table/Scheduled%20Job?limit_page_length=100&fields=${fields}`, { headers })).json()) as { data: { row_id: string; enabled: boolean | number }[] }
  for (const job of jobs.data.filter((j) => j.enabled)) {
    await patch(request, 'Scheduled Job', job.row_id, { enabled: false })
    switchedOff.push({ table: 'Scheduled Job', row: job.row_id })
  }
  const google = (await (await request.get('/api/table/Sign%20In%20Method/google', { headers })).json()) as { enabled: boolean | number }
  if (google.enabled) {
    await patch(request, 'Sign In Method', 'google', { enabled: false })
    switchedOff.push({ table: 'Sign In Method', row: 'google' })
  }
  // Unfinished notice-recipient setup is guidance, not a fault. Trigger a
  // real worker failure to exercise the persistent operational banner.
  const method = 'e2e_health_missing_handler'
  const job = await save(request, 'Scheduled Job', { method, cadence: 'daily', enabled: true })
  try {
    // Enabling the schedule already queues its first execution. Wait for all
    // its attempts, not just the first error: the worker updates this same row
    // on each attempt, which would race the optimistic-lock cleanup below.
    const filters = encodeURIComponent(JSON.stringify([['method', '=', method], ['job_status', '=', 'failed']]))
    await expect.poll(async () => {
      const response = await request.get(`/api/table/Background%20Job?filters=${filters}`, { headers })
      expect(response.status()).toBe(200)
      return (await response.json()).data.length
    }, { timeout: 15_000 }).toBe(1)
    await expect.poll(async () => {
      const response = await request.get(`/api/table/Scheduled%20Job/${encodeURIComponent(job.row_id)}`, { headers })
      return (await response.json()).last_outcome
    }, { timeout: 15_000 }).toBe('error')
    await session
      .visit('/admin/all-tables')
      .within('[data-testid="health-banner"]', (b) =>
        b.assertText('1 problem needs attention').assertAttribute('data-severity', 'error').refuteHas('button'))
      .clickLink('Open instance health')
      .assertHas('[data-testid="instance-health"]')
      .within(`[data-testid="health-check-scheduled-job:${method}"] [data-testid="health-state"]`, (s) => s.assertExactText('Failing'))
  } finally {
    await patch(request, 'Scheduled Job', job.row_id, { enabled: false })
  }
  await session
    .visit('/admin/all-tables')
    .assertHas('[data-testid="all-tables-link"]')
    .refuteHas('[data-testid="health-banner"]')
    .visit('/admin/instance-health')
    .within('[data-testid="instance-health-summary"]', (s) => s.assertExactText('Ready to explore. Optional next steps are listed separately.'))
})

import { test, adminAuth, type APIRequestContext } from './fixtures'

// Instance settings as code, group 4 (#465, design D5): a field the instance
// settings file set is read-only in Admin, with one sentence saying where it
// is changed. Fields the file does not name stay editable, and nothing is
// locked before the first apply.

const HINT = 'Set in the instance settings file (instance-settings.json). Change it there, then apply the file.'
const GOOGLE = '/admin/Sign%20In%20Method/google'
let originalDomains: string | null = null
let timeZone: string | null = null

async function applyFile(request: APIRequestContext, settings: Record<string, unknown>) {
  const headers = await adminAuth(request)
  const res = await request.post('/api/instance-settings/apply', { headers, data: { file: { settings } } })
  if (res.status() !== 200) throw new Error(`apply: ${res.status()} ${await res.text()}`)
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ request }) => {
  const headers = await adminAuth(request)
  const google = await request.get('/api/table/Sign%20In%20Method/google', { headers })
  originalDomains = ((await google.json()) as { allowed_email_domains: string | null }).allowed_email_domains
  // The System Settings case locks time_zone at the value it already has, so
  // no other spec sees a different setting.
  const settings = await request.get('/api/table/System%20Settings/System%20Settings', { headers })
  timeZone = ((await settings.json()) as { time_zone: string | null }).time_zone
  // An empty file manages nothing: the state before any apply.
  await applyFile(request, {})
})

test.afterAll(async ({ request }) => {
  await applyFile(request, {})
  const headers = await adminAuth(request)
  const google = (await (await request.get('/api/table/Sign%20In%20Method/google', { headers })).json()) as { updated_at: string }
  await request.patch('/api/table/Sign%20In%20Method/google', { headers, data: { allowed_email_domains: originalDomains, updated_at: google.updated_at } })
})

test('nothing is locked before the first apply', async ({ session }) => {
  await session
    .visit(GOOGLE)
    .assertHas('[data-testid="form-view"]')
    .within('[data-field="allowed_email_domains"]', (input) => input.refuteAttribute('disabled'))
    .refuteHas('[data-testid="managed-allowed_email_domains"]')
})

test('the Google sign-in method form locks the domains the file sets, and only those', async ({ session, request }) => {
  await applyFile(request, { 'Sign In Method': [{ row_id: 'google', allowed_email_domains: 'example.com,example.org' }] })
  await session
    .visit(GOOGLE)
    .assertHas('[data-testid="form-view"]')
    .assertValue('allowed_email_domains', 'example.com,example.org')
    .within('[data-field="allowed_email_domains"]', (input) =>
      input.assertAttribute('disabled').assertAttribute('aria-describedby'))
    .within('[data-testid="managed-allowed_email_domains"]', (hint) => hint.assertExactText(HINT))
    .within('[data-field="label"]', (input) => input.refuteAttribute('disabled'))
    .refuteHas('[data-testid="managed-label"]')
})

test('the System Settings form locks a field the file sets', async ({ session, request }) => {
  await applyFile(request, { 'System Settings': { time_zone: timeZone } })
  await session
    .visit('/admin/System%20Settings')
    .assertHas('[data-testid="form-view"]')
    .within('[data-field="time_zone"]', (input) => input.assertAttribute('disabled'))
    .within('[data-testid="managed-time_zone"]', (hint) => hint.assertExactText(HINT))
    .within('[data-field="app_name"]', (input) => input.refuteAttribute('disabled'))
    // The file stopped naming the Google domains, so they are editable again.
    .visit(GOOGLE)
    .assertHas('[data-testid="form-view"]')
    .within('[data-field="allowed_email_domains"]', (input) => input.refuteAttribute('disabled'))
})

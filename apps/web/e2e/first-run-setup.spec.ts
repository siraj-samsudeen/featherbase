import { anonymousTest as test, adminAuth, loginAs, type APIRequestContext } from './fixtures'

// First-run setup (#465, task 6.1; checklist items 18–25 on #465). On an
// instance where no System Manager has an email address, the built-in
// Administrator is asked who looks after it as they sign in. The isolated
// suite's database sends email to the sink, so each invitation comes back as
// a link to copy. Anyone a spec before this one made a System Manager with an
// address is switched off for the length of this file, and back on after.

type Headers = { Authorization: string }
let headers: Headers
const switchedOff: string[] = []
const ASHA = 'asha.setup@example.com'

async function patchPerson(request: APIRequestContext, id: string, values: Record<string, unknown>) {
  const url = `/api/table/Person/${encodeURIComponent(id)}`
  const current = (await (await request.get(url, { headers })).json()) as { updated_at: string }
  const res = await request.patch(url, { headers, data: { ...values, updated_at: current.updated_at } })
  if (res.status() !== 200) throw new Error(`patch Person ${id}: ${res.status()} ${await res.text()}`)
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
    await patchPerson(request, id, { enabled: false })
    switchedOff.push(id)
  }
})

test.afterAll(async ({ request }) => {
  headers = await adminAuth(request)
  for (const id of switchedOff) await patchPerson(request, id, { enabled: true })
  // The person this file made is left switched off, so later files start as they would have.
  for (const id of await managersWithEmail(request)) if (!switchedOff.includes(id)) await patchPerson(request, id, { enabled: false })
})

test('skipped: Not now reaches the Admin at once and the banner keeps showing the problem', async ({ session }) => {
  await session.step('sign in as Administrator', async ({ page }) => {
    await loginAs(page)
  })
  await session
    .assertHas('[data-testid="first-run-setup"]')
    .within('[data-testid="first-run-setup"] h1', (h) => h.assertExactText('Who looks after this instance?'))
    .clickButton('Not now')
    .refuteHas('[data-testid="first-run-setup"]')
    .within('[data-testid="health-banner"]', (b) => b.assertText('need').assertAttribute('data-severity', 'error'))
})

test('with the email sink: the person becomes a System Manager and their invitation is shown to copy', async ({ session }) => {
  await session.step('sign in as Administrator', async ({ page }) => {
    await loginAs(page)
  })
  await session
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

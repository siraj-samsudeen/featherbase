// #429: people a sign-in rule let in hold no role and land on the no-access
// page. System Managers get a list of them and one email per new arrival.
import { afterEach, describe, expect, vi } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { makePerson } from './fixtures'
import { configureGoogle, inviteGoogleRaw } from './identity-fixtures'
import { googleSignIn } from './google-mock'
import { completeSignIn } from '../src/sign-in'
import { methodOfKind } from '../src/identities'
import { ALERT_SUBJECT, DAILY_ALERT_CAP, _setAlertSender, alertNewArrival } from '../src/waiting-for-access'

afterEach(() => {
  _setAlertSender(null)
  vi.restoreAllMocks()
})

interface Waiting {
  person: string
  full_name: string | null
  email_domain: string | null
  method: string | null
  method_label: string | null
  arrived_by: string | null
  first_sign_in: string | null
  last_sign_in: string | null
}

async function list(client: TestClient) {
  const res = await client.fetch('/api/people/waiting_for_access')
  return { status: res.status, body: (await res.json()) as { people: Waiting[]; count: number } }
}

const DOMAIN = 'staff.example.com'

/** Real (not mock) Google admits a company domain; the rule creates the person. */
async function realGoogle() {
  await configureGoogle({ client_id: 'real-client-id', allowed_email_domains: DOMAIN })
  return (await methodOfKind('google'))!
}

/** A first Google sign-in the domain rule admits; returns the person's id. */
async function arrive(email: string, subject: string, name: string | null = 'New Starter', opts: { testMode?: boolean } = {}) {
  const google = await realGoogle()
  const issued = await completeSignIn(
    google,
    { status: 'verified', subject, email, email_verified: true, display_name: name, hosted_domain: DOMAIN },
    null,
    opts,
  )
  return issued.user.row_id
}

const alertsTo = async (recipient: string) =>
  sql`select recipient, subject, body, reference_name from email_queue where subject = ${ALERT_SUBJECT} and lower(recipient) = ${recipient}`

/** Fill today's (IST) cap with alerts for other people. */
async function fillCap(at: string) {
  for (let i = 0; i < DAILY_ALERT_CAP; i++)
    await sql.unsafe(
      `insert into activity_log (row_id, created_by, updated_by, "user", operation, created_at)
       values ('wfa-cap-${i}', 'system', 'system', 'system', 'access_alert for psn_cap${i}', ${at})`,
    )
}
const IST_MIDNIGHT = `(date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')`

describe('the waiting-for-access list', () => {
  test('shows a person a sign-in rule let in, with domain, method and sign-in times but not the full address', async ({ admin }) => {
    const id = await arrive(`new.starter@${DOMAIN}`, 'g-wfa-1')
    const { status, body } = await list(admin)
    expect(status).toBe(200)
    const row = body.people.find((p) => p.person === id)!
    expect(row).toMatchObject({ full_name: 'New Starter', email_domain: DOMAIN, method: 'google', arrived_by: 'new-person' })
    expect(row.first_sign_in).toBeTruthy()
    expect(row.last_sign_in).toBeTruthy()
    expect(JSON.stringify(row)).not.toContain('new.starter@')
    expect(body.count).toBe(body.people.length)
  })

  test('first and last sign-in come from the sign-in log', async ({ admin }) => {
    const id = await arrive(`twice@${DOMAIN}`, 'g-wfa-2')
    await sql`update activity_log set created_at = now() - interval '3 days' where "user" = ${id} and operation = 'login'`
    await arrive(`twice@${DOMAIN}`, 'g-wfa-2')
    const row = (await list(admin)).body.people.find((p) => p.person === id)!
    expect(new Date(row.first_sign_in!).getTime()).toBeLessThan(new Date(row.last_sign_in!).getTime() - 2 * 86400_000)
  })

  test('leaves out people with a role, built-in accounts, disabled and merged-away people', async ({ admin }) => {
    const withRole = await makePerson({ full_name: 'Has Role', roles: [{ role: 'System Manager' }] })
    const disabled = await makePerson({ full_name: 'Disabled', enabled: false })
    const survivor = await makePerson({ full_name: 'Survivor', roles: [{ role: 'System Manager' }] })
    const merged = await makePerson({ full_name: 'Merged' })
    await sql`update person set enabled = false, replaced_by = ${survivor} where row_id = ${merged}`
    const noRole = await makePerson({ full_name: 'No Role', email: 'no.role@example.com' })
    const ids = (await list(admin)).body.people.map((p) => p.person)
    expect(ids).toContain(noRole)
    for (const out of [withRole, disabled, merged, 'Administrator', 'Guest']) expect(ids).not.toContain(out)
    const row = (await list(admin)).body.people.find((p) => p.person === noRole)!
    // Added by hand, never signed in: no method, no sign-in times.
    expect(row).toMatchObject({ email_domain: 'example.com', method: null, first_sign_in: null, last_sign_in: null })
  })

  test('a name that is still an address shows as its domain only', async ({ admin }) => {
    const p = await makePerson({ full_name: 'legacy.name@example.com' })
    const res = await admin.fetch('/api/people/waiting_for_access')
    expect(await res.clone().text()).not.toContain('legacy.name@')
    expect(((await res.json()) as { people: Waiting[] }).people.find((r) => r.person === p)!.full_name).toBe('example.com')
  })

  test('the implicit All role does not count as a role of their own', async ({ admin }) => {
    const p = await makePerson({ full_name: 'Only All', roles: [{ role: 'All' }] })
    expect((await list(admin)).body.people.map((r) => r.person)).toContain(p)
  })

  test('newest first', async ({ admin }) => {
    const older = await makePerson({ full_name: 'Older' })
    const newer = await makePerson({ full_name: 'Newer' })
    await sql`update person set created_at = now() - interval '2 days' where row_id = ${older}`
    const ids = (await list(admin)).body.people.map((p) => p.person)
    expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(older))
  })

  test('the count answers on its own, for the badge', async ({ admin }) => {
    await makePerson({ full_name: 'Counted' })
    const res = await admin.fetch('/api/people/waiting_for_access/count')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { count: number }).count).toBe((await list(admin)).body.count)
  })

  test('is System Manager only', async ({ createUser }) => {
    const clerk = await createUser({ email: 'clerk@example.com', roles: [] })
    expect((await list(clerk)).status).toBe(403)
    expect((await clerk.fetch('/api/people/waiting_for_access/count')).status).toBe(403)
  })
})

describe('a new person\'s starting name', () => {
  test('with no display name it is the part of the address before the @', async () => {
    const id = await arrive(`ravi.k@${DOMAIN}`, 'g-wfa-name-1', null)
    const [p] = await sql`select full_name from person where row_id = ${id}`
    expect(p.full_name).toBe('ravi.k')
  })

  test('a display name that is an address is cut to its local part too', async () => {
    const id = await arrive(`mock.name@${DOMAIN}`, 'g-wfa-name-2', `mock.name@${DOMAIN}`)
    const [p] = await sql`select full_name from person where row_id = ${id}`
    expect(p.full_name).toBe('mock.name')
  })
})

describe('the email alert to System Managers', () => {
  async function managers() {
    await makePerson({ full_name: 'Manager One', email: 'manager.one@example.com', roles: [{ role: 'System Manager' }] })
    await makePerson({ full_name: 'Manager Off', email: 'manager.off@example.com', enabled: false, roles: [{ role: 'System Manager' }] })
    await makePerson({ full_name: 'Manager No Mail', roles: [{ role: 'System Manager' }] })
    await makePerson({ full_name: 'Not A Manager', email: 'clerk.two@example.com' })
  }

  test('one email to each enabled System Manager with an address when a rule creates a person', async () => {
    await managers()
    const id = await arrive(`arrival@${DOMAIN}`, 'g-wfa-3', 'Arrival Person')
    const mails = await alertsTo('manager.one@example.com')
    expect(mails).toHaveLength(1)
    expect(mails[0].reference_name).toBe(id)
    expect(mails[0].body).toContain('Arrival Person')
    expect(mails[0].body).toContain(DOMAIN)
    expect(mails[0].body).toContain('Google')
    expect(mails[0].body).toContain('/featherbase/admin/waiting-for-access')
    expect(mails[0].body).not.toContain('arrival@')
    expect(await alertsTo('manager.off@example.com')).toHaveLength(0)
    expect(await alertsTo('clerk.two@example.com')).toHaveLength(0)
    // Signing in again is not a new arrival.
    await arrive(`arrival@${DOMAIN}`, 'g-wfa-3', 'Arrival Person')
    expect(await alertsTo('manager.one@example.com')).toHaveLength(1)
  })

  test('the alert row names the system as actor and the person in its text', async () => {
    await managers()
    const id = await arrive(`actor@${DOMAIN}`, 'g-wfa-actor')
    const rows = await sql`select "user", operation from activity_log where operation like 'access_alert%' and operation like ${'%' + id}`
    expect(rows).toEqual([{ user: 'system', operation: `access_alert for ${id}` }])
  })

  test('a person is announced once even when asked twice', async () => {
    await managers()
    const google = await realGoogle()
    const p = await makePerson({ full_name: 'Twice Asked', email: `twice.asked@${DOMAIN}` })
    await alertNewArrival(p, google)
    await alertNewArrival(p, google)
    expect((await alertsTo('manager.one@example.com')).filter((m) => m.reference_name === p)).toHaveLength(1)
  })

  test('no name given: the alert carries no full address', async () => {
    await managers()
    await arrive(`nameless.one@${DOMAIN}`, 'g-wfa-nameless', null)
    const [mail] = await alertsTo('manager.one@example.com')
    expect(mail.body).toContain('nameless.one')
    expect(mail.body).not.toContain('nameless.one@')
  })

  test('no alert when an invited person claims their account', async ({ api }) => {
    await managers()
    const invited = await makePerson({ email: `invited@${DOMAIN}` })
    await inviteGoogleRaw(invited, `invited@${DOMAIN}`)
    const res = await googleSignIn(api, `invited@${DOMAIN}`, { subject: 'g-wfa-4' })
    expect(res.status).toBe(302)
    expect(await alertsTo('manager.one@example.com')).toHaveLength(0)
  })

  test('no alert for a test-mode sign-in or one through the mock Google provider', async ({ api }) => {
    await managers()
    await arrive(`tester@${DOMAIN}`, 'g-wfa-test', 'Tester', { testMode: true })
    // The dev mock provider serves when Google has no client id.
    await configureGoogle({ client_id: '', allowed_email_domains: '*' })
    const res = await googleSignIn(api, 'mocked@example.com', { subject: 'g-wfa-mock' })
    expect(res.status).toBe(302)
    expect(await alertsTo('manager.one@example.com')).toHaveLength(0)
  })

  test('beyond the daily cap no more mail goes out, and the log says so once', async () => {
    await managers()
    await fillCap(`${IST_MIDNIGHT} + interval '1 minute'`)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await arrive(`over.one@${DOMAIN}`, 'g-wfa-5')
    await arrive(`over.two@${DOMAIN}`, 'g-wfa-6')
    expect(await alertsTo('manager.one@example.com')).toHaveLength(0)
    const capLines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('waiting_for_access_alert_cap'))
    expect(capLines).toHaveLength(1)
  })

  // The day is India's, whatever the database session's time zone. Two zones
  // so that at every hour one of them disagrees with India about "today".
  test('the cap counts the India day, not the database day', async () => {
    await managers()
    await sql`set local timezone = 'UTC'`
    await fillCap(`${IST_MIDNIGHT} + interval '1 minute'`)
    await arrive(`ist.today@${DOMAIN}`, 'g-wfa-ist-1')
    expect(await alertsTo('manager.one@example.com')).toHaveLength(0)
  })

  test('yesterday in India does not count towards today\'s cap', async () => {
    await managers()
    await sql`set local timezone = 'Pacific/Kiritimati'`
    await fillCap(`${IST_MIDNIGHT} - interval '1 minute'`)
    await arrive(`ist.yesterday@${DOMAIN}`, 'g-wfa-ist-2')
    expect(await alertsTo('manager.one@example.com')).toHaveLength(1)
  })

  test('a mail failure never blocks the sign-in; it logs one structured line', async () => {
    await managers()
    _setAlertSender(async () => {
      throw new Error('smtp down')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const id = await arrive(`unlucky@${DOMAIN}`, 'g-wfa-7')
    expect(id).toBeTruthy()
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('waiting_for_access_alert_failed'))
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toMatchObject({ event: 'waiting_for_access_alert_failed', error: 'smtp down' })
  })
})

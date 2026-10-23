// #429: people a sign-in rule let in hold no role and land on the no-access
// page. System Managers get a list of them and one email per new arrival.
import { afterEach, describe, expect, vi } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { makePerson } from './fixtures'
import { configureGoogle, inviteGoogleRaw } from './identity-fixtures'
import { googleSignIn, redeemSession } from './google-mock'
import { ALERT_SUBJECT, DAILY_ALERT_CAP, _setAlertSender } from '../src/waiting-for-access'

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

/** A first Google sign-in the domain rule admits; returns the new person's id. */
async function arrive(api: TestClient, email: string, subject: string, name = 'New Starter') {
  const res = await googleSignIn(api, email, { subject, name })
  expect(res.status).toBe(302)
  return (await redeemSession(api, res)).user.row_id
}

const alertsTo = async (recipient: string) =>
  sql`select recipient, subject, body, reference_name from email_queue where subject = ${ALERT_SUBJECT} and recipient = ${recipient}`

describe('the waiting-for-access list', () => {
  test('shows a person a sign-in rule let in, with domain, method and sign-in times but not the full address', async ({ admin, api }) => {
    await configureGoogle({ allowed_email_domains: 'staff.example.com' })
    const id = await arrive(api, 'new.starter@staff.example.com', 'g-wfa-1')
    const { status, body } = await list(admin)
    expect(status).toBe(200)
    const row = body.people.find((p) => p.person === id)!
    expect(row).toMatchObject({
      full_name: 'New Starter',
      email_domain: 'staff.example.com',
      method: 'google',
      arrived_by: 'new-person',
    })
    expect(row.first_sign_in).toBeTruthy()
    expect(row.last_sign_in).toBeTruthy()
    expect(JSON.stringify(row)).not.toContain('new.starter@')
    expect(body.count).toBe(body.people.length)
  })

  test('first and last sign-in come from the sign-in log', async ({ admin, api }) => {
    await configureGoogle({ allowed_email_domains: 'staff.example.com' })
    const id = await arrive(api, 'twice@staff.example.com', 'g-wfa-2')
    await sql`update activity_log set created_at = now() - interval '3 days' where "user" = ${id} and operation = 'login'`
    await arrive(api, 'twice@staff.example.com', 'g-wfa-2')
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

describe('the email alert to System Managers', () => {
  async function managers() {
    const sm = await makePerson({ full_name: 'Manager One', email: 'manager.one@example.com', roles: [{ role: 'System Manager' }] })
    await makePerson({ full_name: 'Manager Off', email: 'manager.off@example.com', enabled: false, roles: [{ role: 'System Manager' }] })
    await makePerson({ full_name: 'Manager No Mail', roles: [{ role: 'System Manager' }] })
    await makePerson({ full_name: 'Not A Manager', email: 'clerk.two@example.com' })
    return sm
  }

  test('one email to each enabled System Manager with an address when a rule creates a person', async ({ api }) => {
    await managers()
    await configureGoogle({ allowed_email_domains: 'staff.example.com' })
    const id = await arrive(api, 'arrival@staff.example.com', 'g-wfa-3', 'Arrival Person')
    const mails = await alertsTo('manager.one@example.com')
    expect(mails).toHaveLength(1)
    expect(mails[0].reference_name).toBe(id)
    expect(mails[0].body).toContain('Arrival Person')
    expect(mails[0].body).toContain('staff.example.com')
    expect(mails[0].body).toContain('Google')
    expect(mails[0].body).toContain('/featherbase/admin/waiting-for-access')
    expect(mails[0].body).not.toContain('arrival@')
    expect(await alertsTo('manager.off@example.com')).toHaveLength(0)
    expect(await alertsTo('clerk.two@example.com')).toHaveLength(0)
    // Signing in again is not a new arrival.
    await arrive(api, 'arrival@staff.example.com', 'g-wfa-3', 'Arrival Person')
    expect(await alertsTo('manager.one@example.com')).toHaveLength(1)
  })

  test('no alert when an invited person claims their account', async ({ api }) => {
    await managers()
    const invited = await makePerson({ email: 'invited@staff.example.com' })
    await inviteGoogleRaw(invited, 'invited@staff.example.com')
    const res = await googleSignIn(api, 'invited@staff.example.com', { subject: 'g-wfa-4' })
    expect(res.status).toBe(302)
    expect(await alertsTo('manager.one@example.com')).toHaveLength(0)
  })

  test('beyond the daily cap no more mail goes out, and the log says so once', async ({ api }) => {
    await managers()
    await configureGoogle({ allowed_email_domains: 'staff.example.com' })
    for (let i = 0; i < DAILY_ALERT_CAP; i++)
      await sql`insert into activity_log (row_id, created_by, updated_by, "user", operation) values (${'wfa-cap-' + i}, 'Administrator', 'Administrator', ${'cap-' + i}, 'access_alert')`
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await arrive(api, 'over.one@staff.example.com', 'g-wfa-5')
    await arrive(api, 'over.two@staff.example.com', 'g-wfa-6')
    expect(await alertsTo('manager.one@example.com')).toHaveLength(0)
    const capLines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('waiting_for_access_alert_cap'))
    expect(capLines).toHaveLength(1)
  })

  test('a mail failure never blocks the sign-in; it logs one structured line', async ({ api }) => {
    await managers()
    await configureGoogle({ allowed_email_domains: 'staff.example.com' })
    _setAlertSender(async () => {
      throw new Error('smtp down')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await googleSignIn(api, 'unlucky@staff.example.com', { subject: 'g-wfa-7' })
    expect(res.status).toBe(302)
    expect((await redeemSession(api, res)).token).toBeTruthy()
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('waiting_for_access_alert_failed'))
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toMatchObject({ event: 'waiting_for_access_alert_failed', error: 'smtp down' })
  })
})

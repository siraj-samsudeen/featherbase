// #429, #955: waiting for access is per app. A person waits for an app only
// after opening it without access; System Managers list the requests, get one
// email per person and app, and one reminder a day later.
import { afterEach, describe, expect, vi } from 'vitest'
import { resolve } from 'node:path'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { expectStatus, grantRole, makePerson } from './fixtures'
import { configureGoogle } from './identity-fixtures'
import { completeSignIn } from '../src/sign-in'
import { methodOfKind } from '../src/identities'
import { saveDoc } from '../src/document'
import { drainJobs, enqueue } from '../src/jobs'
import {
  ALERT_SUBJECT, DAILY_ALERT_CAP, REMINDER_SUBJECT, _setAlertSender, alertAccessRequest, noAccessYetPage,
  remindAccessRequests, requestAccess,
} from '../src/waiting-for-access'

afterEach(() => {
  _setAlertSender(null)
  vi.restoreAllMocks()
})

interface RequestRow {
  row_id: string
  person: string
  email: string | null
  app: string
  app_name: string
}

/** The waiting list: the standard Access Request list. */
async function list(client: TestClient, filters: unknown[] = []) {
  const qs = new URLSearchParams({
    filters: JSON.stringify(filters),
    fields: JSON.stringify(['row_id', 'person', 'email', 'app', 'app_name']),
    order_by: 'created_at desc',
    limit_page_length: '500',
  })
  const res = await client.fetch(`/api/table/Access%20Request?${qs}`)
  const body = res.ok ? ((await res.json()) as { data: RequestRow[]; total: number }) : { data: [], total: 0 }
  return { status: res.status, rows: body.data, total: body.total }
}

async function count(client: TestClient): Promise<number> {
  const res = await client.fetch('/api/people/waiting_for_access/count')
  await expectStatus(res, 200)
  return ((await res.json()) as { count: number }).count
}

const ask = (client: TestClient, app: unknown) =>
  client.fetch('/api/access_request', { method: 'POST', body: JSON.stringify({ app }) })

const VIEWER = 'Sales Target Viewer'
async function viewerRole() {
  const [have] = await sql`select 1 from role where row_id = ${VIEWER}`
  if (!have) await saveDoc('Role', { row_id: VIEWER }, 'Administrator')
}

async function giveRole(person: string, role: string) {
  const [row] = await sql`select updated_at from person where row_id = ${person}`
  await saveDoc('Person', { row_id: person, updated_at: row.updated_at, roles: [{ role }] }, 'Administrator')
}

/** test-apps/other: an installed app with pages of its own, titled "Other
 *  tasks", here open only to System Managers (its manifest opens it to All). */
async function installOther(admin: TestClient) {
  const { discoverPackages } = await import('../src/runtime-packages')
  await discoverPackages([resolve('../..', 'test-apps/other')])
  await admin.post('/api/install_app', { name: 'other' })
  await sql`delete from permission where ref_table = 'other.task' and role = 'All'`
}

const DOMAIN = 'staff.example.com'

const mailsTo = async (recipient: string, subject = ALERT_SUBJECT) =>
  sql`select recipient, subject, body, reference_name from email_queue where subject = ${subject} and lower(recipient) = ${recipient}`

async function managers() {
  await makePerson({ full_name: 'Manager One', email: 'manager.one@example.com', roles: [{ role: 'System Manager' }] })
  await makePerson({ full_name: 'Manager Off', email: 'manager.off@example.com', enabled: false, roles: [{ role: 'System Manager' }] })
  await makePerson({ full_name: 'Manager No Mail', roles: [{ role: 'System Manager' }] })
  await makePerson({ full_name: 'Not A Manager', email: 'clerk.two@example.com' })
}

const noManagerMail = () => sql`update person set email = null where row_id in (select parent from has_role where role = 'System Manager')`

/** Fill today's (IST) cap with alerts for other people. */
async function fillCap(at: string) {
  for (let i = 0; i < DAILY_ALERT_CAP; i++)
    await sql.unsafe(
      `insert into activity_log (row_id, created_by, updated_by, "user", operation, created_at)
       values ('wfa-cap-${i}', 'system', 'system', 'system', 'access_alert for psn_cap${i} in featherbase', ${at})`,
    )
}
const IST_MIDNIGHT = `(date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')`

describe('opening something without access is the request', () => {
  test('opening Featherbase with no role records one request, listed with the App and the full address', async ({ admin, createUser }) => {
    const priya = await createUser({ email: 'priya@example.com', roles: [] })
    for (let i = 0; i < 2; i++) {
      const res = await ask(priya, 'featherbase')
      await expectStatus(res, 200)
      expect(await res.json()).toEqual({ state: 'waiting', title: 'Featherbase' })
    }
    const { status, rows, total } = await list(admin)
    expect(status).toBe(200)
    expect(total).toBe(1)
    expect(rows[0]).toMatchObject({ person: priya.user, email: 'priya@example.com', app: 'Featherbase', app_name: 'featherbase' })
    expect(await count(admin)).toBe(1)
  })

  test('opening Dash without its role is a request for Dash', async ({ admin, createUser }) => {
    const priya = await createUser({ email: 'priya.dash@example.com', roles: [] })
    expect(await (await ask(priya, 'dash')).json()).toEqual({ state: 'waiting', title: 'Dash' })
    expect((await list(admin)).rows).toMatchObject([{ person: priya.user, app: 'Dash' }])
  })

  // Found on production staging (10-Nov-2026): a person who belongs in an app was sent to the Admin
  // first, and its no-access page emailed every System Manager. Their app is where they go instead.
  test("someone with an app of their own role isn't waiting for Featherbase: no request, no mail, and their app named", async ({ admin, createUser }) => {
    await managers()
    await installOther(admin)
    await admin.post('/api/save_row', { table: 'Role', row: { row_id: 'Other Reader' } })
    await grantRole(admin, { table: 'other.task', role: 'Other Reader', can_read: true })
    const reader = await createUser({ email: 'other.reader@example.com', roles: ['Other Reader'] })
    expect(await (await ask(reader, 'featherbase')).json()).toEqual({ state: 'elsewhere', title: 'Featherbase', home: '/other/' })
    expect([(await list(admin)).total, (await mailsTo('manager.one@example.com')).length]).toEqual([0, 0])
  })

  // Someone whose only apps are open to everyone (#659: none of them is theirs) isn't waiting for
  // Featherbase either: they are shown those apps, and nobody is told.
  test('someone who can open only apps open to everyone gets those apps listed, and no request', async ({ admin, createUser }) => {
    await managers()
    const { discoverPackages } = await import('../src/runtime-packages')
    await discoverPackages([resolve('../..', 'test-apps/other')])
    await admin.post('/api/install_app', { name: 'other' })
    const anyone = await createUser({ email: 'anyone@example.com', roles: [] })
    expect(await (await ask(anyone, 'featherbase')).json())
      .toEqual({ state: 'apps', title: 'Featherbase', apps: [{ name: 'other', title: 'Other tasks', href: '/other/' }] })
    expect([(await list(admin)).total, (await mailsTo('manager.one@example.com')).length]).toEqual([0, 0])
  })

  test('something they can open is not a request', async ({ admin }) => {
    expect(await (await ask(admin, 'featherbase')).json()).toEqual({ state: 'open', title: 'Featherbase' })
    expect((await list(admin)).total).toBe(0)
  })

  test('a report viewer can open Featherbase, so they never wait for it', async ({ admin, createUser }) => {
    await viewerRole()
    const viewer = await createUser({ email: 'viewer@example.com', roles: [VIEWER] })
    expect(await (await ask(viewer, 'featherbase')).json()).toEqual({ state: 'open', title: 'Featherbase' })
    expect((await list(admin)).total).toBe(0)
  })

  test('nothing else can be asked for', async ({ admin, createUser }) => {
    const priya = await createUser({ email: 'priya.odd@example.com', roles: [] })
    for (const app of ['no_such_app', 'toString', 42, undefined]) expect((await ask(priya, app)).status).toBe(417)
    await expectStatus(await priya.fetch('/api/access_request', { method: 'POST', body: 'not json' }), 417)
    expect((await list(admin)).total).toBe(0)
  })

  test('a built-in account asks for nothing', async ({ admin }) => {
    expect(await requestAccess('Guest', 'featherbase')).toBeNull()
    expect((await list(admin)).total).toBe(0)
  })

  test('signing in for the first time is not a request', async ({ admin }) => {
    await managers()
    await configureGoogle({ client_id: 'real-client-id', allowed_email_domains: DOMAIN })
    const google = (await methodOfKind('google'))!
    await completeSignIn(google, { status: 'verified', subject: 'g-wfa-1', email: `new.starter@${DOMAIN}`, email_verified: true, display_name: 'New Starter', hosted_domain: DOMAIN }, null)
    expect(await count(admin)).toBe(0)
    expect(await mailsTo('manager.one@example.com')).toHaveLength(0)
  })

  test("an installed app's page, opened without access, says an admin has been told and records the request", async ({ admin, createUser }) => {
    await installOther(admin)
    const priya = await createUser({ email: 'priya.other@example.com', roles: [] })
    const page = await priya.fetch('/other/', { headers: { accept: 'text/html' } })
    await expectStatus(page, 403)
    const html = await page.text()
    expect(html).toContain("You don't have access to Other tasks yet")
    expect(html).toContain('An admin has been told')
    expect((await list(admin)).rows).toMatchObject([{ person: priya.user, app: 'Other tasks', app_name: 'other' }])
    // A script it asks for is refused as before.
    await expectStatus(await priya.fetch('/other/app.js'), 404)
    // Someone who can open it gets the app, and asks nothing.
    await expectStatus(await admin.fetch('/other/', { headers: { accept: 'text/html' } }), 200)
    expect((await list(admin)).total).toBe(1)
  })

  test('an app that is not installed is still unavailable, and asks nothing', async ({ admin, createUser }) => {
    const priya = await createUser({ email: 'priya.none@example.com', roles: [] })
    const page = await priya.fetch('/not_installed/', { headers: { accept: 'text/html' } })
    await expectStatus(page, 404)
    expect(await page.text()).toContain('Application unavailable')
    expect((await list(admin)).total).toBe(0)
  })

  test('the page escapes the app title', () => {
    expect(noAccessYetPage(`<b>"Tom's" & co</b>`)).toContain('&lt;b&gt;&quot;Tom&#39;s&quot; &amp; co&lt;/b&gt;')
  })
})

describe('the waiting list', () => {
  test('a request goes once the person can open that app, and their other requests stay', async ({ admin, createUser }) => {
    await installOther(admin)
    await viewerRole()
    const priya = await createUser({ email: 'priya.two@example.com', roles: [] })
    await ask(priya, 'dash')
    await ask(priya, 'other')
    expect(await count(admin)).toBe(2)
    await giveRole(priya.user!, VIEWER)
    expect(await count(admin)).toBe(1)
    expect((await list(admin)).rows).toMatchObject([{ app: 'Other tasks' }])
  })

  test('a disabled or merged-away person no longer waits', async ({ admin }) => {
    const gone = await makePerson({ full_name: 'Gone', email: 'gone@example.com' })
    const merged = await makePerson({ full_name: 'Merged', email: 'merged@example.com' })
    const stays = await makePerson({ full_name: 'Stays', email: 'stays@example.com' })
    for (const p of [gone, merged, stays]) await requestAccess(p, 'featherbase')
    await sql`update person set enabled = false where row_id = ${gone}`
    await sql`update person set enabled = false, replaced_by = ${stays} where row_id = ${merged}`
    expect(await count(admin)).toBe(1)
    expect((await list(admin)).rows.map((r) => r.person)).toEqual([stays])
  })

  test('filters by App like any list, newest first', async ({ admin, createUser }) => {
    const asha = await createUser({ email: 'asha@example.com', roles: [] })
    const bala = await createUser({ email: 'bala@example.com', roles: [] })
    await ask(asha, 'featherbase')
    await ask(bala, 'dash')
    await ask(bala, 'featherbase')
    await sql`update access_request set created_at = now() - interval '2 days' where person = ${asha.user}`
    expect((await list(admin)).rows.map((r) => r.person)).toEqual([bala.user, bala.user, asha.user])
    expect((await list(admin, [['app', '=', 'Featherbase']])).rows.map((r) => r.person)).toEqual([bala.user, asha.user])
    expect((await list(admin, [['app', '=', 'Dash']])).rows.map((r) => r.person)).toEqual([bala.user])
  })

  test('the list and the count are System Manager only', async ({ admin, createUser }) => {
    const clerk = await createUser({ email: 'clerk@example.com', roles: [] })
    await ask(clerk, 'featherbase')
    await expectStatus(await clerk.fetch('/api/people/waiting_for_access/count'), 403)
    expect((await list(clerk)).status).toBe(403)
    expect((await list(admin)).total).toBe(1)
  })

  test('only the platform writes requests', async ({ admin }) => {
    const res = await admin.fetch('/api/save_row', { method: 'POST', body: JSON.stringify({ table: 'Access Request', row: { person: 'Administrator', app: 'X', app_name: 'x' } }) })
    await expectStatus(res, 403)
    expect((await list(admin)).total).toBe(0)
  })
})

describe('the email alert to System Managers', () => {
  test('one email to each enabled System Manager with an address per person and app', async ({ createUser }) => {
    await managers()
    const priya = await createUser({ email: `priya@${DOMAIN}`, fullName: 'Priya Raman', roles: [] })
    await ask(priya, 'dash')
    await ask(priya, 'dash')
    await ask(priya, 'featherbase')
    const mails = await mailsTo('manager.one@example.com')
    expect(mails).toHaveLength(2)
    expect(mails.map((m) => m.reference_name)).toEqual([priya.user, priya.user])
    const bodies = mails.map((m) => String(m.body)).join('\n')
    expect(bodies).toContain('Priya Raman')
    expect(bodies).toContain(`Email domain: ${DOMAIN}`)
    expect(bodies).toContain('App: Dash')
    expect(bodies).toContain('App: Featherbase')
    expect(bodies).toContain('/featherbase/admin/waiting-for-access')
    expect(bodies).not.toContain('priya@')
    expect(await mailsTo('manager.off@example.com')).toHaveLength(0)
    expect(await mailsTo('clerk.two@example.com')).toHaveLength(0)
  })

  test('the alert row names the system as actor and the person and app in its text', async () => {
    await managers()
    const p = await makePerson({ full_name: 'Actor Check', email: 'actor@example.com' })
    await requestAccess(p, 'featherbase')
    const rows = await sql`select "user", operation from activity_log where operation like 'access_alert%' and operation like ${'%' + p + '%'}`
    expect(rows).toEqual([{ user: 'system', operation: `access_alert for ${p} in featherbase` }])
  })

  test('no name or address given: the alert says so', async () => {
    await managers()
    await requestAccess(await makePerson({ full_name: null }), 'featherbase')
    const [mail] = await mailsTo('manager.one@example.com')
    expect(mail.body).toContain('Name: not given')
    expect(mail.body).toContain('Email domain: no address')
  })

  test('a name that is an address shows as its domain only', async () => {
    await managers()
    await requestAccess(await makePerson({ full_name: `named.by.address@${DOMAIN}` }), 'featherbase')
    const [mail] = await mailsTo('manager.one@example.com')
    expect(mail.body).toContain(`Name: ${DOMAIN}`)
    expect(mail.body).not.toContain('named.by.address')
  })

  test('beyond the daily cap no more mail goes out, the log says so once, and the list still has them', async ({ admin }) => {
    await managers()
    await fillCap(`${IST_MIDNIGHT} + interval '1 minute'`)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const name of ['Over One', 'Over Two']) await requestAccess(await makePerson({ full_name: name }), 'featherbase')
    expect(await mailsTo('manager.one@example.com')).toHaveLength(0)
    const capLines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('waiting_for_access_alert_cap'))
    expect(capLines).toHaveLength(1)
    expect(await count(admin)).toBe(2)
  })

  // The day is India's, whatever the database session's time zone. Two zones
  // so that at every hour one of them disagrees with India about "today".
  test('the cap counts the India day, not the database day', async () => {
    await managers()
    await sql`set local timezone = 'UTC'`
    await fillCap(`${IST_MIDNIGHT} + interval '1 minute'`)
    await requestAccess(await makePerson({ full_name: 'IST Today' }), 'featherbase')
    expect(await mailsTo('manager.one@example.com')).toHaveLength(0)
  })

  test("yesterday in India does not count towards today's cap", async () => {
    await managers()
    await sql`set local timezone = 'Pacific/Kiritimati'`
    await fillCap(`${IST_MIDNIGHT} - interval '1 minute'`)
    await requestAccess(await makePerson({ full_name: 'IST Yesterday' }), 'featherbase')
    expect(await mailsTo('manager.one@example.com')).toHaveLength(1)
  })

  test('with no System Manager to mail, the alert is recorded as undelivered, not dropped (#463)', async () => {
    await noManagerMail()
    const p = await makePerson({ full_name: 'Nobody Told', email: `nobody.told@${DOMAIN}` })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(await alertAccessRequest(p, { name: 'featherbase', title: 'Featherbase' })).toBe('no recipients')

    expect(await sql`select 1 from email_queue where subject = ${ALERT_SUBJECT} and reference_name = ${p}`).toHaveLength(0)
    const rows = await sql`select "user", operation from activity_log where operation like 'notice_undelivered:%'`
    expect(rows).toEqual([{ user: 'system', operation: 'notice_undelivered: no System Manager has an email address (waiting-for-access alert)' }])
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('notice_undelivered'))
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      { event: 'notice_undelivered', notice: 'waiting-for-access alert', reason: 'no System Manager has an email address' },
    ])
  })

  test('a mail failure never stops the page: the request is listed, and one structured line is logged', async ({ admin, createUser }) => {
    await managers()
    _setAlertSender(async () => {
      throw new Error('smtp down')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const priya = await createUser({ email: 'unlucky@example.com', roles: [] })
    expect(await (await ask(priya, 'featherbase')).json()).toEqual({ state: 'waiting', title: 'Featherbase' })
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('waiting_for_access_alert_failed'))
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toMatchObject({ event: 'waiting_for_access_alert_failed', app: 'featherbase', error: 'smtp down' })
    expect(await count(admin)).toBe(1)
  })

  test('a failure that is not an Error is logged as text', async () => {
    await managers()
    _setAlertSender(async () => {
      throw 'refused'
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await alertAccessRequest(await makePerson({ full_name: 'Odd Failure' }), { name: 'featherbase', title: 'Featherbase' })).toBe(0)
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('waiting_for_access_alert_failed'))
    expect(JSON.parse(lines[0])).toMatchObject({ error: 'refused' })
  })
})

describe('the reminder a day later', () => {
  const ageRequests = (interval: string) => sql`update access_request set created_at = now() - ${interval}::interval`

  test('lists every request waiting over a day, once, in one email to each System Manager', async ({ admin }) => {
    await managers()
    const old = await makePerson({ full_name: 'Waited Long', email: 'waited@example.com' })
    await requestAccess(old, 'featherbase')
    await requestAccess(old, 'dash')
    await requestAccess(await makePerson({ full_name: null }), 'featherbase')
    await ageRequests('25 hours')
    await requestAccess(await makePerson({ full_name: 'Just Asked' }), 'featherbase')

    expect(await remindAccessRequests()).toBe(3)
    const mails = await mailsTo('manager.one@example.com', REMINDER_SUBJECT)
    expect(mails).toHaveLength(1)
    expect(mails[0].body).toContain('These 3 requests have waited more than a day')
    expect(mails[0].body).toContain('- Waited Long, Featherbase')
    expect(mails[0].body).toContain('- Waited Long, Dash')
    expect(mails[0].body).toContain('- not given, Featherbase')
    expect(mails[0].body).not.toContain('Just Asked')
    expect(mails[0].body).toContain('/featherbase/admin/waiting-for-access')
    expect(await mailsTo('manager.off@example.com', REMINDER_SUBJECT)).toHaveLength(0)

    // Once: the next run has nothing new to say.
    expect(await remindAccessRequests()).toBe(0)
    expect(await mailsTo('manager.one@example.com', REMINDER_SUBJECT)).toHaveLength(1)
    expect(await count(admin)).toBe(4)
  })

  test('one request reads as one, and a request that got access is not reminded about', async ({ createUser }) => {
    await managers()
    await viewerRole()
    const priya = await createUser({ email: 'priya.late@example.com', fullName: 'Priya Late', roles: [] })
    const sam = await createUser({ email: 'sam.late@example.com', fullName: 'Sam Late', roles: [] })
    await ask(priya, 'dash')
    await ask(sam, 'dash')
    await ageRequests('2 days')
    await giveRole(sam.user!, VIEWER)
    expect(await remindAccessRequests()).toBe(1)
    const [mail] = await mailsTo('manager.one@example.com', REMINDER_SUBJECT)
    expect(mail.body).toContain('This request has waited more than a day')
    expect(mail.body).toContain('- Priya Late, Dash')
    expect(mail.body).not.toContain('Sam Late')
  })

  test('with no System Manager to mail, the reminder is recorded as undelivered', async () => {
    await noManagerMail()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Nothing due: nothing to record.
    expect(await remindAccessRequests()).toBe(0)
    expect(await sql`select 1 from activity_log where operation like 'notice_undelivered:%'`).toHaveLength(0)
    await requestAccess(await makePerson({ full_name: 'Unseen' }), 'featherbase')
    await ageRequests('2 days')
    await noManagerMail()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await remindAccessRequests()).toBe('no recipients')
    // Not marked reminded, so the reminder still goes once someone can get it.
    expect(await sql`select 1 from access_request where reminded_at is not null`).toHaveLength(0)
    const rows = await sql`select operation from activity_log where operation like 'notice_undelivered:%reminder)'`
    expect(rows).toEqual([{ operation: 'notice_undelivered: no System Manager has an email address (waiting-for-access reminder)' }])
  })

  test('runs as the hourly remind_access_requests job, and says what it did', async () => {
    await import('../src/jobs/access-request-reminder')
    const [row] = await sql`select cadence, enabled from scheduled_job where row_id = 'remind_access_requests'`
    expect(row).toEqual({ cadence: 'hourly', enabled: true })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const run = async () => {
      const job = await enqueue('remind_access_requests', {}, { trigger: 'manual', runAt: new Date(0) })
      await drainJobs(20)
      const [done] = await sql`select outcome, result from job_execution where job = ${job}`
      return done
    }

    await requestAccess(await makePerson({ full_name: 'Job Waiter' }), 'featherbase')
    await ageRequests('2 days')
    const saved = await sql`select row_id, email from person where row_id in (select parent from has_role where role = 'System Manager')`
    await noManagerMail()
    expect(await run()).toMatchObject({ outcome: 'success', result: 'no System Manager has an email address' })

    for (const p of saved) await sql`update person set email = ${p.email} where row_id = ${p.row_id}`
    await managers()
    await sql`update access_request set reminded_at = null`
    expect(await run()).toMatchObject({ outcome: 'success', result: 'reminded about 1 request(s)' })
    expect(await mailsTo('manager.one@example.com', REMINDER_SUBJECT)).toHaveLength(1)
  })
})

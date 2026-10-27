// First-run setup (#465, task 6.1; design D9; spec "First-run System Manager
// setup"). While no System Manager has an email address, the built-in
// Administrator names the people who look after the instance: each becomes a
// System Manager and is invited through the existing invitation flow. When
// email cannot be sent yet, each person's invitation link comes back to copy.
import { afterEach, describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { _setInvitationDeliveryForTests } from '../src/invitation-email'
import type { MailMessage } from '../src/email'
import { runHealthChecks } from '../src/instance-health'
import { config } from '../src/config'
import { parseInstanceAddresses } from '../src/instance-addresses'
import { expectApiError } from './fixtures'

const SETUP = '/api/setup/system-managers'

// readSmtpConfig reads the process environment itself.
const SMTP_HOST = process.env.SMTP_HOST
const SMTP_USER = process.env.SMTP_USER
afterEach(() => {
  if (SMTP_HOST === undefined) delete process.env.SMTP_HOST
  else process.env.SMTP_HOST = SMTP_HOST
  if (SMTP_USER === undefined) delete process.env.SMTP_USER
  else process.env.SMTP_USER = SMTP_USER
  _setInvitationDeliveryForTests(null)
})

/** Nobody but the built-in Administrator is a System Manager with an address. */
async function noManagerEmails() {
  await sql`update person set email = null where row_id in (select parent from has_role where role = 'System Manager')`
}

async function googleOn() {
  await sql`update sign_in_method set enabled = true, allowed_email_domains = 'example.com' where kind = 'google'`
}

const rolesOf = async (email: string) =>
  (await sql`select r.role from person p join has_role r on r.parent = p.row_id where lower(p.email) = ${email} order by 1`).map((r) => r.role)

interface Outcome {
  person: string
  full_name: string
  email: string
  created: boolean
  invitation: { status: string; link?: string; method_label?: string; error?: string }
}

describe('first-run setup (6.1)', () => {
  test('with the email sink: each person is a System Manager, invited, and their link comes back to copy', async ({ admin }) => {
    await noManagerEmails()
    await googleOn()
    const res = await admin.post<{ people: Outcome[]; email_can_send: boolean }>(SETUP, {
      people: [{ full_name: 'Asha Keeper', email: 'Asha@Example.com' }, { full_name: '', email: 'ravi@example.com' }],
    })
    expect(res.email_can_send).toBe(false)
    expect(res.people).toHaveLength(2)
    expect(res.people[0]).toMatchObject({ full_name: 'Asha Keeper', email: 'asha@example.com', created: true })
    expect(res.people[0].invitation).toMatchObject({ status: 'link', method_label: expect.any(String) })
    expect(res.people[0].invitation.link).toMatch(/\/featherbase\/login$/)
    // A blank name falls back to the address's local part.
    expect(res.people[1].full_name).toBe('ravi')
    expect(await rolesOf('asha@example.com')).toContain('System Manager')
    // Nothing was put in the sink: the link is shown instead.
    expect((await sql`select 1 from email_sink where mail_to in ('asha@example.com', 'ravi@example.com')`).length).toBe(0)
    // A pending Google invitation exists for each, so the address can sign in.
    const [{ n }] = await sql`select count(*)::int as n from sign_in_identity where pending_email in ('asha@example.com', 'ravi@example.com') and ended_at is null`
    expect(n).toBe(2)
    // The health check now passes.
    const check = (await runHealthChecks()).find((c) => c.key === 'system-manager-email')!
    expect(check.ok).toBe(true)
  })

  test('the link is built from the instance address marked for emails, never the request (#492)', async ({ admin }) => {
    await noManagerEmails()
    await googleOn()
    const before = config.instanceAddresses
    config.instanceAddresses = parseInstanceAddresses(
      '[{"address":"https://dash.example.com","opens":"admin","emails":true},{"address":"https://api.example.com:8092","opens":"admin"}]', 'test')
    try {
      const res = await admin.post<{ people: Outcome[] }>(SETUP, { people: [{ full_name: 'Asha', email: 'asha@example.com' }] })
      expect(res.people[0].invitation).toMatchObject({ status: 'link', link: 'https://dash.example.com/featherbase/login' })
    } finally {
      config.instanceAddresses = before
    }
  })

  test('with outbound email: the invitation is sent through the existing flow', async ({ admin }) => {
    await noManagerEmails()
    await googleOn()
    process.env.SMTP_HOST = 'smtp.example.com'
    const sent: MailMessage[] = []
    _setInvitationDeliveryForTests(async (msg) => { sent.push(msg) })
    const res = await admin.post<{ people: Outcome[]; email_can_send: boolean }>(SETUP, { people: [{ full_name: 'Asha Keeper', email: 'asha@example.com' }] })
    expect(res.email_can_send).toBe(true)
    expect(res.people[0].invitation.status).toBe('sent')
    expect(sent.map((m) => m.to)).toEqual(['asha@example.com'])
  })

  test('an incomplete SMTP configuration still returns what was committed, each invitation with its link (Codex review)', async ({ admin }) => {
    await noManagerEmails()
    await googleOn()
    process.env.SMTP_HOST = 'smtp.example.com'
    process.env.SMTP_USER = 'relay@example.com' // and no SMTP_PASSWORD
    const res = await admin.post<{ people: Outcome[]; email_can_send: boolean }>(SETUP, { people: [{ full_name: 'Asha', email: 'asha@example.com' }] })
    expect(res.email_can_send).toBe(false)
    expect(res.people[0].invitation).toMatchObject({ status: 'failed', link: expect.stringMatching(/\/featherbase\/login$/) })
    expect(await rolesOf('asha@example.com')).toContain('System Manager')
  })

  test('an existing person with that address is given the role, not created again', async ({ admin, createUser }) => {
    await noManagerEmails()
    await googleOn()
    const existing = await createUser({ email: 'clerk.setup@example.com', roles: ['All'] })
    const res = await admin.post<{ people: Outcome[] }>(SETUP, { people: [{ full_name: 'Clerk', email: 'CLERK.setup@example.com' }] })
    expect(res.people[0]).toMatchObject({ person: existing.user, created: false })
    expect(await rolesOf('clerk.setup@example.com')).toEqual(['All', 'System Manager'])
    const [{ n }] = await sql`select count(*)::int as n from person where lower(email) = 'clerk.setup@example.com'`
    expect(n).toBe(1)
  })

  test('without a Google sign-in method the people are still made System Managers, and the result says so', async ({ admin }) => {
    await noManagerEmails()
    await sql`update sign_in_method set enabled = false where kind = 'google'`
    const res = await admin.post<{ people: Outcome[] }>(SETUP, { people: [{ full_name: 'Asha', email: 'asha@example.com' }] })
    expect(res.people[0].invitation.status).toBe('no_method')
    expect(await rolesOf('asha@example.com')).toContain('System Manager')
  })

  test('every problem is listed at once, beside its row, and nothing is created', async ({ admin }) => {
    await noManagerEmails()
    await expectApiError(
      admin.post(SETUP, { people: [{ full_name: 'A', email: 'not-an-address' }, { full_name: 'B', email: 'b@example.com' }, { full_name: 'C', email: 'B@example.com' }] }),
      { status: 417, type: 'ValidationError', fields: { 'people.0.email': expect.any(String), 'people.2.email': expect.any(String) } },
    )
    expect((await sql`select 1 from person where lower(email) = 'b@example.com'`).length).toBe(0)
    await expectApiError(admin.post(SETUP, { people: [] }), { status: 417, type: 'ValidationError' })
  })

  test('an address that already signs in with Google reaches that person, not a new one (Codex review)', async ({ admin, createUser }) => {
    await noManagerEmails()
    await googleOn()
    const holder = await createUser({ email: 'other.contact@example.com', roles: ['All'] })
    await sql`insert into sign_in_identity (id, person_id, method, subject, email, linked_by)
      values ('sid-setup-1', ${holder.user}, 'google', 'g-subject-1', 'asha.google@example.com', 'Administrator')`
    const res = await admin.post<{ people: Outcome[] }>(SETUP, { people: [{ full_name: 'Asha', email: 'asha.google@example.com' }] })
    expect(res.people[0]).toMatchObject({ person: holder.user, created: false })
    expect(await rolesOf('other.contact@example.com')).toContain('System Manager')
  })

  test('a sign-in owner with no contact email gets the address, so the notices reach them (Codex bot)', async ({ admin, createUser }) => {
    await noManagerEmails()
    await googleOn()
    const holder = await createUser({ email: 'blank.contact@example.com', roles: ['All'] })
    await sql`update person set email = null where row_id = ${holder.user}`
    await sql`insert into sign_in_identity (id, person_id, method, subject, email, linked_by)
      values ('sid-setup-3', ${holder.user}, 'google', 'g-subject-3', 'ravi.google@example.com', 'Administrator')`
    const res = await admin.post<{ people: Outcome[] }>(SETUP, { people: [{ full_name: 'Ravi', email: 'ravi.google@example.com' }] })
    expect(res.people[0]).toMatchObject({ person: holder.user, created: false })
    const [row] = await sql`select email from person where row_id = ${holder.user}`
    expect(row.email).toBe('ravi.google@example.com')
    expect((await runHealthChecks()).find((c) => c.key === 'system-manager-email')!.ok).toBe(true)
  })

  test('an address held by two different people is refused until someone decides', async ({ admin, createUser }) => {
    await noManagerEmails()
    const a = await createUser({ email: 'shared.setup@example.com', roles: ['All'] })
    const b = await createUser({ email: 'b.setup@example.com', roles: ['All'] })
    await sql`insert into sign_in_identity (id, person_id, method, subject, email, linked_by)
      values ('sid-setup-2', ${b.user}, 'google', 'g-subject-2', 'shared.setup@example.com', 'Administrator')`
    await expectApiError(admin.post(SETUP, { people: [{ full_name: 'X', email: 'shared.setup@example.com' }] }), {
      status: 417, type: 'ValidationError', fields: { 'people.0.email': expect.stringContaining('more than one person') },
    })
    expect(await rolesOf('shared.setup@example.com')).not.toContain('System Manager')
    void a
  })

  test('a disabled person with that address is refused, not silently given the role', async ({ admin, createUser }) => {
    await noManagerEmails()
    const gone = await createUser({ email: 'gone.setup@example.com', roles: ['All'] })
    await sql`update person set enabled = false where row_id = ${gone.user}`
    await expectApiError(admin.post(SETUP, { people: [{ full_name: 'Gone', email: 'gone.setup@example.com' }] }), {
      status: 417, type: 'ValidationError', fields: { 'people.0.email': expect.stringContaining('disabled') },
    })
  })

  test('only the built-in Administrator may use it', async ({ createUser }) => {
    const manager = await createUser({ email: 'sm.setup@example.com', roles: ['System Manager'] })
    await expectApiError(manager.post(SETUP, { people: [{ full_name: 'X', email: 'x@example.com' }] }), { status: 403 })
  })
})

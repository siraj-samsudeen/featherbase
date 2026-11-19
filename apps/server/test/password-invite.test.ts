import { createHash } from 'node:crypto'
import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { config } from '../src/config'
import { issueSession, setPasswordFromShell } from '../src/auth'
import { _setPasswordInviteAcceptHooksForTests, _setPasswordInviteDeliveryForTests, sendPasswordInvite } from '../src/password-invite'
import { test } from './pg-test'
import { expectRefused, expectStatus, makePerson } from './fixtures'
import { configureDelegated, inviteGoogleRaw, linkDelegated, setPasswordMethod } from './identity-fixtures'

// #1257: an administrator sends a person with no way in a one-time,
// 72-hour "Set your password" link. Opening it sets their first password and
// signs them in. Never offered to an account that signs in another way (#137).

const INVALID = 'This invitation link is invalid or has expired'
const HOUR = 60 * 60 * 1000

type Api = { fetch: (path: string, init?: RequestInit) => Promise<Response> }

const post = (client: Api, path: string, body: unknown) =>
  client.fetch(path, { method: 'POST', body: JSON.stringify(body) })

async function newcomer(email = 'ravi@partner.test') {
  return makePerson({ email, full_name: 'Ravi Partner' })
}

async function send(admin: TestClient, person: string) {
  return admin.post(`/api/people/${person}/password_invite`, {}) as Promise<{
    password_invite: { status: string; sent_at: string; expires_at: string }
    invitation_email: { status: string }
  }>
}

async function linkFromMail(email: string): Promise<{ url: URL; key: string }> {
  // Every link mailed to the address; the one for the newest invite.
  const mails = await sql`select body from email_sink where mail_to = ${email}`
  const links = mails.flatMap((m) => {
    const match = /Set your password here: (\S+)/.exec(String(m.body))
    return match ? [new URL(match[1])] : []
  })
  const [newest] = await sql`select i.token_hash from password_invite i join person p on p.row_id = i.person
    where lower(p.email) = ${email} order by i.created_at desc, i.id desc limit 1`
  const url = links.find((u) => createHash('sha256').update(u.searchParams.get('key') ?? '').digest('hex') === newest?.token_hash)
  if (!url) throw new Error(`no invite mail for ${email}`)
  return { url, key: url.searchParams.get('key') ?? '' }
}

async function mailCount(email: string) {
  const [{ n }] = await sql`select count(*)::int as n from email_sink where mail_to = ${email}`
  return n as number
}

async function invitesOf(person: string) {
  return sql`select * from password_invite where person = ${person} order by created_at`
}

async function panel(admin: TestClient, person: string) {
  return (await admin.get(`/api/people/${person}/identities`)) as {
    has_password: boolean
    password_invite: {
      offered: boolean
      refusal: string | null
      latest: { status: string; sent_at: string | null; expires_at: string; accepted_at: string | null } | null
    }
  }
}

describe('#1257 password invite', () => {
  test('a person with no way in is emailed a link that sets their first password and signs them in', async ({ admin, api }) => {
    const email = 'ravi@partner.test'
    const person = await newcomer(email)
    expect((await panel(admin, person)).password_invite).toEqual({ offered: true, refusal: null, latest: null })

    const before = Date.now()
    const sent = await send(admin, person)
    expect(sent.invitation_email).toEqual({ status: 'sent' })
    expect(sent.password_invite.status).toBe('pending')
    const expires = new Date(sent.password_invite.expires_at).getTime()
    expect(expires).toBeGreaterThanOrEqual(before + 72 * HOUR - 60_000)
    expect(expires).toBeLessThanOrEqual(Date.now() + 72 * HOUR + 60_000)

    const { url, key } = await linkFromMail(email)
    expect(url.pathname).toBe('/featherbase/set-password')
    expect(key).toMatch(/^[0-9a-f]{48}$/)
    // Only a fingerprint of the link is stored.
    const [row] = await invitesOf(person)
    expect(row.token_hash).toBe(createHash('sha256').update(key).digest('hex'))
    expect(JSON.stringify(row)).not.toContain(key)
    expect(row.invited_by).toBe('Administrator')

    const shown = await panel(admin, person)
    expect(shown.has_password).toBe(false)
    expect(shown.password_invite.offered).toBe(true)
    expect(shown.password_invite.latest).toMatchObject({ status: 'pending', expires_at: sent.password_invite.expires_at, accepted_at: null })
    expect(shown.password_invite.latest!.sent_at).toEqual(expect.any(String))

    // The page names the account it sets a password for.
    const check = await post(api, '/api/password_invite/check', { key })
    await expectStatus(check, 200)
    expect(await check.json()).toEqual({ email, expires_at: sent.password_invite.expires_at })

    // The minimum length applies and a refused password keeps the link.
    await expectRefused(post(api, '/api/password_invite/accept', { key, new_password: 'abcde' }), 417, 'at least 6 characters')
    const accepted = await post(api, '/api/password_invite/accept', { key, new_password: 'chosen-pw-1' })
    await expectStatus(accepted, 200)
    const session = (await accepted.json()) as { token: string; user: { row_id: string; sign_in: { method: string } } }
    expect(session.token).toEqual(expect.any(String))
    expect(session.user.row_id).toBe(person)
    expect(session.user.sign_in.method).toBe('password')
    expect(accepted.headers.get('set-cookie') ?? '').toContain('sid=')

    // Later sign-ins use the email and that password.
    await expectStatus(await post(api, '/api/login', { usr: email, pwd: 'chosen-pw-1' }), 200)

    // The link works once.
    await expectRefused(post(api, '/api/password_invite/accept', { key, new_password: 'another-pw-2' }), 417, INVALID)
    await expectRefused(post(api, '/api/password_invite/check', { key }), 417, INVALID)

    const after = await panel(admin, person)
    expect(after.has_password).toBe(true)
    expect(after.password_invite.offered).toBe(false)
    expect(after.password_invite.latest).toMatchObject({ status: 'accepted', accepted_at: expect.any(String) })

    // Forgot password now works for them like anyone else.
    await post(api, '/api/reset_password_request', { usr: email })
    const [reset] = await sql`select count(*)::int as n from password_reset where "user" = ${person}`
    expect(reset.n).toBe(1)
  })

  test('sending again voids the earlier link', async ({ admin, api }) => {
    const email = 'twice@partner.test'
    const person = await newcomer(email)
    await send(admin, person)
    const first = await linkFromMail(email)
    await send(admin, person)
    const second = await linkFromMail(email)
    expect(second.key).not.toBe(first.key)
    expect(await mailCount(email)).toBe(2)

    await expectRefused(post(api, '/api/password_invite/accept', { key: first.key, new_password: 'chosen-pw-1' }), 417, INVALID)
    expect((await sql`select (select password_hash from person_credential where person_id = ${person}) as password_hash`)[0].password_hash).toBeNull()
    await expectStatus(await post(api, '/api/password_invite/accept', { key: second.key, new_password: 'chosen-pw-1' }), 200)
    const statuses = (await invitesOf(person)).map((r) => [r.voided_at != null, r.accepted_at != null])
    expect(statuses).toEqual([[true, false], [false, true]])
  })

  test('an expired link is refused and the panel says it expired', async ({ admin, api }) => {
    const email = 'late@partner.test'
    const person = await newcomer(email)
    await send(admin, person)
    const { key } = await linkFromMail(email)
    await sql`update password_invite set expires_at = now() - interval '1 second' where person = ${person}`
    await expectRefused(post(api, '/api/password_invite/accept', { key, new_password: 'chosen-pw-1' }), 417, INVALID)
    expect((await panel(admin, person)).password_invite).toMatchObject({ offered: true, latest: { status: 'expired' } })
    expect((await sql`select (select password_hash from person_credential where person_id = ${person}) as password_hash`)[0].password_hash).toBeNull()
  })

  test('an unknown or empty key is refused the same way', async ({ api }) => {
    await expectRefused(post(api, '/api/password_invite/accept', { key: 'f'.repeat(48), new_password: 'chosen-pw-1' }), 417, INVALID)
    await expectRefused(post(api, '/api/password_invite/check', { key: '' }), 417, INVALID)
  })

  test('never offered to someone who already has a way in, no email, or is disabled', async ({ admin }) => {
    await configureDelegated()
    const withPassword = await makePerson({ email: 'haspw@partner.test' })
    await admin.post('/api/set_password', { user: withPassword, password: 'origpw123' })
    const hr = await makePerson({ email: 'hr@store.test' })
    await linkDelegated(hr, 'EMP42')
    const googleInvited = await makePerson({ email: 'g@store.test' })
    await inviteGoogleRaw(googleInvited, 'g@store.test')
    const expectsGoogle = await makePerson({ email: 'eg@store.test', expects_google_sign_in: true })
    const expectsMicrosoft = await makePerson({ email: 'em@partner.test', expects_microsoft_sign_in: true })
    const noEmail = await makePerson({ full_name: 'Store staff' })
    const disabled = await makePerson({ email: 'off@partner.test', enabled: false })

    const cases: [string, string][] = [
      [withPassword, 'already has a password'],
      [hr, 'signs in another way'],
      [googleInvited, 'signs in another way'],
      [expectsGoogle, 'signs in another way'],
      [expectsMicrosoft, 'signs in another way'],
      [noEmail, 'no email address'],
      [disabled, 'disabled'],
    ]
    for (const [person, why] of cases) {
      const shown = (await panel(admin, person)).password_invite
      expect(shown.offered).toBe(false)
      expect(shown.refusal).toContain(why)
      await expectRefused(admin.post(`/api/people/${person}/password_invite`, {}), 417, why)
      expect(await invitesOf(person)).toEqual([])
    }
    const [{ n }] = await sql`select count(*)::int as n from email_sink where subject = 'Set your password'`
    expect(n).toBe(0)
    // #137: none of them was given a password.
    const hashes = await sql`select row_id from person where row_id in ${sql([hr, googleInvited, expectsGoogle, expectsMicrosoft, noEmail, disabled])} and exists (select 1 from person_credential c where c.person_id = person.row_id)`
    expect(hashes).toEqual([])
  })

  test('not offered while password sign-in is turned off', async ({ admin }) => {
    const person = await newcomer('nopw@partner.test')
    await setPasswordMethod({ enabled: false })
    expect((await panel(admin, person)).password_invite).toMatchObject({ offered: false, refusal: expect.stringContaining('Password sign-in is turned off') })
    await expectRefused(admin.post(`/api/people/${person}/password_invite`, {}), 417, 'Password sign-in is turned off')
  })

  test('the link stops working when the person changes before it is used', async ({ admin, api }) => {
    await configureDelegated()
    const cases: [string, (person: string) => Promise<unknown>][] = [
      ['email changed', (p) => sql`update person set email = 'moved@partner.test' where row_id = ${p}`],
      ['shell reset', (p) => setPasswordFromShell(p, 'shell-pw-1')],
      ['another way in', (p) => linkDelegated(p, 'EMP77')],
      ['disabled', (p) => sql`update person set enabled = false where row_id = ${p}`],
      ['sessions ended', (p) => sql`update person set sessions_ended_at = now() + interval '1 second' where row_id = ${p}`],
    ]
    for (const [label, change] of cases) {
      const email = `${label.replace(/ /g, '-')}@partner.test`
      const person = await newcomer(email)
      await send(admin, person)
      const { key } = await linkFromMail(email)
      await change(person)
      await expectRefused(post(api, '/api/password_invite/accept', { key, new_password: 'chosen-pw-1' }), 417, INVALID)
      const [row] = await sql`select (select password_hash from person_credential where person_id = ${person}) as password_hash`
      if (label !== 'shell reset') expect(row.password_hash, label).toBeNull()
    }
  })

  test('only a System Manager sends, and a test-mode session cannot', async ({ admin, api, createUser }) => {
    const person = await newcomer('who@partner.test')
    const someone = await createUser({ email: 'clerk@x.test', roles: [] })
    await expectRefused(someone.post(`/api/people/${person}/password_invite`, {}), 403)
    const { token } = await issueSession(admin.user!, { testMode: true })
    const res = await api.fetch(`/api/people/${person}/password_invite`, {
      method: 'POST', body: '{}', headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(403)
    expect(await invitesOf(person)).toEqual([])
  })

  test('a send that fails voids its link and says so', async ({ admin, api }) => {
    const email = 'bounce@partner.test'
    const person = await newcomer(email)
    let captured = ''
    _setPasswordInviteDeliveryForTests(async (msg) => {
      captured = msg.body
      throw Object.assign(new Error('relay said no'), { code: 'EENVELOPE', responseCode: 550 })
    })
    try {
      await expectRefused(admin.post(`/api/people/${person}/password_invite`, {}), 503, 'not sent')
    } finally {
      _setPasswordInviteDeliveryForTests(null)
    }
    const key = new URL(/Set your password here: (\S+)/.exec(captured)![1]).searchParams.get('key')!
    await expectRefused(post(api, '/api/password_invite/accept', { key, new_password: 'chosen-pw-1' }), 417, INVALID)
    expect((await panel(admin, person)).password_invite.latest).toMatchObject({ status: 'not_sent' })
  })

  // Codex, adversarial round 1: what lands between the burn and the password
  // write, and between that write and the session, still counts.
  test('a resend, email change or shell reset between using the link and the password write refuses it', async ({ admin, api }) => {
    const cases: [string, (person: string) => Promise<unknown>][] = [
      ['resend', (p) => sendPasswordInvite(p, 'Administrator', 'http://localhost')],
      ['email changed', (p) => sql`update person set email = 'elsewhere@partner.test' where row_id = ${p}`],
      ['shell reset', (p) => setPasswordFromShell(p, 'shell-pw-1')],
    ]
    for (const [label, change] of cases) {
      const email = `gap-${label.replace(/ /g, '-')}@partner.test`
      const person = await newcomer(email)
      await send(admin, person)
      const { key } = await linkFromMail(email)
      _setPasswordInviteAcceptHooksForTests({ afterBurn: async () => { await change(person) } })
      try {
        await expectRefused(post(api, '/api/password_invite/accept', { key, new_password: 'chosen-pw-1' }), 417, INVALID)
      } finally {
        _setPasswordInviteAcceptHooksForTests(null)
      }
      const [row] = await sql`select (select password_hash from person_credential where person_id = ${person}) as password_hash`
      if (label !== 'shell reset') expect(row.password_hash, label).toBeNull()
      expect(await sql`select 1 from password_invite where person = ${person} and accepted_at is not null`, label).toEqual([])
    }
  })

  test('a shell reset between the password write and the session leaves no session', async ({ admin, api }) => {
    const email = 'reset-race@partner.test'
    const person = await newcomer(email)
    await send(admin, person)
    const { key } = await linkFromMail(email)
    _setPasswordInviteAcceptHooksForTests({ beforeSession: async () => { await setPasswordFromShell(person, 'shell-pw-1') } })
    try {
      await expectRefused(post(api, '/api/password_invite/accept', { key, new_password: 'chosen-pw-1' }), 417, INVALID)
    } finally {
      _setPasswordInviteAcceptHooksForTests(null)
    }
    // The session issued before the check was revoked; the shell's password stands.
    const [{ n }] = await sql`select count(*)::int as n from revoked_session where person_id = ${person}`
    expect(n).toBe(1)
    await expectStatus(await post(api, '/api/login', { usr: email, pwd: 'shell-pw-1' }), 200)
    await expectRefused(post(api, '/api/login', { usr: email, pwd: 'chosen-pw-1' }), 401)
  })

  test('the edges answer plainly: an unknown person, no address to link to, a send past its deadline, no key, a body that is not JSON', async ({ admin, api }) => {
    await expectRefused(admin.post('/api/people/psn_nobody/password_invite', {}), 404, 'not found')

    const person = await newcomer('edges@partner.test')
    const environment = config.environment
    config.environment = 'production'
    try {
      await expectRefused(admin.post(`/api/people/${person}/password_invite`, {}), 503, 'INSTANCE_ADDRESSES')
    } finally {
      config.environment = environment
    }
    expect(await invitesOf(person)).toEqual([])

    _setPasswordInviteDeliveryForTests(() => new Promise(() => {}), 5)
    try {
      await expectRefused(admin.post(`/api/people/${person}/password_invite`, {}), 503, 'ETIMEDOUT')
    } finally {
      _setPasswordInviteDeliveryForTests(null)
    }
    expect((await panel(admin, person)).password_invite.latest).toMatchObject({ status: 'not_sent' })

    await expectRefused(post(api, '/api/password_invite/accept', { new_password: 'chosen-pw-1' }), 417, INVALID)
    for (const path of ['/api/password_invite/check', '/api/password_invite/accept'])
      await expectRefused(api.fetch(path, { method: 'POST', body: 'not json' }), 417, INVALID)
  })

  test('an email change that slips past the trigger before the write is refused too', async ({ admin, api }) => {
    const cases: [string, (person: string) => Promise<unknown>][] = [
      // The email trigger is the first guard; the write checks the address itself as well.
      ['email changed past the trigger', async (p) => {
        await sql`alter table person disable trigger person_void_password_invites`
        await sql`update person set email = 'slipped@partner.test' where row_id = ${p}`
        await sql`alter table person enable trigger person_void_password_invites`
      }],
    ]
    for (const [label, change] of cases) {
      const email = `vanish-${label.split(' ')[0]}-${label.length}@partner.test`
      const person = await newcomer(email)
      await send(admin, person)
      const { key } = await linkFromMail(email)
      _setPasswordInviteAcceptHooksForTests({ afterBurn: async () => { await change(person) } })
      try {
        await expectRefused(post(api, '/api/password_invite/accept', { key, new_password: 'chosen-pw-1' }), 417, INVALID)
      } finally {
        _setPasswordInviteAcceptHooksForTests(null)
      }
    }
  })

  test('password sign-in removed between the write and the session leaves no session', async ({ admin, api }) => {
    const email = 'method-gone@partner.test'
    const person = await newcomer(email)
    await send(admin, person)
    const { key } = await linkFromMail(email)
    _setPasswordInviteAcceptHooksForTests({ beforeSession: async () => { await sql`delete from sign_in_method where row_id = 'password'` } })
    try {
      await expectRefused(post(api, '/api/password_invite/accept', { key, new_password: 'chosen-pw-1' }), 417, INVALID)
    } finally {
      _setPasswordInviteAcceptHooksForTests(null)
    }
  })
})

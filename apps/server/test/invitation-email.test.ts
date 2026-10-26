// #430: inviting a Google address emails the invited person — who invited
// them, what this instance is (its configured name and introduction), the
// sign-in link and which address to use. A failed send never loses the invite
// and is reported to the inviter; a pending invite can be re-sent, at most
// once per ten minutes.
import { afterEach, describe, expect, vi } from 'vitest'
import { parseInstanceAddresses } from '../src/instance-addresses'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { makePerson } from './fixtures'
import { configureGoogle } from './identity-fixtures'
import { googleSignIn, redeemSession } from './google-mock'
import { _setInvitationDeliveryForTests, _setInvitationHooksForTests, composeInvitation } from '../src/invitation-email'
import { config } from '../src/config'
import { preflightRelease } from '../src/release-preflight'

const enc = encodeURIComponent

afterEach(() => _setInvitationHooksForTests(null))

async function setting(field: string, value: string) {
  await sql`delete from single_value where table_name = 'System Settings' and field = ${field}`
  await sql`insert into single_value ${sql({ table_name: 'System Settings', field, value })}`
}

async function invite(client: TestClient, person: string, email: string, extra: Record<string, unknown> = {}) {
  const res = await client.fetch(`/api/people/${enc(person)}/identities`, {
    method: 'POST',
    body: JSON.stringify({ method: 'google', email, ...extra }),
  })
  return { status: res.status, body: (await res.json()) as Record<string, any> }
}

async function mailsTo(address: string) {
  return sql`select mail_to, subject, body from email_sink where mail_to = ${address} order by created_at`
}

async function inviter(createUser: (o: { email: string; fullName?: string; roles: string[] }) => Promise<TestClient>) {
  return createUser({ email: 'inviter.430@example.com', fullName: 'Asha Inviter', roles: ['System Manager'] })
}

describe('the invitation email', () => {
  test('inviting sends one email with the inviter, the configured name and introduction, and the sign-in link', async ({ createUser }) => {
    await setting('app_name', 'Example Dash')
    await setting('invitation_email_intro', 'Example Dash shows each store its daily sales against target.')
    const admin = await inviter(createUser)
    const person = await makePerson({ full_name: 'Store Person', email: 'store.person@example.com' })

    const { status, body } = await invite(admin, person, 'Store.Person@example.com')
    expect(status).toBe(201)
    expect(body.invitation_email).toEqual({ status: 'sent' })
    expect(body.invitation_sent_at).toEqual(expect.any(String))

    const mails = await mailsTo('store.person@example.com')
    expect(mails).toHaveLength(1)
    expect(mails[0].subject).toBe('Asha Inviter invited you to Example Dash')
    const text = String(mails[0].body)
    expect(text).toContain('Asha Inviter has invited you to sign in to Example Dash.')
    expect(text).toContain('Example Dash shows each store its daily sales against target.')
    expect(text).toContain('Sign in with Google using this address: store.person@example.com')
    expect(text).toMatch(/https?:\/\/[^\s]+\/featherbase\/login\b/)
  })

  test('with no introduction configured the email still names the instance and carries the link', async ({ createUser }) => {
    await sql`delete from single_value where table_name = 'System Settings' and field in ('app_name', 'invitation_email_intro')`
    const admin = await inviter(createUser)
    const person = await makePerson({ full_name: 'Plain Person' })
    await invite(admin, person, 'plain.person@example.com')
    const [mail] = await mailsTo('plain.person@example.com')
    expect(mail.subject).toBe('Asha Inviter invited you to Featherbase')
    expect(String(mail.body)).toContain('/featherbase/login')
    expect(String(mail.body)).not.toContain('undefined')
  })

  test('the link uses the address marked for emails', async ({ createUser }) => {
    const { config } = await import('../src/config')
    const before = config.instanceAddresses
    config.instanceAddresses = parseInstanceAddresses('[{"address":"https://dash.example.com","opens":"admin","emails":true}]', 'test')
    try {
      const admin = await inviter(createUser)
      const person = await makePerson({ full_name: 'Linked Person' })
      await invite(admin, person, 'linked.person@example.com')
      const [mail] = await mailsTo('linked.person@example.com')
      expect(String(mail.body)).toContain('https://dash.example.com/featherbase/login')
    } finally {
      config.instanceAddresses = before
    }
  })

  test('the inviter can choose not to send an email', async ({ createUser }) => {
    const admin = await inviter(createUser)
    const person = await makePerson({ full_name: 'Quiet Person' })
    const { status, body } = await invite(admin, person, 'quiet.person@example.com', { send_invitation_email: false })
    expect(status).toBe(201)
    expect(body.invitation_email).toEqual({ status: 'not_sent', reason: 'not_requested' })
    expect(body.invitation_sent_at).toBeNull()
    expect(await mailsTo('quiet.person@example.com')).toHaveLength(0)
  })

  test('inviting the same address again sends nothing more', async ({ createUser }) => {
    const admin = await inviter(createUser)
    const person = await makePerson({ full_name: 'Twice Person' })
    await invite(admin, person, 'twice.person@example.com')
    const again = await invite(admin, person, 'twice.person@example.com')
    expect(again.status).toBe(200)
    expect(again.body.invitation_email).toEqual({ status: 'not_sent', reason: 'already_invited' })
    expect(await mailsTo('twice.person@example.com')).toHaveLength(1)
  })

  test('a failed send keeps the invite, tells the inviter, and logs without the address', async ({ createUser }) => {
    _setInvitationDeliveryForTests(async () => {
      throw new Error('550 mailbox unavailable for broken.person@example.com')
    })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const admin = await inviter(createUser)
      const person = await makePerson({ full_name: 'Broken Person' })
      const { status, body } = await invite(admin, person, 'broken.person@example.com')
      expect(status).toBe(201)
      expect(body.invitation_email.status).toBe('failed')
      expect(body.invitation_email.error).toMatch(/not sent/i)
      expect(JSON.stringify(body.invitation_email)).not.toContain('broken.person')
      // The invite exists, and a resend is not held back by the failed try.
      const [row] = await sql`select pending_email, invitation_sent_at from sign_in_identity where id = ${body.id}`
      expect(row).toEqual({ pending_email: 'broken.person@example.com', invitation_sent_at: null })
      const lines = logged.mock.calls.map((c) => c.join(' '))
      expect(lines.some((l) => l.includes('sign_in_invitation'))).toBe(true)
      expect(lines.join('\n')).not.toContain('broken.person')
    } finally {
      logged.mockRestore()
    }
  })

  test('the first Google sign-in with the invited address still claims the invite', async ({ api, createUser }) => {
    await configureGoogle({ allowed_email_domains: '' })
    const admin = await inviter(createUser)
    const person = await makePerson({ full_name: 'Claim Person' })
    const { body } = await invite(admin, person, 'claim.person@example.com')
    const session = await redeemSession(api, await googleSignIn(api, 'claim.person@example.com', { subject: 'g-claim-430' }))
    expect(session.user.row_id).toBe(person)
    expect(session.user.sign_in).toMatchObject({ method: 'google', identity: body.id })
  })
})

describe('resending an invitation', () => {
  async function resend(client: TestClient, identity: string) {
    const res = await client.fetch(`/api/identities/${enc(identity)}/resend_invitation`, { method: 'POST' })
    return { status: res.status, body: (await res.json()) as Record<string, any> }
  }

  test('resends a pending invite, at most once every ten minutes', async ({ createUser }) => {
    const admin = await inviter(createUser)
    const person = await makePerson({ full_name: 'Resend Person' })
    const { body } = await invite(admin, person, 'resend.person@example.com', { send_invitation_email: false })

    const first = await resend(admin, body.id)
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ invitation_email: { status: 'sent' } })
    expect(await mailsTo('resend.person@example.com')).toHaveLength(1)

    const tooSoon = await resend(admin, body.id)
    expect(tooSoon.status).toBe(429)
    expect(tooSoon.body.error.message).toMatch(/10 minutes/)
    expect(await mailsTo('resend.person@example.com')).toHaveLength(1)

    await sql`update sign_in_identity set invitation_sent_at = now() - interval '11 minutes' where id = ${body.id}`
    expect((await resend(admin, body.id)).status).toBe(200)
    expect(await mailsTo('resend.person@example.com')).toHaveLength(2)
  })

  test('a failed resend is an error the inviter sees, and does not start the wait', async ({ createUser }) => {
    const admin = await inviter(createUser)
    const person = await makePerson({ full_name: 'Retry Person' })
    const { body } = await invite(admin, person, 'retry.person@example.com', { send_invitation_email: false })
    _setInvitationDeliveryForTests(async () => {
      throw new Error('connection refused')
    })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const failed = await resend(admin, body.id)
      expect(failed.status).toBe(503)
      expect(failed.body.error.message).toMatch(/not sent/i)
    } finally {
      logged.mockRestore()
    }
    _setInvitationDeliveryForTests(null)
    expect((await resend(admin, body.id)).status).toBe(200)
  })

  test('only a pending invite can be resent, and only by a System Manager', async ({ createUser }) => {
    const admin = await inviter(createUser)
    const plain = await createUser({ email: 'plain.430@example.com', roles: [] })
    const person = await makePerson({ full_name: 'Done Person' })
    const { body } = await invite(admin, person, 'done.person@example.com', { send_invitation_email: false })
    expect((await resend(plain, body.id)).status).toBe(403)

    await sql`update sign_in_identity set subject = 'g-done', pending_email = null where id = ${body.id}`
    const claimed = await resend(admin, body.id)
    expect(claimed.status).toBe(417)
    expect(claimed.body.error.message).toMatch(/pending/i)
  })
})

// Review of #439: the link never comes from a request outside development and
// test; a failure before the send takes nothing; a hung send has a deadline.
describe('hardening', () => {
  async function resend(client: TestClient, identity: string) {
    const res = await client.fetch(`/api/identities/${enc(identity)}/resend_invitation`, { method: 'POST' })
    return { status: res.status, body: (await res.json()) as Record<string, any> }
  }
  async function withConfig<T>(change: Partial<Pick<typeof config, 'instanceAddresses' | 'environment'>>, run: () => Promise<T>): Promise<T> {
    const c = config as Pick<typeof config, 'instanceAddresses' | 'environment'>
    const before = { instanceAddresses: c.instanceAddresses, environment: c.environment }
    Object.assign(c, change)
    try {
      return await run()
    } finally {
      Object.assign(c, before)
    }
  }

  test('outside development and test, no INSTANCE_ADDRESSES means no email, never a link from the request', async ({ createUser }) => {
    const admin = await inviter(createUser)
    const person = await makePerson({ full_name: 'Prod Person' })
    await withConfig({ instanceAddresses: null, environment: 'production' }, async () => {
      const res = await admin.fetch(`/api/people/${enc(person)}/identities`, {
        method: 'POST',
        headers: { host: 'attacker.example.net' },
        body: JSON.stringify({ method: 'google', email: 'prod.person@example.com' }),
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as Record<string, any>
      expect(body.invitation_email).toEqual({ status: 'failed', error: expect.stringMatching(/INSTANCE_ADDRESSES/) })
      expect(body.invitation_sent_at).toBeNull()
      const again = await resend(admin, body.id)
      expect(again.status).toBe(503)
      expect(again.body.error.message).toMatch(/INSTANCE_ADDRESSES/)
    })
    expect(await mailsTo('prod.person@example.com')).toHaveLength(0)
  })

  test('the release preflight refuses a production server without INSTANCE_ADDRESSES', async () => {
    await withConfig({ instanceAddresses: null }, async () => {
      const prev = process.env.DISABLE_DATABASE_ENVIRONMENT_CHECK
      process.env.DISABLE_DATABASE_ENVIRONMENT_CHECK = '1'
      try {
        await expect(preflightRelease({ environment: 'production' })).rejects.toThrow(/INSTANCE_ADDRESSES is not set on a "production" server/)
        await withConfig({ instanceAddresses: parseInstanceAddresses('[{"address":"https://dash.example.com","opens":"admin","emails":true}]', 'production') }, async () => {
          expect(await preflightRelease({ environment: 'production' })).toContain('INSTANCE_ADDRESSES: https://dash.example.com opens admin (emails)')
        })
      } finally {
        if (prev === undefined) delete process.env.DISABLE_DATABASE_ENVIRONMENT_CHECK
        else process.env.DISABLE_DATABASE_ENVIRONMENT_CHECK = prev
      }
    })
  })

  test('a failure before the send claims nothing, so a retry can send at once', async ({ createUser }) => {
    const admin = await inviter(createUser)
    const person = await makePerson({ full_name: 'Early Person' })
    const { body } = await invite(admin, person, 'early.person@example.com', { send_invitation_email: false })
    _setInvitationHooksForTests({ beforeClaim: async () => { throw new Error('settings unavailable') } })
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect((await resend(admin, body.id)).status).toBe(500)
    } finally {
      quiet.mockRestore()
    }
    const [row] = await sql`select invitation_sent_at from sign_in_identity where id = ${body.id}`
    expect(row.invitation_sent_at).toBeNull()
    _setInvitationHooksForTests(null)
    expect((await resend(admin, body.id)).status).toBe(200)
  })

  test('a failed audit write after the email went out is logged, and the send is still reported as sent', async ({ createUser }) => {
    _setInvitationHooksForTests({ audit: async () => { throw new Error('audit down') } })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const admin = await inviter(createUser)
      const person = await makePerson({ full_name: 'Audit Person' })
      const { body } = await invite(admin, person, 'audit.person@example.com')
      expect(body.invitation_email).toEqual({ status: 'sent' })
      expect(await mailsTo('audit.person@example.com')).toHaveLength(1)
      expect(logged.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('invitation_audit_failed')
    } finally {
      logged.mockRestore()
    }
  })

  test('a send that hangs past its deadline counts as failed and gives the window back', async ({ createUser }) => {
    _setInvitationHooksForTests({ deliver: () => new Promise<void>(() => {}), deadlineMs: 50 })
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const admin = await inviter(createUser)
      const person = await makePerson({ full_name: 'Hung Person' })
      const { body } = await invite(admin, person, 'hung.person@example.com')
      expect(body.invitation_email).toEqual({ status: 'failed', error: 'The invitation email was not sent (ETIMEDOUT)' })
      expect(body.invitation_sent_at).toBeNull()
    } finally {
      quiet.mockRestore()
    }
  })

  test('a line break in a configured name never reaches the subject as a new header line', () => {
    const mail = composeInvitation({
      address: 'x@example.com', inviter: 'Asha\r\nBcc: y@example.com', appName: 'Example\nDash',
      intro: '', methodLabel: 'Google', link: 'https://dash.example.com/featherbase/login',
    })
    expect(mail.subject).toBe('Asha Bcc: y@example.com invited you to Example Dash')
    expect(mail.subject).not.toMatch(/[\r\n]/)
  })

  test('two resends at once send one email', async ({ createUser }) => {
    const admin = await inviter(createUser)
    const person = await makePerson({ full_name: 'Race Person' })
    const { body } = await invite(admin, person, 'race.person@example.com', { send_invitation_email: false })
    const results = await Promise.all([resend(admin, body.id), resend(admin, body.id)])
    expect(results.map((r) => r.status).sort()).toEqual([200, 429])
    expect(await mailsTo('race.person@example.com')).toHaveLength(1)
  })

  test('an unknown invite is not found; an ended one cannot be resent', async ({ createUser }) => {
    const admin = await inviter(createUser)
    expect((await resend(admin, 'uid_does_not_exist')).status).toBe(404)
    const person = await makePerson({ full_name: 'Ended Person' })
    const { body } = await invite(admin, person, 'ended.person@example.com', { send_invitation_email: false })
    await sql`update sign_in_identity set ended_at = now(), ended_reason = 'unlinked' where id = ${body.id}`
    const ended = await resend(admin, body.id)
    expect(ended.status).toBe(417)
    expect(await mailsTo('ended.person@example.com')).toHaveLength(0)
  })
})

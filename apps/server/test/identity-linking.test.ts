// person-identities (D6): administrators link, invite, rename, move and
// unlink; a signed-in person links Google by proving it, and can remove a
// method but never their last way in.
import { describe, expect, vi, afterEach } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { expectStatus, makePerson } from './fixtures'
import { sign } from 'hono/jwt'
import { configureDelegated, giveEmployeeCode, configureGoogle, inviteGoogleRaw, linkDelegated } from './identity-fixtures'
import { beginMockApproval, googleLink, googleSignIn, linkOutcome, redeemSession, withGoogleFetch } from './google-mock'
import { getSignInMethod } from '../src/identities'
import { completeSignIn, linkVerifiedToSelf, resolveVerified } from '../src/sign-in'
import { issueSession } from '../src/auth'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// person-rename: ids are minted; the typed name is the person's username.
async function passwordSession(api: TestClient, admin: TestClient, username: string) {
  const id = await makePerson({ username })
  await admin.post('/api/set_password', { user: id, password: `${username}-pw-1` })
  const res = await api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr: username, pwd: `${username}-pw-1` }) })
  return { id, token: ((await res.json()) as { token: string }).token }
}

const as = (api: TestClient, token: string) => (path: string, init: RequestInit = {}) =>
  api.fetch(path, { ...init, headers: { authorization: `Bearer ${token}` } })

describe('an administrator links sign-in methods', () => {
  test('link, rename (sessions survive), move (sessions end) and unlink', async ({ api, admin }) => {
    await configureDelegated()
    const rr10 = await makePerson({ username: 'rr-10' })
    const rr11 = await makePerson({ username: 'rr-11' })
    const linked = (await admin.post(`/api/people/${rr10}/identities`, { method: 'stylehr', subject: 'RR-10', sign_in_name: 'tl_10' })) as { id: string }
    // Test mode resolves a typed code through the person's current
    // employee-code row (person-resolution D5).
    await giveEmployeeCode(rr10, 'RR-10')
    // A non-admin cannot.
    const { token: tl } = await passwordSession(api, admin, 'plain.person')
    await expectStatus(await as(api, tl)(`/api/people/${rr10}/identities`), 403)

    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', 'trust-any-password')
    const { token } = (await (await api.fetch('/api/login/delegated', { method: 'POST', body: JSON.stringify({ usr: 'RR-10', pwd: '', method: 'stylehr' }) })).json()) as { token: string }
    vi.unstubAllEnvs()
    const who = () => as(api, token)('/api/whoami')
    await expectStatus(await who(), 200)

    await expectStatus(await admin.fetch(`/api/identities/${linked.id}`, { method: 'PATCH', body: JSON.stringify({ sign_in_name: 'tl_10_new' }) }), 200)
    await expectStatus(await who(), 200)
    const [renamed] = await sql`select sign_in_name from sign_in_identity where id = ${linked.id}`
    expect(renamed.sign_in_name).toBe('tl_10_new')

    const moveRes = await admin.fetch(`/api/identities/${linked.id}`, { method: 'PATCH', body: JSON.stringify({ person_id: rr11 }) })
    await expectStatus(moveRes, 200)
    const moved = (await moveRes.json()) as { id: string }
    await expectStatus(await who(), 401)
    // person-resolution D4/D5: the move keeps who held it until when.
    const listed = (await admin.get(`/api/people/${rr11}/identities`)) as { identities: { id: string; subject: string; ended_at: string | null }[] }
    expect(listed.identities.map((i) => [i.id, i.subject, i.ended_at])).toEqual([[moved.id, 'RR-10', null]])
    const history = (await admin.get(`/api/people/${rr10}/identities`)) as { identities: { id: string; ended_reason: string | null }[] }
    expect(history.identities.map((i) => [i.id, i.ended_reason])).toEqual([[linked.id, 'moved']])

    // Unlinking ends the link and keeps it as history; the id can be linked afresh.
    await expectStatus(await admin.fetch(`/api/identities/${moved.id}`, { method: 'DELETE' }), 200)
    expect(await sql`select ended_reason from sign_in_identity where id = ${moved.id}`).toEqual([{ ended_reason: 'unlinked' }])
    await expectStatus(await admin.fetch(`/api/people/${rr11}/identities`, { method: 'POST', body: JSON.stringify({ method: 'stylehr', subject: 'RR-10' }) }), 201)
  })

  test('a collision is refused atomically and names that it is already linked', async ({ admin }) => {
    await configureDelegated()
    const rr20 = await makePerson({})
    const rr21 = await makePerson({})
    await admin.post(`/api/people/${rr20}/identities`, { method: 'stylehr', subject: 'RR-20' })
    const res = await admin.fetch(`/api/people/${rr21}/identities`, { method: 'POST', body: JSON.stringify({ method: 'stylehr', subject: 'RR-20' }) })
    await expectStatus(res, 409)
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain('already linked')
  })

  test('service accounts get no sign-in methods', async ({ admin }) => {
    await configureDelegated()
    const svc = (await admin.post('/api/service_accounts', { label: 'svc-link-test' })) as { row_id: string }
    // A service account is not a person: it has no person row (and so no email).
    expect(await sql`select 1 from person where row_id = ${svc.row_id}`).toHaveLength(0)
    await expectStatus(await admin.fetch(`/api/people/${svc.row_id}/identities`, { method: 'POST', body: JSON.stringify({ method: 'stylehr', subject: 'S-1' }) }), 417)
  })
})

describe('a person links Google themselves', () => {
  test('a fresh session links a Google account, which then opens the same account', async ({ api, admin }) => {
    await configureGoogle({ allowed_email_domains: '' })
    const { id, token } = await passwordSession(api, admin, 'linker')
    const res = await googleLink(api, token, 'linker@gmail.com', { subject: 'g-linker' })
    expect(linkOutcome(res)).toBe('linked')
    const signedIn = await googleSignIn(api, 'linker.renamed@gmail.com', { subject: 'g-linker' })
    expect((await redeemSession(api, signedIn)).user.row_id).toBe(id)
  })

  test('a Google account linked to someone else, or reserved for them, is refused', async ({ api, admin }) => {
    const owner = await makePerson({})
    await sql`insert into sign_in_identity (id, person_id, method, subject, linked_by) values ('uid_owner', ${owner}, 'google', 'g-owned', 'test')`
    await inviteGoogleRaw(owner, 'reserved@gmail.com')
    const { id: grabber, token } = await passwordSession(api, admin, 'grabber')
    expect(linkOutcome(await googleLink(api, token, 'x@gmail.com', { subject: 'g-owned' }))).toBe('taken')
    expect(linkOutcome(await googleLink(api, token, 'reserved@gmail.com', { subject: 'g-new' }))).toBe('reserved')
    expect(await sql`select 1 from sign_in_identity where person_id = ${grabber}`).toHaveLength(0)
  })

  test('a stale session, or one minted before sessions carried their time, must sign in again', async ({ api, admin }) => {
    const stale = await makePerson({})
    const secret = process.env.JWT_SECRET ?? 'dev-secret-change-me'
    const now = Math.floor(Date.now() / 1000)
    const noIat = await sign({ sub: stale, exp: now + 3600 }, secret)
    const old = await sign({ sub: stale, iat: now - 3600, exp: now + 3600, jti: 'stale-session', m: 'password' }, secret)
    await admin.post('/api/set_password', { user: stale, password: 'stale-pw-1' })
    // Minted before the upgrade: ended at deploy, it opens nothing.
    await expectStatus(await as(api, noIat)('/api/oauth/google/link', { redirect: 'manual' }), 401)
    await expectStatus(await as(api, noIat)('/api/whoami'), 401)
    // Signed in an hour ago: must sign in again first.
    await expectStatus(await as(api, old)('/api/oauth/google/link', { redirect: 'manual' }), 401)
  })

  test('removing a method: never the last one; a pending invite does not count', async ({ api, admin }) => {
    await configureDelegated()
    const rr30 = await makePerson({})
    const hr = await linkDelegated(rr30, 'tl_30', { subject: 'RR-30' })
    await inviteGoogleRaw(rr30, 'rr30@gmail.com')
    // A test-mode session cannot remove anything at all; use a real one.
    const { _setDelegatedFetch } = await import('../src/delegated-login')
    _setDelegatedFetch((async () => Response.json({ token: 'x' })) as unknown as typeof fetch)
    try {
      const res = await api.fetch('/api/login/delegated', { method: 'POST', body: JSON.stringify({ usr: 'tl_30', pwd: 'right', method: 'stylehr' }) })
      const { token } = (await res.json()) as { token: string }
      await expectStatus(await as(api, token)(`/api/me/identities/${hr}`, { method: 'DELETE' }), 409)
      const mine = (await (await as(api, token)('/api/me/sign_in_methods')).json()) as { identities: { linked: boolean }[] }
      expect(mine.identities.map((i) => i.linked).sort()).toEqual([false, true])
    } finally {
      _setDelegatedFetch(null)
    }
  })
})

// person-resolution D5 / C7: a sign-in method with an identifier system writes
// the matching identifier row; ending the link closes it. Every address is
// also an `email` row, and a mailbox moved between people keeps who held it.
describe('write-through to identifiers', () => {
  const current = (person: string, system: string) =>
    sql`select value, source from person_identifier where person_id = ${person} and system = ${system} and upper_inf(valid) order by value`

  test('a StyleHR link writes its record number; unlinking closes it', async ({ admin }) => {
    await configureDelegated()
    const p = await makePerson({ full_name: 'Writes Through' })
    const { id } = await admin.post<{ id: string }>(`/api/people/${p}/identities`, { method: 'stylehr', subject: '900001', sign_in_name: 'wt_login' })
    expect(await current(p, 'stylehr-employee-id')).toEqual([{ value: '900001', source: 'sign-in' }])
    await admin.delete(`/api/identities/${id}`)
    expect(await current(p, 'stylehr-employee-id')).toEqual([])
  })

  test('the person’s address is an email row; changing it closes the old one and opens the new', async ({ admin }) => {
    const p = await makePerson({ email: 'first@x.test' })
    expect(await current(p, 'email')).toEqual([{ value: 'first@x.test', source: 'person-email' }])
    const row = await admin.get<{ updated_at: string }>(`/api/table/Person/${p}`)
    await admin.fetch(`/api/table/Person/${p}`, { method: 'PATCH', body: JSON.stringify({ email: 'Second@x.test', updated_at: row.updated_at }) })
    expect(await current(p, 'email')).toEqual([{ value: 'second@x.test', source: 'person-email' }])
  })

  test('a store mailbox moved to the next manager: the outgoing manager’s address row closes, the incoming one’s opens', async ({ admin }) => {
    const outgoing = await makePerson({ full_name: 'Outgoing SM' })
    const incoming = await makePerson({ full_name: 'Incoming SM' })
    await sql`insert into sign_in_identity (id, person_id, method, subject, email, linked_by)
      values ('uid_mailbox_atk', ${outgoing}, 'google', 'g-sm-atk', 'sm.atk@jeyarama.com', 'test')`
    const { writeThroughIdentity } = await import('../src/person-identifiers')
    await writeThroughIdentity('uid_mailbox_atk')
    expect(await current(outgoing, 'email')).toEqual([{ value: 'sm.atk@jeyarama.com', source: 'sign-in' }])
    await sql`update person_identifier set valid = daterange('2026-01-01', null, '[)') where person_id = ${outgoing} and system = 'email'`
    const moved = (await (await admin.fetch('/api/identities/uid_mailbox_atk', { method: 'PATCH', body: JSON.stringify({ person_id: incoming }) })).json()) as { id: string }
    expect(await current(outgoing, 'email')).toEqual([])
    const [{ today }] = await sql`select current_date::text as today`
    expect(await sql`select upper(valid)::text as until from person_identifier where person_id = ${outgoing} and system = 'email'`).toEqual([
      { until: today },
    ])
    expect(await current(incoming, 'email')).toEqual([{ value: 'sm.atk@jeyarama.com', source: 'sign-in' }])
    expect(await sql`select ended_reason from sign_in_identity where id = 'uid_mailbox_atk'`).toEqual([{ ended_reason: 'moved' }])
    expect(moved.id).not.toBe('uid_mailbox_atk')
  })

  test('an address that is both the person’s email and a live Google link stays current while either remains (Codex review on #385)', async ({ admin }) => {
    const p = await makePerson({ email: 'both@x.test' })
    await sql`insert into sign_in_identity (id, person_id, method, subject, email, linked_by)
      values ('uid_both_google', ${p}, 'google', 'g-both', 'both@x.test', 'test')`
    const { writeThroughIdentity } = await import('../src/person-identifiers')
    await writeThroughIdentity('uid_both_google')
    // The primary email changes: the Google link still backs the old address.
    const row = await admin.get<{ updated_at: string }>(`/api/table/Person/${p}`)
    await admin.fetch(`/api/table/Person/${p}`, { method: 'PATCH', body: JSON.stringify({ email: 'new@x.test', updated_at: row.updated_at }) })
    expect((await current(p, 'email')).map((r) => r.value)).toEqual(['both@x.test', 'new@x.test'])
    // The Google link ends: nothing backs the old address any more.
    await admin.delete('/api/identities/uid_both_google')
    expect((await current(p, 'email')).map((r) => r.value)).toEqual(['new@x.test'])
  })

  test('an address someone entered stays when a Google link with the same address ends (Codex review on #385)', async ({ admin }) => {
    const p = await makePerson({ full_name: 'Entered first' })
    const { addIdentifier } = await import('../src/person-identifiers')
    await addIdentifier(p, { system: 'email', value: 'entered@x.test' }, 'Administrator')
    await sql`insert into sign_in_identity (id, person_id, method, subject, email, linked_by)
      values ('uid_entered_google', ${p}, 'google', 'g-entered', 'entered@x.test', 'test')`
    const { writeThroughIdentity } = await import('../src/person-identifiers')
    await writeThroughIdentity('uid_entered_google')
    await admin.delete('/api/identities/uid_entered_google')
    expect(await current(p, 'email')).toEqual([{ value: 'entered@x.test', source: 'manual' }])
  })

  test('a value recorded after its mirror takes the row over, so ending the link keeps it (Codex review on #385)', async ({ admin }) => {
    const p = await makePerson({ full_name: 'Mirror first' })
    await sql`insert into sign_in_identity (id, person_id, method, subject, email, linked_by)
      values ('uid_mirror_first', ${p}, 'google', 'g-mirror-first', 'mirror.first@x.test', 'test')`
    const { addIdentifier, writeThroughIdentity } = await import('../src/person-identifiers')
    await writeThroughIdentity('uid_mirror_first')
    const recorded = await addIdentifier(p, { system: 'email', value: 'Mirror.First@x.test' }, 'Administrator')
    expect(recorded.result).toBe('updated')
    await admin.delete('/api/identities/uid_mirror_first')
    expect(await current(p, 'email')).toEqual([{ value: 'mirror.first@x.test', source: 'manual' }])
  })

  test('when the provider reports a new verified address for a link, the mirror moves with it (Codex review on #385)', async () => {
    const p = await makePerson({ full_name: 'Renamed' })
    await sql`insert into sign_in_identity (id, person_id, method, subject, email, linked_by)
      values ('uid_renamed', ${p}, 'google', 'g-renamed', 'linker@gmail.com', 'test')`
    const { writeThroughIdentity } = await import('../src/person-identifiers')
    const { touchIdentity } = await import('../src/identities')
    await writeThroughIdentity('uid_renamed')
    await touchIdentity('uid_renamed', { email: 'linker.renamed@gmail.com' })
    expect(await current(p, 'email')).toEqual([{ value: 'linker.renamed@gmail.com', source: 'sign-in' }])
  })

  test('a session opened through a link ends when the link ends, and the ended link never opens the account again', async ({ api, admin }) => {
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', 'trust-any-password')
    await configureDelegated()
    const p = await makePerson({ full_name: 'Ends' })
    const id = await linkDelegated(p, 'ends_login', { subject: 'RR-77' })
    const login = () => api.fetch('/api/login/delegated', { method: 'POST', body: JSON.stringify({ usr: 'RR-77', pwd: '', method: 'stylehr' }) })
    const { token } = (await (await login()).json()) as { token: string }
    await expectStatus(await as(api, token)('/api/whoami'), 200)
    await admin.delete(`/api/identities/${id}`)
    await expectStatus(await as(api, token)('/api/whoami'), 401)
    await expectStatus(await login(), 401)
  })
})

describe('a Google link that cannot finish comes back with its reason', () => {
  // Starts a link as `token` and approves it at the mock; returns the
  // callback URL and the challenge cookies the browser carries back.
  async function approvedLink(api: TestClient, token: string, email: string, subject: string) {
    const { callback, challenge } = await beginMockApproval(api, email, { token, name: 'Linker', subject })
    return { callback: callback as string, challenge }
  }

  test('a callback arriving with another person\'s session links nothing', async ({ api, admin }) => {
    await configureGoogle({ allowed_email_domains: '' })
    const starter = await passwordSession(api, admin, 'link.starter')
    const other = await passwordSession(api, admin, 'link.other')
    const { callback, challenge } = await approvedLink(api, starter.token, 'starter@gmail.com', 'g-starter')
    const res = await api.fetch(callback, { headers: { cookie: [`sid=${other.token}`, ...challenge].join('; ') } })
    expect(linkOutcome(res)).toBe('wrong_session')
    expect(await sql`select 1 from sign_in_identity where subject = 'g-starter'`).toHaveLength(0)
  })

  test('a link finished after self-linking was turned off links nothing', async ({ api, admin }) => {
    await configureGoogle({ allowed_email_domains: '' })
    const me = await passwordSession(api, admin, 'link.turned.off')
    const { callback, challenge } = await approvedLink(api, me.token, 'off@gmail.com', 'g-off')
    await configureGoogle({ self_link: false })
    const res = await api.fetch(callback, { headers: { cookie: [`sid=${me.token}`, ...challenge].join('; ') } })
    expect(linkOutcome(res)).toBe('not_allowed')
    expect(await sql`select 1 from sign_in_identity where subject = 'g-off'`).toHaveLength(0)
  })

  test('a link finished after Google was turned off comes back as a Google failure', async ({ api, admin }) => {
    await configureGoogle({ allowed_email_domains: '' })
    const me = await passwordSession(api, admin, 'link.google.off')
    const { callback, challenge } = await approvedLink(api, me.token, 'goneoff@gmail.com', 'g-gone-off')
    await configureGoogle({ enabled: false })
    const res = await api.fetch(callback, { headers: { cookie: [`sid=${me.token}`, ...challenge].join('; ') } })
    expect(linkOutcome(res)).toBe('google_failed')
  })

  test('a link finished in a preview session of the same person links nothing', async ({ api, admin }) => {
    await configureGoogle({ allowed_email_domains: '' })
    const me = await passwordSession(api, admin, 'link.preview.finish')
    const { callback, challenge } = await approvedLink(api, me.token, 'preview.finish@gmail.com', 'g-preview-finish')
    const preview = (await issueSession(me.id, { preview: true })).token
    const res = await api.fetch(callback, { headers: { cookie: [`sid=${preview}`, ...challenge].join('; ') } })
    expect(linkOutcome(res)).toBe('not_allowed')
    expect(await sql`select 1 from sign_in_identity where subject = 'g-preview-finish'`).toHaveLength(0)
  })

  test('a link finished once the sign-in is no longer fresh asks to sign in again', async ({ api, admin }) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    await configureGoogle({ allowed_email_domains: '' })
    const me = await passwordSession(api, admin, 'link.stale')
    vi.advanceTimersByTime(6 * 60_000)
    const { callback, challenge } = await approvedLink(api, me.token, 'stale@gmail.com', 'g-stale')
    vi.advanceTimersByTime(9.5 * 60_000)
    const res = await api.fetch(callback, { headers: { cookie: [`sid=${me.token}`, ...challenge].join('; ') } })
    expect(linkOutcome(res)).toBe('sign_in_again')
    expect(await sql`select 1 from sign_in_identity where subject = 'g-stale'`).toHaveLength(0)
  })

  test('a link whose call to Google fails outright comes back as failed', async ({ api, admin }) => {
    await configureGoogle({ client_id: 'client-1', allowed_email_domains: '' })
    const me = await passwordSession(api, admin, 'link.network')
    const start = await api.fetch('/api/oauth/google/link', { headers: { cookie: `sid=${me.token}` } })
    const state = new URL(start.headers.get('location') as string).searchParams.get('state') as string
    const cookie = [`sid=${me.token}`, ...start.headers.getSetCookie().map((c) => c.split(';')[0])].join('; ')
    await withGoogleFetch(async () => { throw new TypeError('fetch failed') }, async () => {
      const res = await api.fetch(`/api/oauth/google/callback?state=${encodeURIComponent(state)}&code=c`, { headers: { cookie } })
      expect(linkOutcome(res)).toBe('failed')
    })
  })

  test('linking the Google account a person already holds again keeps the one link', async ({ api, admin }) => {
    await configureGoogle({ allowed_email_domains: '' })
    const me = await passwordSession(api, admin, 'link.twice')
    expect(linkOutcome(await googleLink(api, me.token, 'twice@gmail.com', { subject: 'g-twice' }))).toBe('linked')
    expect(linkOutcome(await googleLink(api, me.token, 'twice@gmail.com', { subject: 'g-twice' }))).toBe('linked')
    expect(await sql`select person_id from sign_in_identity where subject = 'g-twice' and ended_at is null`).toEqual([{ person_id: me.id }])
  })

  test('a person linking the address they were invited on takes the invite over', async ({ api, admin }) => {
    await configureGoogle({ allowed_email_domains: '' })
    const me = await passwordSession(api, admin, 'link.invited')
    const invite = await inviteGoogleRaw(me.id, 'invited.self@gmail.com')
    expect(linkOutcome(await googleLink(api, me.token, 'invited.self@gmail.com', { subject: 'g-invited-self' }))).toBe('linked')
    expect(await sql`select 1 from sign_in_identity where id = ${invite}`).toHaveLength(0)
    expect(await sql`select person_id from sign_in_identity where subject = 'g-invited-self'`).toEqual([{ person_id: me.id }])
  })
})

describe('the sign-in pipeline refuses what it cannot vouch for', () => {
  const verified = { status: 'verified' as const, subject: 'g-pipeline', email: 'pipe@gmail.com', email_verified: true, display_name: null, hosted_domain: null }

  test('an outside identity with no subject resolves to nobody', async () => {
    const google = (await getSignInMethod('google'))!
    await expect(resolveVerified(google, { ...verified, subject: '' })).rejects.toThrow('Invalid login credentials')
  })

  test('a turned-off method completes no sign-in, even for a verified identity', async () => {
    await configureGoogle({ enabled: false, allowed_email_domains: '*' })
    const google = (await getSignInMethod('google'))!
    await expect(completeSignIn(google, verified, null)).rejects.toThrow('Invalid login credentials')
    expect(await sql`select 1 from sign_in_identity where subject = 'g-pipeline'`).toHaveLength(0)
  })

  test('a method with no label that is not answering is named by its key', async () => {
    await configureDelegated()
    const delegated = { ...(await getSignInMethod('stylehr'))!, label: '' }
    await expect(completeSignIn(delegated, { status: 'unavailable' }, null)).rejects.toThrow('stylehr is not responding right now')
  })

  test('a method with no label that shows an unknown account as gone is named by its key', async () => {
    await configureDelegated()
    const delegated = { ...(await getSignInMethod('stylehr'))!, label: '' }
    await expect(completeSignIn(delegated, { status: 'left' }, null)).rejects.toThrow('stylehr shows this account as no longer active')
  })

  test('a Google sign-in that carries no address keeps the one on file, no longer verified', async () => {
    await configureGoogle({ allowed_email_domains: '' })
    const me = await makePerson({})
    const google = (await getSignInMethod('google'))!
    const id = await linkVerifiedToSelf(google, me, { ...verified, subject: 'g-no-address' })
    await completeSignIn(google, { ...verified, subject: 'g-no-address', email: undefined }, null)
    expect(await sql`select email, email_verified from sign_in_identity where id = ${id}`).toEqual([{ email: 'pipe@gmail.com', email_verified: false }])
  })

  test('a self-link from an address Google has not verified records no address', async () => {
    await configureGoogle({ allowed_email_domains: '' })
    const me = await makePerson({})
    const google = (await getSignInMethod('google'))!
    const id = await linkVerifiedToSelf(google, me, { ...verified, subject: 'g-unverified-self', email_verified: false })
    expect(await sql`select email, email_verified from sign_in_identity where id = ${id}`).toEqual([{ email: null, email_verified: false }])
  })

  test('a self-link Google vouches for but sends no address for records no address', async () => {
    await configureGoogle({ allowed_email_domains: '' })
    const me = await makePerson({})
    const google = (await getSignInMethod('google'))!
    const id = await linkVerifiedToSelf(google, me, { ...verified, subject: 'g-blank-self', email: undefined })
    expect(await sql`select email from sign_in_identity where id = ${id}`).toEqual([{ email: null }])
  })

  test('a self-link from a company address whose Google account names another hosted domain is refused', async () => {
    await configureGoogle({ allowed_email_domains: 'acme.example' })
    const me = await makePerson({})
    const google = (await getSignInMethod('google'))!
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(linkVerifiedToSelf(google, me, { ...verified, subject: 'g-other-hd', email: 'jo@acme.example', hosted_domain: 'other.example' }))
      .rejects.toMatchObject({ type: 'PermissionError' })
    expect(warn).toHaveBeenCalledWith('[link] google: self-link refused (hosted domain differs; hd present)')
  })

  test('a method that does not vouch for its subjects cannot be linked by its owner', async () => {
    await configureDelegated()
    const me = await makePerson({})
    const delegated = (await getSignInMethod('stylehr'))!
    await expect(linkVerifiedToSelf(delegated, me, verified)).rejects.toMatchObject({ type: 'PermissionError' })
  })
})

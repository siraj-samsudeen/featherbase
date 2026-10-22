// person-identities (D6): administrators link, invite, rename, move and
// unlink; a signed-in person links Google by proving it, and can remove a
// method but never their last way in.
import { describe, expect, vi, afterEach } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { makePerson } from './fixtures'
import { sign } from 'hono/jwt'
import { configureDelegated, giveEmployeeCode, configureGoogle, inviteGoogleRaw, linkDelegated } from './identity-fixtures'
import { googleLink, googleSignIn, linkOutcome, redeemSession } from './google-mock'

afterEach(() => {
  vi.useRealTimers()
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
    expect((await as(api, tl)(`/api/people/${rr10}/identities`)).status).toBe(403)

    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', 'trust-any-password')
    const { token } = (await (await api.fetch('/api/login/delegated', { method: 'POST', body: JSON.stringify({ usr: 'RR-10', pwd: '', method: 'stylehr' }) })).json()) as { token: string }
    vi.unstubAllEnvs()
    const who = () => as(api, token)('/api/whoami')
    expect((await who()).status).toBe(200)

    expect((await admin.fetch(`/api/identities/${linked.id}`, { method: 'PATCH', body: JSON.stringify({ sign_in_name: 'tl_10_new' }) })).status).toBe(200)
    expect((await who()).status).toBe(200)
    const [renamed] = await sql`select sign_in_name from sign_in_identity where id = ${linked.id}`
    expect(renamed.sign_in_name).toBe('tl_10_new')

    const moveRes = await admin.fetch(`/api/identities/${linked.id}`, { method: 'PATCH', body: JSON.stringify({ person_id: rr11 }) })
    expect(moveRes.status).toBe(200)
    const moved = (await moveRes.json()) as { id: string }
    expect((await who()).status).toBe(401)
    // person-resolution D4/D5: the move keeps who held it until when.
    const listed = (await admin.get(`/api/people/${rr11}/identities`)) as { identities: { id: string; subject: string; ended_at: string | null }[] }
    expect(listed.identities.map((i) => [i.id, i.subject, i.ended_at])).toEqual([[moved.id, 'RR-10', null]])
    const history = (await admin.get(`/api/people/${rr10}/identities`)) as { identities: { id: string; ended_reason: string | null }[] }
    expect(history.identities.map((i) => [i.id, i.ended_reason])).toEqual([[linked.id, 'moved']])

    // Unlinking ends the link and keeps it as history; the id can be linked afresh.
    expect((await admin.fetch(`/api/identities/${moved.id}`, { method: 'DELETE' })).status).toBe(200)
    expect(await sql`select ended_reason from sign_in_identity where id = ${moved.id}`).toEqual([{ ended_reason: 'unlinked' }])
    expect((await admin.fetch(`/api/people/${rr11}/identities`, { method: 'POST', body: JSON.stringify({ method: 'stylehr', subject: 'RR-10' }) })).status).toBe(201)
  })

  test('a collision is refused atomically and names that it is already linked', async ({ admin }) => {
    await configureDelegated()
    const rr20 = await makePerson({})
    const rr21 = await makePerson({})
    await admin.post(`/api/people/${rr20}/identities`, { method: 'stylehr', subject: 'RR-20' })
    const res = await admin.fetch(`/api/people/${rr21}/identities`, { method: 'POST', body: JSON.stringify({ method: 'stylehr', subject: 'RR-20' }) })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain('already linked')
  })

  test('service accounts get no sign-in methods', async ({ admin }) => {
    await configureDelegated()
    const svc = (await admin.post('/api/service_accounts', { label: 'svc-link-test' })) as { row_id: string }
    // A service account is not a person: it has no person row (and so no email).
    expect(await sql`select 1 from person where row_id = ${svc.row_id}`).toHaveLength(0)
    expect((await admin.fetch(`/api/people/${svc.row_id}/identities`, { method: 'POST', body: JSON.stringify({ method: 'stylehr', subject: 'S-1' }) })).status).toBe(417)
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
    const old = await sign({ sub: stale, iat: now - 3600, exp: now + 3600, m: 'password' }, secret)
    await admin.post('/api/set_password', { user: stale, password: 'stale-pw-1' })
    // Minted before the upgrade: ended at deploy, it opens nothing.
    expect((await as(api, noIat)('/api/oauth/google/link', { redirect: 'manual' })).status).toBe(401)
    expect((await as(api, noIat)('/api/whoami')).status).toBe(401)
    // Signed in an hour ago: must sign in again first.
    expect((await as(api, old)('/api/oauth/google/link', { redirect: 'manual' })).status).toBe(401)
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
      expect((await as(api, token)(`/api/me/identities/${hr}`, { method: 'DELETE' })).status).toBe(409)
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
    const { id } = await admin.post<{ id: string }>(`/api/people/${p}/identities`, { method: 'stylehr', subject: '48213', sign_in_name: 'wt_login' })
    expect(await current(p, 'stylehr-employee-id')).toEqual([{ value: '48213', source: 'sign-in' }])
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
    expect(await sql`select upper(valid)::text as until from person_identifier where person_id = ${outgoing} and system = 'email'`).toEqual([
      { until: new Date().toISOString().slice(0, 10) },
    ])
    expect(await current(incoming, 'email')).toEqual([{ value: 'sm.atk@jeyarama.com', source: 'sign-in' }])
    expect(await sql`select ended_reason from sign_in_identity where id = 'uid_mailbox_atk'`).toEqual([{ ended_reason: 'moved' }])
    expect(moved.id).not.toBe('uid_mailbox_atk')
  })

  test('a session opened through a link ends when the link ends, and the ended link never opens the account again', async ({ api, admin }) => {
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', 'trust-any-password')
    await configureDelegated()
    const p = await makePerson({ full_name: 'Ends' })
    const id = await linkDelegated(p, 'ends_login', { subject: 'RR-77' })
    const login = () => api.fetch('/api/login/delegated', { method: 'POST', body: JSON.stringify({ usr: 'RR-77', pwd: '', method: 'stylehr' }) })
    const { token } = (await (await login()).json()) as { token: string }
    expect((await as(api, token)('/api/whoami')).status).toBe(200)
    await admin.delete(`/api/identities/${id}`)
    expect((await as(api, token)('/api/whoami')).status).toBe(401)
    expect((await login()).status).toBe(401)
  })
})

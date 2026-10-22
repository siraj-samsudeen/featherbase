// person-identities (D6): administrators link, invite, rename, move and
// unlink; a signed-in person links Google by proving it, and can remove a
// method but never their last way in.
import { describe, expect, vi, afterEach } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
import { sign } from 'hono/jwt'
import { configureDelegated, configureGoogle, inviteGoogleRaw, linkDelegated } from './identity-fixtures'
import { googleLink, googleSignIn, linkOutcome, redeemSession } from './google-mock'

afterEach(() => {
  vi.useRealTimers()
})

async function passwordSession(api: TestClient, admin: TestClient, user: string) {
  await saveDoc('User', { row_id: user, enabled: true }, 'Administrator')
  await admin.post('/api/set_password', { user, password: `${user}-pw-1` })
  const res = await api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr: user, pwd: `${user}-pw-1` }) })
  return ((await res.json()) as { token: string }).token
}

const as = (api: TestClient, token: string) => (path: string, init: RequestInit = {}) =>
  api.fetch(path, { ...init, headers: { authorization: `Bearer ${token}` } })

describe('an administrator links sign-in methods', () => {
  test('link, rename (sessions survive), move (sessions end) and unlink', async ({ api, admin }) => {
    await configureDelegated()
    await saveDoc('User', { row_id: 'RR-10', enabled: true }, 'Administrator')
    await saveDoc('User', { row_id: 'RR-11', enabled: true }, 'Administrator')
    const linked = (await admin.post('/api/users/RR-10/identities', { method: 'stylehr', subject: 'RR-10', sign_in_name: 'tl_10' })) as { id: string }
    // A non-admin cannot.
    const tl = await passwordSession(api, admin, 'plain.person')
    expect((await as(api, tl)('/api/users/RR-10/identities')).status).toBe(403)

    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', 'trust-any-password')
    const { token } = (await (await api.fetch('/api/login/delegated', { method: 'POST', body: JSON.stringify({ usr: 'RR-10', pwd: '' }) })).json()) as { token: string }
    vi.unstubAllEnvs()
    const who = () => as(api, token)('/api/whoami')
    expect((await who()).status).toBe(200)

    expect((await admin.fetch(`/api/identities/${linked.id}`, { method: 'PATCH', body: JSON.stringify({ sign_in_name: 'tl_10_new' }) })).status).toBe(200)
    expect((await who()).status).toBe(200)
    const [renamed] = await sql`select sign_in_name from user_identity where id = ${linked.id}`
    expect(renamed.sign_in_name).toBe('tl_10_new')

    expect((await admin.fetch(`/api/identities/${linked.id}`, { method: 'PATCH', body: JSON.stringify({ user_id: 'RR-11' }) })).status).toBe(200)
    expect((await who()).status).toBe(401)
    const listed = (await admin.get('/api/users/RR-11/identities')) as { identities: { id: string }[] }
    expect(listed.identities.map((i) => i.id)).toEqual([linked.id])

    expect((await admin.fetch(`/api/identities/${linked.id}`, { method: 'DELETE' })).status).toBe(200)
    expect(await sql`select 1 from user_identity where id = ${linked.id}`).toHaveLength(0)
  })

  test('a collision is refused atomically and names that it is already linked', async ({ admin }) => {
    await configureDelegated()
    await saveDoc('User', { row_id: 'RR-20', enabled: true }, 'Administrator')
    await saveDoc('User', { row_id: 'RR-21', enabled: true }, 'Administrator')
    await admin.post('/api/users/RR-20/identities', { method: 'stylehr', subject: 'RR-20' })
    const res = await admin.fetch('/api/users/RR-21/identities', { method: 'POST', body: JSON.stringify({ method: 'stylehr', subject: 'RR-20' }) })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain('already linked')
  })

  test('service accounts get no sign-in methods', async ({ admin }) => {
    await configureDelegated()
    await admin.post('/api/service_accounts', { row_id: 'svc-link-test' })
    const [svc] = await sql`select email from "user" where row_id = 'svc-link-test'`
    expect(svc.email).toBeNull()
    expect((await admin.fetch('/api/users/svc-link-test/identities', { method: 'POST', body: JSON.stringify({ method: 'stylehr', subject: 'S-1' }) })).status).toBe(417)
  })
})

describe('a person links Google themselves', () => {
  test('a fresh session links a Google account, which then opens the same account', async ({ api, admin }) => {
    await configureGoogle({ allowed_email_domains: '' })
    const token = await passwordSession(api, admin, 'linker')
    const res = await googleLink(api, token, 'linker@gmail.com', { subject: 'g-linker' })
    expect(linkOutcome(res)).toBe('linked')
    const signedIn = await googleSignIn(api, 'linker.renamed@gmail.com', { subject: 'g-linker' })
    expect((await redeemSession(api, signedIn)).user.row_id).toBe('linker')
  })

  test('a Google account linked to someone else, or reserved for them, is refused', async ({ api, admin }) => {
    await saveDoc('User', { row_id: 'owner', enabled: true }, 'Administrator')
    await sql`insert into user_identity (id, user_id, method, subject, linked_by) values ('uid_owner', 'owner', 'google', 'g-owned', 'test')`
    await inviteGoogleRaw('owner', 'reserved@gmail.com')
    const token = await passwordSession(api, admin, 'grabber')
    expect(linkOutcome(await googleLink(api, token, 'x@gmail.com', { subject: 'g-owned' }))).toBe('taken')
    expect(linkOutcome(await googleLink(api, token, 'reserved@gmail.com', { subject: 'g-new' }))).toBe('taken')
    expect(await sql`select 1 from user_identity where user_id = 'grabber'`).toHaveLength(0)
  })

  test('a stale session, or one minted before sessions carried their time, must sign in again', async ({ api, admin }) => {
    await saveDoc('User', { row_id: 'stale', enabled: true }, 'Administrator')
    const secret = process.env.JWT_SECRET ?? 'dev-secret-change-me'
    const now = Math.floor(Date.now() / 1000)
    const noIat = await sign({ sub: 'stale', exp: now + 3600 }, secret)
    const old = await sign({ sub: 'stale', iat: now - 3600, exp: now + 3600, m: 'password' }, secret)
    await admin.post('/api/set_password', { user: 'stale', password: 'stale-pw-1' })
    for (const token of [noIat, old]) {
      const res = await as(api, token)('/api/oauth/google/link', { redirect: 'manual' })
      expect(res.status).toBe(401)
    }
  })

  test('removing a method: never the last one; a pending invite does not count', async ({ api, admin }) => {
    await configureDelegated()
    await saveDoc('User', { row_id: 'RR-30', enabled: true }, 'Administrator')
    const hr = await linkDelegated('RR-30', 'tl_30')
    await inviteGoogleRaw('RR-30', 'rr30@gmail.com')
    // A test-mode session cannot remove anything at all; use a real one.
    const { _setDelegatedFetch } = await import('../src/delegated-login')
    _setDelegatedFetch((async () => Response.json({ token: 'x' })) as unknown as typeof fetch)
    try {
      const res = await api.fetch('/api/login/delegated', { method: 'POST', body: JSON.stringify({ usr: 'tl_30', pwd: 'right' }) })
      const { token } = (await res.json()) as { token: string }
      expect((await as(api, token)(`/api/me/identities/${hr}`, { method: 'DELETE' })).status).toBe(409)
      const mine = (await (await as(api, token)('/api/me/sign_in_methods')).json()) as { identities: { linked: boolean }[] }
      expect(mine.identities.map((i) => i.linked).sort()).toEqual([false, true])
    } finally {
      _setDelegatedFetch(null)
    }
  })
})

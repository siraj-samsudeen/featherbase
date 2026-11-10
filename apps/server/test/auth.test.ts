import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { config } from '../src/config'
import { parseInstanceAddresses } from '../src/instance-addresses'
import { expectSessionCookie, setSessionHours } from './session-cookie-test-utils'
import { endedSessionIds, issueSession, renameAccessToken, revokeAccessToken } from '../src/auth'
import { expectRefused, expectStatus, makePerson } from './fixtures'

const json = (body: unknown) => ({
  method: 'POST',
  body: JSON.stringify(body),
})

describe('API-004: authentication', () => {
  test('login requires nonempty string credentials and never issues a cookie for a malformed credential shape', async ({ api }) => {
    for (const body of [{}, { usr: 'Administrator' }, { usr: '', pwd: 'admin' }, { usr: 'Administrator', pwd: '' }, { usr: 17, pwd: 'admin' }, { usr: 'Administrator', pwd: 41 }]) {
      const response = await api.fetch('/api/login', json(body))
      await expectStatus(response, 417)
      expect(await response.json()).toMatchObject({ error: { type: 'ValidationError', message: 'Expected { usr, pwd }' } })
      expect(response.headers.get('set-cookie')).toBeNull()
    }
  })

  test('password recovery rejects truncated JSON before recording a reset or changing credentials', async ({ api }) => {
    const before = await sql`select row_id, password_hash from person order by row_id`
    const resets = await sql`select * from password_reset order by token`
    for (const [path, message] of [
      ['/api/reset_password_request', 'Expected { usr }'],
      ['/api/reset_password', 'Expected { key, new_password }'],
    ]) {
      const response = await api.fetch(path, { method: 'POST', body: '{"unfinished":' })
      await expectStatus(response, 417)
      expect(await response.json()).toMatchObject({ error: { type: 'ValidationError', message } })
      expect(response.headers.get('set-cookie')).toBeNull()
    }
    expect(await sql`select row_id, password_hash from person order by row_id`).toEqual(before)
    expect(await sql`select * from password_reset order by token`).toEqual(resets)
  })

  test('an enabled delegated method still requires a valid request and never defaults an unknown method', async ({ api, admin }) => {
    await admin.post('/api/save_row', { table: 'Sign In Method', row: {
      row_id: 'request-shape', kind: 'delegated_password', label: 'Request shape', enabled: true,
      new_person: 'refuse', self_link: false, service_url: 'https://provider.example.test/login',
    } })
    const malformed = await api.fetch('/api/login/delegated', { method: 'POST', body: '{"unfinished":' })
    await expectStatus(malformed, 417)
    expect(await malformed.json()).toMatchObject({ error: { type: 'ValidationError', message: 'Expected { usr, pwd, method }' } })
    expect(malformed.headers.get('set-cookie')).toBeNull()
    const unknown = await api.fetch('/api/login/delegated', json({ method: 'not-configured', usr: 'someone', pwd: 'never-forwarded' }))
    await expectStatus(unknown, 404)
    expect(unknown.headers.get('set-cookie')).toBeNull()
  })

  test('password sign-in gives the sid cookie the configured session lifetime', async ({ api }) => {
    for (const hours of [1, 720]) {
      await setSessionHours(hours)
      const before = Math.floor(Date.now() / 1000)
      const res = await api.fetch(
        '/api/login',
        json({ usr: 'Administrator', pwd: process.env.ADMIN_PASSWORD ?? 'admin' }),
      )
      const after = Math.floor(Date.now() / 1000)
      await expectStatus(res, 200)
      expectSessionCookie(res, hours, { before, after })
      const body = (await res.json()) as Record<string, unknown>
      expect(Object.keys(body).filter((key) => !['token', 'user', 'landing', 'apps'].includes(key))).toEqual([])
    }
  })

  test('session lifetime keeps its eight-hour fallback and 1–720 hour bounds', async ({ api }) => {
    for (const [configured, expected] of [
      [0, 8],
      [-2, 1],
      [900, 720],
    ]) {
      await setSessionHours(configured)
      const before = Math.floor(Date.now() / 1000)
      const res = await api.fetch(
        '/api/login',
        json({ usr: 'Administrator', pwd: process.env.ADMIN_PASSWORD ?? 'admin' }),
      )
      const after = Math.floor(Date.now() / 1000)
      expectSessionCookie(res, expected, { before, after })
    }
  })

  test('login with valid credentials yields a token and user', async ({ api }) => {
    const res = await api.fetch(
      '/api/login',
      json({ usr: 'Administrator', pwd: process.env.ADMIN_PASSWORD ?? 'admin' }),
    )
    await expectStatus(res, 200)
    const body = (await res.json()) as { token: string; user: { row_id: string } }
    expect(body.token.split('.')).toHaveLength(3)
    expect(body.user.row_id).toBe('Administrator')
  })

  test('login also works by email; wrong password is 401', async ({ api }) => {
    // person-identities: the 0005 seed address is cleared by the upgrade; give
    // the Administrator a real one to sign in by.
    await sql`update person set email = 'admin@example.com' where row_id = 'Administrator'`
    const byEmail = await api.fetch(
      '/api/login',
      json({ usr: 'admin@example.com', pwd: process.env.ADMIN_PASSWORD ?? 'admin' }),
    )
    await expectStatus(byEmail, 200)
    const bad = await api.fetch('/api/login', json({ usr: 'Administrator', pwd: 'nope' }))
    await expectStatus(bad, 401)
  })

  test('requests without a token are rejected; garbage tokens too', async ({ api }) => {
    await expectStatus(await api.fetch('/api/table/Table'), 401)
    await expectStatus(await api.fetch('/api/whoami'), 401)
    expect(
      (
        await api.fetch('/api/whoami', {
          headers: { authorization: 'Bearer not.a.jwt' },
        })
      ).status,
    ).toBe(401)
  })

  test('a valid token resolves the correct user and stamps ownership', async ({ admin }) => {
    const me = await admin.get<{ row_id: string }>('/api/whoami')
    expect(me.row_id).toBe('Administrator')
  })

  test('ping stays public', async ({ api }) => {
    await expectStatus(await api.fetch('/api/ping'), 200)
  })

  // #101: the sid cookie is a live credential; sign-out must expire it even
  // when no bearer token accompanies the request (the SPA has already
  // dropped its token by the time a stale tab retries).
  test('logout is public and expires the sid cookie', async ({ api }) => {
    const login = await api.fetch(
      '/api/login',
      json({ usr: 'Administrator', pwd: process.env.ADMIN_PASSWORD ?? 'admin' }),
    )
    expect(login.headers.get('set-cookie')).toContain('sid=')

    const res = await api.fetch('/api/logout', { method: 'POST' })
    await expectStatus(res, 200)
    const cleared = res.headers.get('set-cookie') ?? ''
    expect(cleared).toContain('sid=')
    expect(cleared.toLowerCase()).toContain('max-age=0')
  })
})

// #353: the sid cookie follows the sign-in challenge cookies' rule: Secure
// whenever the instance's external origin is https, and not on a plain-http
// local origin, where a browser would silently drop a Secure cookie.
describe('the sid cookie is sent only over a secure connection on a secure address', () => {
  const sidOf = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith('sid=')) ?? ''
  const signIn = (api: { fetch: (url: string, init?: RequestInit) => Promise<Response> }, url: string, headers: Record<string, string> = {}) =>
    api.fetch(url, { ...json({ usr: 'Administrator', pwd: process.env.ADMIN_PASSWORD ?? 'admin' }), headers })

  test('a configured https address makes sign-in and sign-out cookies Secure, whatever the header says', async ({ api }) => {
    const previous = config.instanceAddresses
    config.instanceAddresses = parseInstanceAddresses('[{"address":"https://app.example.com","opens":"admin","emails":true}]', 'test')
    try {
      const login = await signIn(api, 'http://app.example.com/api/login', { 'x-forwarded-proto': 'http' })
      await expectStatus(login, 200)
      expect(sidOf(login)).toMatch(/;\s*Secure(?:;|$)/i)
      const logout = await api.fetch('http://app.example.com/api/logout', { method: 'POST' })
      expect(sidOf(logout)).toMatch(/;\s*Secure(?:;|$)/i)
    } finally {
      config.instanceAddresses = previous
    }
  })

  test('a request forwarded over https gets a Secure cookie, even through a proxy that appends its hop', async ({ api }) => {
    for (const proto of ['https', 'https,http']) {
      const login = await signIn(api, '/api/login', { 'x-forwarded-proto': proto })
      await expectStatus(login, 200)
      expect(sidOf(login), proto).toMatch(/;\s*Secure(?:;|$)/i)
    }
  })

  test('a plain-http local origin keeps a cookie without Secure, so signing in still works there', async ({ api }) => {
    const login = await signIn(api, '/api/login')
    await expectStatus(login, 200)
    expect(sidOf(login)).toMatch(/^sid=/)
    expect(sidOf(login)).not.toMatch(/;\s*Secure/i)
    const logout = await api.fetch('/api/logout', { method: 'POST' })
    expect(sidOf(logout)).not.toMatch(/;\s*Secure/i)
  })
})

describe('reading a credential for sign-out and from the cookie', () => {
  test('a percent-encoded sid cookie is decoded, and a malformed or empty one is not a credential', async () => {
    const { credentialFromCookieHeader } = await import('../src/auth')
    expect(credentialFromCookieHeader('a=1; sid=ab%2Bcd')).toBe('Bearer ab+cd')
    expect(credentialFromCookieHeader('sid=%E0%A4%A')).toBeUndefined()
    expect(credentialFromCookieHeader('sid=')).toBeUndefined()
    expect(credentialFromCookieHeader('novalue; other=1')).toBeUndefined()
    expect(credentialFromCookieHeader(undefined)).toBeUndefined()
  })

  test('only a correctly signed session token with an id and an expiry names a session to sign out', async () => {
    const { sessionToRevoke } = await import('../src/auth')
    const { sign } = await import('hono/jwt')
    const secret = process.env.JWT_SECRET ?? 'dev-secret-change-me'
    const exp = Math.floor(Date.now() / 1000) - 60 // expired sessions still sign out
    expect(await sessionToRevoke('Bearer not-a-jwt')).toBeNull()
    expect(await sessionToRevoke(`Bearer ${await sign({ sub: 'p', jti: 'j', exp }, 'a-different-secret')}`)).toBeNull()
    expect(await sessionToRevoke(`Bearer ${await sign({ sub: 'p', exp }, secret)}`)).toBeNull()
    expect(await sessionToRevoke(`Bearer ${await sign({ sub: 'p', jti: 'j' }, secret)}`)).toBeNull()
    expect(await sessionToRevoke(`Bearer ${await sign({ sub: 'p', jti: 'j', exp }, secret)}`)).toEqual({ jti: 'j', person: 'p', expiresAt: exp })
  })
})

describe('credentials that cannot be honoured', () => {
  test('a stored password hash without a salt signs nobody in', async ({ api }) => {
    const person = await makePerson({ email: 'corrupt.hash@example.com' })
    await sql`update person set password_hash = 'no-salt-here' where row_id = ${person}`
    await expectStatus(await api.fetch('/api/login', json({ usr: 'corrupt.hash@example.com', pwd: 'no-salt-here' })), 401)
  })

  test('a session whose expiry has already passed is never issued', async () => {
    const person = await makePerson({ email: 'late.session@example.com' })
    await expect(issueSession(person, { expiresAt: Math.floor(Date.now() / 1000) - 1 }))
      .rejects.toMatchObject({ type: 'AuthenticationError', message: 'Invalid or expired session' })
  })

  test('a token for an account that does not exist is refused as not found', async ({ admin }) => {
    await expectRefused(admin.post('/api/access_tokens', { label: 'ghost', owner: 'psn_nobody_at_all' }), 404, 'psn_nobody_at_all not found')
    expect(await sql`select 1 from access_token where label = 'ghost'`).toHaveLength(0)
  })

  test('renaming or revoking a token that does not exist is refused as not found', async () => {
    await expect(renameAccessToken('tok_missing', 'new name', 'Administrator')).rejects.toMatchObject({ type: 'NotFoundError' })
    await expect(revokeAccessToken('tok_missing')).rejects.toMatchObject({ type: 'NotFoundError' })
  })

  test('with no open sessions to check, none has ended', async () => {
    expect(await endedSessionIds([])).toEqual(new Set())
  })
})

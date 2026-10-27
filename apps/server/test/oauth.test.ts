import { afterEach, describe, expect, vi } from 'vitest'
import { test } from './pg-test'
import { config } from '../src/config'
import { parseInstanceAddresses } from '../src/instance-addresses'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
import { makePerson } from './fixtures'
import { mockConsentHtml } from '../src/oauth'
import type { TestClient } from 'feather-testing-postgres'
import { expectSessionCookie, setSessionHours } from './session-cookie-test-utils'
import { configureGoogle, inviteGoogleRaw } from './identity-fixtures'
import { CLIENT, FROM_CLIENT, signInAddresses } from './sign-in-address-utils'

// PLAT-006: Google OAuth server-side flow, driven through the dev mock
// provider (no google_client_id in System Settings, ALLOW_MOCK_OAUTH=1 from
// vitest.config.ts). The browser dance is three redirects: login → consent →
// approve → callback; chased by hand. The login challenge (state + PKCE
// verifier) rides HttpOnly cookies, so these tests carry cookies between hops
// exactly as a browser would — that binding is the point of the CSRF fix.
// The domain allowlist is instance config in System Settings, so tests set it
// inside their sandbox transaction — no env vars, no cleanup.

// person-identities: Google is the Sign In Method row `google`.
const setAllowedDomains = (value: string) => configureGoogle({ allowed_email_domains: value })
const setClientId = (value: string) => configureGoogle({ client_id: value })

// One browser starting a sign-in: the login route mints the state and sets the
// cookies that bind it to this browser. Every later hop must present them back.
async function beginLogin(api: TestClient): Promise<{ state: string; cookie: string }> {
  const res = await api.fetch('/api/oauth/google/login')
  const location = res.headers.get('location') as string
  const state = new URLSearchParams(location.split('?')[1]).get('state') as string
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  return { state, cookie }
}

function approveUrl(state: string, email: string, name: string, extra: { subject?: string; hd?: string } = {}): string {
  return (
    '/api/oauth/mock/approve?' +
    new URLSearchParams({ state, redirect_uri: '/api/oauth/google/callback', email, name, ...extra }).toString()
  )
}

async function mockSignIn(api: TestClient, email: string, name = 'Test User', extra: { subject?: string; hd?: string } = {}) {
  const { state, cookie } = await beginLogin(api)
  const approve = await api.fetch(approveUrl(state, email, name, extra), { headers: { cookie } })
  if (approve.status !== 302) return approve
  return api.fetch(approve.headers.get('location') as string, { headers: { cookie } })
}

// #150: what the callback hands the SPA is a one-time handoff code, not the
// session token. These two read the landing redirect the way the SPA does.
function handoffCode(res: Response): string | null {
  const location = res.headers.get('location') as string
  return new URLSearchParams(location.split('?')[1] ?? '').get('code')
}

function sidCookie(res: Response): string {
  const sid = res.headers.getSetCookie().find((c) => c.startsWith('sid='))
  return sid?.split(';')[0] ?? ''
}

function redeem(api: TestClient, code: string | null, cookie: string) {
  return api.fetch('/api/oauth/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ code }),
  })
}

describe('PLAT-006: OAuth sign-in (mock provider)', () => {
  test('Google sign-in gives the sid cookie the configured session lifetime', async ({ api }) => {
    await setAllowedDomains('*')
    for (const hours of [1, 720]) {
      await setSessionHours(hours)
      const before = Math.floor(Date.now() / 1000)
      const res = await mockSignIn(api, `session-${hours}@example.com`)
      const after = Math.floor(Date.now() / 1000)
      expect(res.status).toBe(302)
      const cookie = expectSessionCookie(res, hours, { before, after })
      const redeemed = await redeem(api, handoffCode(res), cookie)
      expect(redeemed.status).toBe(200)
      expect(Object.keys((await redeemed.json()) as object).sort()).toEqual(['token', 'user'])
    }
  })

  test('the mock consent page begins with a standards-mode doctype', () => {
    expect(mockConsentHtml('state', '/api/oauth/google/callback', 'person@example.com', 'Test User'))
      .toMatch(/^<!DOCTYPE html>/)
  })

  test('full mock flow provisions a user and hands the SPA a session', async ({ api }) => {
    await setAllowedDomains('*')
    const res = await mockSignIn(api, 'new.person@gmail.com')
    expect(res.status).toBe(302)
    const landing = res.headers.get('location') as string
    // #150: the landing URL carries a handoff code and no session token. The
    // assertion used to be `/oauth-callback?token=` — the change of expectation
    // IS the fix, not an accommodation of one.
    expect(landing).toContain('/oauth-callback?code=')
    expect(landing).not.toContain('token=')

    // The SPA redeems that code over POST, presenting the sid cookie the same
    // response set, and gets the session it needs (its WebSocket and private
    // file URLs carry the literal token).
    const redeemed = await redeem(api, handoffCode(res), sidCookie(res))
    expect(redeemed.status).toBe(200)
    const session = (await redeemed.json()) as { token: string; user: { row_id: string } }
    // person-identities: a person Google creates gets an opaque, permanent id
    // (the warehouse person_id), never the address.
    expect(session.user.row_id).toMatch(/^psn_[a-z2-7]{20}$/)
    expect(session.user).toMatchObject({ email: 'new.person@gmail.com', full_name: 'Test User' })
    // The token is a real session: it authenticates as that user.
    const whoami = await api.fetch('/api/whoami', {
      headers: { authorization: `Bearer ${session.token}` },
    })
    expect(whoami.status).toBe(200)
    expect(((await whoami.json()) as { row_id: string }).row_id).toBe(session.user.row_id)

    // person-identities: the new person is linked by Google's account ID.
    const [user] = await sql`
      select u.enabled, i.subject, i.method from person u join sign_in_identity i on i.person_id = u.row_id
      where u.email = 'new.person@gmail.com'`
    expect(user).toMatchObject({ enabled: true, method: 'google', subject: 'new.person@gmail.com' })
  })

  // #150: the code is a one-shot. The copy left behind in browser history, in
  // a Referer header or in a proxy log is already spent by the time anyone
  // reads it — unlike the 7-day session JWT that used to be in that URL.
  test('a handoff code cannot be redeemed twice', async ({ api }) => {
    await setAllowedDomains('*')
    const res = await mockSignIn(api, 'replay@gmail.com')
    const code = handoffCode(res)
    const cookie = sidCookie(res)
    expect((await redeem(api, code, cookie)).status).toBe(200)
    expect((await redeem(api, code, cookie)).status).toBe(401)
  })

  // And it is bound to the browser it was minted for: redemption requires the
  // sid cookie set by the same callback response. A code lifted from the URL
  // is worth nothing in another browser.
  test('a handoff code redeemed without the matching sid cookie is refused', async ({ api }) => {
    await setAllowedDomains('*')
    const res = await mockSignIn(api, 'bound@gmail.com')
    const code = handoffCode(res)
    expect((await redeem(api, code, '')).status).toBe(401)
    const other = await mockSignIn(api, 'someone.else@gmail.com')
    expect((await redeem(api, code, sidCookie(other))).status).toBe(401)
    // Burned by the failed attempts — the right browser cannot use it either.
    expect((await redeem(api, code, sidCookie(res))).status).toBe(401)
  })

  test('an unknown or missing handoff code is refused', async ({ api }) => {
    expect((await redeem(api, 'not-a-real-code', '')).status).toBe(401)
    expect((await redeem(api, null, '')).status).toBe(401)
  })

  test('blank allowed_login_domains blocks auto-provisioning by default', async ({ api }) => {
    await setAllowedDomains('')
    const denied = await mockSignIn(api, 'unconfigured@gmail.com')
    expect(denied.status).toBe(401)
    const [row] = await sql`select 1 from person where email = 'unconfigured@gmail.com'`
    expect(row).toBeUndefined()
  })

  test('* explicitly allows auto-provisioning from any domain', async ({ api }) => {
    await setAllowedDomains('*')
    const admitted = await mockSignIn(api, 'explicit-anywhere@outside.io')
    expect(admitted.status).toBe(302)
    const [user] = await sql`
      select u.enabled, i.method from person u join sign_in_identity i on i.person_id = u.row_id
      where u.email = 'explicit-anywhere@outside.io'`
    expect(user).toMatchObject({ method: 'google', enabled: true })
  })

  test('* still rejects malformed provider identities', async ({ api }) => {
    await setAllowedDomains('*')
    // Missing and repeated separators distinguish "contains @" from exactly
    // one non-empty, non-whitespace local part and domain.
    for (const email of ['not-an-email', 'user@@example.com']) {
      const denied = await mockSignIn(api, email)
      expect(denied.status).toBe(401)
      const [row] = await sql`
        select 1 from person where email = ${email} or row_id = ${email}`
      expect(row).toBeUndefined()
    }
  })

  test('allowed_login_domains blocks auto-provisioning foreign domains', async ({ api }) => {
    await setAllowedDomains('jeyarama.com')
    const denied = await mockSignIn(api, 'stranger@gmail.com')
    expect(denied.status).toBe(401)
    const [row] = await sql`select 1 from person where email = 'stranger@gmail.com'`
    expect(row).toBeUndefined()

    const admitted = await mockSignIn(api, 'admitted@jeyarama.com')
    expect(admitted.status).toBe(302)
    expect(admitted.headers.get('location')).toContain('/oauth-callback?code=')
  })

  // person-identities: an existing account is reached through a linked
  // Google account or an invite, never because its email matches.
  test('an invited existing user signs in when auto-provisioning is disabled', async ({ api, admin }) => {
    const contractor = await makePerson({ email: 'contractor@outside.io', roles: [] })
    await setAllowedDomains('')
    expect((await mockSignIn(api, 'contractor@outside.io')).status).toBe(401)
    await admin.post(`/api/people/${contractor}/identities`, { method: 'google', email: 'contractor@outside.io' })
    const res = await mockSignIn(api, 'contractor@outside.io')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('/oauth-callback?code=')
  })

  test('a google_client_id in System Settings switches to the real provider', async ({ api }) => {
    await setClientId('test-client-id')
    const res = await api.fetch('/api/oauth/google/login')
    expect(res.status).toBe(302)
    const loc = res.headers.get('location') as string
    expect(loc).toContain('https://accounts.google.com/o/oauth2/v2/auth')
    expect(loc).toContain('client_id=test-client-id')
    expect(loc).toContain('redirect_uri=')
    // PKCE: the authorize redirect carries an S256 challenge, so a stolen
    // authorization code is useless without this browser's verifier.
    expect(loc).toContain('code_challenge_method=S256')
    expect(new URLSearchParams(loc.split('?')[1]).get('code_challenge')).toMatch(/^[\w-]{43}$/)
    // With a real provider active, the mock endpoints refuse.
    expect((await api.fetch('/api/oauth/mock/consent')).status).toBe(417)
  })

  // --- Defect A: the mock must fail CLOSED ----------------------------------
  // It used to be gated on `NODE_ENV === 'production'`, so an unset or
  // misspelled NODE_ENV — or a System Manager blanking google_client_id in the
  // Admin UI — left a pre-auth, un-rate-limited endpoint that minted a session
  // for any typed email, `Administrator` included.
  test('a blank google_client_id does NOT open the mock when ALLOW_MOCK_OAUTH is unset', async ({
    api,
  }) => {
    // Hold a validly signed state minted while the mock was still enabled:
    // even that must not get past the gate.
    const { state, cookie } = await beginLogin(api)
    await setClientId('') // explicitly blank — the exact state that used to fail open

    const prev = process.env.ALLOW_MOCK_OAUTH
    delete process.env.ALLOW_MOCK_OAUTH
    try {
      expect((await api.fetch('/api/oauth/mock/consent')).status).toBe(401)
      expect((await api.fetch(approveUrl(state, 'Administrator', 'x'), { headers: { cookie } })).status).toBe(401)
      // Sign-in itself refuses rather than falling back to the mock, and the
      // callback will not decode a mock code either.
      expect((await api.fetch('/api/oauth/google/login')).status).toBe(401)
      expect((await api.fetch('/api/oauth/google/callback?code=x&state=y')).status).toBe(401)
    } finally {
      if (prev === undefined) delete process.env.ALLOW_MOCK_OAUTH
      else process.env.ALLOW_MOCK_OAUTH = prev
    }
    // Nothing was provisioned by any of it.
    const [row] = await sql`select 1 from sign_in_identity where person_id = 'Administrator' and method = 'google'`
    expect(row).toBeUndefined()
  })

  // --- Defect B: state must be bound to the browser that started the login ---
  // A signature alone proves the server minted the state, not that THIS
  // browser did. Without the cookie binding, an attacker completes consent
  // with their own account and feeds the victim the callback URL, planting the
  // attacker's session in the victim's browser (login CSRF / session fixation).
  test('a callback whose state cookie is missing or mismatched is rejected', async ({ api }) => {
    await setAllowedDomains('*')
    // "No user was provisioned" only means something if none existed to begin
    // with, and this email is reachable by hand against a dev server. Clearing
    // it inside the sandbox transaction (rolled back like everything else)
    // makes the assertion below depend on this test alone, not on ambient state.
    await sql`delete from person where email = 'attacker@gmail.com'`
    const { state, cookie } = await beginLogin(api)
    const approve = await api.fetch(approveUrl(state, 'attacker@gmail.com', 'Attacker'), {
      headers: { cookie },
    })
    expect(approve.status).toBe(302)
    const callbackUrl = approve.headers.get('location') as string

    // The victim's browser: it never started this login, so it has no cookie.
    expect((await api.fetch(callbackUrl)).status).toBe(401)

    // A browser mid-flight on its OWN login: cookie present, but not this one.
    const other = await beginLogin(api)
    expect((await api.fetch(callbackUrl, { headers: { cookie: other.cookie } })).status).toBe(401)

    // Neither attempt minted a session or a user.
    const [row] = await sql`select 1 from person where email = 'attacker@gmail.com'`
    expect(row).toBeUndefined()

    // The browser that actually started the sign-in still completes normally.
    const genuine = await api.fetch(callbackUrl, { headers: { cookie } })
    expect(genuine.status).toBe(302)
    expect(genuine.headers.get('location')).toContain('/oauth-callback?code=')
  })

  test('the approve step also requires the state cookie', async ({ api }) => {
    const { state } = await beginLogin(api)
    // Same signed state, no cookie — the mock consent bounce refuses too.
    expect((await api.fetch(approveUrl(state, 'someone@gmail.com', 'Someone'))).status).toBe(401)
  })

  // --- Defect C: x-forwarded-proto is a LIST, not a scalar -------------------
  // A proxy chain APPENDS its own hop rather than overwriting, so a request
  // that reached the edge over TLS can arrive as `https,http`. Comparing the
  // whole header to 'https' then read false and set the login cookies WITHOUT
  // `Secure` — anyone who can get the browser onto plain http reads the state
  // and verifier that the CSRF fix depends on.
  test('a proxy that appends to x-forwarded-proto cannot downgrade the login cookies', async ({
    api,
  }) => {
    await setClientId('test-client-id')
    const res = await api.fetch('/api/oauth/google/login', {
      headers: { 'x-forwarded-proto': 'https,http' },
    })
    expect(res.status).toBe(302)
    const cookies = res.headers.getSetCookie()
    expect(cookies).toHaveLength(2)
    for (const cookie of cookies) expect(cookie).toMatch(/;\s*Secure/i)

    // One origin decides both, so the cookie flag and the redirect_uri can
    // never disagree: `https,http://…` was the other half of the same bug.
    const redirectUri = new URLSearchParams((res.headers.get('location') as string).split('?')[1]).get(
      'redirect_uri',
    )
    expect(redirectUri).toMatch(/^https:\/\/[^,]+\/api\/oauth\/google\/callback$/)
  })

  test('a configured INSTANCE_ADDRESSES settles the origin and the header is not consulted', async ({
    api,
  }) => {
    await setClientId('test-client-id')
    const previous = config.instanceAddresses
    config.instanceAddresses = parseInstanceAddresses('[{"address":"https://app.example.com","opens":"admin","emails":true}]', 'test')
    try {
      // The listed host, reached over plain http as far as the header says.
      // (An unlisted one is sent to start again here: instance-addresses-http.test.ts.)
      const res = await api.fetch('http://app.example.com/api/oauth/google/login', {
        headers: { 'x-forwarded-proto': 'http' },
      })
      const redirectUri = new URLSearchParams((res.headers.get('location') as string).split('?')[1]).get(
        'redirect_uri',
      )
      expect(redirectUri).toBe('https://app.example.com/api/oauth/google/callback')
      for (const cookie of res.headers.getSetCookie()) expect(cookie).toMatch(/;\s*Secure/i)
    } finally {
      config.instanceAddresses = previous
    }
  })

  test('an x-forwarded-proto that is not http or https is ignored', async ({ api }) => {
    await setClientId('test-client-id')
    const res = await api.fetch('/api/oauth/google/login', {
      headers: { 'x-forwarded-proto': 'javascript' },
    })
    const redirectUri = new URLSearchParams((res.headers.get('location') as string).split('?')[1]).get(
      'redirect_uri',
    )
    // Falls back to the protocol the socket actually spoke — the header never
    // gets interpolated into the origin verbatim.
    expect(redirectUri).toMatch(/^http:\/\/[^/]+\/api\/oauth\/google\/callback$/)
    for (const cookie of res.headers.getSetCookie()) expect(cookie).not.toMatch(/;\s*Secure/i)
  })

  // --- Defect D: the mock reflected any redirect_uri -------------------------
  // The mock mints a session for ANY typed email, `Administrator` included.
  // Reflecting the caller's redirect_uri handed that authorization code to
  // whatever host asked for it.
  test('the mock approve endpoint refuses an off-origin redirect_uri', async ({ api }) => {
    const { state, cookie } = await beginLogin(api)
    const approveTo = (redirect_uri: string) =>
      api.fetch(
        '/api/oauth/mock/approve?' +
          new URLSearchParams({ state, redirect_uri, email: 'Administrator', row_id: 'x' }).toString(),
        { headers: { cookie } },
      )

    for (const evil of [
      'https://evil.example.com/x',
      '//evil.example.com/x', // protocol-relative — a "starts with /" check would pass it
      'http://localhost:8000/api/oauth/google/callback/../../evil',
      '/api/oauth/google/callback/../../evil',
    ]) {
      const res = await approveTo(evil)
      expect(res.status).toBe(400)
      expect(res.headers.get('location')).toBeNull()
    }

    // The application's own callback still works.
    const ok = await api.fetch(approveUrl(state, 'demo.user@gmail.com', 'Demo'), { headers: { cookie } })
    expect(ok.status).toBe(302)
    expect(ok.headers.get('location')).toMatch(/^\/api\/oauth\/google\/callback\?/)
  })
})

describe('#3783: Google sign-in lands a report viewer on their report', () => {
  test('a provisioned Sales Target Viewer redeems a session that names the report as landing; others get none', async ({ api }) => {
    await setAllowedDomains('')
    await saveDoc('Role', { row_id: 'Sales Target Viewer' }, 'Administrator')
    // Provisioned ahead of time (the data-warehouse viewer sync), not created.
    const dm = await makePerson({
      email: 'dm.test@jeyarama.com', full_name: 'DM Test',
      roles: [{ role: 'Sales Target Viewer' }],
    })
    const plainUser = await makePerson({ email: 'plain.user@jeyarama.com', full_name: 'Plain', roles: [] })
    // person-identities: the viewer sync invites each Google address; the
    // first sign-in claims the invite. A matching email alone opens nothing.
    await inviteGoogleRaw(dm, 'dm.test@jeyarama.com')
    await inviteGoogleRaw(plainUser, 'plain.user@jeyarama.com')

    const viewer = await mockSignIn(api, 'dm.test@jeyarama.com', 'DM Test')
    expect(viewer.status).toBe(302)
    const v = await (await redeem(api, handoffCode(viewer), sidCookie(viewer))).json() as { user: { row_id: string }; landing?: string }
    expect(v.user.row_id).toBe(dm)
    expect(v.landing).toBe('/featherbase/sales-target')

    const plain = await mockSignIn(api, 'plain.user@jeyarama.com', 'Plain')
    const p = await (await redeem(api, handoffCode(plain), sidCookie(plain))).json() as { landing?: string }
    expect(p.landing).toBeUndefined()
  })
})

describe('exchanging a code with Google itself', () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  // Answers the token endpoint and the userinfo endpoint in turn; Google is never contacted.
  async function exchangeWith(token: Response, userinfo?: Response) {
    const { _setGoogleFetch, exchangeCode } = await import('../src/oauth')
    const calls: { url: string; body: string; authorization: string | null }[] = []
    _setGoogleFetch(async (input, init) => {
      const url = String(input)
      calls.push({ url, body: String(init?.body ?? ''), authorization: new Headers(init?.headers).get('authorization') })
      return url.includes('oauth2.googleapis.com') ? token : (userinfo as Response)
    })
    try {
      return { calls, result: await exchangeCode('the-code', '/api/oauth/google/callback', 'client-1', 'the-verifier').then((v) => v, (e: Error) => e) }
    } finally {
      _setGoogleFetch(null)
    }
  }

  test('a verified account is returned by its permanent ID, with the PKCE verifier sent to Google', async () => {
    const { calls, result } = await exchangeWith(
      json({ access_token: 'at-1' }),
      json({ sub: ' 1234 ', email: 'Jo@Example.COM', email_verified: true, name: 'Jo', hd: 'Example.com' }),
    )
    expect(result).toEqual({ status: 'verified', subject: '1234', email: 'jo@example.com', email_verified: true, display_name: 'Jo', hosted_domain: 'example.com' })
    expect(new URLSearchParams(calls[0].body).get('code_verifier')).toBe('the-verifier')
    expect(calls[1].authorization).toBe('Bearer at-1')
  })

  test('an unverified address is dropped and a missing name and domain stay empty', async () => {
    const { result } = await exchangeWith(json({ access_token: 'at' }), json({ sub: '9', email: 'a@b.com', email_verified: false }))
    expect(result).toEqual({ status: 'verified', subject: '9', email: null, email_verified: false, display_name: null, hosted_domain: null })
  })

  test('a refused token exchange, a reply with no access token, a refused userinfo and an account with no ID each fail as a Google error', async () => {
    const message = async (token: Response, userinfo?: Response) => ((await exchangeWith(token, userinfo)).result as Error).message
    expect(await message(json({}, 400))).toBe('Google token exchange failed')
    expect(await message(json({ error: 'x' }))).toBe('Google token exchange failed')
    expect(await message(json({ access_token: 'at' }, 200), json({}, 500))).toBe('Google userinfo fetch failed')
    expect(await message(json({ access_token: 'at' }), json({ email: 'a@b.com' }))).toBe('Google did not return an account ID')
  })
})

describe('#396: the sign-in records the client address', () => {
  afterEach(() => vi.unstubAllEnvs())

  test('a Google sign-in records the address its callback came from', async ({ api }) => {
    vi.stubEnv('CLIENT_ADDRESS_HEADER', 'x-real-ip')
    await setAllowedDomains('*')
    const { state, cookie } = await beginLogin(api)
    const approve = await api.fetch(approveUrl(state, 'google.address@gmail.com', 'Google Address'), { headers: { cookie } })
    const res = await api.fetch(approve.headers.get('location') as string, { headers: { cookie, ...FROM_CLIENT } })
    expect(res.status).toBe(302)
    const [person] = await sql`select row_id from person where email = 'google.address@gmail.com'`
    expect(await signInAddresses(person.row_id as string)).toEqual([CLIENT])
  })
})

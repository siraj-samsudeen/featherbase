import { afterEach, describe, expect, vi } from 'vitest'
import { test } from './pg-test'
import { config } from '../src/config'
import { parseInstanceAddresses } from '../src/instance-addresses'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
import { getBrowser } from '../src/print'
import { expectRefused, expectStatus, makePerson } from './fixtures'
import { assertSignInAvailable, exchangeCode, googleAuthorizeUrl, mintHandoffCode, mockApproveRedirect, mockConsentHtml, newLoginChallenge, redeemHandoffCode, verifyState } from '../src/oauth'
import type { TestClient } from 'feather-testing-postgres'
import { expectSessionCookie, setSessionHours } from './session-cookie-test-utils'
import { configureGoogle, inviteGoogleRaw } from './identity-fixtures'
import { googleSignIn, mockApproveUrl, mockOAuth, withGoogleFetch } from './google-mock'
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

async function mockSignIn(api: TestClient, email: string, name = 'Test User', extra: { subject?: string; hd?: string } = {}) {
  return googleSignIn(api, email, { ...extra, name })
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
  test('a producer-issued login challenge expires after ten minutes', async ({ api }) => {
    await setClientId('')
    await setAllowedDomains('*')
    const started = Math.floor(Date.now() / 1000) * 1000
    try {
      for (const seconds of [599, 601]) {
        vi.setSystemTime(started)
        const email = `elapsed-${seconds}@example.test`
        const { state, cookie } = await beginLogin(api)
        const approved = await api.fetch(mockApproveUrl(state, email, { name: 'Elapsed Login' }), { headers: { cookie } })
        await expectStatus(approved, 302)
        vi.setSystemTime(started + seconds * 1000)
        const callback = await api.fetch(approved.headers.get('location')!, { headers: { cookie } })
        if (seconds === 599) {
          await expectStatus(callback, 302)
          const session = await redeem(api, handoffCode(callback), sidCookie(callback))
          await expectStatus(session, 200)
          expect(await session.json()).toMatchObject({ user: { email } })
        } else {
          await expectStatus(callback, 401)
          expect(await callback.json()).toEqual({ error: { type: 'AuthenticationError', message: 'Token expired' } })
          expect(callback.headers.get('location')).toBeNull()
          expect(sidCookie(callback)).toBe('')
          expect(await sql`select row_id from person where email = ${email}`).toEqual([])
        }
      }
    } finally {
      vi.useRealTimers()
    }
  })

  test('Google sign-in gives the sid cookie the configured session lifetime', async ({ api }) => {
    await setAllowedDomains('*')
    for (const hours of [1, 720]) {
      await setSessionHours(hours)
      const before = Math.floor(Date.now() / 1000)
      const res = await mockSignIn(api, `session-${hours}@example.com`)
      const after = Math.floor(Date.now() / 1000)
      await expectStatus(res, 302)
      const cookie = expectSessionCookie(res, hours, { before, after })
      const redeemed = await redeem(api, handoffCode(res), cookie)
      await expectStatus(redeemed, 200)
      expect(Object.keys((await redeemed.json()) as object).sort()).toEqual(['apps', 'token', 'user'])
    }
  })

  test('the mock consent page begins with a standards-mode doctype', () => {
    expect(mockConsentHtml('state', '/api/oauth/google/callback', 'person@example.com', 'Test User'))
      .toMatch(/^<!DOCTYPE html>/)
  })

  test('the dev consent endpoint keeps special characters inside form values', async ({ api }) => {
    await setClientId('')
    const { state } = await beginLogin(api)
    const values = {
      state,
      redirect_uri: '/api/oauth/google/callback',
      email: 'a&b@example.test',
      name: 'Ada "><img id="consent-injected">& O\'Neil',
      subject: 'acct<&>"\'',
      hd: 'workspace.example.test',
    }
    const response = await api.fetch(`/api/oauth/mock/consent?${new URLSearchParams(values)}`)
    await expectStatus(response, 200)
    expect(response.headers.get('content-type')).toContain('text/html')
    const html = await response.text()
    expect(html).toContain('value="a&amp;b@example.test"')
    expect(html).toContain('value="Ada &quot;&gt;&lt;img id=&quot;consent-injected&quot;&gt;&amp; O&#39;Neil"')
    expect(html).toContain('value="acct&lt;&amp;&gt;&quot;&#39;"')

    const page = await (await getBrowser()).newPage({ javaScriptEnabled: false })
    try {
      await page.setContent(html)
      expect(await page.locator('form').count()).toBe(1)
      expect(await page.locator('form').getAttribute('method')).toBe('get')
      expect(await page.locator('form').getAttribute('action')).toBe('/api/oauth/mock/approve')
      expect(await page.locator('form input').evaluateAll(inputs =>
        Object.fromEntries(inputs.map(input => [(input as HTMLInputElement).name, (input as HTMLInputElement).value])),
      )).toEqual(values)
      expect(await page.locator('#consent-injected, img, script').count()).toBe(0)
    } finally {
      await page.close()
    }
  })

  test('full mock flow provisions a user and hands the SPA a session', async ({ api }) => {
    await setAllowedDomains('*')
    const res = await mockSignIn(api, 'new.person@gmail.com')
    await expectStatus(res, 302)
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
    await expectStatus(redeemed, 200)
    const session = (await redeemed.json()) as { token: string; user: { row_id: string } }
    // person-identities: a person Google creates gets an opaque, permanent id
    // (the warehouse person_id), never the address.
    expect(session.user.row_id).toMatch(/^psn_[a-z2-7]{20}$/)
    expect(session.user).toMatchObject({ email: 'new.person@gmail.com', full_name: 'Test User' })
    // The token is a real session: it authenticates as that user.
    const whoami = await api.fetch('/api/whoami', {
      headers: { authorization: `Bearer ${session.token}` },
    })
    await expectStatus(whoami, 200)
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
    await expectStatus(await redeem(api, code, cookie), 200)
    await expectStatus(await redeem(api, code, cookie), 401)
  })

  // And it is bound to the browser it was minted for: redemption requires the
  // sid cookie set by the same callback response. A code lifted from the URL
  // is worth nothing in another browser.
  test('a handoff code redeemed without the matching sid cookie is refused', async ({ api }) => {
    await setAllowedDomains('*')
    const res = await mockSignIn(api, 'bound@gmail.com')
    const code = handoffCode(res)
    await expectStatus(await redeem(api, code, ''), 401)
    const other = await mockSignIn(api, 'someone.else@gmail.com')
    await expectStatus(await redeem(api, code, sidCookie(other)), 401)
    // Burned by the failed attempts — the right browser cannot use it either.
    await expectStatus(await redeem(api, code, sidCookie(res)), 401)
  })

  test('an unknown or missing handoff code is refused', async ({ api }) => {
    await expectStatus(await redeem(api, 'not-a-real-code', ''), 401)
    await expectStatus(await redeem(api, null, ''), 401)
  })

  test('blank allowed_login_domains blocks auto-provisioning by default', async ({ api }) => {
    await setAllowedDomains('')
    const denied = await mockSignIn(api, 'unconfigured@gmail.com')
    await expectStatus(denied, 401)
    const [row] = await sql`select 1 from person where email = 'unconfigured@gmail.com'`
    expect(row).toBeUndefined()
  })

  test('* explicitly allows auto-provisioning from any domain', async ({ api }) => {
    await setAllowedDomains('*')
    const admitted = await mockSignIn(api, 'explicit-anywhere@outside.io')
    await expectStatus(admitted, 302)
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
      await expectStatus(denied, 401)
      const [row] = await sql`
        select 1 from person where email = ${email} or row_id = ${email}`
      expect(row).toBeUndefined()
    }
  })

  test('allowed_login_domains blocks auto-provisioning foreign domains', async ({ api }) => {
    await setAllowedDomains('jeyarama.com')
    const denied = await mockSignIn(api, 'stranger@gmail.com')
    await expectStatus(denied, 401)
    const [row] = await sql`select 1 from person where email = 'stranger@gmail.com'`
    expect(row).toBeUndefined()

    const admitted = await mockSignIn(api, 'admitted@jeyarama.com')
    await expectStatus(admitted, 302)
    expect(admitted.headers.get('location')).toContain('/oauth-callback?code=')
  })

  // person-identities: an existing account is reached through a linked
  // Google account or an invite, never because its email matches.
  test('an invited existing user signs in when auto-provisioning is disabled', async ({ api, admin }) => {
    const contractor = await makePerson({ email: 'contractor@outside.io', roles: [] })
    await setAllowedDomains('')
    await expectStatus(await mockSignIn(api, 'contractor@outside.io'), 401)
    await admin.post(`/api/people/${contractor}/identities`, { method: 'google', email: 'contractor@outside.io' })
    const res = await mockSignIn(api, 'contractor@outside.io')
    await expectStatus(res, 302)
    expect(res.headers.get('location')).toContain('/oauth-callback?code=')
  })

  // Moved from the deleted e2e/oauth.spec.ts: the invite links the person who
  // already exists; the sign-in neither makes a second one nor lands elsewhere.
  test('an invited existing user signs in as that person, and no second person is made', async ({ api, admin }) => {
    const existing = await makePerson({ email: 'invited.existing@outside.io', roles: [] })
    await setAllowedDomains('*')
    await admin.post(`/api/people/${existing}/identities`, { method: 'google', email: 'invited.existing@outside.io' })
    const res = await mockSignIn(api, 'invited.existing@outside.io')
    const redeemed = await redeem(api, handoffCode(res), sidCookie(res))
    await expectStatus(redeemed, 200)
    expect(((await redeemed.json()) as { user: { row_id: string } }).user.row_id).toBe(existing)
    expect(await sql`select row_id from person where email = 'invited.existing@outside.io'`).toEqual([{ row_id: existing }])
  })

  // #474: "Try another Google account" must not carry the refused address into
  // the new attempt. With the dev provider, the attempt is its consent page.
  test('a retry start after a refusal opens a consent page that does not hold the refused address', async ({ api }) => {
    await setClientId('')
    await setAllowedDomains('')
    await expectStatus(await mockSignIn(api, 'refused.retry@gmail.com'), 401)
    const start = await api.fetch('/api/oauth/google/login?prompt=select_account')
    await expectStatus(start, 302)
    const consent = await api.fetch(start.headers.get('location') as string, {
      headers: { cookie: start.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') },
    })
    await expectStatus(consent, 200)
    const html = await consent.text()
    expect(html).toContain('data-testid="mock-email"')
    expect(html).not.toContain('refused.retry@gmail.com')
  })

  test('PLAT-006: a callback with a forged state is refused to an API caller', async ({ api }) => {
    const res = await api.fetch('/api/oauth/google/callback?code=abc&state=forged.signature')
    await expectStatus(res, 401)
  })

  test('a google_client_id in System Settings switches to the real provider', async ({ api }) => {
    await setClientId('test-client-id')
    const res = await api.fetch('/api/oauth/google/login')
    await expectStatus(res, 302)
    const loc = res.headers.get('location') as string
    expect(loc).toContain('https://accounts.google.com/o/oauth2/v2/auth')
    expect(loc).toContain('client_id=test-client-id')
    expect(loc).toContain('redirect_uri=')
    // PKCE: the authorize redirect carries an S256 challenge, so a stolen
    // authorization code is useless without this browser's verifier.
    expect(loc).toContain('code_challenge_method=S256')
    expect(new URLSearchParams(loc.split('?')[1]).get('code_challenge')).toMatch(/^[\w-]{43}$/)
    // With a real provider active, the mock endpoints refuse.
    await expectStatus(await api.fetch('/api/oauth/mock/consent'), 417)
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

    mockOAuth(false)
    try {
      await expectStatus(await api.fetch('/api/oauth/mock/consent'), 401)
      await expectStatus(await api.fetch(mockApproveUrl(state, 'Administrator', { name: 'x' }), { headers: { cookie } }), 401)
      // Sign-in itself refuses rather than falling back to the mock, and the
      // callback will not decode a mock code either.
      await expectStatus(await api.fetch('/api/oauth/google/login'), 401)
      await expectStatus(await api.fetch('/api/oauth/google/callback?code=x&state=y'), 401)
    } finally {
      vi.unstubAllEnvs()
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
    const approve = await api.fetch(mockApproveUrl(state, 'attacker@gmail.com', { name: 'Attacker' }), {
      headers: { cookie },
    })
    await expectStatus(approve, 302)
    const callbackUrl = approve.headers.get('location') as string

    // The victim's browser: it never started this login, so it has no cookie.
    await expectStatus(await api.fetch(callbackUrl), 401)

    // A browser mid-flight on its OWN login: cookie present, but not this one.
    const other = await beginLogin(api)
    await expectStatus(await api.fetch(callbackUrl, { headers: { cookie: other.cookie } }), 401)

    // Neither attempt minted a session or a user.
    const [row] = await sql`select 1 from person where email = 'attacker@gmail.com'`
    expect(row).toBeUndefined()

    // The browser that actually started the sign-in still completes normally.
    const genuine = await api.fetch(callbackUrl, { headers: { cookie } })
    await expectStatus(genuine, 302)
    expect(genuine.headers.get('location')).toContain('/oauth-callback?code=')
  })

  test('a dev authorization code with one altered signature character cannot create an account or session', async ({ api }) => {
    await setClientId('')
    await setAllowedDomains('*')
    const email = 'signed-code-control@example.test'
    const { state, cookie } = await beginLogin(api)
    expect(cookie).toContain('oauth_state=')
    expect(cookie).toContain('oauth_verifier=')
    const approved = await api.fetch(mockApproveUrl(state, email, { name: 'Signed Code Control' }), { headers: { cookie } })
    await expectStatus(approved, 302)
    const callback = new URL(approved.headers.get('location')!, 'http://localhost')
    expect(callback.pathname).toBe('/api/oauth/google/callback')
    expect(callback.searchParams.get('state')).toBe(state)
    const code = callback.searchParams.get('code')!
    expect(code).toMatch(/^[\w-]+\.[\w-]+$/)
    const signatureStart = code.indexOf('.') + 1
    const tampered = code.slice(0, signatureStart) + (code[signatureStart] === 'A' ? 'B' : 'A') + code.slice(signatureStart + 1)
    const stateOfAccounts = async () => ({
      people: await sql`select * from person order by row_id`,
      roles: await sql`select * from has_role order by row_id`,
      identities: await sql`select * from sign_in_identity order by id`,
      revoked: await sql`select * from revoked_session order by jti`,
      activity: await sql`select * from activity_log order by row_id`,
    })
    const before = await stateOfAccounts()
    expect(before.people.some((person) => person.email === email)).toBe(false)
    callback.searchParams.set('code', tampered)
    const refused = await api.fetch(callback.pathname + callback.search, { headers: { cookie } })
    await expectStatus(refused, 401)
    expect(await refused.json()).toEqual({ error: { type: 'AuthenticationError', message: 'Bad signature' } })
    expect(refused.headers.get('location')).toBeNull()
    expect(sidCookie(refused)).toBe('')
    expect(await stateOfAccounts()).toEqual(before)
    await expectStatus(await api.fetch('/api/whoami', { headers: { cookie } }), 401)

    // Retain the original producer-issued challenge and code, as in the state-cookie control above.
    callback.searchParams.set('code', code)
    const genuine = await api.fetch(callback.pathname + callback.search, { headers: { cookie } })
    await expectStatus(genuine, 302)
    expect(genuine.headers.get('location')).toContain('/oauth-callback?code=')
    expect(sidCookie(genuine)).not.toBe('')
    const redeemed = await redeem(api, handoffCode(genuine), sidCookie(genuine))
    await expectStatus(redeemed, 200)
    const session = await redeemed.json() as { token: string; user: { row_id: string; email: string } }
    expect(session.user.email).toBe(email)
    const whoami = await api.fetch('/api/whoami', { headers: { authorization: `Bearer ${session.token}` } })
    await expectStatus(whoami, 200)
    expect(await whoami.json()).toMatchObject({ row_id: session.user.row_id, email })
    expect(await sql`select person_id, method, subject from sign_in_identity where person_id = ${session.user.row_id}`)
      .toEqual([{ person_id: session.user.row_id, method: 'google', subject: email }])
    expect(await sql`select operation, sign_in_method from activity_log where "user" = ${session.user.row_id} and operation = 'login'`)
      .toEqual([{ operation: 'login', sign_in_method: 'google' }])
  })

  test('the approve step also requires the state cookie', async ({ api }) => {
    const { state } = await beginLogin(api)
    // Same signed state, no cookie — the mock consent bounce refuses too.
    await expectStatus(await api.fetch(mockApproveUrl(state, 'someone@gmail.com', { name: 'Someone' })), 401)
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
    await expectStatus(res, 302)
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
      await expectStatus(res, 400)
      expect(res.headers.get('location')).toBeNull()
    }

    // The application's own callback still works.
    const ok = await api.fetch(mockApproveUrl(state, 'demo.user@gmail.com', { name: 'Demo' }), { headers: { cookie } })
    await expectStatus(ok, 302)
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
    await expectStatus(viewer, 302)
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
    const calls: { url: string; body: string; authorization: string | null }[] = []
    const handler: typeof fetch = async (input, init) => {
      const url = String(input)
      calls.push({ url, body: String(init?.body ?? ''), authorization: new Headers(init?.headers).get('authorization') })
      return url.includes('oauth2.googleapis.com') ? token : (userinfo as Response)
    }
    return withGoogleFetch(handler, async () => ({ calls, result: await exchangeCode('the-code', '/api/oauth/google/callback', 'client-1', 'the-verifier').then((v) => v, (e: Error) => e) }))
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

  test('an account Google sends with no address has none, unverified', async () => {
    const { result } = await exchangeWith(json({ access_token: 'at' }), json({ sub: '10', email_verified: true }))
    expect(result).toMatchObject({ subject: '10', email: null, email_verified: false })
  })

  // No seam injected: the exchange goes through the global fetch, stubbed here.
  test('without an injected fetch, the exchange asks Google through the global fetch', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', async (input: unknown) => {
      const url = String(input)
      urls.push(url)
      if (url === 'https://oauth2.googleapis.com/token') return json({ access_token: 'at-global' })
      if (url === 'https://openidconnect.googleapis.com/v1/userinfo') return json({ sub: '12', email: 'g@example.com', email_verified: true })
      throw new Error(`unexpected request to ${url}`)
    })
    try {
      expect(await exchangeCode('the-code', '/api/oauth/google/callback', 'client-1', 'v')).toMatchObject({ subject: '12', email: 'g@example.com' })
    } finally {
      vi.unstubAllGlobals()
    }
    expect(urls).toEqual(['https://oauth2.googleapis.com/token', 'https://openidconnect.googleapis.com/v1/userinfo'])
  })

  test('an exchange with no PKCE verifier sends an empty one', async () => {
    const bodies: string[] = []
    const handler: typeof fetch = async (input, init) => {
      bodies.push(String(init?.body ?? ''))
      return String(input).includes('oauth2.googleapis.com') ? json({ access_token: 'at' }) : json({ sub: '11' })
    }
    await withGoogleFetch(handler, () => exchangeCode('the-code', '/api/oauth/google/callback', 'client-1', undefined))
    expect(new URLSearchParams(bodies[0]).get('code_verifier')).toBe('')
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
    const approve = await api.fetch(mockApproveUrl(state, 'google.address@gmail.com', { name: 'Google Address' }), { headers: { cookie } })
    const res = await api.fetch(approve.headers.get('location') as string, { headers: { cookie, ...FROM_CLIENT } })
    await expectStatus(res, 302)
    const [person] = await sql`select row_id from person where email = 'google.address@gmail.com'`
    expect(await signInAddresses(person.row_id as string)).toEqual([CLIENT])
  })
})

describe('the OAuth steps refuse what they cannot use', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  test('with no client id and the mock provider off, sign-in is not available', () => {
    mockOAuth(false)
    expect(() => assertSignInAvailable('')).toThrow('Google sign-in is not configured')
  })

  test('a callback without a state is refused', () => {
    expect(() => verifyState(undefined, 'cookie-state', 'localhost')).toThrow('Missing OAuth state')
  })

  test('the mock consent page carries every hint it is given', () => {
    const url = new URL(googleAuthorizeUrl('', 'st', '/api/oauth/google/callback', 'ch', { email: 'jo@example.com', name: 'Jo', subject: 'g-1', hd: '' }), 'http://x')
    expect(Object.fromEntries(url.searchParams)).toEqual({ state: 'st', redirect_uri: '/api/oauth/google/callback', email: 'jo@example.com', name: 'Jo', subject: 'g-1', hd: '' })
  })

  test('the mock consent page opened with no query carries a blank state and callback', async ({ api }) => {
    const html = await (await expectStatus(await api.fetch('/api/oauth/mock/consent'), 200)).text()
    expect(html).toContain('<input type="hidden" name="state" value="" />')
    expect(html).toContain('<input type="hidden" name="redirect_uri" value="" />')
  })

  test('a mock approval with no state is refused', async ({ api }) => {
    const { cookie } = await beginLogin(api)
    await expectStatus(await api.fetch('/api/oauth/mock/approve', { headers: { cookie } }), 401)
  })

  test('a mock approval with no callback address is refused', async ({ api }) => {
    const { state, cookie } = await beginLogin(api)
    await expectStatus(await api.fetch(`/api/oauth/mock/approve?${new URLSearchParams({ state })}`, { headers: { cookie } }), 400)
  })

  test('a mock approval that names no email signs nobody in', async ({ api }) => {
    const { state, cookie } = await beginLogin(api)
    const approve = await expectStatus(await api.fetch(`/api/oauth/mock/approve?${new URLSearchParams({ state, redirect_uri: '/api/oauth/google/callback' })}`, { headers: { cookie } }), 302)
    await expectRefused(api.fetch(approve.headers.get('location') as string, { headers: { cookie } }), 401, 'No email in code')
  })

  test('a code exchange without a code is refused', async () => {
    await expect(exchangeCode(undefined, '/api/oauth/google/callback', '', undefined)).rejects.toThrow('Missing authorization code')
  })

  test('a mock code is not exchanged once the mock provider is off', async () => {
    mockOAuth(false)
    await expect(exchangeCode('any', '/api/oauth/google/callback', '', undefined)).rejects.toThrow('Mock OAuth provider is disabled')
  })

  // The state is signed with the same key as a mock code; it names no one.
  test('a sign-in state handed back as a mock code is refused for naming no email', async () => {
    const { state } = newLoginChallenge('localhost')
    await expect(exchangeCode(state, '/api/oauth/google/callback', '', undefined)).rejects.toThrow('No email in code')
  })

  test('with the Google sign-in method deleted, the mock provider still offers its consent page', async ({ admin, api }) => {
    const [google] = await sql`select row_id from sign_in_method where kind = 'google'`
    await admin.delete(`/api/table/Sign%20In%20Method/${encodeURIComponent(String(google.row_id))}`)
    await expectStatus(await api.fetch('/api/oauth/mock/consent?state=st&redirect_uri=%2Fapi%2Foauth%2Fgoogle%2Fcallback'), 200)
  })

  test('a mock code that names no one is named by its email', async () => {
    const location = mockApproveRedirect('st', '/api/oauth/google/callback', 'jo@gmail.com', '')
    const code = new URLSearchParams(location.split('?')[1]).get('code') as string
    expect(await exchangeCode(code, '/api/oauth/google/callback', '', undefined)).toMatchObject({ subject: 'jo@gmail.com', display_name: 'jo@gmail.com' })
  })

  test('a mock code that names no email is refused', async () => {
    const location = mockApproveRedirect('st', '/api/oauth/google/callback', '  ', 'No One')
    const code = new URLSearchParams(location.split('?')[1]).get('code') as string
    await expect(exchangeCode(code, '/api/oauth/google/callback', '', undefined)).rejects.toThrow('No email in code')
  })

  test('an abandoned hand-off code stays refused after later codes clear it away', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const session = { token: 'tok-abandoned', user: { row_id: 'psn_x' } } as unknown as Parameters<typeof mintHandoffCode>[0]
    const abandoned = mintHandoffCode(session)
    vi.advanceTimersByTime(61_000)
    mintHandoffCode({ ...session, token: 'tok-later' })
    expect(() => redeemHandoffCode(abandoned, 'tok-abandoned', 'localhost')).toThrow('Invalid or expired sign-in code')
  })

  test('a callback with no state is refused to the API caller', async ({ api }) => {
    await expectRefused(api.fetch('/api/oauth/google/callback?code=c'), 401, 'Missing OAuth state')
  })

  test('a browser sign-in whose call to Google fails outright lands on the sign-in page, logged', async ({ api }) => {
    await configureGoogle({ client_id: 'client-1', allowed_email_domains: '*' })
    const start = await api.fetch('/api/oauth/google/login')
    const state = new URL(start.headers.get('location') as string).searchParams.get('state') as string
    const cookie = start.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await withGoogleFetch(async () => { throw new TypeError('fetch failed') }, async () => {
        const res = await expectStatus(await api.fetch(`/api/oauth/google/callback?state=${encodeURIComponent(state)}&code=c`, { headers: { cookie, accept: 'text/html' } }), 302)
        expect(res.headers.get('location')).toBe('/featherbase/login?error=google_failed')
        expect(error.mock.calls.some((call) => call[0] === '[sign-in] google callback failed')).toBe(true)
      })
    } finally {
      error.mockRestore()
    }
  })
})

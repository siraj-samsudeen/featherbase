import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
import type { TestClient } from 'feather-testing-postgres'

// PLAT-006: Google OAuth server-side flow, driven through the dev mock
// provider (no google_client_id in System Settings, ALLOW_MOCK_OAUTH=1 from
// vitest.config.ts). The browser dance is three redirects: login → consent →
// approve → callback; chased by hand. The login challenge (state + PKCE
// verifier) rides HttpOnly cookies, so these tests carry cookies between hops
// exactly as a browser would — that binding is the point of the CSRF fix.
// The domain allowlist is instance config in System Settings, so tests set it
// inside their sandbox transaction — no env vars, no cleanup.

async function setAllowedDomains(value: string) {
  await sql`
    insert into single_value (table_name, field, value)
    values ('System Settings', 'allowed_login_domains', ${value})
    on conflict (table_name, field) do update set value = excluded.value`
}

async function setClientId(value: string) {
  await sql`
    insert into single_value (table_name, field, value)
    values ('System Settings', 'google_client_id', ${value})
    on conflict (table_name, field) do update set value = excluded.value`
}

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

function approveUrl(state: string, email: string, name: string): string {
  return (
    '/api/oauth/mock/approve?' +
    new URLSearchParams({ state, redirect_uri: '/api/oauth/google/callback', email, name }).toString()
  )
}

async function mockSignIn(api: TestClient, email: string, name = 'Test User') {
  const { state, cookie } = await beginLogin(api)
  const approve = await api.fetch(approveUrl(state, email, name), { headers: { cookie } })
  if (approve.status !== 302) return approve
  return api.fetch(approve.headers.get('location') as string, { headers: { cookie } })
}

describe('PLAT-006: OAuth sign-in (mock provider)', () => {
  test('full mock flow provisions a user and hands the SPA a session', async ({ api }) => {
    const res = await mockSignIn(api, 'new.person@gmail.com')
    expect(res.status).toBe(302)
    const landing = res.headers.get('location') as string
    expect(landing).toContain('/oauth-callback?token=')
    const [user] = await sql`
      select social_login, enabled from "user" where email = 'new.person@gmail.com'`
    expect(user).toMatchObject({ social_login: 'google', enabled: true })
  })

  test('allowed_login_domains blocks auto-provisioning foreign domains', async ({ api }) => {
    await setAllowedDomains('jeyarama.com')
    const denied = await mockSignIn(api, 'stranger@gmail.com')
    expect(denied.status).toBe(401)
    const [row] = await sql`select 1 from "user" where email = 'stranger@gmail.com'`
    expect(row).toBeUndefined()

    const admitted = await mockSignIn(api, 'kannan@jeyarama.com')
    expect(admitted.status).toBe(302)
    expect(admitted.headers.get('location')).toContain('/oauth-callback?token=')
  })

  test('an existing user signs in even off-domain (provisioned deliberately)', async ({ api }) => {
    await saveDoc(
      'User',
      { name: 'contractor@outside.io', email: 'contractor@outside.io', enabled: true, roles: [] },
      'Administrator',
    )
    await setAllowedDomains('jeyarama.com')
    const res = await mockSignIn(api, 'contractor@outside.io')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('/oauth-callback?token=')
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
    const [row] = await sql`select 1 from "user" where name = 'Administrator' and social_login = 'google'`
    expect(row).toBeUndefined()
  })

  // --- Defect B: state must be bound to the browser that started the login ---
  // A signature alone proves the server minted the state, not that THIS
  // browser did. Without the cookie binding, an attacker completes consent
  // with their own account and feeds the victim the callback URL, planting the
  // attacker's session in the victim's browser (login CSRF / session fixation).
  test('a callback whose state cookie is missing or mismatched is rejected', async ({ api }) => {
    // "No user was provisioned" only means something if none existed to begin
    // with, and this email is reachable by hand against a dev server. Clearing
    // it inside the sandbox transaction (rolled back like everything else)
    // makes the assertion below depend on this test alone, not on ambient state.
    await sql`delete from "user" where email = 'attacker@gmail.com'`
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
    const [row] = await sql`select 1 from "user" where email = 'attacker@gmail.com'`
    expect(row).toBeUndefined()

    // The browser that actually started the sign-in still completes normally.
    const genuine = await api.fetch(callbackUrl, { headers: { cookie } })
    expect(genuine.status).toBe(302)
    expect(genuine.headers.get('location')).toContain('/oauth-callback?token=')
  })

  test('the approve step also requires the state cookie', async ({ api }) => {
    const { state } = await beginLogin(api)
    // Same signed state, no cookie — the mock consent bounce refuses too.
    expect((await api.fetch(approveUrl(state, 'someone@gmail.com', 'Someone'))).status).toBe(401)
  })
})

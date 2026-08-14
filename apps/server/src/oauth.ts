import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { sql } from './db'
import type { SessionUser } from './auth'
import { AppError } from './errors'
import { saveDoc } from './document'
import { getSystemSettings } from './settings'

// PLAT-006: social login (Google OAuth) mapped to the User Table. The client
// id and the login-domain allowlist are instance configuration (System
// Settings — checked in via manifest fixtures, editable in the Admin UI);
// only GOOGLE_CLIENT_SECRET comes from the environment. A mock provider can
// stand in for Google in development: a local consent page returns a signed
// authorization `code` that the callback exchanges for the user's identity.

const SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me'

// Real Google is used only when a client id is configured; otherwise mock.
export async function oauthClientId(): Promise<string> {
  return (await getSystemSettings()).google_client_id
}

// The mock provider mints a session for ANY typed email — `Administrator`
// included — from a pre-auth, un-rate-limited endpoint. So it is opt-in and
// nothing else: only ALLOW_MOCK_OAUTH=1 turns it on. Absence of configuration
// must never be what enables it, which is how the previous NODE_ENV check
// failed open (unset/misspelled NODE_ENV, or a System Manager blanking
// google_client_id in the Admin UI, both re-opened the mock).
export function mockOAuthEnabled(): boolean {
  return process.env.ALLOW_MOCK_OAUTH === '1'
}

// Guards the /api/oauth/mock/* routes. Named for what it does: it refuses the
// mock provider. It does NOT assert that OAuth is configured.
export function assertMockProviderAllowed(clientId: string): void {
  if (!mockOAuthEnabled())
    throw new AppError('AuthenticationError', 'Mock OAuth provider is disabled')
  if (clientId) throw new AppError('ValidationError', 'Mock provider is not active')
}

// Guards the real sign-in routes (login + callback). A configured client id
// means real Google. Without one the mock would have to serve — so sign-in is
// refused outright unless the mock was explicitly opted into.
export function assertSignInAvailable(clientId: string): void {
  if (!clientId && !mockOAuthEnabled())
    throw new AppError('AuthenticationError', 'Google sign-in is not configured')
}

// --- signed, stateless tokens (state + mock code) ---------------------------
function hmac(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('base64url')
}
function pack(obj: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify({ ...obj, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url')
  return `${body}.${hmac(body)}`
}
function unpack(token: string): Record<string, unknown> {
  const [body, sig] = token.split('.')
  if (!body || !sig) throw new AppError('AuthenticationError', 'Malformed token')
  const expected = hmac(body)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new AppError('AuthenticationError', 'Bad signature')
  const obj = JSON.parse(Buffer.from(body, 'base64url').toString()) as Record<string, unknown>
  if (typeof obj.exp === 'number' && obj.exp < Math.floor(Date.now() / 1000))
    throw new AppError('AuthenticationError', 'Token expired')
  return obj
}

// --- login challenge: state + PKCE ------------------------------------------
// A signature alone binds state to nothing: an attacker can start a login,
// finish consent with their OWN Google account, and hand the victim's browser
// the resulting callback URL — planting the attacker's session in the victim's
// browser (login CSRF / session fixation). So the state is also written to a
// short-lived HttpOnly cookie and must match at the callback: a state minted
// for one browser is worthless in another.
//
// The PKCE verifier rides the same trip. It proves the browser that finishes
// the exchange is the one that started it, so a stolen authorization code
// cannot be redeemed by anyone else.
export function newLoginChallenge(): { state: string; verifier: string } {
  return {
    // Math.random() is not a CSPRNG — its output is predictable enough to
    // forge. The nonce is security-bearing, so it comes from crypto.
    state: pack({ nonce: randomBytes(32).toString('base64url') }),
    verifier: randomBytes(32).toString('base64url'),
  }
}

// PKCE S256: the challenge is the SHA-256 of the verifier, base64url-encoded.
export function codeChallengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

// `cookieState` is the value of the state cookie set at login. Both must be
// present and identical, and the state must still carry a valid signature.
export function verifyState(state: string | undefined, cookieState: string | undefined): void {
  if (!state) throw new AppError('AuthenticationError', 'Missing OAuth state')
  if (!cookieState)
    throw new AppError('AuthenticationError', 'Missing OAuth state cookie — start sign-in again')
  const a = Buffer.from(state)
  const b = Buffer.from(cookieState)
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new AppError('AuthenticationError', 'OAuth state does not match this browser')
  unpack(state) // throws if invalid/expired
}

// The authorization URL the browser is sent to. Real Google in prod; the local
// mock consent page in dev.
export function googleAuthorizeUrl(
  clientId: string,
  state: string,
  redirectUri: string,
  codeChallenge: string,
  hint?: { email?: string; name?: string },
): string {
  if (clientId) {
    const p = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })
    return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`
  }
  const p = new URLSearchParams({ state, redirect_uri: redirectUri })
  if (hint?.email) p.set('email', hint.email)
  if (hint?.name) p.set('name', hint.name)
  return `/api/oauth/mock/consent?${p.toString()}`
}

// Mock "consent screen": a tiny page that, on approval, hands back a signed code.
export function mockConsentHtml(state: string, redirectUri: string, email: string, name: string): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
  // state + redirect_uri travel as hidden inputs — a GET form discards the
  // action URL's query string, so they must be part of the form body.
  return `<!table html><html><head><meta charset="utf-8"><title>Sign in with Google (dev)</title>
    <style>body{font-family:system-ui;background:#f4f5f6;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
    .card{background:#fff;border:1px solid #d1d8dd;border-radius:10px;padding:28px;width:340px}
    h1{font-size:16px;margin:0 0 4px} p{color:#6c7680;font-size:13px;margin:0 0 16px}
    label{display:block;font-size:12px;color:#6c7680;margin:10px 0 4px}
    input{width:100%;box-sizing:border-box;padding:8px;border:1px solid #d1d8dd;border-radius:6px;font-size:14px}
    button{margin-top:18px;width:100%;padding:9px;background:#2490ef;color:#fff;border:0;border-radius:6px;font-size:14px;cursor:pointer}</style>
    </head><body><form class="card" method="get" action="/api/oauth/mock/approve">
      <h1>Sign in with Google</h1><p>Mock provider (dev)</p>
      <input type="hidden" name="state" value="${esc(state)}" />
      <input type="hidden" name="redirect_uri" value="${esc(redirectUri)}" />
      <label>Email</label><input name="email" data-testid="mock-email" value="${esc(email)}" />
      <label>Name</label><input name="name" data-testid="mock-name" value="${esc(name)}" />
      <button type="submit" data-testid="mock-approve">Continue</button>
    </form></body></html>`
}

// The one place the mock provider is allowed to send an authorization code:
// this application's own callback. A real provider only redirects to a URI
// registered with it; the mock's equivalent is this constant.
export const OAUTH_CALLBACK_PATH = '/api/oauth/google/callback'

// Approve → issue a signed code carrying the chosen identity, then bounce to the
// OAuth callback exactly as a real provider would.
//
// The redirect target is allowlisted, not reflected. The mock mints a session
// for ANY typed email — `Administrator` included — so reflecting the caller's
// `redirect_uri` handed an admin authorization code to whatever host asked
// for it (`?redirect_uri=https://evil.example.com/x` → 302 there with the
// code attached). Exact match, so neither a protocol-relative `//host` nor a
// `…/callback/../../elsewhere` traversal slips past.
export function mockApproveRedirect(state: string, redirectUri: string, email: string, name: string): string {
  if (redirectUri !== OAUTH_CALLBACK_PATH)
    throw new AppError(
      'BadRequestError',
      `Mock provider only redirects to ${OAUTH_CALLBACK_PATH}`,
    )
  const code = pack({ email, name })
  const p = new URLSearchParams({ code, state })
  return `${redirectUri}?${p.toString()}`
}

// Exchange an authorization code for the user's identity. Real Google POSTs
// the token endpoint then fetches userinfo; the mock decodes its signed code.
// `redirectUri` must byte-match the one sent to the authorize endpoint.
export async function exchangeCode(
  code: string | undefined,
  redirectUri: string,
  clientId: string,
  codeVerifier: string | undefined,
): Promise<{ email: string; name: string }> {
  if (!code) throw new AppError('AuthenticationError', 'Missing authorization code')
  if (!clientId) {
    // This is the mock branch — the one that mints a session from a typed
    // email. Guarded here too, not just at the route: this is where the
    // identity is actually conjured.
    if (!mockOAuthEnabled())
      throw new AppError('AuthenticationError', 'Mock OAuth provider is disabled')
    const obj = unpack(code)
    const email = String(obj.email ?? '').trim().toLowerCase()
    if (!email) throw new AppError('AuthenticationError', 'No email in code')
    return { email, name: String(obj.name ?? email) }
  }
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      // PKCE: Google checks this against the code_challenge sent at authorize.
      code_verifier: codeVerifier ?? '',
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!tokenRes.ok) throw new AppError('AuthenticationError', 'Google token exchange failed')
  const { access_token } = (await tokenRes.json()) as { access_token?: string }
  if (!access_token) throw new AppError('AuthenticationError', 'Google token exchange failed')
  const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${access_token}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!infoRes.ok) throw new AppError('AuthenticationError', 'Google userinfo fetch failed')
  const info = (await infoRes.json()) as { email?: string; email_verified?: boolean; name?: string }
  const email = String(info.email ?? '').trim().toLowerCase()
  if (!email || info.email_verified !== true)
    throw new AppError('AuthenticationError', 'Google account has no verified email')
  return { email, name: String(info.name ?? email) }
}

// --- #150: the sign-in handoff code -----------------------------------------
// The callback used to bounce to `/oauth-callback?token=<7-day session JWT>`,
// which parks a long-lived credential in browser history, in the `Referer` of
// every later outbound request from that page, and in every proxy/CDN access
// log along the way.
//
// The SPA still needs the literal token at that moment — its WebSocket carries
// it as a query parameter and private file downloads append it — so an empty
// redirect on the sid cookie alone would break sign-in. What travels in the
// URL instead is a handoff code: 32 random bytes, redeemable exactly once,
// over POST, within a minute. Redeeming burns it, so the copy left behind in
// history or a log is already spent.
//
// It is also bound to the browser it was minted for: the same response sets
// the sid cookie, and redemption requires that cookie to match the session
// being handed over. A code intercepted in flight is worthless elsewhere.
const HANDOFF_TTL_MS = 60_000

interface HandoffSession {
  token: string
  user: SessionUser
}

const handoffs = new Map<string, { session: HandoffSession; expires: number }>()

export function mintHandoffCode(session: HandoffSession): string {
  const now = Date.now()
  // Abandoned codes (the user closes the tab mid-redirect) would otherwise
  // accumulate for the process's lifetime.
  for (const [code, entry] of handoffs) if (entry.expires <= now) handoffs.delete(code)
  const code = randomBytes(32).toString('base64url')
  handoffs.set(code, { session, expires: now + HANDOFF_TTL_MS })
  return code
}

// One code, one use. The entry is deleted whatever the outcome — an expired or
// wrong-browser attempt burns it too, so nothing is left to retry against.
export function redeemHandoffCode(code: string | undefined, sid: string | undefined): HandoffSession {
  const invalid = () => new AppError('AuthenticationError', 'Invalid or expired sign-in code')
  if (!code) throw invalid()
  const entry = handoffs.get(code)
  handoffs.delete(code)
  if (!entry || entry.expires <= Date.now()) throw invalid()
  const a = Buffer.from(sid ?? '')
  const b = Buffer.from(entry.session.token)
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw invalid()
  return entry.session
}

// System Settings `allowed_login_domains` (comma-separated) limits which
// email domains may auto-provision an account on first sign-in. Empty = no
// restriction (dev). Users that already exist were provisioned deliberately
// and always may sign in, mirroring the report server's grants arm.
async function domainAdmitted(email: string): Promise<boolean> {
  const domains = (await getSystemSettings()).allowed_login_domains
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
  if (!domains.length) return true
  const at = email.lastIndexOf('@')
  return at > 0 && domains.includes(email.slice(at + 1))
}

// Map an OAuth identity to a User: link an existing account by email/name or
// create one, mark it as a Google login, and return its name.
export async function findOrCreateGoogleUser(email: string, name: string): Promise<string> {
  const [existing] = await sql`
    select row_id, enabled, user_type from "user"
    where lower(email) = ${email} or lower(row_id) = ${email} limit 1`
  let userName: string
  if (existing) {
    userName = existing.row_id as string
    // #137: a disabled principal stays disabled. This used to flip `enabled`
    // back on ("ensure it can sign in") BEFORE issueSession got a say — so an
    // OAuth round trip undid an administrator's disable, and every access
    // token that principal owned started working again, even though the
    // interactive login itself was still refused. Refusing here matches
    // login() and issueSession(), which both reject a disabled user.
    //
    // ONE refusal, ONE message, deliberately. Separate "this account is
    // disabled" and "this account cannot sign in" replies let an unauthenticated
    // caller probe an address and learn which accounts exist and in what
    // state — the exact enumeration oracle requestPasswordReset() avoids by
    // returning a silent null. The generic wording matches login()'s.
    if (existing.user_type === 'service' || !existing.enabled)
      throw new AppError('AuthenticationError', 'Invalid login credentials')
  } else {
    if (!(await domainAdmitted(email)))
      throw new AppError('AuthenticationError', 'Access not provisioned for this account. Contact IT.')
    const created = await saveDoc(
      'User',
      { row_id: email, email, full_name: name || email, enabled: true, roles: [] },
      'Administrator',
    )
    userName = String(created.row_id)
  }
  // social_login is read_only (system-managed) → set it with a direct write.
  await sql`update "user" set social_login = 'google' where row_id = ${userName}`
  return userName
}

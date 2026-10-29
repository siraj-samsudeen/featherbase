import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { SessionUser } from './auth'
import { AppError } from './errors'
import { GOOGLE_CONSUMER_DOMAINS, methodOfKind, mockOAuthEnabled, methodUsable, type SignInMethod } from './identities'
import { GOOGLE_OFF, type VerifiedIdentity } from './sign-in'
import { readVariable } from './env'


// PLAT-006: social login (Google OAuth) mapped to the User Table. The client
// id and the login-domain allowlist are instance configuration (the Google
// Sign In Method row, editable in the Admin UI — person-identities);
// only GOOGLE_CLIENT_SECRET comes from the environment. A mock provider can
// stand in for Google in development: a local consent page returns a signed
// authorization `code` that the callback exchanges for the user's identity.

const secret = () => readVariable('JWT_SECRET') ?? 'dev-secret-change-me'

// Google is the Sign In Method row of kind `google` (person-identities). Real
// Google is used only when that row carries a client id; otherwise the mock.
async function googleMethod(): Promise<SignInMethod | null> {
  return methodOfKind('google')
}

export async function oauthClientId(): Promise<string> {
  return (await googleMethod())?.client_id ?? ''
}

/** Is Google sign-in offered at all: the row is on, and either a client id is
 *  set or the dev mock was explicitly opted into. */
export async function googleAvailable(): Promise<SignInMethod | null> {
  const method = await googleMethod()
  return method && methodUsable(method) ? method : null
}

// The mock provider is opt-in only: mockOAuthEnabled() (identities.ts) reads
// ALLOW_MOCK_OAUTH=1. Absence of configuration never enables it.

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
    throw new AppError('AuthenticationError', GOOGLE_OFF)
}

// --- signed, stateless tokens (state + mock code) ---------------------------
function hmac(body: string): string {
  return createHmac('sha256', secret()).update(body).digest('base64url')
}
function pack(obj: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify({ ...obj, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url')
  return `${body}.${hmac(body)}`
}
/** Which flow a callback's state CLAIMS to belong to, without trusting it:
 *  used only to choose where an error is shown (a link attempt goes back to
 *  the Sign-in methods page). Every action still requires verifyState. */
export function claimedPurpose(state: string | undefined): string | undefined {
  try {
    const obj = JSON.parse(Buffer.from(String(state ?? '').split('.')[0] ?? '', 'base64url').toString()) as { purpose?: unknown }
    return typeof obj.purpose === 'string' ? obj.purpose : undefined
  } catch {
    return undefined
  }
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
//
// #488: the state also signs the host the sign-in started on (lowercased, no
// port). Each address has its own redirect_uri, and a callback arriving on any
// other host is refused, so a sign-in can only finish where it began.
export function newLoginChallenge(host: string, extra: { purpose?: 'link'; uid?: string } = {}): { state: string; verifier: string } {
  return {
    // Math.random() is not a CSPRNG — its output is predictable enough to
    // forge. The nonce is security-bearing, so it comes from crypto. A link
    // flow also signs who started it (person-identities D6).
    state: pack({ nonce: randomBytes(32).toString('base64url'), host, ...extra }),
    verifier: randomBytes(32).toString('base64url'),
  }
}

// PKCE S256: the challenge is the SHA-256 of the verifier, base64url-encoded.
export function codeChallengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

// `cookieState` is the value of the state cookie set at login. Both must be
// present and identical, and the state must still carry a valid signature and
// name the host this request arrived on.
export function verifyState(state: string | undefined, cookieState: string | undefined, host: string): { purpose?: string; uid?: string } {
  if (!state) throw new AppError('AuthenticationError', 'Missing OAuth state')
  if (!cookieState)
    throw new AppError('AuthenticationError', 'Missing OAuth state cookie — start sign-in again')
  const a = Buffer.from(state)
  const b = Buffer.from(cookieState)
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new AppError('AuthenticationError', 'OAuth state does not match this browser')
  const obj = unpack(state) // throws if invalid/expired
  if (obj.host !== host)
    throw new AppError('AuthenticationError', 'This sign-in was started on another address — start it again here')
  return { purpose: typeof obj.purpose === 'string' ? obj.purpose : undefined, uid: typeof obj.uid === 'string' ? obj.uid : undefined }
}

// The authorization URL the browser is sent to. Real Google in prod; the local
// mock consent page in dev.
export function googleAuthorizeUrl(
  clientId: string,
  state: string,
  redirectUri: string,
  codeChallenge: string,
  hint?: { email?: string; name?: string; subject?: string; hd?: string },
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
  if (hint?.subject) p.set('subject', hint.subject)
  if (hint?.hd !== undefined) p.set('hd', hint.hd)
  return `/api/oauth/mock/consent?${p.toString()}`
}

// Mock "consent screen": a tiny page that, on approval, hands back a signed code.
export function mockConsentHtml(state: string, redirectUri: string, email: string, name: string, subject = '', hd?: string): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
  // state + redirect_uri travel as hidden inputs — a GET form discards the
  // action URL's query string, so they must be part of the form body.
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sign in with Google (dev)</title>
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
      <label>Google account ID (blank = the email)</label><input name="subject" data-testid="mock-subject" value="${esc(subject)}" />
      ${hd === undefined ? '' : `<input type="hidden" name="hd" value="${esc(hd)}" />`}
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
export function mockApproveRedirect(state: string, redirectUri: string, email: string, name: string, subject = '', hd?: string): string {
  if (redirectUri !== OAUTH_CALLBACK_PATH)
    throw new AppError(
      'BadRequestError',
      `Mock provider only redirects to ${OAUTH_CALLBACK_PATH}`,
    )
  const code = pack({ email, name, subject, ...(hd === undefined ? {} : { hd }) })
  const p = new URLSearchParams({ code, state })
  return `${redirectUri}?${p.toString()}`
}

const CONSUMER_DOMAINS = new Set(GOOGLE_CONSUMER_DOMAINS)

/** Google's verify step: a VerifiedIdentity whose subject is the permanent
 *  account ID (`sub`); the email is display data and an admission signal. */

// Injectable for the sandboxed suite — Google itself is never contacted from a
// test (same seam as `_setEmbedFetch` in sales-target.ts).
let googleFetch: typeof fetch | null = null
export function _setGoogleFetch(f: typeof fetch | null) {
  googleFetch = f
}

// Exchange an authorization code for the user's identity. Real Google POSTs
// the token endpoint then fetches userinfo; the mock decodes its signed code.
// `redirectUri` must byte-match the one sent to the authorize endpoint.
export async function exchangeCode(
  code: string | undefined,
  redirectUri: string,
  clientId: string,
  codeVerifier: string | undefined,
): Promise<VerifiedIdentity> {
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
    const domain = email.split('@')[1] ?? ''
    // The mock plays a Workspace account unless told otherwise (hd '' = none).
    const hd = obj.hd === undefined ? (CONSUMER_DOMAINS.has(domain) ? null : domain) : String(obj.hd) || null
    return {
      status: 'verified',
      subject: String(obj.subject ?? '').trim() || email,
      email,
      email_verified: true,
      display_name: String(obj.name ?? '') || email,
      hosted_domain: hd,
    }
  }
  const tokenRes = await (googleFetch ?? fetch)('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: readVariable('GOOGLE_CLIENT_SECRET') ?? '',
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
  const infoRes = await (googleFetch ?? fetch)('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${access_token}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!infoRes.ok) throw new AppError('AuthenticationError', 'Google userinfo fetch failed')
  const info = (await infoRes.json()) as { sub?: string; email?: string; email_verified?: boolean; name?: string; hd?: string }
  const subject = String(info.sub ?? '').trim()
  if (!subject) throw new AppError('AuthenticationError', 'Google did not return an account ID')
  const email = String(info.email ?? '').trim().toLowerCase()
  const verified = Boolean(email) && info.email_verified === true
  return {
    status: 'verified',
    subject,
    // An unverified address is not kept or used (review nit).
    email: verified ? email : null,
    email_verified: verified,
    display_name: String(info.name ?? '') || null,
    hosted_domain: info.hd ? String(info.hd).toLowerCase() : null,
  }
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
//
// #488 adds a second kind: the hand-off to ANOTHER address of this instance.
// The source host's sid cookie cannot cross hosts, and a code that only named
// its target host could be handed to someone else's browser (login CSRF: an
// attacker signs in, takes their own hand-off URL, sends it to a victim, whose
// browser ends up signed in as the attacker). So the hand-off is a round trip
// that binds it to the browser that signed in, with no shared cookie:
//
//   1. the sign-in on the source mints a TICKET (source session, source host,
//      target host) and sends the browser to the target's /api/handoff/start;
//   2. the target sets its own short-lived, host-only, HttpOnly nonce cookie
//      and sends the browser back to the source's /api/handoff/bind with the
//      nonce's hash;
//   3. the source requires THIS browser's sid cookie to be the ticket's
//      session, spends the ticket and mints a CODE bound to the target host,
//      the nonce's hash and the source session, then sends the browser to the
//      target's /featherbase/oauth-callback;
//   4. the target redeems the code only with the matching nonce cookie, and
//      only while the source session is still live (index.ts re-resolves it),
//      then mints a new session of its own.
const HANDOFF_TTL_MS = 60_000

interface HandoffSession {
  token: string
  user: SessionUser
}

type Handoff =
  | { kind: 'session'; session: HandoffSession }
  | { kind: 'address'; host: string; nonceHash: string; sourceToken: string }
type RedeemedHandoff = { kind: 'session'; session: HandoffSession } | { kind: 'address'; sourceToken: string }

const handoffs = new Map<string, { entry: Handoff; expires: number }>()

interface Ticket {
  sourceToken: string
  sourceHost: string
  targetHost: string
}
const tickets = new Map<string, { ticket: Ticket; expires: number }>()

function sweep<T extends { expires: number }>(map: Map<string, T>, now: number) {
  // Abandoned codes (the user closes the tab mid-redirect) would otherwise
  // accumulate for the process's lifetime.
  for (const [key, held] of map) if (held.expires <= now) map.delete(key)
}

function mint(entry: Handoff): string {
  const now = Date.now()
  sweep(handoffs, now)
  const code = randomBytes(32).toString('base64url')
  handoffs.set(code, { entry, expires: now + HANDOFF_TTL_MS })
  return code
}

function sameSecret(a: string | undefined, b: string): boolean {
  const x = Buffer.from(a ?? '')
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** The hash of a hand-off nonce: what travels in a URL, while the nonce
 *  itself stays in the target's HttpOnly cookie. */
export function nonceHash(nonce: string): string {
  return createHash('sha256').update(nonce).digest('base64url')
}

/** A fresh nonce for the target's cookie (step 2). */
export function newHandoffNonce(): string {
  return randomBytes(32).toString('base64url')
}

/** A code for the browser that already holds `session`'s sid cookie. */
export function mintHandoffCode(session: HandoffSession): string {
  return mint({ kind: 'session', session })
}

/** Step 1: a ticket for handing the session `sourceToken`, signed in on
 *  `sourceHost`, over to `targetHost`. */
export function mintHandoffTicket(sourceToken: string, sourceHost: string, targetHost: string): string {
  const now = Date.now()
  sweep(tickets, now)
  const id = randomBytes(32).toString('base64url')
  tickets.set(id, { ticket: { sourceToken, sourceHost, targetHost }, expires: now + HANDOFF_TTL_MS })
  return id
}

const invalid = () => new AppError('AuthenticationError', 'Invalid or expired sign-in code')

/** Step 2: the live ticket, when it is for this (target) host. Not spent. */
export function ticketForTarget(id: string | undefined, host: string): Ticket {
  const held = id ? tickets.get(id) : undefined
  if (!held || held.expires <= Date.now() || held.ticket.targetHost !== host) throw invalid()
  return held.ticket
}

/** Step 3: on the source host, with this browser's sid cookie, spend the
 *  ticket and mint the code for its target, bound to the nonce's hash. Any
 *  refusal spends the ticket too. */
export function bindHandoffTicket(id: string | undefined, sid: string | undefined, host: string, hash: string | undefined): { code: string; targetHost: string } {
  const held = id ? tickets.get(id) : undefined
  if (id) tickets.delete(id)
  if (!held || held.expires <= Date.now()) throw invalid()
  const { ticket } = held
  if (ticket.sourceHost !== host || !hash || !sameSecret(sid, ticket.sourceToken)) throw invalid()
  return { code: mint({ kind: 'address', host: ticket.targetHost, nonceHash: hash, sourceToken: ticket.sourceToken }), targetHost: ticket.targetHost }
}

// One code, one use. The entry is deleted whatever the outcome — an expired,
// wrong-browser or wrong-host attempt burns it too, so nothing is left to
// retry against. A browser-bound code (#150) needs its sid cookie; an address
// hand-off needs its host and the target's nonce cookie (`nonce`).
export function redeemHandoffCode(code: string | undefined, sid: string | undefined, host: string, nonce?: string): RedeemedHandoff {
  if (!code) throw invalid()
  const held = handoffs.get(code)
  handoffs.delete(code)
  if (!held || held.expires <= Date.now()) throw invalid()
  const { entry } = held
  if (entry.kind === 'address') {
    if (entry.host !== host || !nonce || !sameSecret(nonceHash(nonce), entry.nonceHash)) throw invalid()
    return { kind: 'address', sourceToken: entry.sourceToken }
  }
  if (!sameSecret(sid, entry.session.token)) throw invalid()
  return { kind: 'session', session: entry.session }
}

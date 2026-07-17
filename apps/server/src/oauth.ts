import { createHmac, timingSafeEqual } from 'node:crypto'
import { sql } from './db'
import { AppError } from './errors'
import { saveDoc, getDoc } from './document'

// PLAT-006: social login (Google OAuth) mapped to the User DocType. In dev
// (no GOOGLE_CLIENT_ID configured) a mock provider stands in for Google: a
// local consent page returns a signed authorization `code` that the callback
// exchanges for the user's identity. The same handlers would drive real Google
// once credentials are set; only `authorizeUrl`/`exchange` differ.

const SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me'

// Real Google is used only when a client id is configured; otherwise mock.
export function isMockProvider(): boolean {
  return !process.env.GOOGLE_CLIENT_ID
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

export function newState(): string {
  return pack({ nonce: Math.random().toString(36).slice(2) })
}
export function verifyState(state: string | undefined): void {
  if (!state) throw new AppError('AuthenticationError', 'Missing OAuth state')
  unpack(state) // throws if invalid/expired
}

// The authorization URL the browser is sent to. Real Google in prod; the local
// mock consent page in dev.
export function googleAuthorizeUrl(state: string, redirectUri: string, hint?: { email?: string; name?: string }): string {
  if (!isMockProvider()) {
    const p = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID as string,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
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
  return `<!doctype html><html><head><meta charset="utf-8"><title>Sign in with Google (dev)</title>
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

// Approve → issue a signed code carrying the chosen identity, then bounce to the
// OAuth callback exactly as a real provider would.
export function mockApproveRedirect(state: string, redirectUri: string, email: string, name: string): string {
  const code = pack({ email, name })
  const p = new URLSearchParams({ code, state })
  return `${redirectUri}?${p.toString()}`
}

// Exchange an authorization code for the user's identity. Real Google would POST
// the token endpoint + fetch userinfo; the mock decodes its signed code.
export async function exchangeCode(code: string | undefined): Promise<{ email: string; name: string }> {
  if (!code) throw new AppError('AuthenticationError', 'Missing authorization code')
  if (isMockProvider()) {
    const obj = unpack(code)
    const email = String(obj.email ?? '').trim().toLowerCase()
    if (!email) throw new AppError('AuthenticationError', 'No email in code')
    return { email, name: String(obj.name ?? email) }
  }
  // Real Google exchange would go here (token endpoint + userinfo).
  throw new AppError('AuthenticationError', 'Live Google exchange not configured')
}

// Map an OAuth identity to a User: link an existing account by email/name or
// create one, mark it as a Google login, and return its name.
export async function findOrCreateGoogleUser(email: string, name: string): Promise<string> {
  const [existing] = await sql`
    select name from tab_user where lower(email) = ${email} or lower(name) = ${email} limit 1`
  let userName: string
  if (existing) {
    userName = existing.name as string
    // Ensure it can sign in.
    const doc = await getDoc('User', userName)
    if (!doc.enabled)
      await saveDoc('User', { name: userName, modified: doc.modified, enabled: true }, 'Administrator')
  } else {
    const created = await saveDoc(
      'User',
      { name: email, email, full_name: name || email, enabled: true, roles: [] },
      'Administrator',
    )
    userName = String(created.name)
  }
  // social_login is read_only (system-managed) → set it with a direct write.
  await sql`update tab_user set social_login = 'google' where name = ${userName}`
  return userName
}

// Sign in with Microsoft (microsoft-sign-in): Microsoft Entra ID work and
// school accounts through the identity platform v2.0, authorization code with
// PKCE and a nonce. This module is only the verify step and its URLs; who gets
// in is the shared pipeline's (sign-in.ts), exactly as for Google.
//
// Configuration is the Sign In Method row of kind `microsoft`: the client id,
// the allowed domains, and `settings.tenant` ('organizations', the default, or
// one tenant's ID). The client secret is only the MICROSOFT_CLIENT_SECRET
// deployment variable. Without a client id the dev stand-in serves, and only
// when ALLOW_MOCK_OAUTH=1.
import { createHash } from 'node:crypto'
import { AppError } from './errors'
import { methodOfKind, methodUsable, mockOAuthEnabled, type SignInMethod } from './identities'
import { packSigned, unpackSigned } from './oauth'
import { readVariable } from './env'
import { MICROSOFT_OFF, type VerifiedIdentity } from './sign-in'

export { MICROSOFT_OFF }

export const MICROSOFT_CALLBACK_PATH = '/api/oauth/microsoft/callback'
/** The tenant every personal Microsoft account (outlook.com, hotmail.com)
 *  belongs to. The organizations endpoint never signs one in; refused anyway. */
export const MICROSOFT_CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad'

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const AUTHORITY = 'https://login.microsoftonline.com'
/** Clock skew allowed on the token's expiry, in seconds. */
const SKEW = 300

const failed = (why: string) => new AppError('AuthenticationError', `Microsoft sign-in failed: ${why}`)

/** Why a tenant setting cannot be saved, or null. */
export function tenantProblem(value: unknown): string | null {
  if (value == null || value === '') return null
  const t = String(value).trim().toLowerCase()
  return t === 'organizations' || GUID.test(t) ? null : 'must be organizations or a tenant ID'
}

/** The tenant a method signs in through: 'organizations' unless it names one. */
export function microsoftTenant(method: Pick<SignInMethod, 'settings'>): string {
  const value = method.settings?.tenant
  if (tenantProblem(value)) throw new AppError('AuthenticationError', MICROSOFT_OFF)
  return value ? String(value).trim().toLowerCase() : 'organizations'
}

/** Is Microsoft sign-in offered: the row is on, with a client id or the stand-in. */
export async function microsoftAvailable(): Promise<SignInMethod | null> {
  const method = await methodOfKind('microsoft')
  return method && methodUsable(method) ? method : null
}

/** The ID token's nonce, bound to the sign-in's state (which is itself bound
 *  to this browser's cookie), so nothing extra needs storing. */
export function microsoftNonce(state: string): string {
  return createHash('sha256').update(`microsoft-nonce:${state}`).digest('base64url')
}

export function microsoftAuthorizeUrl(method: SignInMethod, state: string, redirectUri: string, codeChallenge: string): string {
  if (!method.client_id) return `/api/oauth/mock/microsoft/consent?${new URLSearchParams({ state, redirect_uri: redirectUri })}`
  const p = new URLSearchParams({
    client_id: method.client_id,
    response_type: 'code',
    response_mode: 'query',
    redirect_uri: redirectUri,
    scope: 'openid profile email',
    state,
    nonce: microsoftNonce(state),
    prompt: 'select_account',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })
  return `${AUTHORITY}/${microsoftTenant(method)}/oauth2/v2.0/authorize?${p}`
}

/** `xms_edov`: the tenant has verified it owns the email's domain. A boolean
 *  claim, though some tenants send it as a string or a number. */
function domainVerified(value: unknown): boolean {
  return value === true || value === 1 || value === 'true' || value === '1'
}

/** What Featherbase believes from an ID token's claims (design D2, D3). The
 *  token came straight from Microsoft's token endpoint over TLS, so its
 *  signature is not checked again (OpenID Connect Core 3.1.3.7); every other
 *  check is here. Throws on any failed check. */
export function microsoftIdentityFromClaims(
  c: Record<string, unknown>,
  expected: { clientId: string; tenant: string; nonce: string; now?: number },
): VerifiedIdentity {
  const now = expected.now ?? Math.floor(Date.now() / 1000)
  const tid = String(c.tid ?? '').toLowerCase()
  const oid = String(c.oid ?? '').toLowerCase()
  if (!GUID.test(tid)) throw failed('no tenant')
  if (tid === MICROSOFT_CONSUMER_TENANT) throw failed('a personal account')
  if (expected.tenant !== 'organizations' && tid !== expected.tenant) throw failed('another tenant')
  if (c.iss !== `${AUTHORITY}/${tid}/v2.0`) throw failed('another issuer')
  if (c.aud !== expected.clientId) throw failed('another audience')
  if (typeof c.exp !== 'number' || c.exp + SKEW < now) throw failed('expired')
  if (typeof c.nonce !== 'string' || c.nonce !== expected.nonce) throw failed('another sign-in')
  if (!GUID.test(oid)) throw failed('no account ID')
  // Only `email`, and only with `xms_edov`: any tenant's administrator can set
  // any address on their own users. `preferred_username` is never trusted.
  const email = typeof c.email === 'string' ? c.email.trim().toLowerCase() : ''
  const verified = Boolean(email) && /^[^\s@]+@[^\s@]+$/.test(email) && domainVerified(c.xms_edov)
  return {
    status: 'verified',
    subject: `${tid}/${oid}`,
    email: verified ? email : null,
    email_verified: verified,
    display_name: typeof c.name === 'string' && c.name.trim() ? c.name.trim() : null,
    // The domain the tenant has proven it owns plays Google's hosted-domain part.
    hosted_domain: verified ? email.split('@')[1] : null,
  }
}

function decodeIdToken(token: unknown): Record<string, unknown> {
  const parts = typeof token === 'string' ? token.split('.') : []
  if (parts.length !== 3) throw failed('no ID token')
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as unknown
    if (claims && typeof claims === 'object' && !Array.isArray(claims)) return claims as Record<string, unknown>
  } catch {
    // fall through
  }
  throw failed('an unreadable ID token')
}

// Injectable for the sandboxed suite: Microsoft is never contacted from a test.
let microsoftFetch: typeof fetch | null = null
export function _setMicrosoftFetch(f: typeof fetch | null) {
  microsoftFetch = f
}

/** Redeem an authorization code for the account's identity. `state` is the
 *  verified state the sign-in started with, which fixes the nonce. */
export async function exchangeMicrosoftCode(
  code: string | undefined,
  redirectUri: string,
  method: SignInMethod,
  codeVerifier: string | undefined,
  state: string,
): Promise<VerifiedIdentity> {
  if (!code) throw new AppError('AuthenticationError', 'Missing authorization code')
  const nonce = microsoftNonce(state)
  if (!method.client_id) {
    // The stand-in: its code carries claims, checked exactly as a real token's.
    if (!mockOAuthEnabled()) throw new AppError('AuthenticationError', 'Mock OAuth provider is disabled')
    const obj = unpackSigned(code)
    if (obj.provider !== 'microsoft') throw new AppError('AuthenticationError', 'Bad signature')
    const tid = String(obj.tid)
    return microsoftIdentityFromClaims(
      {
        iss: `${AUTHORITY}/${tid.toLowerCase()}/v2.0`,
        aud: 'mock',
        exp: Math.floor(Date.now() / 1000) + 600,
        nonce,
        tid,
        oid: obj.oid,
        email: obj.email,
        xms_edov: obj.edov === true,
        name: obj.name,
      },
      { clientId: 'mock', tenant: 'organizations', nonce },
    )
  }
  const tenant = microsoftTenant(method)
  const res = await (microsoftFetch ?? fetch)(`${AUTHORITY}/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: method.client_id,
      client_secret: readVariable('MICROSOFT_CLIENT_SECRET') ?? '',
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier ?? '',
      scope: 'openid profile email',
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new AppError('AuthenticationError', 'Microsoft token exchange failed')
  const { id_token } = (await res.json().catch(() => ({}))) as { id_token?: unknown }
  return microsoftIdentityFromClaims(decodeIdToken(id_token), { clientId: method.client_id, tenant, nonce })
}

// --- the dev stand-in -----------------------------------------------------

/** The stand-in's consent page: on approval, a signed code carrying the
 *  account's claims. */
export function mockMicrosoftConsentHtml(state: string, redirectUri: string): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sign in with Microsoft (dev)</title>
    <style>body{font-family:system-ui;background:#f4f5f6;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
    .card{background:#fff;border:1px solid #d1d8dd;border-radius:10px;padding:28px;width:340px}
    h1{font-size:16px;margin:0 0 4px} p{color:#6c7680;font-size:13px;margin:0 0 16px}
    label{display:block;font-size:12px;color:#6c7680;margin:10px 0 4px}
    input{width:100%;box-sizing:border-box;padding:8px;border:1px solid #d1d8dd;border-radius:6px;font-size:14px}
    input[type=checkbox]{width:auto}
    button{margin-top:18px;width:100%;padding:9px;background:#2f2f2f;color:#fff;border:0;border-radius:6px;font-size:14px;cursor:pointer}</style>
    </head><body><form class="card" method="get" action="/api/oauth/mock/microsoft/approve">
      <h1>Sign in with Microsoft</h1><p>Stand-in for Microsoft (dev)</p>
      <input type="hidden" name="state" value="${esc(state)}" />
      <input type="hidden" name="redirect_uri" value="${esc(redirectUri)}" />
      <label>Email</label><input name="email" data-testid="mock-email" value="" />
      <label>Name</label><input name="name" data-testid="mock-name" value="Demo User" />
      <label>Tenant ID</label><input name="tid" data-testid="mock-tid" value="0b7c1f6e-3c1a-4f7e-9a63-2a6a3c1d9e11" />
      <label>Object ID</label><input name="oid" data-testid="mock-oid" value="5f1e2d3c-4b5a-4968-8776-655443322110" />
      <label><input type="checkbox" name="edov" value="1" checked data-testid="mock-edov" /> The tenant has verified this address's domain</label>
      <button type="submit" data-testid="mock-approve">Continue</button>
    </form></body></html>`
}

/** Approve at the stand-in: a signed code, sent only to Microsoft sign-in's
 *  own callback (an allowlist, never the caller's redirect_uri). */
export function mockMicrosoftApproveRedirect(state: string, redirectUri: string, account: { email: string; name: string; tid: string; oid: string; edov: boolean }): string {
  if (redirectUri !== MICROSOFT_CALLBACK_PATH)
    throw new AppError('BadRequestError', `Mock provider only redirects to ${MICROSOFT_CALLBACK_PATH}`)
  const code = packSigned({ provider: 'microsoft', ...account })
  return `${redirectUri}?${new URLSearchParams({ code, state })}`
}

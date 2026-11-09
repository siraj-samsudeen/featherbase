import type { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { config } from './config'
import { OAUTH_CALLBACK_PATH } from './oauth'
import { linkAddress, requestHost } from './instance-addresses'

// Sessions ride an HttpOnly `sid` cookie in addition to the Bearer token the
// SPA stores. Either credential authenticates a request; the cookie keeps the
// token out of reach of page scripts and lets plain browser requests (file
// links, the print page) carry the session.
// #353: `secure` by the sign-in challenge cookies' rule (externalOrigin): on
// whenever the instance is reached over https, off on a plain-http local
// origin, where a browser would silently drop a Secure cookie.
export function setSidCookie(c: Context, token: string, maxAgeSeconds: number) {
  setCookie(c, 'sid', token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: maxAgeSeconds,
    secure: externalOrigin(c).protocol === 'https:',
  })
}

// The Authorization header wins; an sid cookie is the fallback credential.
export function authCredential(c: Context): string | undefined {
  const header = c.req.header('authorization')
  if (header) return header
  const sid = getCookie(c, 'sid')
  return sid ? `Bearer ${sid}` : undefined
}

// The origin a browser reaches this instance on. INSTANCE_ADDRESSES is
// configuration and therefore authoritative (#488): the request's Host only
// SELECTS one of its entries, and an unlisted host gets the Admin entry, so a
// header can never create an origin. Only a checkout with no list at all
// (development and test) falls back to the request, and then
// `x-forwarded-proto` is read as what it is — a LIST. A proxy chain APPENDS
// its hop rather than overwriting, so a request that reached the edge over TLS
// arrives as `https,http`; comparing that whole string to 'https' read false
// and set the login cookies without `Secure`, and interpolated
// `https,http://host` into the redirect_uri. Only the first hop is the
// client's, and anything that is not http/https is not a protocol we will
// paste into an origin.
export function externalOrigin(c: Context): URL {
  if (config.instanceAddresses) return new URL(linkAddress(config.instanceAddresses, requestHost(c.req.url)).address)
  const url = new URL(c.req.url)
  const forwarded = c.req.header('x-forwarded-proto')?.split(',')[0].trim().toLowerCase()
  const proto = forwarded === 'http' || forwarded === 'https' ? forwarded : url.protocol.slice(0, -1)
  return new URL(`${proto}://${url.host}`)
}

// PLAT-006: Google OAuth (public — the caller is logging in). In dev a mock
// provider stands in for Google. Flow: login → provider consent → callback →
// find/create User → issue session → bounce back into the SPA with the token.
// Mock flow stays same-origin (relative) so the dev proxy keeps the browser
// on the SPA origin end to end; real Google needs an absolute redirect_uri
// that byte-matches the registered one.
export function oauthRedirectUri(c: Context, clientId: string): string {
  if (!clientId) return OAUTH_CALLBACK_PATH
  return `${externalOrigin(c).origin}${OAUTH_CALLBACK_PATH}`
}

// The login challenge (OAuth `state` + PKCE verifier) rides HttpOnly cookies
// so it is bound to the browser that started the sign-in. Same attributes as
// the sid cookie, plus `secure` whenever the browser reached us over TLS and a
// ten-minute life — they exist only for the length of one consent round trip.
export const OAUTH_STATE_COOKIE = 'oauth_state'
export const OAUTH_VERIFIER_COOKIE = 'oauth_verifier'

// Derived from the external origin, not NODE_ENV: behind Railway's TLS-
// terminating edge the container sees http, and a `secure` cookie on a
// plain-http dev origin is silently dropped by the browser. Same origin the
// redirect_uri comes from, so the two can never disagree.
function oauthCookieOptions(c: Context) {
  return {
    httpOnly: true,
    sameSite: 'Lax' as const,
    path: '/',
    maxAge: 600,
    secure: externalOrigin(c).protocol === 'https:',
  }
}

export function setLoginChallengeCookies(c: Context, state: string, verifier: string) {
  setCookie(c, OAUTH_STATE_COOKIE, state, oauthCookieOptions(c))
  setCookie(c, OAUTH_VERIFIER_COOKIE, verifier, oauthCookieOptions(c))
}

export function clearLoginChallengeCookies(c: Context) {
  deleteCookie(c, OAUTH_STATE_COOKIE, { path: '/' })
  deleteCookie(c, OAUTH_VERIFIER_COOKIE, { path: '/' })
}

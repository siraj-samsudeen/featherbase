import type { Context } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { config } from './config'
import { AppError } from './errors'

export function externalOrigin(c: Context): URL {
  if (config.siteUrl) return new URL(config.siteUrl)
  const url = new URL(c.req.url)
  const forwarded = c.req.header('x-forwarded-proto')?.split(',')[0].trim().toLowerCase()
  const proto = forwarded === 'http' || forwarded === 'https' ? forwarded : url.protocol.slice(0, -1)
  return new URL(`${proto}://${url.host}`)
}

export function setSidCookie(c: Context, token: string) {
  setCookie(c, 'sid', token, { httpOnly: true, sameSite: 'Lax', path: '/',
    maxAge: 60 * 60 * 24 * 7, secure: externalOrigin(c).protocol === 'https:' })
}

export function authCredential(c: Context): string | undefined {
  const header = c.req.header('authorization')
  if (header) return header
  const sid = getCookie(c, 'sid')
  return sid ? `Bearer ${sid}` : undefined
}

// Bearer credentials do not excuse a mismatched browser Origin. Requiring
// Origin on these browser-only mutations also excludes cross-site form POSTs.
export function requireAuthOrigin(c: Context) {
  if (c.req.header('origin') !== externalOrigin(c).origin)
    throw new AppError('PermissionError', 'Same-origin authentication request required')
}

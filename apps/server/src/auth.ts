import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { sign, verify } from 'hono/jwt'
import { sql } from './db'
import { AppError } from './errors'
import { getSystemSettings } from './settings'
import { logActivity } from './audit'

// API-004: email/password login issuing a JWT; every API call (except
// /api/ping and /api/login) must carry it. Passwords are scrypt-hashed.

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me'

// 32-byte key + 16-byte salt fits the varchar(140) Data column (97 chars).
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 32).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = scryptSync(password, salt, 32)
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

export async function setUserPassword(name: string, password: string) {
  await sql`
    update tab_user set password_hash = ${hashPassword(password)}
    where name = ${name}`
}

export interface SessionUser {
  name: string
  email: string
  full_name: string | null
}

export async function login(usr: string, pwd: string): Promise<{ token: string; user: SessionUser }> {
  const [user] = await sql`
    select name, email, full_name, enabled, password_hash from tab_user
    where (name = ${usr} or email = ${usr})`
  if (!user || !user.enabled || !user.password_hash || !verifyPassword(pwd, user.password_hash as string))
    throw new AppError('AuthenticationError', 'Invalid login credentials')
  // SET-004: session lifetime is driven by System Settings (session_hours),
  // clamped to a sane range so a bad setting can't disable or eternalize logins.
  const { session_hours } = await getSystemSettings()
  const hours = Math.min(Math.max(session_hours || 8, 1), 720)
  const token = await sign(
    {
      sub: user.name as string,
      exp: Math.floor(Date.now() / 1000) + hours * 3600,
    },
    JWT_SECRET,
  )
  // PLAT-007: record the successful authentication.
  await logActivity(user.name as string, 'login', { full_name: user.full_name as string | null })
  return {
    token,
    user: { name: user.name as string, email: user.email as string, full_name: user.full_name as string | null },
  }
}

// API-005: integration keys. The secret is scrypt-hashed at rest and only
// ever shown once, at generation time.
export async function generateApiKeys(
  user: string,
): Promise<{ api_key: string; api_secret: string }> {
  const api_key = 'fc_' + randomBytes(8).toString('hex')
  const api_secret = randomBytes(16).toString('hex')
  const [row] = await sql`
    update tab_user set api_key = ${api_key}, api_secret_hash = ${hashPassword(api_secret)}
    where name = ${user} returning name`
  if (!row) throw new AppError('NotFoundError', `User ${user} not found`)
  return { api_key, api_secret }
}

export async function revokeApiKeys(user: string): Promise<void> {
  await sql`update tab_user set api_key = null, api_secret_hash = null where name = ${user}`
}

async function resolveApiKey(pair: string): Promise<SessionUser> {
  const idx = pair.indexOf(':')
  const key = idx === -1 ? pair : pair.slice(0, idx)
  const secret = idx === -1 ? '' : pair.slice(idx + 1)
  const [user] = await sql`
    select name, email, full_name, enabled, api_secret_hash from tab_user
    where api_key = ${key}`
  if (
    !user ||
    !user.enabled ||
    !user.api_secret_hash ||
    !verifyPassword(secret, user.api_secret_hash as string)
  )
    throw new AppError('AuthenticationError', 'Invalid API key or secret')
  return {
    name: user.name as string,
    email: user.email as string,
    full_name: user.full_name as string | null,
  }
}

export async function resolveToken(authorization?: string): Promise<SessionUser> {
  // API-005: integrations authenticate with "Authorization: token key:secret".
  const apiPair = authorization?.match(/^token (.+)$/)?.[1]
  if (apiPair) return resolveApiKey(apiPair)
  const token = authorization?.match(/^Bearer (.+)$/)?.[1]
  if (!token) throw new AppError('AuthenticationError', 'Authentication required')
  let payload: { sub?: unknown }
  try {
    payload = (await verify(token, JWT_SECRET, 'HS256')) as { sub?: unknown }
  } catch {
    throw new AppError('AuthenticationError', 'Invalid or expired session')
  }
  const [user] = await sql`
    select name, email, full_name, enabled from tab_user where name = ${String(payload.sub)}`
  if (!user || !user.enabled)
    throw new AppError('AuthenticationError', 'Invalid or expired session')
  return { name: user.name as string, email: user.email as string, full_name: user.full_name as string | null }
}

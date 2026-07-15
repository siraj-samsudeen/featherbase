import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { sign, verify } from 'hono/jwt'
import { sql } from './db'
import { AppError } from './errors'

// API-004: email/password login issuing a JWT; every API call (except
// /api/ping and /api/login) must carry it. Passwords are scrypt-hashed.

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me'
const SESSION_HOURS = 8

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
  const token = await sign(
    {
      sub: user.name as string,
      exp: Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600,
    },
    JWT_SECRET,
  )
  return {
    token,
    user: { name: user.name as string, email: user.email as string, full_name: user.full_name as string | null },
  }
}

export async function resolveToken(authorization?: string): Promise<SessionUser> {
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

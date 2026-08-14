import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
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

// #137: the invariant lives here, not at the route. /api/set_password already
// refused service accounts, but password reset reaches this function directly,
// so a reset link could still stamp a password_hash onto a principal
// documented as having none. The guard is on the write itself.
export async function setUserPassword(name: string, password: string) {
  const [row] = await sql`select user_type from "user" where row_id = ${name}`
  if (row?.user_type === 'service')
    throw new AppError(
      'ValidationError',
      'Service accounts have no password — issue an access token instead',
    )
  await sql`
    update "user" set password_hash = ${hashPassword(password)}
    where row_id = ${name}`
}

export interface SessionUser {
  row_id: string
  email: string
  full_name: string | null
}

export async function login(usr: string, pwd: string): Promise<{ token: string; user: SessionUser }> {
  const [user] = await sql`
    select row_id, email, full_name, enabled, password_hash, user_type from "user"
    where (row_id = ${usr} or email = ${usr})`
  // #131: service accounts never sign in interactively — tokens only. The
  // refusal is deliberately the same generic message as a bad password.
  if (!user || user.user_type === 'service' || !user.enabled || !user.password_hash || !verifyPassword(pwd, user.password_hash as string))
    throw new AppError('AuthenticationError', 'Invalid login credentials')
  // SET-004: session lifetime is driven by System Settings (session_hours),
  // clamped to a sane range so a bad setting can't disable or eternalize logins.
  const { session_hours } = await getSystemSettings()
  const hours = Math.min(Math.max(session_hours || 8, 1), 720)
  const token = await sign(
    {
      sub: user.row_id as string,
      exp: Math.floor(Date.now() / 1000) + hours * 3600,
    },
    JWT_SECRET,
  )
  // PLAT-007: record the successful authentication.
  await logActivity(user.row_id as string, 'login', { full_name: user.full_name as string | null })
  return {
    token,
    user: { row_id: user.row_id as string, email: user.email as string, full_name: user.full_name as string | null },
  }
}

// PLAT-006: issue a session for an already-authenticated user (e.g. after a
// successful OAuth exchange) — the password-less counterpart to login().
export async function issueSession(userName: string): Promise<{ token: string; user: SessionUser }> {
  const [user] = await sql`
    select row_id, email, full_name, enabled, user_type from "user" where row_id = ${userName}`
  if (!user || !user.enabled || user.user_type === 'service')
    throw new AppError('AuthenticationError', 'User cannot sign in')
  const { session_hours } = await getSystemSettings()
  const hours = Math.min(Math.max(session_hours || 8, 1), 720)
  const token = await sign(
    { sub: user.row_id as string, exp: Math.floor(Date.now() / 1000) + hours * 3600 },
    JWT_SECRET,
  )
  await logActivity(user.row_id as string, 'login', { full_name: user.full_name as string | null })
  return {
    token,
    user: { row_id: user.row_id as string, email: user.email as string, full_name: user.full_name as string | null },
  }
}

// #131: named access tokens — THE integration credential (replaces the
// API-005 per-user key pair). The plaintext ("fbt_" + 32 random bytes) is
// returned exactly once, at issue time; only its SHA-256 is stored. A token
// authenticates as its owner, with the owner's roles — no separate scopes.

const TOKEN_PREFIX = 'fbt_'

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export interface AccessTokenRow {
  id: string
  label: string
  owner: string
  created_at: string
  expires_at: string | null
  last_used_at: string | null
  revoked_at: string | null
  /** Only present on list results — see listAccessTokens. */
  owner_enabled?: boolean
}

const tokenFields = () => sql`id, label, owner, created_at, expires_at, last_used_at, revoked_at`

export async function issueAccessToken(
  owner: string,
  label: string,
  expiresAt?: Date | null,
): Promise<{ token: string } & AccessTokenRow> {
  if (!label.trim()) throw new AppError('ValidationError', 'A token needs a label')
  if (expiresAt && !(expiresAt.getTime() > Date.now()))
    throw new AppError('ValidationError', 'expires_at must be in the future')
  const [user] = await sql`select row_id, enabled from "user" where row_id = ${owner}`
  if (!user) throw new AppError('NotFoundError', `User ${owner} not found`)
  if (!user.enabled) throw new AppError('ValidationError', `${owner} is disabled`)
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url')
  const [row] = await sql`
    insert into access_token (id, label, owner, token_hash, expires_at)
    values (${'tok_' + randomBytes(6).toString('hex')}, ${label.trim()}, ${owner},
            ${hashToken(token)}, ${expiresAt ?? null})
    returning ${tokenFields()}`
  return { token, ...(row as unknown as AccessTokenRow) }
}

// All tokens (owner undefined) or one principal's, newest first. #137:
// owner_enabled rides along because a live-looking token whose owner is
// disabled cannot authenticate — the UI must not call it active.
//
// The join is a LEFT join on purpose. An inner join drops any token whose
// owner no longer matches a `user` row, so the credential vanishes from the
// admin screen while `resolveAccessToken` would still find it by hash — an
// operator cannot revoke what they cannot see. A missing owner is reported
// as `owner_enabled: false`, which is the truth: such a token authenticates
// nobody, and it stays listed and revocable.
export async function listAccessTokens(owner?: string): Promise<AccessTokenRow[]> {
  const rows = owner
    ? await sql`
        select t.id, t.label, t.owner, t.created_at, t.expires_at, t.last_used_at, t.revoked_at,
               coalesce(u.enabled, false) as owner_enabled
        from access_token t left join "user" u on u.row_id = t.owner
        where t.owner = ${owner} order by t.created_at desc`
    : await sql`
        select t.id, t.label, t.owner, t.created_at, t.expires_at, t.last_used_at, t.revoked_at,
               coalesce(u.enabled, false) as owner_enabled
        from access_token t left join "user" u on u.row_id = t.owner
        order by t.created_at desc`
  return rows as unknown as AccessTokenRow[]
}

export async function getAccessToken(id: string): Promise<AccessTokenRow> {
  const [row] = await sql`select ${tokenFields()} from access_token where id = ${id}`
  if (!row) throw new AppError('NotFoundError', `Access token ${id} not found`)
  return row as unknown as AccessTokenRow
}

// Idempotent: revoking twice keeps the first revocation stamp.
export async function revokeAccessToken(id: string): Promise<void> {
  const [row] = await sql`
    update access_token set revoked_at = coalesce(revoked_at, now())
    where id = ${id} returning id`
  if (!row) throw new AppError('NotFoundError', `Access token ${id} not found`)
}

async function resolveAccessToken(token: string): Promise<SessionUser> {
  // The update doubles as the lookup: a live token gets its last_used_at
  // stamped in the same round-trip.
  const [hit] = await sql`
    update access_token set last_used_at = now()
    where token_hash = ${hashToken(token)}
      and revoked_at is null
      and (expires_at is null or expires_at > now())
    returning owner`
  if (!hit) throw new AppError('AuthenticationError', 'Invalid or expired access token')
  const [user] = await sql`
    select row_id, email, full_name, enabled from "user" where row_id = ${hit.owner}`
  if (!user || !user.enabled)
    throw new AppError('AuthenticationError', 'Invalid or expired access token')
  return {
    row_id: user.row_id as string,
    email: user.email as string,
    full_name: user.full_name as string | null,
  }
}

// #173: sessions ride an HttpOnly `sid` cookie. A raw Node request — the
// WebSocket upgrade — has no Hono context to read it through, so parse the
// header directly and hand back the same `Bearer <token>` shape resolveToken
// takes. An absent, empty or malformed cookie is simply no credential.
const SID_COOKIE = 'sid'

export function credentialFromCookieHeader(header?: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1 || part.slice(0, eq).trim() !== SID_COOKIE) continue
    const raw = part.slice(eq + 1).trim()
    // Cookie values are percent-encoded on the way out; a malformed one is
    // simply not a credential.
    let value = raw
    if (raw.includes('%')) {
      try {
        value = decodeURIComponent(raw)
      } catch {
        return undefined
      }
    }
    return value ? `Bearer ${value}` : undefined
  }
  return undefined
}

// #137 accepted a credential from `?token=` for <img src>, download links and
// the browser WebSocket, refusing only access tokens there. #173 finished the
// job: no route reads a credential out of a URL at all now — those callers
// authenticate from the `sid` cookie, which is already on the request — so
// there is no URL-borne case left to refuse. A URL lands in browser history,
// referrers and proxy logs, and that is as true of a session JWT as it is of
// an access token.
export async function resolveToken(authorization?: string): Promise<SessionUser> {
  const token = authorization?.match(/^Bearer (.+)$/)?.[1]
  if (!token) throw new AppError('AuthenticationError', 'Authentication required')
  // #131: access tokens ride the same Bearer header as sessions, told apart
  // by their prefix — no JWT parse attempted on them.
  if (token.startsWith(TOKEN_PREFIX)) return resolveAccessToken(token)
  let payload: { sub?: unknown }
  try {
    payload = (await verify(token, JWT_SECRET, 'HS256')) as { sub?: unknown }
  } catch {
    throw new AppError('AuthenticationError', 'Invalid or expired session')
  }
  const [user] = await sql`
    select row_id, email, full_name, enabled from "user" where row_id = ${String(payload.sub)}`
  if (!user || !user.enabled)
    throw new AppError('AuthenticationError', 'Invalid or expired session')
  return { row_id: user.row_id as string, email: user.email as string, full_name: user.full_name as string | null }
}

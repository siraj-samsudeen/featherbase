import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { sign, verify } from 'hono/jwt'
import { sql, type Sql, type TxSql } from './db'
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
export async function setUserPassword(name: string, password: string, db: Sql | TxSql = sql) {
  // person-rename: only a person has a password. A service account is not a
  // person, so it is refused here whichever route reached this write.
  const [row] = await db`select 1 from person where row_id = ${name}`
  if (!row) {
    const [service] = await db`select 1 from service_account where row_id = ${name}`
    if (service)
      throw new AppError('ValidationError', 'Service accounts have no password — issue an access token instead')
    throw new AppError('NotFoundError', `Person ${name} not found`)
  }
  await db`
    update person set password_hash = ${hashPassword(password)}
    where row_id = ${name}`
}

/** #391: the break-glass reset from an operator shell. The same write as
 *  every other route (so the same refusals). In one transaction it also ends
 *  every live session of the person and revokes their outstanding reset
 *  links; the Activity Log then records the actor `cli`. Access tokens are
 *  left alone: revoke them separately. */
export async function setPasswordFromShell(person: string, password: string) {
  await sql.begin(async (tx) => {
    const t = tx as unknown as TxSql
    await setUserPassword(person, password, t)
    // resetPassword re-checks this cut-off under the same row lock, so a link
    // already consumed but not yet written cannot land after it either.
    await t`update person set sessions_ended_at = now() where row_id = ${person}`
    await t`delete from password_reset where "user" = ${person}`
  })
  await logActivity('cli', `password_set for ${person}`)
}

export type PrincipalKind = 'person' | 'service_account'

export interface SessionUser {
  /** The principal id: a person (`psn_…`, or a built-in) or a service account (`svc_…`). */
  row_id: string
  /** Which kind of principal this session is (person-rename R2). */
  kind: PrincipalKind
  /** Optional contact data (person-identities): null for people without one. */
  email: string | null
  full_name: string | null
  /** How this session was opened (person-identities D8). Absent for access
   *  tokens; `method` null for sessions issued before the upgrade. */
  sign_in?: SignInClaims
}

export interface SignInClaims {
  method: string | null
  identity: string | null
  test_mode: boolean
  /** A dev-preview click-through session (preview.ts). */
  preview: boolean
  /** Seconds since the epoch; null for a token minted before the upgrade. */
  issued_at: number | null
  /** This session's unique id (`jti`, #411): what sign-out revokes. */
  session_id: string
  /** Seconds since the epoch when this session's token expires. */
  expires_at: number
}

export interface SessionOptions {
  method?: string
  identity?: string
  testMode?: boolean
  preview?: boolean
}

export interface IssuedSession {
  token: string
  user: SessionUser
  maxAgeSeconds: number
}

async function issueSessionToken(userName: string, opts: SessionOptions = {}): Promise<{ token: string; maxAgeSeconds: number; iat: number; jti: string }> {
  // SET-004: session lifetime is driven by System Settings (session_hours),
  // clamped to a sane range so a bad setting can't disable or eternalize logins.
  const { session_hours } = await getSystemSettings()
  const hours = Math.min(Math.max(session_hours || 8, 1), 720)
  const maxAgeSeconds = hours * 3600
  const iat = Math.floor(Date.now() / 1000)
  // #411: a unique id per session, so sign-out can revoke exactly this one.
  const jti = randomBytes(16).toString('base64url')
  // m = sign-in method, idn = linked identity, tm = test mode (design D8).
  const token = await sign(
    {
      sub: userName,
      iat,
      exp: iat + maxAgeSeconds,
      jti,
      ...(opts.method ? { m: opts.method } : {}),
      ...(opts.identity ? { idn: opts.identity } : {}),
      ...(opts.testMode ? { tm: true } : {}),
      ...(opts.preview ? { pv: true } : {}),
    },
    JWT_SECRET,
  )
  return { token, maxAgeSeconds, iat, jti }
}

function claimsOf(opts: SessionOptions, iat: number, jti: string, exp: number): SignInClaims {
  return { expires_at: exp, method: opts.method ?? null, identity: opts.identity ?? null, test_mode: Boolean(opts.testMode), preview: Boolean(opts.preview), issued_at: iat, session_id: jti }
}

/** The one account a typed username-or-email names for password sign-in and
 *  reset: an exact id, else a case-insensitive id, else a case-insensitive
 *  email — a username always beats an email. Two different people matching
 *  at the same level is ambiguous and answers nobody. */
export async function findPasswordAccount(typed: string) {
  // A username is the id for older accounts and `username` for people who
  // signed up (their id is opaque); either beats an email.
  const rows = await sql`
    select row_id, email, full_name, enabled, password_hash,
      case when row_id = ${typed} then 0
           when lower(row_id) = lower(trim(${typed})) or lower(username) = lower(trim(${typed})) then 1
           else 2 end as rank
    from person
    where row_id = ${typed} or lower(row_id) = lower(trim(${typed})) or lower(username) = lower(trim(${typed}))
      or lower(email) = lower(trim(${typed}))
    order by rank
    limit 3`
  if (!rows.length) return null
  const best = rows.filter((r) => r.rank === rows[0].rank)
  return best.length === 1 ? best[0] : null
}

// The one refusal every interactive sign-in gives for bad or unusable
// credentials, so a failure never reveals which it was.
export const INVALID_CREDENTIALS = 'Invalid login credentials'

// A real scrypt check against a throwaway hash, so a name that matches no
// account takes as long to refuse as a wrong password (review minor 6).
const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'))
export function burnPasswordCheck(pwd: string): void {
  verifyPassword(pwd, DUMMY_HASH)
}

// PLAT-006: issue a session for an already-authenticated user. Every sign-in
// method ends here through the shared pipeline (sign-in.ts), which passes the
// method and identity so the session remembers how it was opened.
export async function issueSession(userName: string, opts: SessionOptions = {}): Promise<IssuedSession> {
  const [user] = await sql`
    select row_id, email, full_name, enabled from person where row_id = ${userName}`
  if (!user || !user.enabled)
    throw new AppError('AuthenticationError', 'User cannot sign in')
  const session = await issueSessionToken(user.row_id as string, opts)
  await logActivity(user.row_id as string, 'login', {
    full_name: user.full_name as string | null,
    sign_in_method: opts.method ?? (opts.preview ? 'preview' : null),
    test_mode: Boolean(opts.testMode),
  })
  return {
    token: session.token,
    user: { row_id: user.row_id as string, kind: 'person', email: (user.email as string | null) ?? null, full_name: user.full_name as string | null, sign_in: claimsOf(opts, session.iat, session.jti, session.iat + session.maxAgeSeconds) },
    maxAgeSeconds: session.maxAgeSeconds,
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
  /** The principal the token authenticates as: a person or a service account. */
  owner: string
  owner_kind: PrincipalKind
  created_at: string
  expires_at: string | null
  last_used_at: string | null
  revoked_at: string | null
  /** Only present on list results — see listAccessTokens. */
  owner_enabled?: boolean
  /** The owner's name, for screens (never show the opaque id). List results only. */
  owner_name?: string | null
}

const tokenFields = () => sql`id, label, coalesce(person, service_account) as owner,
  case when person is not null then 'person' else 'service_account' end as owner_kind,
  created_at, expires_at, last_used_at, revoked_at`

/** A principal id → its kind and enabled flag; null when it names nobody. */
export async function findPrincipal(id: string): Promise<{ row_id: string; kind: PrincipalKind; enabled: boolean } | null> {
  const [row] = await sql`
    select row_id, 'person' as kind, enabled from person where row_id = ${id}
    union all
    select row_id, 'service_account' as kind, enabled from service_account where row_id = ${id}`
  return row ? { row_id: String(row.row_id), kind: row.kind as PrincipalKind, enabled: row.enabled === true } : null
}

export async function issueAccessToken(
  owner: string,
  label: string,
  expiresAt?: Date | null,
): Promise<{ token: string } & AccessTokenRow> {
  if (!label.trim()) throw new AppError('ValidationError', 'A token needs a label')
  if (expiresAt && !(expiresAt.getTime() > Date.now()))
    throw new AppError('ValidationError', 'expires_at must be in the future')
  const principal = await findPrincipal(owner)
  if (!principal) throw new AppError('NotFoundError', `Account ${owner} not found`)
  if (!principal.enabled) throw new AppError('ValidationError', `${owner} is disabled`)
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url')
  const [row] = await sql`
    insert into access_token (id, label, person, service_account, token_hash, expires_at)
    values (${'tok_' + randomBytes(6).toString('hex')}, ${label.trim()},
            ${principal.kind === 'person' ? owner : null}, ${principal.kind === 'service_account' ? owner : null},
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
  const rows = await sql`
    select t.id, t.label, coalesce(t.person, t.service_account) as owner,
           case when t.person is not null then 'person' else 'service_account' end as owner_kind,
           t.created_at, t.expires_at, t.last_used_at, t.revoked_at,
           coalesce(p.enabled, s.enabled, false) as owner_enabled,
           coalesce(nullif(trim(p.full_name), ''), '@' || nullif(p.username, ''), nullif(p.email, ''), s.label) as owner_name
    from access_token t
    left join person p on p.row_id = t.person
    left join service_account s on s.row_id = t.service_account
    ${owner ? sql`where t.person = ${owner} or t.service_account = ${owner}` : sql``}
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
    returning person, service_account`
  if (!hit) throw new AppError('AuthenticationError', 'Invalid or expired access token')
  // Whichever column is set (person-rename R2); a disabled owner of either
  // kind is refused.
  const [owner] = hit.person
    ? await sql`select row_id, email, full_name, enabled, 'person' as kind from person where row_id = ${hit.person as string}`
    : await sql`select row_id, null::text as email, label as full_name, enabled, 'service_account' as kind
        from service_account where row_id = ${hit.service_account as string}`
  if (!owner || !owner.enabled)
    throw new AppError('AuthenticationError', 'Invalid or expired access token')
  return {
    row_id: owner.row_id as string,
    kind: owner.kind as PrincipalKind,
    email: (owner.email as string | null) ?? null,
    full_name: owner.full_name as string | null,
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
  let payload: { sub?: unknown; iat?: unknown; exp?: unknown; jti?: unknown; m?: unknown; idn?: unknown; tm?: unknown; pv?: unknown }
  try {
    payload = (await verify(token, JWT_SECRET, 'HS256')) as typeof payload
  } catch {
    throw new AppError('AuthenticationError', 'Invalid or expired session')
  }
  // A token minted before person-identities carries no `iat`: such sessions
  // were ended at the upgrade (no compatibility window — Siraj, 22-Oct-2026).
  if (typeof payload.iat !== 'number') throw new AppError('AuthenticationError', 'Invalid or expired session')
  // #411: nor does one minted before sessions carried an id — it could never
  // be signed out, so it ended at that upgrade too.
  if (typeof payload.jti !== 'string' || !payload.jti) throw new AppError('AuthenticationError', 'Invalid or expired session')
  const jti = payload.jti
  const method = typeof payload.m === 'string' ? payload.m : null
  const identity = typeof payload.idn === 'string' ? payload.idn : null
  // One query (design D8): the person, the method the session came through,
  // and the identity it used. A session ends when the person is disabled, its
  // method is turned off, its password is removed, or its identity is
  // unlinked or moved. Tokens from before the upgrade carry no m/idn.
  const [user] = await sql`
    select u.row_id, u.email, u.full_name, u.enabled, (u.password_hash is not null) as has_password,
      floor(extract(epoch from u.sessions_ended_at)) as sessions_ended_at,
      m.enabled as method_enabled, m.kind as method_kind,
      i.person_id as identity_owner, i.subject as identity_subject, i.ended_at as identity_ended,
      (r.jti is not null) as signed_out
    from person u
    left join sign_in_method m on m.row_id = ${method}
    left join sign_in_identity i on i.id = ${identity}
    left join revoked_session r on r.jti = ${jti}
    where u.row_id = ${String(payload.sub)}`
  const ended =
    !user ||
    !user.enabled ||
    // #411: this session was signed out (a primary-key lookup).
    user.signed_out ||
    (method !== null && user.method_enabled !== true) ||
    (user?.method_kind === 'password' && !user.has_password) ||
    // #391: a session issued before the person's sessions were ended. Whole
    // seconds, like `iat` (floor(now)): a sign-in in the same second as the
    // reset survives — and so would an older one from that same second.
    (user.sessions_ended_at != null && payload.iat < Number(user.sessions_ended_at)) ||
    // person-resolution D5: a session opened through an identity that has
    // since ended (left, moved, unlinked) ends on its next request.
    (identity !== null && (user.identity_owner !== user.row_id || user.identity_subject == null || user.identity_ended != null))
  if (ended) throw new AppError('AuthenticationError', 'Invalid or expired session')
  return {
    row_id: user.row_id as string,
    kind: 'person',
    email: (user.email as string | null) ?? null,
    full_name: user.full_name as string | null,
    sign_in: {
      method,
      identity,
      test_mode: payload.tm === true,
      preview: payload.pv === true,
      issued_at: typeof payload.iat === 'number' ? payload.iat : null,
      session_id: jti,
      expires_at: Number(payload.exp),
    },
  }
}

/** #411: the session a credential names, for sign-out. The signature must
 *  hold but expiry is NOT checked: signing out an expired session still has
 *  to end it (its sockets may be open). Access tokens and anything not
 *  correctly signed name no session and return null. */
export interface SessionToRevoke { jti: string; person: string; expiresAt: number }
export async function sessionToRevoke(authorization?: string): Promise<SessionToRevoke | null> {
  const token = authorization?.match(/^Bearer (.+)$/)?.[1]
  if (!token || token.startsWith(TOKEN_PREFIX)) return null
  let payload: { sub?: unknown; jti?: unknown; exp?: unknown }
  try {
    payload = (await verify(token, JWT_SECRET, { alg: 'HS256', exp: false })) as typeof payload
  } catch {
    return null
  }
  if (typeof payload.jti !== 'string' || !payload.jti || typeof payload.exp !== 'number') return null
  return { jti: payload.jti, person: String(payload.sub), expiresAt: payload.exp }
}

/** #411: record a signed-out session so resolveToken refuses it. Only that
 *  session; the person's others keep working. An already-expired session
 *  needs no row (expiry refuses it). Rows past their session's expiry are
 *  pruned in the same transaction, so the table holds only sessions that
 *  could still be presented. Throws when the write fails — the caller must
 *  not report sign-out as complete. */
export async function revokeSession(session: SessionToRevoke): Promise<void> {
  await sql.begin(async (t) => {
    await t`delete from revoked_session where expires_at < now()`
    if (session.expiresAt <= Math.floor(Date.now() / 1000)) return
    await t`insert into revoked_session (jti, person_id, expires_at)
      values (${session.jti}, ${session.person}, to_timestamp(${session.expiresAt}))
      on conflict (jti) do nothing`
  })
}

/** #411: which of these open sessions have ended since they were checked —
 *  expired, signed out (on any instance), the person disabled, or issued before the
 *  person's sessions were ended (#391; whole seconds, as resolveToken). One
 *  query for all of them. */
export interface OpenSession { jti: string; person: string; issuedAt: number; expiresAt: number }
export async function endedSessionIds(sessions: OpenSession[]): Promise<Set<string>> {
  if (!sessions.length) return new Set()
  const rows = await sql`
    select s.jti
    from unnest(${sessions.map((x) => x.jti)}::text[], ${sessions.map((x) => x.person)}::text[],
                ${sessions.map((x) => x.issuedAt)}::bigint[], ${sessions.map((x) => x.expiresAt)}::bigint[]) as s(jti, person, iat, exp)
    left join person p on p.row_id = s.person
    left join revoked_session r on r.jti = s.jti
    where r.jti is not null or p.row_id is null or not p.enabled
       -- statement_timestamp, not now(): now() is frozen at the start of an
       -- enclosing transaction, which would keep an expired socket open.
       or s.exp <= extract(epoch from statement_timestamp())
       or (p.sessions_ended_at is not null and s.iat < floor(extract(epoch from p.sessions_ended_at)))`
  return new Set(rows.map((r) => r.jti as string))
}

/** Linking another sign-in method needs a recent sign-in (design D6): a
 *  token without `iat` (minted before the upgrade) counts as stale. */
export const LINK_FRESHNESS_SECONDS = 15 * 60
export function assertFreshForLinking(user: SessionUser): void {
  assertCanChangeAccess(user)
  const iat = user.sign_in?.issued_at
  if (!iat || Date.now() / 1000 - iat > LINK_FRESHNESS_SECONDS)
    throw new AppError('AuthenticationError', 'Sign in again first, then link the new method within a few minutes.')
}

/** Refuse adding or removing access from a session that cannot vouch for
 *  the person (reviews B1, B-M2): a test-mode sign-in or a dev-preview
 *  click-through. They can read; they cannot set a password, mint a token, or
 *  link or remove a sign-in method. Access tokens (no sign_in) are integration
 *  credentials and unaffected. */
export function assertCanChangeAccess(user: SessionUser): void {
  const s = user.sign_in
  if (!s) return
  if (s.test_mode || s.preview)
    throw new AppError('PermissionError', 'Not allowed from this sign-in. Sign in again normally to change how this account signs in.')
}

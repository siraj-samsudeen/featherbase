import { createHash, randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import type { Context, Next } from 'hono'
import { sql, type Sql } from './db'

const DEFAULTS = { LOGIN: 60, PASSWORD: 5, OAUTH_LOGIN: 30, OAUTH_CALLBACK: 30, FORM: 30 } as const
type Kind = keyof typeof DEFAULTS

function positiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number) {
  const value = env[name] === undefined ? fallback : Number(env[name])
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647)
    throw new Error(`${name} must be a positive integer no greater than 2147483647`)
  return value
}

function ip(value: string | undefined): string | null {
  // Node accepts scoped IPv6 literals, but they are not portable client
  // addresses and URL normalization rejects them. Treat them as malformed.
  if (!value || value.includes('%') || !isIP(value)) return null
  if (isIP(value) === 4) return value
  const normalized = new URL(`http://[${value}]/`).hostname.slice(1, -1)
  // URL canonicalization turns every mapped spelling (including dotted or
  // expanded IPv6) into these two hex words. Match only the mapped prefix.
  const mapped = /^::ffff:([\da-f]+):([\da-f]+)$/.exec(normalized)
  if (!mapped) return normalized
  return mapped.slice(1).flatMap((word) => {
    const n = parseInt(word, 16)
    return [n >>> 8, n & 255]
  }).join('.')
}

export function preAuthPolicy(env = process.env) {
  const limits = Object.fromEntries(Object.entries(DEFAULTS).map(([kind, fallback]) =>
    [kind, positiveInteger(env, `PREAUTH_${kind}_MAX`, fallback)])) as Record<Kind, number>
  const trusted = (env.TRUSTED_PROXY_IPS ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const address = ip(s)
    if (!address) throw new Error('TRUSTED_PROXY_IPS must contain only explicit IP addresses, not CIDRs or hostnames')
    return address
  })
  return { limits, windowMs: positiveInteger(env, 'PREAUTH_WINDOW_MS', 900_000), trusted }
}

// Fail configuration at boot, not on the first attacked request. Read again
// at admission so the same validation also covers configuration reloads/tests.
preAuthPolicy()

export function sourceAddress(socket: string | undefined, forwarded: string | undefined, trusted: string[]): string {
  let address = ip(socket)
  if (!address) return 'unknown'
  if (!trusted.includes(address) || !forwarded) return address
  const hops = forwarded.split(',').map((part) => ip(part.trim()))
  if (hops.some((hop) => hop === null)) return address
  for (const hop of hops.reverse()) {
    if (!trusted.includes(address)) break
    address = hop!
  }
  return address
}

export function bucketKey(parts: string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

// Separate clients/processes arbitrate on the same unique key. A rejected
// conflict never increments or returns a ticket. Windows use the DB clock.
export async function admit(key: string, max: number, windowMs: number, db: Sql = sql) {
  const revision = randomUUID()
  const [ticket] = await db<{ revision: string }[]>`
    insert into pre_auth_bucket (key, hits, expires_at, revision)
    values (${key}, 1, statement_timestamp() + ${windowMs} * interval '1 millisecond', ${revision})
    on conflict (key) do update set
      hits = case when pre_auth_bucket.expires_at <= statement_timestamp() then 1 else pre_auth_bucket.hits + 1 end,
      expires_at = case when pre_auth_bucket.expires_at <= statement_timestamp()
        then excluded.expires_at else pre_auth_bucket.expires_at end,
      revision = excluded.revision
    where pre_auth_bucket.expires_at <= statement_timestamp() or pre_auth_bucket.hits < ${max}
    returning revision`
  if (ticket) return { key, revision: ticket.revision, retryAfter: 0 }
  const [row] = await db`select greatest(1, ceil(extract(epoch from (expires_at - statement_timestamp()))))::int as retry
    from pre_auth_bucket where key = ${key}`
  return { key, revision: null, retryAfter: Number(row?.retry ?? 1) }
}

export async function forgive(ticket: { key: string; revision: string | null }, db: Sql = sql) {
  // An old success cannot erase attempts admitted after it, even across an
  // expired/recreated window. Source tickets are never passed here.
  await db`delete from pre_auth_bucket where key = ${ticket.key} and revision = ${ticket.revision}`
}

export async function cleanExpiredBuckets(db: Sql = sql) {
  return db`delete from pre_auth_bucket where key in (
    select key from pre_auth_bucket where expires_at <= statement_timestamp()
    order by expires_at limit 100 for update skip locked) returning key`
}

function rejection(c: Context, retryAfter: number) {
  c.header('Retry-After', String(retryAfter))
  return c.json({ error: { type: 'RateLimitError', message: 'Too many attempts; retry later' } }, 429)
}

function source(c: Context, trusted: string[]) {
  return sourceAddress(c.env?.incoming?.socket?.remoteAddress, c.req.header('x-forwarded-for'), trusted)
}

export function publicLimit(kind: Exclude<Kind, 'PASSWORD'>) {
  return async (c: Context, next: Next) => {
    const policy = preAuthPolicy()
    await cleanExpiredBuckets()
    const ticket = await admit(bucketKey([kind, source(c, policy.trusted)]), policy.limits[kind], policy.windowMs)
    if (!ticket.revision) return rejection(c, ticket.retryAfter)
    await next()
  }
}

export async function passwordAttempt(c: Context, username: string) {
  const policy = preAuthPolicy()
  const ticket = await admit(bucketKey(['PASSWORD', 'password', source(c, policy.trusted), username.trim().toLowerCase()]), policy.limits.PASSWORD, policy.windowMs)
  return { ticket, refusal: ticket.revision ? null : rejection(c, ticket.retryAfter) }
}

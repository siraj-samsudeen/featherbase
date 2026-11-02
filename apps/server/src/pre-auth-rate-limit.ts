import { createHash, randomUUID } from 'node:crypto'
import { processEnvironment } from './env'
import { isIP } from 'node:net'
import type { Context, Next } from 'hono'
import { sql, type Sql } from './db'

// HANDOFF (#488) is charged by both legs of the hand-off between addresses, so
// 200 is a hundred hand-offs per source and window: a store's whole shift
// signing in at once from one public IP, past the Google buckets.
const DEFAULTS = { LOGIN: 60, PASSWORD: 5, OAUTH_LOGIN: 30, OAUTH_CALLBACK: 30, FORM: 30, SIGNUP: 10, HANDOFF: 200 } as const
type Kind = keyof typeof DEFAULTS

function positiveInteger(env: Record<string, string | undefined>, name: string, fallback: number) {
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

export function preAuthPolicy(env: Record<string, string | undefined> = processEnvironment()) {
  const limits = Object.fromEntries(Object.entries(DEFAULTS).map(([kind, fallback]) =>
    [kind, positiveInteger(env, `PREAUTH_${kind}_MAX`, fallback)])) as Record<Kind, number>
  const trusted = (env.TRUSTED_PROXY_IPS ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const address = ip(s)
    if (!address) throw new Error('TRUSTED_PROXY_IPS must contain only explicit IP addresses, not CIDRs or hostnames')
    return address
  })
  // #396: a header the instance's edge overwrites with the client's address
  // (Railway's edge publishes no stable proxy addresses to list above).
  const header = env.CLIENT_ADDRESS_HEADER?.trim().toLowerCase() || null
  if (header && !/^[a-z0-9-]+$/.test(header))
    throw new Error('CLIENT_ADDRESS_HEADER must be one header name, such as x-real-ip')
  return { limits, windowMs: positiveInteger(env, 'PREAUTH_WINDOW_MS', 900_000), trusted, clientHeader: header }
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

function bucketKey(parts: string[]): string {
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

/** The client's network address, or null when none can be told (#396). The
 *  header named by CLIENT_ADDRESS_HEADER wins when it holds exactly one
 *  address; otherwise the socket peer, or behind TRUSTED_PROXY_IPS the
 *  right-most hop they did not append. Sign-ins record the full address;
 *  pre-auth budgets group IPv6 addresses by /64 in source(). */
export function clientAddress(c: Context, policy = preAuthPolicy()): string | null {
  const named = policy.clientHeader ? ip(c.req.header(policy.clientHeader)?.trim()) : null
  if (named) return named
  const address = sourceAddress(c.env?.incoming?.socket?.remoteAddress, c.req.header('x-forwarded-for'), policy.trusted)
  return address === 'unknown' ? null : address
}

function source(c: Context, policy: ReturnType<typeof preAuthPolicy>) {
  const address = clientAddress(c, policy) ?? 'unknown'
  if (isIP(address) !== 6) return address
  // #575: budget one IPv6 network, not each freely rotated host address.
  // clientAddress remains the full canonical address for sign-in history.
  const [left, right] = address.split('::')
  const head = left ? left.split(':') : []
  const tail = right ? right.split(':') : []
  const words = right === undefined ? head : [...head, ...Array<string>(8 - head.length - tail.length).fill('0'), ...tail]
  return `${words.slice(0, 4).map(word => parseInt(word, 16).toString(16)).join(':')}::/64`
}

export function publicLimit(kind: Exclude<Kind, 'PASSWORD'>) {
  return async (c: Context, next: Next) => {
    const policy = preAuthPolicy()
    await cleanExpiredBuckets()
    const ticket = await admit(bucketKey([kind, source(c, policy)]), policy.limits[kind], policy.windowMs)
    if (!ticket.revision) return rejection(c, ticket.retryAfter)
    await next()
  }
}

// `scope` keeps credential namespaces apart: a local username and an ID at a
// delegated sign-in provider (delegated-login.ts) never share one budget.
export async function passwordAttempt(c: Context, username: string, scope: 'password' | 'delegated' = 'password') {
  const policy = preAuthPolicy()
  const ticket = await admit(bucketKey(['PASSWORD', scope, source(c, policy), username.trim().toLowerCase()]), policy.limits.PASSWORD, policy.windowMs)
  return { ticket, refusal: ticket.revision ? null : rejection(c, ticket.retryAfter) }
}

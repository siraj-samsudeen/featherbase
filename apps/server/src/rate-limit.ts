import type { Context, Next } from 'hono'
import { sql } from './db'

// API-007: per-user request rate limiting. A fixed window per user; when the
// count exceeds the user's budget the request is rejected with 429 and a
// Retry-After header (seconds until the window resets). The budget is the
// User's `api_rate_limit` (0/unset = the global default), so a single user can
// be throttled without affecting anyone else.

const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000)
const GLOBAL_MAX = Number(process.env.RATE_LIMIT_MAX ?? 100_000)

interface Bucket {
  windowStart: number
  count: number
}
const buckets = new Map<string, Bucket>()
const limitCache = new Map<string, { limit: number; at: number }>()
const LIMIT_TTL_MS = 5_000

async function budgetFor(user: string): Promise<number> {
  const cached = limitCache.get(user)
  const now = Date.now()
  if (cached && now - cached.at < LIMIT_TTL_MS) return cached.limit
  const [row] = await sql`select api_rate_limit from tab_user where name = ${user}`
  const configured = row ? Number(row.api_rate_limit) : 0
  const limit = configured && configured > 0 ? configured : GLOBAL_MAX
  limitCache.set(user, { limit, at: now })
  return limit
}

// Test/maintenance hook: forget a user's window + cached budget.
export function resetRateLimit(user?: string) {
  if (user) {
    buckets.delete(user)
    limitCache.delete(user)
  } else {
    buckets.clear()
    limitCache.clear()
  }
}

export async function rateLimit(c: Context, next: Next) {
  const user = (c.get('user') as { name?: string } | undefined)?.name
  if (!user) return next()

  const now = Date.now()
  const windowStart = now - (now % WINDOW_MS)
  let b = buckets.get(user)
  if (!b || b.windowStart !== windowStart) {
    b = { windowStart, count: 0 }
    buckets.set(user, b)
  }
  b.count += 1

  const limit = await budgetFor(user)
  if (b.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((windowStart + WINDOW_MS - now) / 1000))
    c.header('Retry-After', String(retryAfter))
    return c.json(
      {
        error: {
          type: 'RateLimitError',
          message: `Rate limit exceeded: ${limit} requests per ${Math.round(WINDOW_MS / 1000)}s`,
        },
      },
      429,
    )
  }
  return next()
}

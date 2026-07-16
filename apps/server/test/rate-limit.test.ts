import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { sql } from '../src/db'
import { setUserPassword } from '../src/auth'
import { resetRateLimit } from '../src/rate-limit'
import { areq } from './helpers'

// API-007: a user with a configured budget is throttled once the window count
// is exceeded — 429 with a Retry-After header — while other users are not.

const USER = 'ratelimit-srv@x.com'
const PWD = 'ratelimitpw123'
const BUDGET = 3

async function cleanup() {
  await sql`delete from tab_has_role where parent = ${USER}`
  await sql`delete from tab_user where name = ${USER}`
}

beforeAll(async () => {
  await cleanup()
  const res = await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({
      doctype: 'User',
      doc: {
        name: USER,
        email: USER,
        enabled: true,
        api_rate_limit: BUDGET,
        roles: [{ role: 'System Manager' }],
      },
    }),
  })
  if (res.status !== 201) throw new Error(`create user: ${res.status}`)
  await setUserPassword(USER, PWD)
  resetRateLimit(USER)
})

afterAll(async () => {
  await cleanup()
  await sql.end()
})

async function token(): Promise<string> {
  const res = await app.request('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usr: USER, pwd: PWD }),
  })
  return ((await res.json()) as { token: string }).token
}

describe('API-007: rate limiting', () => {
  it('allows requests up to the budget, then 429s with Retry-After', async () => {
    resetRateLimit(USER)
    const auth = { authorization: `Bearer ${await token()}` }

    for (let i = 0; i < BUDGET; i++) {
      const res = await app.request('/api/whoami', { headers: auth })
      expect(res.status).toBe(200)
    }

    const limited = await app.request('/api/whoami', { headers: auth })
    expect(limited.status).toBe(429)
    const retry = limited.headers.get('retry-after')
    expect(retry).toBeTruthy()
    expect(Number(retry)).toBeGreaterThan(0)
    const body = (await limited.json()) as { error: { type: string } }
    expect(body.error.type).toBe('RateLimitError')
  })

  it('does not throttle a different user (Administrator) in the same window', async () => {
    // Administrator has no configured budget, so it stays under the global cap.
    for (let i = 0; i < BUDGET + 2; i++) {
      const res = await areq('/api/whoami')
      expect(res.status).toBe(200)
    }
  })
})

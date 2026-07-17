import { describe, expect } from 'vitest'
import { setUserPassword } from '../src/auth'
import { resetRateLimit } from '../src/rate-limit'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

// API-007: a user with a configured budget is throttled once the window count
// is exceeded — 429 with a Retry-After header — while other users are not.

const USER = 'ratelimit-srv@x.com'
const PWD = 'ratelimitpw123'
const BUDGET = 3

// Each test creates the budgeted user inside its own sandbox transaction.
// The harness clears rate-limit windows + budget caches after every test.
async function setup(admin: TestClient) {
  await admin.post('/api/save_doc', {
    doctype: 'User',
    doc: {
      name: USER,
      email: USER,
      enabled: true,
      api_rate_limit: BUDGET,
      roles: [{ role: 'System Manager' }],
    },
  })
  await setUserPassword(USER, PWD)
  resetRateLimit(USER)
}

async function token(api: TestClient): Promise<string> {
  const res = await api.fetch('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usr: USER, pwd: PWD }),
  })
  return ((await res.json()) as { token: string }).token
}

describe('API-007: rate limiting', () => {
  test('allows requests up to the budget, then 429s with Retry-After', async ({ admin, api }) => {
    await setup(admin)
    resetRateLimit(USER)
    const auth = { authorization: `Bearer ${await token(api)}` }

    for (let i = 0; i < BUDGET; i++) {
      const res = await api.fetch('/api/whoami', { headers: auth })
      expect(res.status).toBe(200)
    }

    const limited = await api.fetch('/api/whoami', { headers: auth })
    expect(limited.status).toBe(429)
    const retry = limited.headers.get('retry-after')
    expect(retry).toBeTruthy()
    expect(Number(retry)).toBeGreaterThan(0)
    const body = (await limited.json()) as { error: { type: string } }
    expect(body.error.type).toBe('RateLimitError')
  })

  test('does not throttle a different user (Administrator) in the same window', async ({
    admin,
  }) => {
    await setup(admin)
    // Administrator has no configured budget, so it stays under the global cap.
    for (let i = 0; i < BUDGET + 2; i++) {
      const res = await admin.fetch('/api/whoami')
      expect(res.status).toBe(200)
    }
  })
})

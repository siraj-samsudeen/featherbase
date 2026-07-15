import { app } from '../src/index'

// All API routes require a session (API-004). Tests authenticate once as
// Administrator and reuse the token.
let cached: string | undefined

export async function token(): Promise<string> {
  if (!cached) {
    const res = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        usr: 'Administrator',
        pwd: process.env.ADMIN_PASSWORD ?? 'admin',
      }),
    })
    if (res.status !== 200) throw new Error(`test login failed: ${res.status}`)
    cached = ((await res.json()) as { token: string }).token
  }
  return cached
}

export async function areq(path: string, init: RequestInit = {}) {
  return app.request(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${await token()}`,
      ...((init.headers as Record<string, string>) ?? {}),
    },
  })
}

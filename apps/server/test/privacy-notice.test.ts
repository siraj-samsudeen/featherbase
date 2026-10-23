import { describe, expect } from 'vitest'
import { test } from './pg-test'

// #393: Google's consent screen fetches the privacy notice anonymously, so it
// must answer without a session and must not fall into the legacy-path
// redirect or app-root routing.

describe('#393 privacy notice', () => {
  test('GET /privacy is public HTML carrying the approved notice', async ({ api }) => {
    const res = await api.fetch('/privacy', { redirect: 'manual' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^text\/html/)
    const body = await res.text()
    expect(body).toContain('<title>Feather Dash: Privacy notice</title>')
    expect(body).toContain('Effective 22-Oct-2026')
    expect(body).toContain('Jeyarama Retail Business Group')
    expect(body).toContain('siraj@jeyarama.com')
    expect(body).not.toContain('<script')
  })
})

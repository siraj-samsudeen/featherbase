import { describe, expect } from 'vitest'
import { test } from './pg-test'

// API-008: the Admin origin can call the API cross-origin; other origins
// get no CORS grant. Security headers are set on every response.

const ADMIN_ORIGIN = 'http://localhost:5173'
const EVIL = 'https://evil.example.com'

describe('API-008: CORS + security headers', () => {
  test('grants the Admin origin on preflight and echoes it on responses', async ({ api }) => {
    const pre = await api.fetch('/api/login', {
      method: 'OPTIONS',
      headers: {
        origin: ADMIN_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,authorization',
      },
    })
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-origin')).toBe(ADMIN_ORIGIN)
    expect(pre.headers.get('access-control-allow-methods')).toContain('POST')
    expect(pre.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'authorization',
    )

    const res = await api.fetch('/api/ping', { headers: { origin: ADMIN_ORIGIN } })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe(ADMIN_ORIGIN)
  })

  test('gives a disallowed origin no CORS grant', async ({ api }) => {
    const pre = await api.fetch('/api/login', {
      method: 'OPTIONS',
      headers: { origin: EVIL, 'access-control-request-method': 'POST' },
    })
    expect(pre.headers.get('access-control-allow-origin')).toBeNull()

    const res = await api.fetch('/api/ping', { headers: { origin: EVIL } })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('sets security headers on every response', async ({ api }) => {
    const res = await api.fetch('/api/ping')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBeTruthy()
    expect(res.headers.get('referrer-policy')).toBeTruthy()
  })
})

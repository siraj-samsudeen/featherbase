import { describe, expect } from 'vitest'
import { test } from './pg-test'

// API-008: the Desk origin can call the API cross-origin; other origins
// get no CORS grant. Security headers are set on every response.

const DESK = 'http://localhost:5173'
const EVIL = 'https://evil.example.com'

describe('API-008: CORS + security headers', () => {
  test('grants the Desk origin on preflight and echoes it on responses', async ({ api }) => {
    const pre = await api.fetch('/api/login', {
      method: 'OPTIONS',
      headers: {
        origin: DESK,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,authorization',
      },
    })
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-origin')).toBe(DESK)
    expect(pre.headers.get('access-control-allow-methods')).toContain('POST')
    expect(pre.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'authorization',
    )

    const res = await api.fetch('/api/ping', { headers: { origin: DESK } })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe(DESK)
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

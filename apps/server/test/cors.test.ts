import { describe, expect, it } from 'vitest'
import { app } from '../src/index'

// API-008: the Desk origin can call the API cross-origin; other origins
// get no CORS grant. Security headers are set on every response.

const DESK = 'http://localhost:5173'
const EVIL = 'https://evil.example.com'

describe('API-008: CORS + security headers', () => {
  it('grants the Desk origin on preflight and echoes it on responses', async () => {
    const pre = await app.request('/api/login', {
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

    const res = await app.request('/api/ping', { headers: { origin: DESK } })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe(DESK)
  })

  it('gives a disallowed origin no CORS grant', async () => {
    const pre = await app.request('/api/login', {
      method: 'OPTIONS',
      headers: { origin: EVIL, 'access-control-request-method': 'POST' },
    })
    expect(pre.headers.get('access-control-allow-origin')).toBeNull()

    const res = await app.request('/api/ping', { headers: { origin: EVIL } })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('sets security headers on every response', async () => {
    const res = await app.request('/api/ping')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBeTruthy()
    expect(res.headers.get('referrer-policy')).toBeTruthy()
  })
})

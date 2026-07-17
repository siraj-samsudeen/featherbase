import { describe, expect } from 'vitest'
import { test } from './pg-test'

// API-003: whitelisted methods callable with JSON args; non-whitelisted
// returns 403; guest-allowed methods work without a session.

describe('API-003: RPC for whitelisted server methods', () => {
  test('calls a whitelisted method with JSON args and returns its result', async ({ admin }) => {
    const res = await admin.fetch('/api/method/ping', {
      method: 'POST',
      body: JSON.stringify({ x: 42, hello: 'world' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { message: { pong: boolean; echo: unknown; user: string } }
    expect(body.message.pong).toBe(true)
    expect(body.message.echo).toEqual({ x: 42, hello: 'world' })
    expect(body.message.user).toBe('Administrator')
  })

  test('passes GET query args and runs through the permission layer', async ({ admin }) => {
    const res = await admin.fetch('/api/method/count_docs?doctype=User')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { message: { doctype: string; total: number } }
    expect(body.message.doctype).toBe('User')
    expect(body.message.total).toBeGreaterThan(0)
  })

  test('rejects a non-whitelisted method with 403', async ({ admin }) => {
    const res = await admin.fetch('/api/method/setUserPassword', {
      method: 'POST',
      body: JSON.stringify({ name: 'Administrator', password: 'x' }),
    })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: { type: string } }).error.type).toBe('PermissionError')
  })

  test('requires a session for a non-guest method', async ({ api }) => {
    const res = await api.fetch('/api/method/ping', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(401)
  })

  test('a method that validates its args returns a clean 4xx, not 500', async ({ admin }) => {
    // Missing required arg (also covers a POST with a non-JSON body → {}).
    const res = await admin.fetch('/api/method/count_docs', { method: 'POST', body: 'not json' })
    expect(res.status).toBe(417)
    expect(((await res.json()) as { error: { type: string } }).error.type).toBe('ValidationError')
  })

  test('allows a guest-whitelisted method without a session', async ({ api }) => {
    const res = await api.fetch('/api/method/public_info')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { message: { product: string } }).message.product).toBe(
      'Frappe Clone',
    )
  })
})

import { afterEach, describe, expect, test, vi } from 'vitest'
import { signOut } from '../src/lib/api'

// #411: the server answers 503 when it could not end the session; the client
// must not treat that as a completed sign-out.
describe('signOut', () => {
  afterEach(() => vi.unstubAllGlobals())

  const answer = (status: number, body: unknown) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))

  test('is complete when the server ends the session', async () => {
    answer(200, { ok: true })
    expect(await signOut()).toBe(true)
  })

  test('is incomplete when the server could not end it, or did not answer', async () => {
    answer(503, { error: { type: 'ServiceUnavailableError', message: 'Sign-out did not complete. Try again.' } })
    expect(await signOut()).toBe(false)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down') }))
    expect(await signOut()).toBe(false)
  })
})

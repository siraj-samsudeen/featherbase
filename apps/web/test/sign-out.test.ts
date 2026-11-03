import { afterEach, describe, expect, test, vi } from 'vitest'
import { clearSession, getSessionUser, setSession, signOut } from '../src/lib/api'
import { connectEventSink, flushPendingEvents, recentActions, recordAction, replaceServerEntries } from '../src/lib/recents'

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

  test('keeps unconfirmed visits when sign-out fails', async () => {
    const owner = 'history-incomplete-sign-out'
    setSession('still-valid-token', { row_id: owner, email: null, full_name: null })
    connectEventSink({ currentUser: () => getSessionUser()?.row_id ?? null, post: () => {}, beacon: () => {} })
    const visit = { kind: 'list' as const, key: 'list:Person?', label: 'Person', path: '/featherbase/admin/Person' }
    recordAction(owner, visit, 1_800_000_000_000)
    flushPendingEvents()
    answer(503, { error: { type: 'ServiceUnavailableError', message: 'Try again' } })
    if (await signOut()) clearSession()
    replaceServerEntries(owner, [])
    expect(recentActions(owner, 10)).toEqual([{ ...visit, visits: [1_800_000_000_000] }])
    clearSession()
  })
})

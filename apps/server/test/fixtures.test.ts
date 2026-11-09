// The assertion helpers in ./fixtures.ts are what the rest of the suite
// trusts to fail; these tests prove they do. No server or database is
// needed: a TestApiError and a Response are built by hand.
import { describe, expect, it } from 'vitest'
import { TestApiError } from 'feather-testing-postgres'
import { expectRefused, expectStatus } from './fixtures'

const refusal = (status: number, message = 'refused') =>
  Promise.reject(new TestApiError(status, 'PermissionError', message))

describe('expectRefused', () => {
  it('passes when the call fails with that status', async () => {
    await expect(expectRefused(refusal(403), 403)).resolves.toBeInstanceOf(TestApiError)
  })

  it('fails when the call fails with another status', async () => {
    await expect(expectRefused(refusal(417), 403)).rejects.toThrow(/403/)
  })

  it('fails when the call succeeds', async () => {
    await expect(expectRefused(Promise.resolve({ ok: true }), 403)).rejects.toThrow(/succeeded/)
  })

  it('passes on a refused Response already in hand', async () => {
    const res = new Response('{"error":{"type":"PermissionError","message":"no"}}', { status: 403 })
    await expect(expectRefused(res, 403)).resolves.toMatchObject({ type: 'PermissionError' })
  })

  it('passes when the message contains the given text', async () => {
    await expect(expectRefused(refusal(417, 'qty is required'), 417, 'required')).resolves.toBeInstanceOf(TestApiError)
  })

  it('fails when the message lacks the given text', async () => {
    await expect(expectRefused(refusal(417, 'qty is required'), 417, 'too large')).rejects.toThrow(/too large/)
  })
})

describe('expectStatus', () => {
  it('passes on the expected status, leaving the body readable', async () => {
    const res = await expectStatus(new Response('{"ok":1}', { status: 200 }), 200)
    expect(await res.json()).toEqual({ ok: 1 })
  })

  it('fails on another status, showing the body', async () => {
    const res = new Response('{"error":{"message":"no such row"}}', { status: 404 })
    await expect(expectStatus(res, 200)).rejects.toThrow(/no such row/)
  })
})

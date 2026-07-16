import { describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { setUserPassword } from '../src/auth'
import { areq } from './helpers'

// API-006: every error answer — validation, auth, permission, not-found,
// conflict, malformed request, unknown route — uses the envelope
// { error: { type, message, fields? } } with the right status code.

async function envelope(res: Response) {
  expect(res.headers.get('content-type')).toContain('application/json')
  const body = (await res.json()) as { error: { type: string; message: string; fields?: unknown } }
  expect(body.error).toBeDefined()
  expect(typeof body.error.type).toBe('string')
  expect(typeof body.error.message).toBe('string')
  return body.error
}

describe('API-006: consistent error envelope', () => {
  it('401 AuthenticationError without a token', async () => {
    const res = await app.request('/api/whoami')
    expect(res.status).toBe(401)
    expect((await envelope(res)).type).toBe('AuthenticationError')
  })

  it('401 AuthenticationError with a garbage token', async () => {
    const res = await app.request('/api/whoami', {
      headers: { authorization: 'Bearer garbage' },
    })
    expect(res.status).toBe(401)
    expect((await envelope(res)).type).toBe('AuthenticationError')
  })

  it('404 NotFoundError for an unknown route (authed)', async () => {
    const res = await areq('/api/definitely-not-a-route')
    expect(res.status).toBe(404)
    expect((await envelope(res)).type).toBe('NotFoundError')
  })

  it('404 NotFoundError for a missing document and DocType', async () => {
    for (const path of ['/api/doc/User/no-such-user', '/api/doc/NoSuchDT/x']) {
      const res = await areq(path)
      expect(res.status).toBe(404)
      expect((await envelope(res)).type).toBe('NotFoundError')
    }
  })

  it('400 BadRequestError for non-numeric pagination params (evaluator pass #6)', async () => {
    for (const qs of ['limit_start=abc', 'limit_page_length=xyz', 'limit_start=Infinity']) {
      const res = await areq(`/api/list/User?${qs}`)
      expect(res.status).toBe(400)
      expect((await envelope(res)).type).toBe('BadRequestError')
    }
  })

  it('400 BadRequestError for a malformed JSON body', async () => {
    const res = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    })
    expect(res.status).toBe(400)
    expect((await envelope(res)).type).toBe('BadRequestError')
  })

  it('417 ValidationError with per-field messages', async () => {
    const res = await areq('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({ doctype: 'User', doc: {} }),
    })
    expect(res.status).toBe(417)
    const err = await envelope(res)
    expect(err.type).toBe('ValidationError')
    expect(err.fields).toMatchObject({ email: expect.any(String) })
  })

  it('409 ConflictError on duplicate insert', async () => {
    const res = await areq('/api/resource/User', {
      method: 'POST',
      body: JSON.stringify({ name: 'Administrator', email: 'admin@example.com' }),
    })
    expect(res.status).toBe(409)
    expect((await envelope(res)).type).toBe('ConflictError')
  })

  it('403 PermissionError for a non-privileged user hitting an admin route', async () => {
    // A role-less probe user hitting the System-Manager-only DocType route.
    const email = `envelope-probe-${Math.random().toString(36).slice(2, 8)}@x.com`
    const mk = await areq('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({ doctype: 'User', doc: { name: email, email } }),
    })
    expect(mk.status).toBe(201)
    await setUserPassword(email, 'probe-pw-12345')
    const login = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usr: email, pwd: 'probe-pw-12345' }),
    })
    expect(login.status).toBe(200)
    const tok = ((await login.json()) as { token: string }).token
    const res = await app.request('/api/doctype', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
      body: JSON.stringify({ name: 'Envelope Probe DT', fields: [] }),
    })
    expect(res.status).toBe(403)
    expect((await envelope(res)).type).toBe('PermissionError')
    // cleanup
    await areq(`/api/resource/User/${encodeURIComponent(email)}`, { method: 'DELETE' })
  })
})

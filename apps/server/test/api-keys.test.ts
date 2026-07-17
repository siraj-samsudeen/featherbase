import { describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { sql } from '../src/db'
import { setUserPassword } from '../src/auth'
import { areq, token } from './helpers'

// API-005: key/secret pairs authenticate as the user; revocation kills them.

const USER = 'api-key-user@x.com'

async function makeUser() {
  await sql`delete from tab_has_role where parent = ${USER}`
  await sql`delete from tab_user where name = ${USER}`
  await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({ doctype: 'User', doc: { name: USER, email: USER } }),
  })
  await setUserPassword(USER, 'apikeypw1')
}

describe('API-005: API key + secret token auth', () => {
  it('generated pair authenticates as that user; revoked pair stops working', async () => {
    await makeUser()
    // Login as the user, generate own keys.
    const login = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usr: USER, pwd: 'apikeypw1' }),
    })
    const jwt = ((await login.json()) as { token: string }).token
    const gen = await app.request('/api/generate_api_key', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
      body: '{}',
    })
    expect(gen.status).toBe(201)
    const { api_key, api_secret } = (await gen.json()) as { api_key: string; api_secret: string }
    expect(api_key).toMatch(/^fc_[0-9a-f]{16}$/)
    expect(api_secret).toMatch(/^[0-9a-f]{32}$/)

    // The pair authenticates as that user.
    const who = await app.request('/api/whoami', {
      headers: { authorization: `token ${api_key}:${api_secret}` },
    })
    expect(who.status).toBe(200)
    expect(((await who.json()) as { name: string }).name).toBe(USER)

    // Wrong secret and unknown key fail.
    for (const bad of [`token ${api_key}:wrong`, 'token fc_0000000000000000:x']) {
      const res = await app.request('/api/whoami', { headers: { authorization: bad } })
      expect(res.status).toBe(401)
    }

    // Revocation kills the pair.
    const rev = await app.request('/api/revoke_api_key', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
      body: '{}',
    })
    expect(rev.status).toBe(200)
    const after = await app.request('/api/whoami', {
      headers: { authorization: `token ${api_key}:${api_secret}` },
    })
    expect(after.status).toBe(401)
  })

  it('only System Managers can manage another user\'s keys', async () => {
    await makeUser()
    const login = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usr: USER, pwd: 'apikeypw1' }),
    })
    const jwt = ((await login.json()) as { token: string }).token
    const res = await app.request('/api/generate_api_key', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ user: 'Administrator' }),
    })
    expect(res.status).toBe(403)
    // Admin can.
    const admin = await areq('/api/generate_api_key', {
      method: 'POST',
      body: JSON.stringify({ user: USER }),
    })
    expect(admin.status).toBe(201)
  })

  it('internal columns (password_hash, api keys) never leave through the doc API', async () => {
    await makeUser()
    await areq('/api/generate_api_key', {
      method: 'POST',
      body: JSON.stringify({ user: USER }),
    })
    const res = await areq(`/api/resource/User/${encodeURIComponent(USER)}`)
    expect(res.status).toBe(200)
    const doc = (await res.json()) as Record<string, unknown>
    for (const secret of ['password_hash', 'api_key', 'api_secret_hash'])
      expect(doc).not.toHaveProperty(secret)
    // And requesting them as list fields is rejected outright.
    const list = await areq(
      `/api/resource/User?fields=${encodeURIComponent(JSON.stringify(['name', 'password_hash']))}`,
    )
    expect(list.status).toBe(417)
    // Cleanup.
    await sql`delete from tab_user where name = ${USER}`
  })
})

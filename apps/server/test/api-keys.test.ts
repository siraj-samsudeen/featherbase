import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { setUserPassword } from '../src/auth'
import type { TestClient } from 'feather-testing-postgres'

// API-005: key/secret pairs authenticate as the user; revocation kills them.

const USER = 'api-key-user@x.com'

// The login flow itself is under test here, so the user is created in-test
// (with a real password) rather than through the createUser fixture.
async function makeUser(admin: TestClient) {
  await admin.post('/api/save_doc', {
    doctype: 'User',
    doc: { name: USER, email: USER },
  })
  await setUserPassword(USER, 'apikeypw1')
}

describe('API-005: API key + secret token auth', () => {
  test('generated pair authenticates as that user; revoked pair stops working', async ({
    admin,
    api,
  }) => {
    await makeUser(admin)
    // Login as the user, generate own keys.
    const login = await api.fetch('/api/login', {
      method: 'POST',
      body: JSON.stringify({ usr: USER, pwd: 'apikeypw1' }),
    })
    const jwt = ((await login.json()) as { token: string }).token
    const gen = await api.fetch('/api/generate_api_key', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}` },
      body: '{}',
    })
    expect(gen.status).toBe(201)
    const { api_key, api_secret } = (await gen.json()) as { api_key: string; api_secret: string }
    expect(api_key).toMatch(/^fc_[0-9a-f]{16}$/)
    expect(api_secret).toMatch(/^[0-9a-f]{32}$/)

    // The pair authenticates as that user.
    const who = await api.fetch('/api/whoami', {
      headers: { authorization: `token ${api_key}:${api_secret}` },
    })
    expect(who.status).toBe(200)
    expect(((await who.json()) as { name: string }).name).toBe(USER)

    // Wrong secret and unknown key fail.
    for (const bad of [`token ${api_key}:wrong`, 'token fc_0000000000000000:x']) {
      const res = await api.fetch('/api/whoami', { headers: { authorization: bad } })
      expect(res.status).toBe(401)
    }

    // Revocation kills the pair.
    const rev = await api.fetch('/api/revoke_api_key', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}` },
      body: '{}',
    })
    expect(rev.status).toBe(200)
    const after = await api.fetch('/api/whoami', {
      headers: { authorization: `token ${api_key}:${api_secret}` },
    })
    expect(after.status).toBe(401)
  })

  test("only System Managers can manage another user's keys", async ({ admin, api }) => {
    await makeUser(admin)
    const login = await api.fetch('/api/login', {
      method: 'POST',
      body: JSON.stringify({ usr: USER, pwd: 'apikeypw1' }),
    })
    const jwt = ((await login.json()) as { token: string }).token
    const res = await api.fetch('/api/generate_api_key', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ user: 'Administrator' }),
    })
    expect(res.status).toBe(403)
    // Admin can.
    const adminRes = await admin.fetch('/api/generate_api_key', {
      method: 'POST',
      body: JSON.stringify({ user: USER }),
    })
    expect(adminRes.status).toBe(201)
  })

  test('internal columns (password_hash, api keys) never leave through the doc API', async ({
    admin,
  }) => {
    await makeUser(admin)
    await admin.post('/api/generate_api_key', { user: USER })
    const res = await admin.fetch(`/api/resource/User/${encodeURIComponent(USER)}`)
    expect(res.status).toBe(200)
    const doc = (await res.json()) as Record<string, unknown>
    for (const secret of ['password_hash', 'api_key', 'api_secret_hash'])
      expect(doc).not.toHaveProperty(secret)
    // And requesting them as list fields is rejected outright.
    const list = await admin.fetch(
      `/api/resource/User?fields=${encodeURIComponent(JSON.stringify(['name', 'password_hash']))}`,
    )
    expect(list.status).toBe(417)
  })
})

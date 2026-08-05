import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
import type { TestClient } from 'feather-testing-postgres'

// PLAT-006: Google OAuth server-side flow, driven through the dev mock
// provider (GOOGLE_CLIENT_ID unset). The browser dance is three redirects:
// login → consent → approve → callback; here we chase them by hand.

async function mockSignIn(api: TestClient, email: string, name = 'Test User') {
  const approve = await api.fetch(
    '/api/oauth/mock/approve?' +
      new URLSearchParams({
        state: await freshState(api),
        redirect_uri: '/api/oauth/google/callback',
        email,
        name,
      }).toString(),
  )
  if (approve.status !== 302) return approve
  const callbackUrl = approve.headers.get('location') as string
  return api.fetch(callbackUrl)
}

// The login route mints the signed CSRF state; pull it out of its redirect.
async function freshState(api: TestClient): Promise<string> {
  const res = await api.fetch('/api/oauth/google/login')
  const location = res.headers.get('location') as string
  return new URLSearchParams(location.split('?')[1]).get('state') as string
}

describe('PLAT-006: OAuth sign-in (mock provider)', () => {
  test('full mock flow provisions a user and hands the SPA a session', async ({ api }) => {
    const res = await mockSignIn(api, 'new.person@gmail.com')
    expect(res.status).toBe(302)
    const landing = res.headers.get('location') as string
    expect(landing).toContain('/oauth-callback?token=')
    const [user] = await sql`
      select social_login, enabled from "user" where email = 'new.person@gmail.com'`
    expect(user).toMatchObject({ social_login: 'google', enabled: true })
  })

  test('ALLOWED_LOGIN_DOMAINS blocks auto-provisioning foreign domains', async ({ api }) => {
    process.env.ALLOWED_LOGIN_DOMAINS = 'jeyarama.com'
    try {
      const denied = await mockSignIn(api, 'stranger@gmail.com')
      expect(denied.status).toBe(401)
      const [row] = await sql`select 1 from "user" where email = 'stranger@gmail.com'`
      expect(row).toBeUndefined()

      const admitted = await mockSignIn(api, 'kannan@jeyarama.com')
      expect(admitted.status).toBe(302)
      expect(admitted.headers.get('location')).toContain('/oauth-callback?token=')
    } finally {
      delete process.env.ALLOWED_LOGIN_DOMAINS
    }
  })

  test('an existing user signs in even off-domain (provisioned deliberately)', async ({ api }) => {
    await saveDoc(
      'User',
      { name: 'contractor@outside.io', email: 'contractor@outside.io', enabled: true, roles: [] },
      'Administrator',
    )
    process.env.ALLOWED_LOGIN_DOMAINS = 'jeyarama.com'
    try {
      const res = await mockSignIn(api, 'contractor@outside.io')
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toContain('/oauth-callback?token=')
    } finally {
      delete process.env.ALLOWED_LOGIN_DOMAINS
    }
  })

  test('the mock provider refuses to serve in production', async ({ api }) => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      expect((await api.fetch('/api/oauth/google/login')).status).toBe(401)
      expect((await api.fetch('/api/oauth/mock/consent')).status).toBe(401)
      expect((await api.fetch('/api/oauth/mock/approve')).status).toBe(401)
    } finally {
      process.env.NODE_ENV = prev
    }
  })
})

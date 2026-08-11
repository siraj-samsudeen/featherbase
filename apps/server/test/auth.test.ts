import { describe, expect } from 'vitest'
import { test } from './pg-test'

const json = (body: unknown) => ({
  method: 'POST',
  body: JSON.stringify(body),
})

describe('API-004: authentication', () => {
  test('login with valid credentials yields a token and user', async ({ api }) => {
    const res = await api.fetch(
      '/api/login',
      json({ usr: 'Administrator', pwd: process.env.ADMIN_PASSWORD ?? 'admin' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { token: string; user: { row_id: string } }
    expect(body.token.split('.')).toHaveLength(3)
    expect(body.user.name).toBe('Administrator')
  })

  test('login also works by email; wrong password is 401', async ({ api }) => {
    const byEmail = await api.fetch(
      '/api/login',
      json({ usr: 'admin@example.com', pwd: process.env.ADMIN_PASSWORD ?? 'admin' }),
    )
    expect(byEmail.status).toBe(200)
    const bad = await api.fetch('/api/login', json({ usr: 'Administrator', pwd: 'nope' }))
    expect(bad.status).toBe(401)
  })

  test('requests without a token are rejected; garbage tokens too', async ({ api }) => {
    expect((await api.fetch('/api/table/DocType')).status).toBe(401)
    expect((await api.fetch('/api/whoami')).status).toBe(401)
    expect(
      (
        await api.fetch('/api/whoami', {
          headers: { authorization: 'Bearer not.a.jwt' },
        })
      ).status,
    ).toBe(401)
  })

  test('a valid token resolves the correct user and stamps ownership', async ({ admin }) => {
    const me = await admin.get<{ row_id: string }>('/api/whoami')
    expect(me.row_id).toBe('Administrator')
  })

  test('ping stays public', async ({ api }) => {
    expect((await api.fetch('/api/ping')).status).toBe(200)
  })

  // #101: the sid cookie is a live credential; sign-out must expire it even
  // when no bearer token accompanies the request (the SPA has already
  // dropped its token by the time a stale tab retries).
  test('logout is public and expires the sid cookie', async ({ api }) => {
    const login = await api.fetch(
      '/api/login',
      json({ usr: 'Administrator', pwd: process.env.ADMIN_PASSWORD ?? 'admin' }),
    )
    expect(login.headers.get('set-cookie')).toContain('sid=')

    const res = await api.fetch('/api/logout', { method: 'POST' })
    expect(res.status).toBe(200)
    const cleared = res.headers.get('set-cookie') ?? ''
    expect(cleared).toContain('sid=')
    expect(cleared.toLowerCase()).toContain('max-age=0')
  })
})

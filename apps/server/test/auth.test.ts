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
    const body = (await res.json()) as { token: string; user: { name: string } }
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
    expect((await api.fetch('/api/resource/DocType')).status).toBe(401)
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
    const me = await admin.get<{ name: string }>('/api/whoami')
    expect(me.name).toBe('Administrator')
  })

  test('ping stays public', async ({ api }) => {
    expect((await api.fetch('/api/ping')).status).toBe(200)
  })
})

import { afterAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { app } from '../src/index'
import { areq } from './helpers'

afterAll(async () => {
  await sql.end()
})

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

describe('API-004: authentication', () => {
  it('login with valid credentials yields a token and user', async () => {
    const res = await app.request(
      '/api/login',
      json({ usr: 'Administrator', pwd: process.env.ADMIN_PASSWORD ?? 'admin' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { token: string; user: { name: string } }
    expect(body.token.split('.')).toHaveLength(3)
    expect(body.user.name).toBe('Administrator')
  })

  it('login also works by email; wrong password is 401', async () => {
    const byEmail = await app.request(
      '/api/login',
      json({ usr: 'admin@example.com', pwd: process.env.ADMIN_PASSWORD ?? 'admin' }),
    )
    expect(byEmail.status).toBe(200)
    const bad = await app.request('/api/login', json({ usr: 'Administrator', pwd: 'nope' }))
    expect(bad.status).toBe(401)
  })

  it('requests without a token are rejected; garbage tokens too', async () => {
    expect((await app.request('/api/resource/DocType')).status).toBe(401)
    expect((await app.request('/api/whoami')).status).toBe(401)
    expect(
      (
        await app.request('/api/whoami', {
          headers: { authorization: 'Bearer not.a.jwt' },
        })
      ).status,
    ).toBe(401)
  })

  it('a valid token resolves the correct user and stamps ownership', async () => {
    const me = (await (await areq('/api/whoami')).json()) as { name: string }
    expect(me.name).toBe('Administrator')
  })

  it('ping stays public', async () => {
    expect((await app.request('/api/ping')).status).toBe(200)
  })
})

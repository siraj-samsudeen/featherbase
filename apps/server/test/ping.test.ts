import { describe, expect } from 'vitest'
import { test } from './pg-test'

describe('GET /api/ping', () => {
  test('responds with pong and a live db check', async ({ admin }) => {
    const res = await admin.fetch('/api/ping')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      message: 'pong',
      db: true,
      environment: 'test',
      database_server_local: expect.any(Boolean),
    })
  })

  // Running an Instance / A running server can be checked: a person with no
  // sign-in can ask, and is told whether the database is on this machine.
  test('answers without signing in, and says its database is on this machine', async ({ api }) => {
    const res = await api.fetch('/api/ping')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ message: 'pong', db: true, database_server_local: true })
  })
})

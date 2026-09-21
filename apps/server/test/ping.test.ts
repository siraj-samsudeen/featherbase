import { describe, expect } from 'vitest'
import { test } from './pg-test'

describe('GET /api/ping', () => {
  test('responds with pong and a live db check', async ({ admin }) => {
    const res = await admin.fetch('/api/ping')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      message: 'pong',
      db: true,
      environment: 'test',
      // GitHub's Postgres service is reached through a container bridge, while
      // a developer's test database is loopback. Both are valid test topologies.
      database_server_local: expect.any(Boolean),
    })
  })
})

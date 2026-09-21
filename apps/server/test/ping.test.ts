import { describe, expect } from 'vitest'
import { test } from './pg-test'

describe('GET /api/ping', () => {
  test('responds with pong and a live db check', async ({ admin }) => {
    const res = await admin.fetch('/api/ping')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      message: 'pong',
      db: true,
      environment: 'test',
    })
    expect(body.database_server_local).toEqual(expect.any(Boolean))
  })
})

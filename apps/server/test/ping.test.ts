import { describe, expect, it } from 'vitest'
import { areq } from './helpers'

describe('GET /api/ping', () => {
  it('responds with pong and a live db check', async () => {
    const res = await areq('/api/ping')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ message: 'pong', db: true })
  })
})

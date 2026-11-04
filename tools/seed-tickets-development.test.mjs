import { test } from 'node:test'
import assert from 'node:assert/strict'

test('Tickets development samples refuse a non-loopback destination before making a request', async () => {
  const { seedTickets } = await import('./seed-tickets-development.mjs')
  await assert.rejects(seedTickets({ baseUrl: 'https://example.com', password: 'unused' }), /loopback/)
})

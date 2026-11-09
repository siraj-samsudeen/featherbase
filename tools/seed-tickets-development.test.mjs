import { test } from 'node:test'
import assert from 'node:assert/strict'

test('Tickets development samples refuse a non-loopback destination before making a request', async () => {
  const { seedTickets } = await import('./seed-tickets-development.mjs')
  await assert.rejects(seedTickets({ baseUrl: 'https://example.com', password: 'unused' }), /loopback/)
})

test('Tickets development samples refuse a server whose database is not local, before signing in', async () => {
  const { seedTickets } = await import('./seed-tickets-development.mjs')
  const paths = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    paths.push(new URL(String(url)).pathname)
    return new Response(JSON.stringify({ message: 'pong', environment: 'development', database_server_local: false }), { headers: { 'Content-Type': 'application/json' } })
  }
  try {
    await assert.rejects(seedTickets({ baseUrl: 'http://127.0.0.1:8110', password: 'unused' }), /non-local database/)
  } finally {
    globalThis.fetch = realFetch
  }
  assert.deepEqual(paths, ['/api/ping'])
})

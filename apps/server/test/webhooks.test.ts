import { createServer, type Server } from 'node:http'
import { createHmac } from 'node:crypto'
import { afterAll, beforeAll, describe, expect } from 'vitest'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { drainJobs } from '../src/jobs'

// PLAT-005: a lifecycle event enqueues a webhook delivery that POSTs the doc
// JSON with a valid HMAC signature; non-2xx responses are retried.

const DT = 'Webhook Target'
const SECRET = 'sup3r-s3cret'

interface Received {
  path: string
  body: string
  signature: string | undefined
  event: string | undefined
}
const received: Received[] = []
let server: Server
let port: number
// The receiver fails this many times (with 500) before succeeding, per path.
const failuresLeft = new Map<string, number>()

function startReceiver(): Promise<void> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c) => chunks.push(c as Buffer))
      req.on('end', () => {
        const path = req.url ?? '/'
        const fails = failuresLeft.get(path) ?? 0
        received.push({
          path,
          body: Buffer.concat(chunks).toString('utf8'),
          signature: req.headers['x-webhook-signature'] as string | undefined,
          event: req.headers['x-webhook-event'] as string | undefined,
        })
        if (fails > 0) {
          failuresLeft.set(path, fails - 1)
          res.statusCode = 500
          res.end('fail')
        } else {
          res.statusCode = 200
          res.end('ok')
        }
      })
    })
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as { port: number }).port
      resolve()
    })
  })
}

// The receiver is a real network server, not DB state — it alone stays in
// beforeAll/afterAll. DB setup happens per test inside the sandbox.
beforeAll(async () => {
  await startReceiver()
})

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
})

// Each test creates the DocType in its own transaction and starts with an
// empty capture, so tests don't cross-fire each other's webhooks.
async function setup(admin: TestClient) {
  received.length = 0
  failuresLeft.clear()
  await admin.post('/api/doctype', {
    name: DT,
    fields: [{ fieldname: 'title', fieldtype: 'Data' }],
  })
}

async function makeDoc(admin: TestClient): Promise<{ name: string; modified: string }> {
  return await admin.post<{ name: string; modified: string }>('/api/save_doc', {
    doctype: DT,
    doc: { title: 'v1' },
  })
}

// Sandbox clock shim: inside the rolled-back test transaction now() is frozen
// at BEGIN, while the delivery job's run_at is stamped from the wall clock —
// so it never counts as "due" for the claim query. Mark any job whose run_at
// has passed by the wall clock (clock_timestamp) as due by the transaction
// clock, then drain.
async function drainDueJobs() {
  await sql`
    update tab_background_job set run_at = now()
    where status = 'queued' and run_at > now() and run_at <= clock_timestamp()`
  return await drainJobs()
}

// Failed deliveries are re-queued immediately due, but poll a drain loop
// until the expected hits arrive rather than asserting after one pass.
async function waitForHits(pred: (r: Received) => boolean, want: number, ms = 5000): Promise<Received[]> {
  const deadline = Date.now() + ms
  for (;;) {
    await drainDueJobs()
    const got = received.filter(pred)
    if (got.length >= want || Date.now() > deadline) return got
    await new Promise((r) => setTimeout(r, 100))
  }
}

describe('PLAT-005: webhooks', () => {
  test('on_update posts the doc JSON with a valid signature', async ({ admin }) => {
    await setup(admin)
    await admin.post('/api/save_doc', {
      doctype: 'Webhook',
      doc: { webhook_doctype: DT, webhook_event: 'on_update', request_url: `http://127.0.0.1:${port}/hook`, webhook_secret: SECRET, enabled: true },
    })

    const doc = await makeDoc(admin)
    // Updating fires on_update.
    await admin.post('/api/save_doc', {
      doctype: DT,
      doc: { name: doc.name, modified: doc.modified, title: 'v2' },
    })

    const hits = await waitForHits((r) => r.path === '/hook' && JSON.parse(r.body).name === doc.name, 1)
    expect(hits.length).toBe(1)
    const hit = hits[0]
    expect(hit.event).toBe('on_update')
    const payload = JSON.parse(hit.body) as { name: string; title: string }
    expect(payload.title).toBe('v2')
    // The signature verifies against the exact body with the shared secret.
    expect(hit.signature).toBe(createHmac('sha256', SECRET).update(hit.body).digest('hex'))
  })

  test('retries delivery when the receiver fails, until it succeeds', async ({ admin }) => {
    await setup(admin)
    failuresLeft.set('/retry', 1) // fail once, then succeed
    await admin.post('/api/save_doc', {
      doctype: 'Webhook',
      doc: { webhook_doctype: DT, webhook_event: 'on_update', request_url: `http://127.0.0.1:${port}/retry`, webhook_secret: SECRET, enabled: true },
    })

    const doc = await makeDoc(admin)
    await admin.post('/api/save_doc', {
      doctype: DT,
      doc: { name: doc.name, modified: doc.modified, title: 'v2' },
    })

    // Two hits to /retry: the first 500'd, the retry succeeded.
    const retryHits = await waitForHits(
      (r) => r.path === '/retry' && JSON.parse(r.body).name === doc.name,
      2,
    )
    expect(retryHits.length).toBe(2)
  })

  test('does not fire for events a webhook is not subscribed to', async ({ admin }) => {
    await setup(admin)
    // An on_update webhook exists; creating a doc (after_insert) must not hit it.
    await admin.post('/api/save_doc', {
      doctype: 'Webhook',
      doc: { webhook_doctype: DT, webhook_event: 'on_update', request_url: `http://127.0.0.1:${port}/nomatch`, webhook_secret: SECRET, enabled: true },
    })
    await makeDoc(admin) // after_insert only
    await drainDueJobs()
    await new Promise((r) => setTimeout(r, 300))
    await drainDueJobs()
    expect(received.filter((r) => r.path === '/nomatch').length).toBe(0)
  })
})

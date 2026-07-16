import { createServer, type Server } from 'node:http'
import { createHmac } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { drainJobs } from '../src/jobs'
import { areq } from './helpers'

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

async function cleanup() {
  await sql`delete from tab_webhook where webhook_doctype = ${DT}`
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_webhook_target')
}

async function makeDoc(): Promise<{ name: string; modified: string }> {
  const res = await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({ doctype: DT, doc: { title: 'v1' } }),
  })
  return (await res.json()) as { name: string; modified: string }
}

beforeAll(async () => {
  await cleanup()
  await startReceiver()
  await areq('/api/doctype', {
    method: 'POST',
    body: JSON.stringify({ name: DT, fields: [{ fieldname: 'title', fieldtype: 'Data' }] }),
  })
})

afterAll(async () => {
  await cleanup()
  await new Promise<void>((r) => server.close(() => r()))
  await sql.end()
})

describe('PLAT-005: webhooks', () => {
  it('on_update posts the doc JSON with a valid signature', async () => {
    received.length = 0
    await areq('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({
        doctype: 'Webhook',
        doc: { webhook_doctype: DT, webhook_event: 'on_update', request_url: `http://127.0.0.1:${port}/hook`, webhook_secret: SECRET, enabled: true },
      }),
    })

    const doc = await makeDoc()
    // Updating fires on_update.
    await areq('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({ doctype: DT, doc: { name: doc.name, modified: doc.modified, title: 'v2' } }),
    })
    await drainJobs()

    expect(received.length).toBe(1)
    const hit = received[0]
    expect(hit.event).toBe('on_update')
    const payload = JSON.parse(hit.body) as { name: string; title: string }
    expect(payload.name).toBe(doc.name)
    expect(payload.title).toBe('v2')
    // The signature verifies against the exact body with the shared secret.
    expect(hit.signature).toBe(createHmac('sha256', SECRET).update(hit.body).digest('hex'))
  })

  it('retries delivery when the receiver fails, until it succeeds', async () => {
    received.length = 0
    failuresLeft.set('/retry', 1) // fail once, then succeed
    await areq('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({
        doctype: 'Webhook',
        doc: { webhook_doctype: DT, webhook_event: 'on_update', request_url: `http://127.0.0.1:${port}/retry`, webhook_secret: SECRET, enabled: true },
      }),
    })

    const doc = await makeDoc()
    await areq('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({ doctype: DT, doc: { name: doc.name, modified: doc.modified, title: 'v2' } }),
    })
    await drainJobs()

    // Two hits to /retry: the first 500'd, the retry succeeded.
    const retryHits = received.filter((r) => r.path === '/retry' && JSON.parse(r.body).name === doc.name)
    expect(retryHits.length).toBe(2)
    // The delivery job ended 'done' (not 'failed').
    const [job] = await sql`
      select status from tab_background_job
      where method = 'deliver_webhook' order by modified desc limit 1`
    expect(job.status).toBe('done')
  })

  it('does not fire for events a webhook is not subscribed to', async () => {
    received.length = 0
    // Only on_update webhooks exist; creating a doc (after_insert) shouldn't hit them.
    await makeDoc()
    await drainJobs()
    expect(received.length).toBe(0)
  })
})

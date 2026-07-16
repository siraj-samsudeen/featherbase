import { createHmac } from 'node:crypto'
import { sql } from './db'
import { registerJob, enqueue } from './jobs'

// PLAT-005: outbound webhooks. On a matching lifecycle event we enqueue a
// delivery job per enabled Webhook; the job POSTs the document JSON to the
// configured URL with an HMAC signature header, and the job system retries on
// failure (non-2xx or network error) up to max_attempts.

export type WebhookEvent = 'after_insert' | 'on_update' | 'on_submit' | 'on_cancel'

function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

// Called post-commit from the document lifecycle. Enqueues a delivery job (with
// a snapshot of the doc) for every enabled webhook on this doctype+event.
export async function evaluateWebhooks(
  event: WebhookEvent,
  doctype: string,
  doc: Record<string, unknown>,
): Promise<void> {
  const [tableOk] = await sql`
    select 1 from information_schema.tables where table_name = 'tab_webhook'`
  if (!tableOk) return
  const hooks = await sql`
    select name from tab_webhook
    where webhook_doctype = ${doctype} and webhook_event = ${event} and enabled = true`
  for (const h of hooks) {
    // Snapshot the doc so the payload reflects the state at event time.
    await enqueue('deliver_webhook', { webhook: h.name as string, event, doc }, { maxAttempts: 3 })
  }
}

registerJob('deliver_webhook', async (payload) => {
  const { webhook, event, doc } = payload as {
    webhook: string
    event: string
    doc: Record<string, unknown>
  }
  const [h] = await sql`select request_url, webhook_secret from tab_webhook where name = ${webhook}`
  if (!h) return // webhook was deleted since enqueue — nothing to do

  const body = JSON.stringify(doc)
  const secret = (h.webhook_secret as string) ?? ''
  const res = await fetch(h.request_url as string, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-webhook-event': String(event),
      'x-webhook-signature': sign(secret, body),
    },
    body,
  })
  // Non-2xx throws so the job system retries (JOB-002).
  if (!res.ok) throw new Error(`webhook ${webhook} → HTTP ${res.status}`)
})

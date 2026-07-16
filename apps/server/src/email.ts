import { randomBytes } from 'node:crypto'
import { sql } from './db'
import { AppError } from './errors'
import { registerJob, enqueue } from './jobs'

// EML-001/002/003/005: outbound email. In dev, delivery lands in the Email
// Sink (the local mailbox). The same code path would drive a real SMTP
// transport in production.

export interface Attachment {
  filename: string
  content_b64: string
}

export interface MailMessage {
  to: string
  subject: string
  body: string
  from?: string
  reference_doctype?: string
  reference_name?: string
  attachments?: Attachment[]
}

function id(): string {
  return randomBytes(6).toString('hex')
}

async function defaultSender(): Promise<string> {
  const [acc] = await sql`
    select email_id from tab_email_account
    where is_default = true order by modified desc limit 1`
  if (acc?.email_id) return acc.email_id as string
  const [any] = await sql`select email_id from tab_email_account order by creation asc limit 1`
  return (any?.email_id as string) ?? 'no-reply@localhost'
}

// EML-005: interpolate {{ doc.field }} against a document.
export function renderTemplate(
  template: string,
  doc: Record<string, unknown> | undefined,
): string {
  return template.replace(/\{\{\s*doc\.([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = doc?.[key]
    return v == null ? '' : String(v)
  })
}

// Deliver a message to the sink (the dev transport). Real SMTP would go here.
export async function deliverToSink(msg: MailMessage): Promise<void> {
  const from = msg.from ?? (await defaultSender())
  await sql`
    insert into tab_email_sink ${sql({
      name: id(),
      owner: 'Administrator',
      modified_by: 'Administrator',
      mail_from: from,
      mail_to: msg.to,
      subject: msg.subject,
      body: msg.body,
      attachment_names: (msg.attachments ?? []).map((a) => a.filename).join(', ') || null,
      attachment_b64: msg.attachments?.length ? msg.attachments[0].content_b64 : null,
    })}`
}

// EML-001: send immediately (used for "send a test mail").
export async function sendTestEmail(to: string): Promise<void> {
  const from = await defaultSender()
  await deliverToSink({
    to,
    from,
    subject: 'Test email from Frappe Clone',
    body: 'This is a test email confirming the account can send mail.',
  })
}

// EML-002: queue an email; a background job delivers it and flips the row
// queued -> sent (or error). Returns the Email Queue name.
export async function queueEmail(msg: MailMessage): Promise<string> {
  const from = msg.from ?? (await defaultSender())
  const name = id()
  await sql`
    insert into tab_email_queue ${sql({
      name,
      owner: 'Administrator',
      modified_by: 'Administrator',
      sender: from,
      recipient: msg.to,
      subject: msg.subject,
      body: msg.body,
      status: 'queued',
      reference_doctype: msg.reference_doctype ?? null,
      reference_name: msg.reference_name ?? null,
      attachments: (msg.attachments ?? []) as unknown as string,
    })}`
  await enqueue('send_email', { queue: name })
  return name
}

// The job that actually delivers a queued email exactly once.
registerJob('send_email', async (payload) => {
  const queueName = String(payload.queue ?? '')
  // Claim the row: only deliver if still queued (idempotent under retries).
  const [row] = await sql`
    update tab_email_queue set status = 'sent', modified = now()
    where name = ${queueName} and status = 'queued'
    returning *`
  if (!row) return // already delivered or missing — no double-send
  try {
    await deliverToSink({
      to: row.recipient as string,
      from: row.sender as string,
      subject: (row.subject as string) ?? '',
      body: (row.body as string) ?? '',
      reference_doctype: (row.reference_doctype as string) ?? undefined,
      reference_name: (row.reference_name as string) ?? undefined,
      attachments: (row.attachments as Attachment[] | null) ?? undefined,
    })
  } catch (err) {
    await sql`
      update tab_email_queue set status = 'error', error = ${
        err instanceof Error ? err.message : String(err)
      }, modified = now() where name = ${queueName}`
    throw err
  }
})

export function assertRecipient(to: string | undefined): asserts to is string {
  if (!to) throw new AppError('ValidationError', 'Expected a recipient', { to: 'Required' })
}

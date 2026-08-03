import { randomBytes } from 'node:crypto'
import { sql } from './db'
import { AppError } from './errors'
import { registerJob, enqueue } from './jobs'
import { getDoc } from './document'
import { renderPdf, renderPrintHtml } from './print'

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
  ref_table?: string
  reference_name?: string
  attachments?: Attachment[]
  // EML-005: when set, subject+body are treated as {{ doc.field }} templates
  // and rendered against the reference row at send time.
  render?: boolean
  // EML-003: attach a PDF of the reference row (optionally a named
  // print format) to the outgoing mail.
  attach_pdf?: boolean
  print_format?: string
}

function id(): string {
  return randomBytes(6).toString('hex')
}

async function defaultSender(): Promise<string> {
  const [acc] = await sql`
    select email_id from email_account
    where is_default = true order by updated_at desc limit 1`
  if (acc?.email_id) return acc.email_id as string
  const [any] = await sql`select email_id from email_account order by created_at asc limit 1`
  return (any?.email_id as string) ?? 'no-reply@localhost'
}

// EML-005: interpolate {{ doc.field }} against a row.
export function renderTemplate(
  template: string,
  row: Record<string, unknown> | undefined,
): string {
  return template.replace(/\{\{\s*doc\.([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = row?.[key]
    return v == null ? '' : String(v)
  })
}

// Deliver a message to the sink (the dev transport). Real SMTP would go here.
export async function deliverToSink(msg: MailMessage): Promise<void> {
  const from = msg.from ?? (await defaultSender())
  await sql`
    insert into email_sink ${sql({
      name: id(),
      created_by: 'Administrator',
      updated_by: 'Administrator',
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
    subject: 'Test email from Featherbase',
    body: 'This is a test email confirming the account can send mail.',
  })
}

// EML-002: queue an email; a background job delivers it and flips the row
// queued -> sent (or error). Returns the Email Queue name.
export async function queueEmail(msg: MailMessage): Promise<string> {
  const from = msg.from ?? (await defaultSender())
  const name = id()
  await sql`
    insert into email_queue ${sql({
      name,
      created_by: 'Administrator',
      updated_by: 'Administrator',
      sender: from,
      recipient: msg.to,
      subject: msg.subject,
      body: msg.body,
      send_status: 'queued',
      ref_table: msg.ref_table ?? null,
      reference_name: msg.reference_name ?? null,
      // Delivery options travel with the row so the job is self-contained.
      // `files` carries ready-made attachments (e.g. an Auto Email Report CSV);
      // render/attach_pdf are computed at send time from the reference row.
      attachments: {
        render: msg.render ?? false,
        attach_pdf: msg.attach_pdf ?? false,
        print_format: msg.print_format ?? null,
        files: msg.attachments ?? [],
      } as unknown as string,
    })}`
  await enqueue('send_email', { queue: name })
  return name
}

// The job that actually delivers a queued email exactly once.
registerJob('send_email', async (payload) => {
  const queueName = String(payload.queue ?? '')
  // Claim the row: only deliver if still queued (idempotent under retries).
  const [row] = await sql`
    update email_queue set send_status = 'sent', updated_at = now()
    where name = ${queueName} and send_status = 'queued'
    returning *`
  if (!row) return // already delivered or missing — no double-send
  try {
    const opts = (row.attachments as { render?: boolean; attach_pdf?: boolean; print_format?: string; files?: Attachment[] } | null) ?? {}
    const refTable = (row.ref_table as string) ?? undefined
    const refName = (row.reference_name as string) ?? undefined
    let subject = (row.subject as string) ?? ''
    let body = (row.body as string) ?? ''
    const attachments: Attachment[] = [...(opts.files ?? [])]

    if ((opts.render || opts.attach_pdf) && refTable && refName) {
      const refRow = await getDoc(refTable, refName)
      // EML-005: render subject/body templates against the row.
      if (opts.render) {
        subject = renderTemplate(subject, refRow)
        body = renderTemplate(body, refRow)
      }
      // EML-003: attach a PDF of the row.
      if (opts.attach_pdf) {
        const html = await renderPrintHtml(refTable, refName, 'Administrator', opts.print_format)
        const pdf = await renderPdf(html)
        attachments.push({ filename: `${refName}.pdf`, content_b64: pdf.toString('base64') })
      }
    }

    await deliverToSink({
      to: row.recipient as string,
      from: row.sender as string,
      subject,
      body,
      ref_table: refTable,
      reference_name: refName,
      attachments,
    })
  } catch (err) {
    await sql`
      update email_queue set send_status = 'error', error = ${
        err instanceof Error ? err.message : String(err)
      }, updated_at = now() where name = ${queueName}`
    throw err
  }
})

export function assertRecipient(to: string | undefined): asserts to is string {
  if (!to) throw new AppError('ValidationError', 'Expected a recipient', { to: 'Required' })
}

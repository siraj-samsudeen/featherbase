import { randomBytes } from 'node:crypto'
import { processEnvironment } from './env'
import type { ConnectionOptions } from 'node:tls'
import { createTransport } from 'nodemailer'
import { sql } from './db'
import { AppError } from './errors'
import { emailsAddress, parseInstanceAddresses } from './instance-addresses'
import { registerJob, enqueue } from './jobs'
import { getDoc } from './document'
import { renderPdf, renderPrintHtml } from './print'

// EML-001/002/003/005: outbound email. With SMTP_HOST unset (development,
// the test suite) delivery lands in the Email Sink, the local mailbox. With
// SMTP_HOST set, the same code path sends through that SMTP server (#395).

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

// The sender stamped when no Email Account exists. It is a placeholder, not
// an address anyone can reply to.
const PLACEHOLDER_SENDER = 'no-reply@localhost'

async function defaultSender(): Promise<string> {
  const [acc] = await sql`
    select email_id from email_account
    where is_default = true order by updated_at desc limit 1`
  if (acc?.email_id) return acc.email_id as string
  const [any] = await sql`select email_id from email_account order by created_at asc limit 1`
  return (any?.email_id as string) ?? PLACEHOLDER_SENDER
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

// --- SMTP transport (#395) -------------------------------------------------

export interface SmtpConfig {
  host: string
  port: number
  user?: string
  password?: string
  /** MAIL_FROM: the deployment's one sender (e.g. `Feather Dash <noreply@…>`). */
  from?: string
  /** The EHLO name: SMTP_NAME, else the MAIL_FROM domain, else the emails address's
   *  host. Unset here, the sender's domain is used at send time. */
  name?: string
  /** Extra TLS options. Never read from the environment: tests use it to
   *  trust a throwaway certificate. */
  tls?: ConnectionOptions
}

// Test-only: merged into the environment's config by the send paths. There
// is deliberately no environment variable for it, so a deployment cannot
// loosen certificate checks.
let testOverrides: Pick<SmtpConfig, 'tls'> | null = null
export function _setSmtpTestOverrides(o: Pick<SmtpConfig, 'tls'> | null): void {
  testOverrides = o
}

/** The environment's SMTP config, or null for the Email Sink. */
function activeSmtpConfig(): SmtpConfig | null {
  const cfg = readSmtpConfig()
  return cfg && testOverrides ? { ...cfg, ...testOverrides } : cfg
}

// Read per send, not at import, so a changed environment needs no restart of
// this module (and the tests can switch transports). Blank means unset.
export function readSmtpConfig(env: Record<string, string | undefined> = processEnvironment()): SmtpConfig | null {
  const val = (k: string) => env[k]?.trim() || undefined
  const host = val('SMTP_HOST')
  if (!host) return null
  const rawPort = val('SMTP_PORT') ?? '587'
  const port = Number(rawPort)
  if (!/^\d+$/.test(rawPort) || port < 1 || port > 65535)
    throw new MailDeliveryError('ECONFIG', undefined, 'SMTP_PORT must be a port number (587 for STARTTLS, 465 for implicit TLS)')
  const user = val('SMTP_USER')
  // A Workspace app password is 16 letters that Google displays as four
  // groups of four; the spaces are not part of it. Any other password is
  // used exactly as set.
  const raw = env.SMTP_PASSWORD ?? ''
  const password = (GOOGLE_APP_PASSWORD.test(raw.trim()) ? raw.replace(/\s+/g, '') : raw) || undefined
  if (user && !password) throw new MailDeliveryError('ECONFIG', undefined, 'SMTP_USER is set but SMTP_PASSWORD is empty')
  const from = val('MAIL_FROM')
  const explicitName = val('SMTP_NAME')
  if (explicitName && !HOSTNAME.test(explicitName))
    throw new MailDeliveryError('ECONFIG', undefined, 'SMTP_NAME must be a hostname such as jeyarama.com')
  const name = explicitName ?? (from && senderDomain(from)) ?? emailsHost(val('INSTANCE_ADDRESSES'))
  return { host, port, user, password, from, ...(name ? { name } : {}) }
}

const GOOGLE_APP_PASSWORD = /^[a-z]{4}( [a-z]{4}){3}$/i

// The name sent in EHLO. Left unset, nodemailer uses os.hostname(), and a
// container's hostname has no dot, so it greets as `[127.0.0.1]`; Google's
// relay answers that with `421 4.7.0 Try again later ... (EHLO)`.
const HOSTNAME = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/

function senderDomain(sender: string): string | undefined {
  const domain = bareAddress(sender).split('@')[1]
  return domain && HOSTNAME.test(domain) ? domain : undefined
}

// The host of the INSTANCE_ADDRESSES entry marked for emails (#488). The boot
// already refused an invalid list; here an unusable one just offers no name.
function emailsHost(raw: string | undefined): string | undefined {
  try {
    const list = parseInstanceAddresses(raw, 'development')
    const host = list ? emailsAddress(list).host : undefined
    return host && HOSTNAME.test(host) ? host : undefined
  } catch {
    return undefined
  }
}

// 465 is implicit TLS. On every other port the session starts in plain text
// and STARTTLS is REQUIRED: nodemailer refuses to go on if the server does not
// offer it, so no message and no credential ever crosses the wire unencrypted.
// The certificate is always verified.
export function smtpTransportOptions(cfg: SmtpConfig) {
  const secure = cfg.port === 465
  const auth = cfg.user ? { user: cfg.user, pass: cfg.password ?? '' } : undefined
  return {
    host: cfg.host,
    port: cfg.port,
    name: cfg.name,
    secure,
    requireTLS: !secure,
    auth,
    tls: { minVersion: 'TLSv1.2' as const, ...cfg.tls },
    // A hung relay must not hold a request (a password reset) open for minutes.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    logger: false,
    debug: false,
  }
}

/** A message the SMTP server did not accept. The message names the failure
 *  class and the server's reply code only — never an address, a body or a
 *  credential — so it is safe to log, store and show to the caller. */
export class MailDeliveryError extends AppError {
  code: string
  responseCode?: number
  /** The server's reply line, for the operator running `cli mail:test`.
   *  Not part of `message`, so it is never stored, logged or returned: a
   *  relay may echo an address in it. Non-enumerable for the same reason. */
  declare serverReply?: string
  /** `detail` is fixed text written here (a configuration problem), never
   *  anything taken from the server or the message. */
  constructor(code: string, responseCode?: number, detail?: string) {
    super(
      'ServiceUnavailableError',
      code === 'ECONFIG'
        ? `Mail configuration invalid (ECONFIG)${detail ? `: ${detail}` : ''}`
        : `Mail delivery failed (${code}${responseCode ? ` ${responseCode}` : ''})`,
    )
    this.code = code
    this.responseCode = responseCode
  }

  /** Worth retrying: the server said "try later" (4xx), or could not be
   *  reached. A 5xx refusal, bad credentials or bad configuration are not. */
  get transient(): boolean {
    if (this.responseCode) return this.responseCode >= 400 && this.responseCode < 500
    return TRANSIENT_CODES.has(this.code)
  }
}

// ESOCKET is how nodemailer reports a refused or dropped connection.
const TRANSIENT_CODES = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET'])

/** The bare address of `Name <addr>` or `addr`, lower-cased. */
function bareAddress(sender: string): string {
  return (/<([^>]+)>/.exec(sender)?.[1] ?? sender).trim().toLowerCase()
}

function toDeliveryError(err: unknown): MailDeliveryError {
  if (err instanceof MailDeliveryError) return err
  const e = (err ?? {}) as { code?: unknown; responseCode?: unknown; response?: unknown }
  // nodemailer's codes are fixed identifiers (ECONNECTION, ETLS, EAUTH,
  // EENVELOPE, ...); anything else is reported as an unknown failure rather
  // than echoing free text that could carry an address.
  const code = typeof e.code === 'string' && /^[A-Z_]{2,32}$/.test(e.code) ? e.code : 'EUNKNOWN'
  const responseCode = typeof e.responseCode === 'number' ? e.responseCode : undefined
  const out = new MailDeliveryError(code, responseCode)
  if (typeof e.response === 'string' && e.response.trim()) {
    // Control characters stripped, length capped: it is printed to a terminal.
    const reply = e.response.replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, 500)
    Object.defineProperty(out, 'serverReply', { value: reply, enumerable: false })
  }
  return out
}

/** One structured log line per failed delivery: what the mail was for and
 *  why it failed, never who it was to or what it said. */
export function logMailFailure(purpose: string, err: unknown): void {
  const e = toDeliveryError(err)
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'mail_delivery_failed',
      purpose,
      code: e.code,
      ...(e.responseCode ? { smtp_response_code: e.responseCode } : {}),
    }),
  )
}

export async function sendViaSmtp(cfg: SmtpConfig, msg: MailMessage): Promise<void> {
  // MAIL_FROM wins: a relay that accepts only the deployment's own domain
  // must not be handed an Email Account address from somewhere else. The
  // sender it replaced still gets the replies.
  const sender = msg.from && msg.from !== PLACEHOLDER_SENDER ? msg.from : undefined
  const from = cfg.from ?? sender
  if (!from) throw new MailDeliveryError('ECONFIG', undefined, 'set MAIL_FROM or a default Email Account')
  const replyTo = cfg.from && sender && bareAddress(sender) !== bareAddress(cfg.from) ? sender : undefined
  const name = cfg.name ?? senderDomain(from)
  if (!name) throw new MailDeliveryError('ECONFIG', undefined, 'set SMTP_NAME: the sender address has no domain to greet the server with')
  const transport = createTransport(smtpTransportOptions({ ...cfg, name }))
  try {
    await transport.sendMail({
      from,
      ...(replyTo ? { replyTo } : {}),
      to: msg.to,
      subject: msg.subject,
      text: msg.body,
      attachments: (msg.attachments ?? []).map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content_b64, 'base64'),
      })),
    })
  } catch (err) {
    throw toDeliveryError(err)
  } finally {
    transport.close()
  }
}

/** Deliver one message through the configured transport: SMTP when
 *  SMTP_HOST is set, otherwise the Email Sink. Throws MailDeliveryError when
 *  the SMTP server does not take it; each caller decides what that means. */
export async function deliverEmail(msg: MailMessage): Promise<void> {
  const smtp = activeSmtpConfig()
  if (smtp) return await sendViaSmtp(smtp, { ...msg, from: msg.from ?? (await defaultSender()) })
  await deliverToSink(msg)
}

// Sends started by deliverWithoutWaiting that have not settled yet.
const pendingMail = new Set<Promise<void>>()

/** Deliver without making the caller wait on the SMTP server: a public
 *  request (password reset) answers in the same time whether or not a mail
 *  goes out (#395). A failure, configuration errors included, is logged under
 *  `purpose` and never thrown. The Email Sink is still awaited: it is a local
 *  insert, and the tests read it straight after. */
export async function deliverWithoutWaiting(msg: MailMessage, purpose: string): Promise<void> {
  let smtp: SmtpConfig | null
  try {
    smtp = activeSmtpConfig()
  } catch (err) {
    logMailFailure(purpose, err)
    return
  }
  if (!smtp) {
    await deliverToSink(msg).catch((err) => logMailFailure(purpose, err))
    return
  }
  const cfg = smtp
  const sending = (async () => {
    await sendViaSmtp(cfg, { ...msg, from: msg.from ?? (await defaultSender()) })
  })()
    .catch((err) => logMailFailure(purpose, err))
    .finally(() => pendingMail.delete(sending))
  pendingMail.add(sending)
}

/** Wait for every send started by deliverWithoutWaiting to settle (tests). */
export async function flushPendingMail(): Promise<void> {
  while (pendingMail.size) await Promise.all([...pendingMail])
}

// The dev transport: the local mailbox.
async function deliverToSink(msg: MailMessage): Promise<void> {
  const from = msg.from ?? (await defaultSender())
  await sql`
    insert into email_sink ${sql({
      row_id: id(),
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

// EML-001: send immediately (used for "send a test mail" and `cli mail:test`).
// A delivery failure is thrown to the operator who asked for the test.
export async function sendTestEmail(to: string): Promise<void> {
  const from = await defaultSender()
  await deliverEmail({
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
      row_id: name,
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
registerJob('send_email', async (payload, ctx) => {
  const queueName = String(payload.queue ?? '')
  // Claim the row: only deliver if still queued (idempotent under retries).
  const [row] = await sql`
    update email_queue set send_status = 'sent', updated_at = now()
    where row_id = ${queueName} and send_status = 'queued'
    returning *`
  if (!row) return // already delivered or missing — no double-send
  try {
    const opts = (row.attachments as { render?: boolean; attach_pdf?: boolean; print_format?: string; files?: Attachment[] } | null) ?? {}
    const refTable = (row.ref_table as string) ?? undefined
    const refName = (row.reference_name as string) ?? undefined
    let subject = (row.subject as string) ?? ''
    let body = (row.body as string) ?? ''
    const attachments: Attachment[] = [...(opts.files ?? [])]

    // #432: the queued row outlives its Table. An email about a row of a
    // Table that was deleted (or re-created under the same name) after
    // queueing is not sent, whether or not it renders that row.
    // Compared in SQL: a JS Date drops the microseconds both stamps carry.
    if (refTable) {
      const [current] = await sql`
        select 1 from table_def td join email_queue q on q.ref_table = td.name
        where q.row_id = ${queueName} and td.created_at <= q.created_at`
      if (!current)
        throw new Error(`${refTable} was deleted after this email was queued; it was not sent`)
    }

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

    await deliverEmail({
      to: row.recipient as string,
      from: row.sender as string,
      subject,
      body,
      ref_table: refTable,
      reference_name: refName,
      attachments,
    })
  } catch (err) {
    if (err instanceof MailDeliveryError) logMailFailure('queued_email', err)
    // A transient failure hands the row back to the job's retry, unless this
    // was the job's last attempt; anything else is final.
    let status = 'error'
    if (err instanceof MailDeliveryError && err.transient) {
      const [job] = await sql`select attempts, max_attempts from background_job where row_id = ${ctx.job.row_id}`
      if (job && Number(job.attempts) + 1 < Number(job.max_attempts)) status = 'queued'
    }
    await sql`
      update email_queue set send_status = ${status}, error = ${
        err instanceof Error ? err.message : String(err)
      }, updated_at = now() where row_id = ${queueName}`
    throw err
  }
})

export function assertRecipient(to: string | undefined): asserts to is string {
  if (!to) throw new AppError('ValidationError', 'Expected a recipient', { to: 'Required' })
}

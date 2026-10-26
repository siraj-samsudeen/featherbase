import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SMTPServer, type SMTPServerOptions } from 'smtp-server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { test } from './pg-test'
import { runMain } from './command-io'
import { main as cliMain } from '../src/cli'
import { sql } from '../src/db'
import { drainJobs, loadJobs } from '../src/jobs'
import {
  _setSmtpTestOverrides,
  flushPendingMail,
  queueEmail,
  readSmtpConfig,
  sendTestEmail,
  sendViaSmtp,
  smtpTransportOptions,
  type MailDeliveryError,
} from '../src/email'
import { requestPasswordReset } from '../src/password-reset'

// #395: when SMTP_HOST is set, outbound mail leaves through a real SMTP
// server instead of the Email Sink. These tests run a real SMTP server
// in-process on a random local port (smtp-server), so the socket, the
// STARTTLS upgrade and the AUTH exchange are all exercised for real.

// Every session must upgrade to TLS (#395), so the test server offers
// STARTTLS with a throwaway self-signed certificate for 127.0.0.1. The
// in-process sends trust it through a test-only override that is never read
// from the environment; the CLI subprocess trusts it through Node's own
// NODE_EXTRA_CA_CERTS.
let certDir = ''
let key = ''
let cert = ''
beforeAll(() => {
  certDir = mkdtempSync(path.join(tmpdir(), 'fb-smtp-'))
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
    '-keyout', path.join(certDir, 'key.pem'), '-out', path.join(certDir, 'cert.pem'),
  ], { stdio: 'ignore' })
  key = readFileSync(path.join(certDir, 'key.pem'), 'utf8')
  cert = readFileSync(path.join(certDir, 'cert.pem'), 'utf8')
  _setSmtpTestOverrides({ tls: { ca: cert } })
})
afterAll(() => {
  _setSmtpTestOverrides(null)
  rmSync(certDir, { recursive: true, force: true })
})

interface Received {
  from: string
  to: string[]
  data: string
  secure: boolean
  user?: string
}

// `rcptCode` makes the server refuse every recipient with that SMTP reply
// (451 = try again later, 550 = refused for good).
async function startSmtp(opts: Partial<SMTPServerOptions> = {}, rcptCode?: number) {
  const received: Received[] = []
  const authAttempts: string[] = []
  const server = new SMTPServer({
    authOptional: true,
    key,
    cert,
    logger: false,
    onAuth(auth, _session, cb) {
      authAttempts.push(auth.username ?? '')
      if (auth.username === 'relay-user' && auth.password === 'app-password-xyz') cb(null, { user: auth.username })
      else cb(new Error('Invalid credentials'))
    },
    onRcptTo(_address, _session, cb) {
      if (!rcptCode) return cb()
      const err = new Error(rcptCode >= 500 ? 'Mailbox unavailable' : 'Try again later') as Error & { responseCode: number }
      err.responseCode = rcptCode
      cb(err)
    },
    onData(stream, session, cb) {
      const chunks: Buffer[] = []
      stream.on('data', (c: Buffer) => chunks.push(c))
      stream.on('end', () => {
        received.push({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
          to: session.envelope.rcptTo.map((r) => r.address),
          data: Buffer.concat(chunks).toString('utf8'),
          secure: session.secure,
          user: session.user as string | undefined,
        })
        cb()
      })
    },
    ...opts,
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.server.address() as AddressInfo).port
  return {
    port,
    received,
    authAttempts,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

// The raw message as text, with quoted-printable soft breaks and escapes
// undone (nodemailer wraps long lines such as a reset link).
function decoded(data: string): string {
  return data.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
}

// A port nothing listens on: bind, read the port, release it.
async function closedPort(): Promise<number> {
  const s = createServer()
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve))
  const port = (s.address() as AddressInfo).port
  await new Promise<void>((resolve) => s.close(() => resolve()))
  return port
}

const SMTP_VARS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM', 'SMTP_NAME'] as const
const saved: Record<string, string | undefined> = {}
function setSmtpEnv(vars: Partial<Record<(typeof SMTP_VARS)[number], string>>) {
  for (const k of SMTP_VARS) {
    if (!(k in saved)) saved[k] = process.env[k]
    if (vars[k] === undefined) delete process.env[k]
    else process.env[k] = vars[k]
  }
}
afterEach(() => {
  for (const k of SMTP_VARS) {
    if (!(k in saved)) continue
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
    delete saved[k]
  }
  vi.restoreAllMocks()
})

// A relay that greets like Google's smtp-relay.gmail.com: an EHLO name that
// is not a fully qualified domain (nodemailer's `[127.0.0.1]` fallback when
// the container hostname has no dot) gets `421 4.7.0 ... (EHLO)` and a closed
// connection. Records each EHLO name it was given; never accepts mail.
async function startEhloStrictRelay() {
  const names: string[] = []
  const server = createServer((sock) => {
    sock.write('220 relay.example.test ESMTP ready\r\n')
    sock.on('data', (buf) => {
      const line = buf.toString('utf8').trim()
      const m = /^EHLO (.+)$/i.exec(line)
      if (!m) return void sock.end('221 bye\r\n')
      names.push(m[1])
      if (/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(m[1])) sock.end('554 5.7.0 accepted the name; this test relay stops here\r\n')
      else sock.end('421 4.7.0 Try again later, closing connection. (EHLO) a1-test.0 - gsmtp\r\n')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    port: (server.address() as AddressInfo).port,
    names,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

const FROM = 'Feather Dash <noreply@jeyarama.test>'

describe('EHLO name: never the container hostname', () => {
  const name = (env: Record<string, string>) => readSmtpConfig({ SMTP_HOST: 'h', ...env })!.name

  test('SMTP_NAME wins, then the MAIL_FROM domain, then the host of the address marked for emails', () => {
    const INSTANCE_ADDRESSES = JSON.stringify([
      { address: 'https://admin.example.test', opens: 'admin' },
      { address: 'https://dash.example.test:8443', opens: 'feather_dash', emails: true },
    ])
    expect(name({ SMTP_NAME: 'mail.jeyarama.com', MAIL_FROM: FROM, INSTANCE_ADDRESSES })).toBe('mail.jeyarama.com')
    expect(name({ MAIL_FROM: 'Feather Dash <noreply@Jeyarama.COM>', INSTANCE_ADDRESSES })).toBe('jeyarama.com')
    expect(name({ MAIL_FROM: 'noreply@jeyarama.com' })).toBe('jeyarama.com')
    expect(name({ INSTANCE_ADDRESSES })).toBe('dash.example.test')
  })

  test('with none of them, the sender address supplies it at send time; it is never left to nodemailer', () => {
    expect(name({})).toBeUndefined()
    expect(smtpTransportOptions({ host: 'h', port: 587, name: 'jeyarama.com' }).name).toBe('jeyarama.com')
  })

  test('an INSTANCE_ADDRESSES that cannot be read offers no name rather than failing the send', () => {
    expect(name({ INSTANCE_ADDRESSES: 'not a list' })).toBeUndefined()
  })

  test('an SMTP_NAME that is not a hostname is a configuration error', () => {
    for (const bad of ['jeyarama.com\r\nRCPT TO:<x@y>', 'has space.com', 'under_score.com'])
      expect(() => readSmtpConfig({ SMTP_HOST: 'h', SMTP_NAME: bad })).toThrow(
        expect.objectContaining({ code: 'ECONFIG', message: expect.stringMatching(/SMTP_NAME/) }),
      )
  })

  test('a relay that refuses a non-FQDN EHLO accepts the MAIL_FROM domain', async () => {
    const relay = await startEhloStrictRelay()
    try {
      const cfg = readSmtpConfig({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(relay.port), MAIL_FROM: FROM })!
      // The relay stops after EHLO either way; what matters is which reply.
      await expect(sendViaSmtp(cfg, { to: 'ops@example.test', subject: 's', body: 'b' })).rejects.not.toMatchObject({ responseCode: 421 })
      expect(relay.names).toEqual(['jeyarama.test'])
    } finally {
      await relay.close()
    }
  })

  test('without a name, the Email Account sender domain is used, not the hostname fallback', async () => {
    const relay = await startEhloStrictRelay()
    try {
      const cfg = readSmtpConfig({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(relay.port) })!
      await sendViaSmtp(cfg, { to: 'ops@example.test', from: 'helpdesk@jeyarama.test', subject: 's', body: 'b' }).catch(() => {})
      expect(relay.names).toEqual(['jeyarama.test'])
    } finally {
      await relay.close()
    }
  })

  test("the failure carries the relay's reply text, outside the stored message", async () => {
    const relay = await startEhloStrictRelay()
    try {
      // An explicit dotless name reproduces what the container hostname did.
      const cfg = readSmtpConfig({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(relay.port), MAIL_FROM: FROM, SMTP_NAME: 'a1b2c3d4' })!
      const err = await sendViaSmtp(cfg, { to: 'ops@example.test', subject: 's', body: 'b' }).catch((e: unknown) => e)
      expect(err).toMatchObject({ code: 'ECONNECTION', responseCode: 421, message: 'Mail delivery failed (ECONNECTION 421)' })
      expect((err as MailDeliveryError).serverReply).toBe('421 4.7.0 Try again later, closing connection. (EHLO) a1-test.0 - gsmtp')
      expect(Object.keys(err as object)).not.toContain('serverReply')
    } finally {
      await relay.close()
    }
  })
})

describe('#395: transport selection and options', () => {
  test('no SMTP_HOST means no SMTP config, so the sink stays the transport', () => {
    expect(readSmtpConfig({})).toBeNull()
    expect(readSmtpConfig({ SMTP_HOST: '  ' })).toBeNull()
  })

  test('port 587 requires STARTTLS; credentials become AUTH', () => {
    const cfg = readSmtpConfig({
      SMTP_HOST: 'smtp-relay.gmail.com',
      SMTP_USER: 'relay@example.test',
      SMTP_PASSWORD: 'secret',
      MAIL_FROM: FROM,
    })
    expect(cfg).toMatchObject({ host: 'smtp-relay.gmail.com', port: 587, from: FROM })
    const opts = smtpTransportOptions(cfg!)
    expect(opts).toMatchObject({ host: 'smtp-relay.gmail.com', port: 587, secure: false, requireTLS: true })
    expect(opts.auth).toEqual({ user: 'relay@example.test', pass: 'secret' })
  })

  test('port 587 requires STARTTLS even without credentials', () => {
    const opts = smtpTransportOptions(readSmtpConfig({ SMTP_HOST: 'h', SMTP_PORT: '587' })!)
    expect(opts).toMatchObject({ secure: false, requireTLS: true })
    expect(opts.auth).toBeUndefined()
  })

  test('port 465 is implicit TLS', () => {
    expect(smtpTransportOptions(readSmtpConfig({ SMTP_HOST: 'h', SMTP_PORT: '465' })!)).toMatchObject({
      secure: true,
    })
  })

  test('every port but 465 requires STARTTLS, with or without credentials', () => {
    expect(smtpTransportOptions(readSmtpConfig({ SMTP_HOST: 'h', SMTP_PORT: '2525' })!)).toMatchObject({
      secure: false,
      requireTLS: true,
    })
    expect(smtpTransportOptions(readSmtpConfig({ SMTP_HOST: 'h', SMTP_PORT: '25' })!)).toMatchObject({
      requireTLS: true,
    })
  })

  test('a password is never sent without TLS, whatever the port', () => {
    const opts = smtpTransportOptions(
      readSmtpConfig({ SMTP_HOST: 'h', SMTP_PORT: '2525', SMTP_USER: 'u', SMTP_PASSWORD: 'p' })!,
    )
    expect(opts).toMatchObject({ requireTLS: true })
  })

  test('a non-numeric port is a configuration error', () => {
    expect(() => readSmtpConfig({ SMTP_HOST: 'h', SMTP_PORT: 'abc' })).toThrow(/SMTP_PORT/)
    expect(() => readSmtpConfig({ SMTP_HOST: 'h', SMTP_PORT: 'abc' })).toThrow(expect.objectContaining({ code: 'ECONFIG' }))
  })

  test('a user without a password is a configuration error', () => {
    expect(() => readSmtpConfig({ SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASSWORD: '' })).toThrow(
      expect.objectContaining({ code: 'ECONFIG', message: expect.stringMatching(/SMTP_PASSWORD/) }),
    )
  })

  test("Google's grouped app password loses its spaces; any other password is kept verbatim", () => {
    const pw = (p: string) => readSmtpConfig({ SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASSWORD: p })!.password
    expect(pw('abcd EFGH ijkl mnop')).toBe('abcdEFGHijklmnop')
    expect(pw(' pass word ')).toBe(' pass word ')
    expect(pw('abcd efgh ijkl')).toBe('abcd efgh ijkl')
  })

  test('no MAIL_FROM and no sender is a configuration error', async () => {
    const cfg = readSmtpConfig({ SMTP_HOST: '127.0.0.1', SMTP_PORT: '2525' })!
    await expect(sendViaSmtp(cfg, { to: 'a@example.test', subject: 's', body: 'b' })).rejects.toMatchObject({
      code: 'ECONFIG',
    })
  })
})

// Sandbox clock shim (see email.test.ts): make jobs due by the transaction
// clock, then drain.
async function drainDue(limit?: number) {
  await sql`
    update background_job set run_at = now()
    where job_status = 'queued' and run_at > now() and run_at <= clock_timestamp()`
  return await drainJobs(limit)
}

describe('#395: delivery through a real SMTP server', () => {
  async function setupAccount() {
    await sql`delete from email_sink`
    await sql`delete from email_queue`
  }

  test('a test email goes to the SMTP server from MAIL_FROM, not to the sink', async () => {
    await setupAccount()
    const smtp = await startSmtp()
    try {
      setSmtpEnv({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), MAIL_FROM: FROM })
      await sendTestEmail('ops@example.test')
      expect(smtp.received).toHaveLength(1)
      expect(smtp.received[0]).toMatchObject({ from: 'noreply@jeyarama.test', to: ['ops@example.test'], secure: true })
      expect(smtp.received[0].data).toContain('Subject: Test email from Featherbase')
      expect(smtp.received[0].data).toContain('From: Feather Dash <noreply@jeyarama.test>')
      expect(await sql`select 1 from email_sink`).toHaveLength(0)
    } finally {
      await smtp.close()
    }
  })

  test('when MAIL_FROM replaces a different sender, replies still go to that sender', async () => {
    await setupAccount()
    await sql`delete from email_account where row_id = 'Smtp Reply Account'`
    await sql`
      insert into email_account ${sql({
        row_id: 'Smtp Reply Account',
        created_by: 'Administrator',
        updated_by: 'Administrator',
        email_id: 'helpdesk@jeyarama.test',
        is_default: true,
      })}`
    const smtp = await startSmtp()
    try {
      setSmtpEnv({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), MAIL_FROM: FROM })
      await sendTestEmail('ops@example.test')
      expect(smtp.received[0].from).toBe('noreply@jeyarama.test')
      expect(smtp.received[0].data).toContain('Reply-To: helpdesk@jeyarama.test')
    } finally {
      await smtp.close()
    }
  })

  test('no Reply-To when the sender is MAIL_FROM itself', async () => {
    await setupAccount()
    const smtp = await startSmtp()
    try {
      setSmtpEnv({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), MAIL_FROM: FROM })
      await queueEmail({ to: 'x@example.test', subject: 's', body: 'b', from: 'NOREPLY@jeyarama.test' })
      await loadJobs()
      await drainDue()
      expect(smtp.received).toHaveLength(1)
      expect(smtp.received[0].data).not.toContain('Reply-To:')
    } finally {
      await smtp.close()
    }
  })

  test('a queued email is delivered over SMTP by the job and marked sent', async () => {
    await loadJobs()
    await setupAccount()
    const smtp = await startSmtp()
    try {
      setSmtpEnv({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), MAIL_FROM: FROM })
      const name = await queueEmail({ to: 'queued@example.test', subject: 'Queued hello', body: 'Body text' })
      await sql`
        update background_job set run_at = now()
        where job_status = 'queued' and run_at > now() and run_at <= clock_timestamp()`
      await drainJobs()
      const [row] = await sql`select send_status from email_queue where row_id = ${name}`
      expect(row.send_status).toBe('sent')
      expect(smtp.received).toHaveLength(1)
      expect(smtp.received[0].to).toEqual(['queued@example.test'])
      expect(smtp.received[0].data).toContain('Body text')
    } finally {
      await smtp.close()
    }
  })

  test('an attachment on a queued email arrives with it at the real inbox', async () => {
    await loadJobs()
    await setupAccount()
    const smtp = await startSmtp()
    try {
      setSmtpEnv({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), MAIL_FROM: FROM })
      const csv = 'title,qty\nWasher,3'
      await queueEmail({
        to: 'reports@example.test',
        subject: 'Report',
        body: 'Attached.',
        attachments: [{ filename: 'stock.csv', content_b64: Buffer.from(csv).toString('base64') }],
      })
      await sql`
        update background_job set run_at = now()
        where job_status = 'queued' and run_at > now() and run_at <= clock_timestamp()`
      await drainJobs()
      expect(smtp.received).toHaveLength(1)
      expect(smtp.received[0].data).toContain('filename=stock.csv')
      expect(smtp.received[0].data).toContain(Buffer.from(csv).toString('base64'))
    } finally {
      await smtp.close()
    }
  })

  async function queueOne(to: string) {
    await loadJobs()
    await setupAccount()
    return await queueEmail({ to, subject: 's', body: 'b' })
  }
  const statusOf = async (name: string) =>
    (await sql`select send_status, error from email_queue where row_id = ${name}`)[0] as { send_status: string; error: string }

  test('an unreachable server is transient: the row goes back to queued for the retry, with no address in the error', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    setSmtpEnv({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(await closedPort()), MAIL_FROM: FROM })
    const name = await queueOne('lost@example.test')
    await drainDue(1) // one attempt; the job retries at once, so a full drain would use all three
    const row = await statusOf(name)
    expect(row.send_status).toBe('queued')
    expect(row.error).toMatch(/Mail delivery failed/)
    expect(row.error).not.toContain('lost@example.test')
    const [job] = await sql`select job_status from background_job where method = 'send_email' and payload->>'queue' = ${name}`
    expect(job.job_status).toBe('queued')
    const logged = errors.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
    expect(logged).toContain('mail_delivery_failed')
    expect(logged).not.toContain('lost@example.test')
  })

  test('a 4xx reply is transient and the retry delivers it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const busy = await startSmtp({}, 451)
    let name = ''
    try {
      setSmtpEnv({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(busy.port), MAIL_FROM: FROM })
      name = await queueOne('later@example.test')
      await drainDue(1)
      expect(await statusOf(name)).toMatchObject({ send_status: 'queued', error: 'Mail delivery failed (EENVELOPE 451)' })
    } finally {
      await busy.close()
    }
    const ok = await startSmtp()
    try {
      setSmtpEnv({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(ok.port), MAIL_FROM: FROM })
      await sql`update background_job set run_at = now() where method = 'send_email' and payload->>'queue' = ${name}`
      await drainDue()
      expect((await statusOf(name)).send_status).toBe('sent')
      expect(ok.received).toHaveLength(1)
    } finally {
      await ok.close()
    }
  })

  test('a 5xx reply is permanent: the row is marked error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const smtp = await startSmtp({}, 550)
    try {
      setSmtpEnv({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), MAIL_FROM: FROM })
      const name = await queueOne('gone@example.test')
      await drainDue()
      expect(await statusOf(name)).toMatchObject({ send_status: 'error', error: 'Mail delivery failed (EENVELOPE 550)' })
    } finally {
      await smtp.close()
    }
  })

  test("a transient failure on the job's last attempt is marked error, never left queued", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setSmtpEnv({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(await closedPort()), MAIL_FROM: FROM })
    const name = await queueOne('last@example.test')
    await sql`update background_job set max_attempts = 1 where method = 'send_email' and payload->>'queue' = ${name}`
    await drainDue()
    expect((await statusOf(name)).send_status).toBe('error')
  })

  test('without credentials, a server that does not offer STARTTLS is refused before any mail', async () => {
    const smtp = await startSmtp({ disabledCommands: ['STARTTLS'] })
    try {
      setSmtpEnv({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), MAIL_FROM: FROM })
      await expect(sendTestEmail('ops@example.test')).rejects.toMatchObject({ type: 'ServiceUnavailableError' })
      expect(smtp.received).toHaveLength(0)
    } finally {
      await smtp.close()
    }
  })

  test('with credentials set, a server that does not offer STARTTLS is refused before AUTH', async () => {
    const smtp = await startSmtp({ disabledCommands: ['STARTTLS'] })
    try {
      setSmtpEnv({
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: String(smtp.port),
        SMTP_USER: 'relay-user',
        SMTP_PASSWORD: 'app-password-xyz',
        MAIL_FROM: FROM,
      })
      const err = await sendTestEmail('ops@example.test').catch((e: unknown) => e)
      expect(err).toMatchObject({ type: 'ServiceUnavailableError' })
      const msg = (err as Error).message
      expect(msg).toMatch(/Mail delivery failed/)
      expect(msg).not.toContain('ops@example.test')
      expect(msg).not.toContain('app-password-xyz')
      expect(smtp.authAttempts).toHaveLength(0)
      expect(smtp.received).toHaveLength(0)
    } finally {
      await smtp.close()
    }
  })
})

describe('#395: password reset over SMTP', () => {
  const USER = 'pwreset-smtp@example.test'

  async function setup(admin: { post: (p: string, b: unknown) => Promise<unknown> }) {
    const { row_id } = (await admin.post('/api/save_row', {
      table: 'Person',
      row: { email: USER, full_name: 'Reset Smtp', enabled: true },
    })) as { row_id: string }
    await admin.post('/api/set_password', { user: row_id, password: 'origpw123' })
  }

  test('the reset link is mailed through the SMTP server', async ({ admin }) => {
    await setup(admin)
    const smtp = await startSmtp()
    try {
      setSmtpEnv({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), MAIL_FROM: FROM })
      const token = await requestPasswordReset(USER)
      await flushPendingMail()
      expect(smtp.received).toHaveLength(1)
      expect(smtp.received[0].to).toEqual([USER])
      expect(decoded(smtp.received[0].data)).toContain(`key=${token}`)
    } finally {
      await smtp.close()
    }
  })

  test('a failed send still answers like a sent one, and logs a structured error with no address, key or secret', async ({
    admin,
  }) => {
    await setup(admin)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    setSmtpEnv({
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(await closedPort()),
      SMTP_USER: 'relay-user',
      SMTP_PASSWORD: 'app-password-xyz',
      MAIL_FROM: FROM,
    })
    const token = await requestPasswordReset(USER)
    expect(token).toMatch(/^[0-9a-f]{48}$/)
    await flushPendingMail()

    expect(errors).toHaveBeenCalledTimes(1)
    const line = String(errors.mock.calls[0][0])
    const entry = JSON.parse(line)
    expect(entry).toMatchObject({ level: 'error', event: 'mail_delivery_failed', purpose: 'password_reset' })
    expect(entry.code).toEqual(expect.any(String))
    for (const secret of [USER, token as string, 'app-password-xyz', 'relay-user', 'Reset your password'])
      expect(line).not.toContain(secret)
  })

  test('the public route still answers ok when the send fails', async ({ admin, api }) => {
    await setup(admin)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    setSmtpEnv({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(await closedPort()), MAIL_FROM: FROM })
    await expect(api.post('/api/reset_password_request', { usr: USER })).resolves.toEqual({ ok: true })
    await flushPendingMail()
    expect(errors).toHaveBeenCalledTimes(1)
  })

  test('the request does not wait for the SMTP server, so its timing says nothing about the account', async ({
    admin,
  }) => {
    await setup(admin)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // A server that accepts the connection and never says a word.
    const sockets: import('node:net').Socket[] = []
    const silent = createServer((sock) => sockets.push(sock))
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve))
    try {
      setSmtpEnv({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String((silent.address() as AddressInfo).port), MAIL_FROM: FROM })
      const started = Date.now()
      await requestPasswordReset(USER)
      expect(Date.now() - started).toBeLessThan(2_000)
    } finally {
      for (const sock of sockets) sock.destroy()
      await new Promise<void>((resolve) => silent.close(() => resolve()))
      await flushPendingMail()
    }
  })

  test('a configuration error is logged as ECONFIG and the request still succeeds', async ({ admin }) => {
    await setup(admin)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    setSmtpEnv({ SMTP_HOST: '127.0.0.1', SMTP_PORT: '2525', SMTP_USER: 'relay-user', MAIL_FROM: FROM })
    await expect(requestPasswordReset(USER)).resolves.toMatch(/^[0-9a-f]{48}$/)
    await flushPendingMail()
    expect(errors).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(errors.mock.calls[0][0]))).toMatchObject({ code: 'ECONFIG', purpose: 'password_reset' })
  })
})

// The STARTTLS upgrade with a verified certificate, without the suite-wide
// trust override: the certificate is passed (or withheld) explicitly.
describe('#395: STARTTLS + AUTH on a real socket', () => {
  test('upgrades to TLS, authenticates and delivers', async () => {
    const smtp = await startSmtp({ authOptional: false })
    try {
      const cfg = readSmtpConfig({
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: String(smtp.port),
        SMTP_USER: 'relay-user',
        SMTP_PASSWORD: 'app-password-xyz',
        MAIL_FROM: FROM,
      })!
      await sendViaSmtp({ ...cfg, tls: { ca: cert } }, { to: 'ops@example.test', subject: 'tls hello', body: 'b' })
      expect(smtp.received).toHaveLength(1)
      expect(smtp.received[0]).toMatchObject({ secure: true, user: 'relay-user', to: ['ops@example.test'] })
    } finally {
      await smtp.close()
    }
  })

  test('an untrusted certificate is refused', async () => {
    const smtp = await startSmtp({ authOptional: false })
    try {
      const cfg = readSmtpConfig({
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: String(smtp.port),
        SMTP_USER: 'relay-user',
        SMTP_PASSWORD: 'app-password-xyz',
        MAIL_FROM: FROM,
      })!
      await expect(sendViaSmtp(cfg, { to: 'ops@example.test', subject: 's', body: 'b' })).rejects.toMatchObject({
        type: 'ServiceUnavailableError',
      })
      expect(smtp.authAttempts).toHaveLength(0)
      expect(smtp.received).toHaveLength(0)
    } finally {
      await smtp.close()
    }
  })
})

// `cli mail:test <to>`: the operator's one-message check of a deployment's
// mail settings, run in this process through the CLI's main (ADR 0012); the
// test certificate is trusted through the same override as the sends above.
describe('#395: cli mail:test', () => {
  // The CLI's result in the shape of a process's: stdout on success, or a
  // rejection carrying the exit code and stderr.
  const run = async (args: string[], env: Partial<Record<(typeof SMTP_VARS)[number], string>>) => {
    setSmtpEnv(env)
    const r = await runMain(cliMain, args)
    if (r.code !== 0) throw { code: r.code, stdout: r.stdout, stderr: r.stderr }
    return { stdout: r.stdout, stderr: r.stderr }
  }

  it('sends one test message through the configured SMTP server', async () => {
    const smtp = await startSmtp()
    try {
      const { stdout } = await run(['mail:test', 'ops@example.test'], {
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: String(smtp.port),
        MAIL_FROM: FROM,
      })
      expect(stdout).toMatch(/sent a test message via SMTP 127\.0\.0\.1:\d+/)
      expect(stdout).not.toContain('ops@example.test')
      expect(smtp.received).toHaveLength(1)
      expect(smtp.received[0].to).toEqual(['ops@example.test'])
    } finally {
      await smtp.close()
    }
  })

  it('fails with a non-zero exit and a safe message when the server is unreachable', async () => {
    const err = (await run(['mail:test', 'ops@example.test'], {
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(await closedPort()),
      MAIL_FROM: FROM,
    }).catch((e: unknown) => e)) as { code?: number; stderr?: string }
    expect(err.code).toBe(1)
    expect(err.stderr).toMatch(/Mail delivery failed \(E[A-Z]+\)/)
    expect(err.stderr).not.toContain('ops@example.test')
  })

  it("prints the relay's reply line on failure, with the recipient and credentials masked", async () => {
    const smtp = await startSmtp({ authOptional: false })
    try {
      const err = (await run(['mail:test', 'ops@example.test'], {
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: String(smtp.port),
        SMTP_USER: 'relay-user',
        SMTP_PASSWORD: 'wrong-password-123',
        MAIL_FROM: FROM,
      }).catch((e: unknown) => e)) as { code?: number; stderr?: string }
      expect(err.code).toBe(1)
      expect(err.stderr).toMatch(/Mail delivery failed \(EAUTH 535\)/)
      expect(err.stderr).toMatch(/server reply: 535 /)
      for (const secret of ['ops@example.test', 'wrong-password-123']) expect(err.stderr).not.toContain(secret)
    } finally {
      await smtp.close()
    }
  })

  it('masks every address the relay echoes, however the recipient was written', async () => {
    const smtp = await startSmtp({
      onRcptTo(address, _session, cb) {
        const err = new Error(`5.1.1 <${address.address}> mailbox unavailable`) as Error & { responseCode: number }
        err.responseCode = 550
        cb(err)
      },
    })
    try {
      const err = (await run(['mail:test', 'Ops <Ops@Example.test>, second@example.test'], {
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: String(smtp.port),
        MAIL_FROM: FROM,
      }).catch((e: unknown) => e)) as { code?: number; stderr?: string }
      expect(err.code).toBe(1)
      expect(err.stderr).toContain('server reply: 550 5.1.1 <[address]> mailbox unavailable')
      for (const a of ['ops@example.test', 'second@example.test']) expect(err.stderr?.toLowerCase()).not.toContain(a)
    } finally {
      await smtp.close()
    }
  })

  it('prints a 421 EHLO refusal in full', async () => {
    const relay = await startEhloStrictRelay()
    try {
      const err = (await run(['mail:test', 'ops@example.test'], {
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: String(relay.port),
        MAIL_FROM: FROM,
        SMTP_NAME: 'a1b2c3d4',
      }).catch((e: unknown) => e)) as { code?: number; stderr?: string }
      expect(err.code).toBe(1)
      expect(err.stderr).toContain('Mail delivery failed (ECONNECTION 421)')
      expect(err.stderr).toContain('server reply: 421 4.7.0 Try again later, closing connection. (EHLO)')
    } finally {
      await relay.close()
    }
  })

  test('with SMTP_HOST unset, sends to the Email Sink and says so', async () => {
    const { stdout } = await run(['mail:test', 'ops@example.test'], {})
    expect(stdout).toBe('mail:test: SMTP_HOST is unset; the test message went to the Email Sink\n')
  })

  it('needs a recipient', async () => {
    const err = (await run(['mail:test'], {}).catch((e: unknown) => e)) as { code?: number; stderr?: string }
    expect(err.code).toBe(1)
    expect(err.stderr).toMatch(/usage: cli mail:test <to>/)
  })
})

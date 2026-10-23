import { execFile, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SMTPServer, type SMTPServerOptions } from 'smtp-server'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { drainJobs, loadJobs } from '../src/jobs'
import {
  queueEmail,
  readSmtpConfig,
  sendTestEmail,
  sendViaSmtp,
  smtpTransportOptions,
} from '../src/email'
import { requestPasswordReset } from '../src/password-reset'

// #395: when SMTP_HOST is set, outbound mail leaves through a real SMTP
// server instead of the Email Sink. These tests run a real SMTP server
// in-process on a random local port (smtp-server), so the socket, the
// STARTTLS upgrade and the AUTH exchange are all exercised for real.

interface Received {
  from: string
  to: string[]
  data: string
  secure: boolean
  user?: string
}

async function startSmtp(opts: Partial<SMTPServerOptions> = {}) {
  const received: Received[] = []
  const authAttempts: string[] = []
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    logger: false,
    onAuth(auth, _session, cb) {
      authAttempts.push(auth.username ?? '')
      if (auth.username === 'relay-user' && auth.password === 'app-password-xyz') cb(null, { user: auth.username })
      else cb(new Error('Invalid credentials'))
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

const SMTP_VARS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM'] as const
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

const FROM = 'Feather Dash <noreply@jeyarama.test>'

describe('#395: transport selection and options', () => {
  test('no SMTP_HOST means no SMTP config, so the sink stays the transport', () => {
    expect(readSmtpConfig({})).toBeNull()
    expect(readSmtpConfig({ SMTP_HOST: '  ' })).toBeNull()
  })

  test('port 587 requires STARTTLS; credentials become AUTH', () => {
    const cfg = readSmtpConfig({
      SMTP_HOST: 'smtp-relay.gmail.com',
      SMTP_USER: 'relay@jeyarama.com',
      SMTP_PASSWORD: 'secret',
      MAIL_FROM: FROM,
    })
    expect(cfg).toMatchObject({ host: 'smtp-relay.gmail.com', port: 587, from: FROM })
    const opts = smtpTransportOptions(cfg!)
    expect(opts).toMatchObject({ host: 'smtp-relay.gmail.com', port: 587, secure: false, requireTLS: true })
    expect(opts.auth).toEqual({ user: 'relay@jeyarama.com', pass: 'secret' })
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

  test('a password is never sent without TLS, whatever the port', () => {
    const opts = smtpTransportOptions(
      readSmtpConfig({ SMTP_HOST: 'h', SMTP_PORT: '2525', SMTP_USER: 'u', SMTP_PASSWORD: 'p' })!,
    )
    expect(opts).toMatchObject({ requireTLS: true })
  })

  test('a non-numeric port is refused', () => {
    expect(() => readSmtpConfig({ SMTP_HOST: 'h', SMTP_PORT: 'abc' })).toThrow(/SMTP_PORT/)
  })
})

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
      expect(smtp.received[0]).toMatchObject({ from: 'noreply@jeyarama.test', to: ['ops@example.test'] })
      expect(smtp.received[0].data).toContain('Subject: Test email from Featherbase')
      expect(smtp.received[0].data).toContain('From: Feather Dash <noreply@jeyarama.test>')
      expect(await sql`select 1 from email_sink`).toHaveLength(0)
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

  test('a failed queued email is marked error with no address in the error', async () => {
    await loadJobs()
    await setupAccount()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    setSmtpEnv({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(await closedPort()), MAIL_FROM: FROM })
    const name = await queueEmail({ to: 'lost@example.test', subject: 's', body: 'b' })
    await sql`
      update background_job set run_at = now()
      where job_status = 'queued' and run_at > now() and run_at <= clock_timestamp()`
    await drainJobs()
    const [row] = await sql`select send_status, error from email_queue where row_id = ${name}`
    expect(row.send_status).toBe('error')
    expect(String(row.error)).toMatch(/Mail delivery failed/)
    expect(String(row.error)).not.toContain('lost@example.test')
    const logged = errors.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
    expect(logged).toContain('mail_delivery_failed')
    expect(logged).not.toContain('lost@example.test')
  })

  test('with credentials set, a server that does not offer STARTTLS is refused before AUTH', async () => {
    const smtp = await startSmtp()
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
    expect(errors).toHaveBeenCalledTimes(1)
  })
})

// The STARTTLS upgrade with a verified certificate: a throwaway CA-less
// self-signed cert for 127.0.0.1, trusted by passing it as the client's CA.
describe('#395: STARTTLS + AUTH on a real socket', () => {
  let dir = ''
  let key = ''
  let cert = ''
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'fb-smtp-'))
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
      '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'),
    ], { stdio: 'ignore' })
    key = readFileSync(path.join(dir, 'key.pem'), 'utf8')
    cert = readFileSync(path.join(dir, 'cert.pem'), 'utf8')
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  test('upgrades to TLS, authenticates and delivers', async () => {
    const smtp = await startSmtp({ disabledCommands: [], authOptional: false, key, cert })
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
    const smtp = await startSmtp({ disabledCommands: [], authOptional: false, key, cert })
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
// mail settings. Spawned asynchronously so this process's SMTP server can
// answer while the CLI runs.
describe('#395: cli mail:test', () => {
  const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
  const run = (args: string[], env: Record<string, string>) =>
    promisify(execFile)(path.join(serverDir, 'node_modules', '.bin', 'tsx'), [path.join(serverDir, 'src', 'cli.ts'), ...args], {
      cwd: serverDir,
      timeout: 60_000,
      env: { ...process.env, SMTP_USER: '', SMTP_PASSWORD: '', ...env },
    })

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

  it('needs a recipient', async () => {
    const err = (await run(['mail:test'], {}).catch((e: unknown) => e)) as { code?: number; stderr?: string }
    expect(err.code).toBe(1)
    expect(err.stderr).toMatch(/usage: cli mail:test <to>/)
  })
})

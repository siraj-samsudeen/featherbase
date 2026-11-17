import { createHash, randomBytes } from 'node:crypto'
import { config } from './config'
import { sql, type TxSql } from './db'
import { AppError } from './errors'
import { setUserPassword } from './auth'
import { logActivity } from './audit'
import { deliverEmail, type MailMessage } from './email'
import { emailOrigin } from './instance-addresses'
import { getSystemSettings } from './settings'
import { isReservedEmail, methodOfKind } from './identities'
import { MIN_PASSWORD_LENGTH } from './password-reset'

// #1257: a password invite. A System Manager sends a person who has no way to
// sign in a one-time link; opening it sets their first password, and the
// accept route signs them in. "Forgot password" stays as it is (#137): it
// never gives a password to an account without one. The invite is the
// deliberate, administrator-approved path, and only for someone with no other
// way in, so an account that signs in through Google or the HR system is
// never given a password by it.

const INVITE_TTL_MS = 72 * 60 * 60 * 1000
/** How long one send may take before it counts as failed (as invitation-email). */
const SEND_DEADLINE_MS = 20_000

export const INVALID_INVITE = 'This invitation link is invalid or has expired'

const fingerprint = (key: string) => createHash('sha256').update(key).digest('hex')

let deliver: (msg: MailMessage) => Promise<void> = deliverEmail
/** Test-only: replace the transport (null restores it). */
export function _setPasswordInviteDeliveryForTests(fn: ((msg: MailMessage) => Promise<void>) | null): void {
  deliver = fn ?? deliverEmail
}

export type InviteStatus = 'sending' | 'pending' | 'expired' | 'accepted' | 'voided' | 'not_sent'

export interface InviteView {
  status: InviteStatus
  sent_at: string | null
  expires_at: string
  accepted_at: string | null
  invited_by: string
}

const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString())

function view(row: Record<string, unknown>): InviteView {
  const status: InviteStatus = row.accepted_at
    ? 'accepted'
    : row.voided_at && !row.sent_at
      ? 'not_sent'
      : row.voided_at || row.used_at
        ? 'voided'
        : !row.sent_at
          ? 'sending'
          : new Date(row.expires_at as string).getTime() <= Date.now()
            ? 'expired'
            : 'pending'
  return {
    status,
    sent_at: iso(row.sent_at),
    expires_at: iso(row.expires_at)!,
    accepted_at: iso(row.accepted_at),
    invited_by: row.invited_by as string,
  }
}

/** Why a person cannot be sent an invite, or null when they can. Read under
 *  the caller's transaction (and its lock on the person) when one is given. */
async function whyNot(person: string, db: TxSql | typeof sql = sql): Promise<string | null> {
  const [row] = await db`
    select p.enabled, p.email, (p.password_hash is not null) as has_password, p.expects_google_sign_in,
      exists (select 1 from sign_in_identity i where i.person_id = p.row_id and i.ended_at is null) as other_way
    from person p where p.row_id = ${person}`
  if (!row) throw new AppError('NotFoundError', `Person ${person} not found`)
  if (!row.enabled) return 'This person is disabled'
  if (row.has_password) return 'This person already has a password; they can use "Forgot password"'
  // #137: a password invite never adds a way in beside another method.
  if (row.other_way || row.expects_google_sign_in) return 'This person already signs in another way, so they are not given a password'
  const email = typeof row.email === 'string' ? row.email.trim() : ''
  if (!email || isReservedEmail(email)) return 'This person has no email address to send the invite to'
  const method = await methodOfKind('password')
  if (!method?.enabled) return 'Password sign-in is turned off'
  return null
}

/** What the Person's sign-in panel shows: whether an invite can be sent, why
 *  not, and the latest invite. */
export async function passwordInviteState(person: string): Promise<{ offered: boolean; refusal: string | null; latest: InviteView | null }> {
  const why = await whyNot(person)
  const [latest] = await sql`select * from password_invite where person = ${person} order by created_at desc, id desc limit 1`
  return { offered: why === null, refusal: why, latest: latest ? view(latest) : null }
}

async function inviterName(actor: string): Promise<string> {
  const [row] = await sql`select full_name from person where row_id = ${actor}`
  const name = typeof row?.full_name === 'string' ? row.full_name.trim() : ''
  return name || 'An administrator'
}

function failureCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'string' && /^[A-Z_]{2,32}$/.test(code) ? code : 'EUNKNOWN'
}

/**
 * Send (or send again) a person's password invite. Every earlier link of
 * theirs not yet used is voided in the same transaction that makes the new
 * one. The send is awaited, since the administrator is told whether it went;
 * a send that fails voids its link (nobody holds it) and is the answer.
 */
export async function sendPasswordInvite(person: string, actor: string, requestOrigin?: string): Promise<InviteView> {
  // #488: the address marked for emails; the request's own origin only for a
  // development or test server with no list.
  const origin = emailOrigin(config.instanceAddresses, config.environment, requestOrigin)
  if (!origin) throw new AppError('ServiceUnavailableError', "The invite was not sent: this instance's addresses (INSTANCE_ADDRESSES) are not set")

  const key = randomBytes(24).toString('hex')
  const invite = await sql.begin(async (tx) => {
    const t = tx as unknown as TxSql
    // The person's row lock orders this against a concurrent send, accept,
    // email change or password write.
    await t`select 1 from person where row_id = ${person} for update`
    const why = await whyNot(person, t)
    if (why) throw new AppError('ValidationError', why)
    await t`update password_invite set voided_at = now() where person = ${person} and used_at is null and voided_at is null`
    const [row] = await t`insert into password_invite ${sql({
      id: 'pwi_' + randomBytes(9).toString('hex'),
      person,
      token_hash: fingerprint(key),
      invited_by: actor,
      // The clock, not the transaction's start: the newest invite is the latest.
      created_at: new Date(),
      expires_at: new Date(Date.now() + INVITE_TTL_MS),
    })} returning *`
    const [p] = await t`select email, full_name from person where row_id = ${person}`
    return { row, email: String(p.email).trim(), name: typeof p.full_name === 'string' ? p.full_name.trim() : '' }
  })

  const settings = await getSystemSettings()
  const oneLine = (v: string) => v.replace(/[\r\n]+/g, ' ').trim()
  const link = `${origin.replace(/\/+$/, '')}/featherbase/set-password?key=${key}`
  const message: MailMessage = {
    to: invite.email,
    subject: 'Set your password',
    body: [
      invite.name ? `Hello ${oneLine(invite.name)},` : 'Hello,',
      `${oneLine(await inviterName(actor))} has invited you to sign in to ${oneLine(settings.app_name)}.`,
      `Set your password here: ${link}`,
      `After that, sign in with this email address (${invite.email}) and your password.`,
      'This link works once and expires in 72 hours. If you were not expecting this invitation, you can ignore this email.',
    ].join('\n\n'),
  }

  try {
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('send deadline passed'), { code: 'ETIMEDOUT' })), SEND_DEADLINE_MS)
    })
    try {
      await Promise.race([deliver(message), deadline])
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    const code = failureCode(err)
    // The failure class only, never the address.
    console.error(JSON.stringify({ level: 'error', event: 'mail_delivery_failed', purpose: 'password_invite', code }))
    await sql`update password_invite set voided_at = now() where id = ${invite.row.id as string} and used_at is null and voided_at is null`
    throw new AppError('ServiceUnavailableError', `The invite email was not sent (${code})`)
  }
  const [sent] = await sql`update password_invite set sent_at = now() where id = ${invite.row.id as string} returning *`
  await logActivity(actor, `password_invite_sent for ${person}`)
  return view(sent)
}

/** The account a live link sets a password for, for the "Set your password"
 *  page. Every link that cannot be used answers the same way. */
export async function checkPasswordInvite(key: string): Promise<{ email: string; expires_at: string }> {
  if (!key) throw new AppError('ValidationError', INVALID_INVITE)
  const [row] = await sql`
    select i.person, i.expires_at, p.email from password_invite i join person p on p.row_id = i.person
    where i.token_hash = ${fingerprint(key)} and i.used_at is null and i.voided_at is null
      and i.sent_at is not null and i.expires_at > now()`
  if (!row || (await whyNot(row.person as string))) throw new AppError('ValidationError', INVALID_INVITE)
  return { email: String(row.email).trim(), expires_at: iso(row.expires_at)! }
}

/**
 * Use a link: set the person's first password. Returns the person, whom the
 * route then signs in.
 *
 * Burn-on-use, as password reset: the link is spent in its own committed
 * transaction before the password write, so a write that is then refused
 * never gives the link back. Its conditions sit in the locking query's WHERE,
 * so a concurrent use re-reads the spent row under READ COMMITTED and finds
 * nothing.
 */
export async function acceptPasswordInvite(key: string, newPassword: string): Promise<string> {
  if (!key) throw new AppError('ValidationError', INVALID_INVITE)
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH)
    throw new AppError('ValidationError', `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)

  const used = await sql.begin(async (tx) => {
    const t = tx as unknown as TxSql
    const [row] = await t`
      select id, person, created_at from password_invite
      where token_hash = ${fingerprint(key)} and used_at is null and voided_at is null
        and sent_at is not null and expires_at > now()
      for update`
    if (!row) throw new AppError('ValidationError', INVALID_INVITE)
    await t`update password_invite set used_at = now() where id = ${row.id as string}`
    return { id: row.id as string, person: row.person as string, issuedAt: new Date(row.created_at as string) }
  })

  // Under the person's row lock: still someone with no way in (no password,
  // no other method, enabled, an address), and nothing ended their sessions
  // after the link was made (a shell reset takes the same lock).
  await sql.begin(async (tx) => {
    const t = tx as unknown as TxSql
    const [p] = await t`select sessions_ended_at from person where row_id = ${used.person} for update`
    if (!p) throw new AppError('ValidationError', INVALID_INVITE)
    if (p.sessions_ended_at && new Date(p.sessions_ended_at as string) > used.issuedAt)
      throw new AppError('ValidationError', INVALID_INVITE)
    if (await whyNot(used.person, t)) throw new AppError('ValidationError', INVALID_INVITE)
    await setUserPassword(used.person, newPassword, t)
    await t`update password_invite set accepted_at = now() where id = ${used.id}`
  })
  await logActivity(used.person, 'password_invite_accepted')
  return used.person
}

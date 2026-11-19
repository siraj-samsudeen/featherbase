import { createHash, randomBytes } from 'node:crypto'
import { config } from './config'
import { sql, type TxSql } from './db'
import { AppError } from './errors'
import { revokeSession, setUserPassword, type IssuedSession } from './auth'
import { logActivity } from './audit'
import { deliverEmail, type MailMessage } from './email'
import { emailOrigin } from './instance-addresses'
import { getSystemSettings } from './settings'
import { isReservedEmail, methodOfKind } from './identities'
import { MIN_PASSWORD_LENGTH } from './password-reset'
import { completeSignIn } from './sign-in'

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
let deadlineMs = SEND_DEADLINE_MS
/** Test-only: replace the transport and its deadline (null restores both). */
export function _setPasswordInviteDeliveryForTests(fn: ((msg: MailMessage) => Promise<void>) | null, deadline?: number): void {
  deliver = fn ?? deliverEmail
  deadlineMs = fn ? deadline ?? SEND_DEADLINE_MS : SEND_DEADLINE_MS
}

/** Test-only seams inside the two gaps of an acceptance: after the link is
 *  burned and before the password write, and after that write and before the
 *  session is issued. */
interface AcceptHooks { afterBurn?: () => Promise<void>; beforeSession?: () => Promise<void> }
let acceptHooks: AcceptHooks = {}
export function _setPasswordInviteAcceptHooksForTests(h: AcceptHooks | null): void {
  acceptHooks = h ?? {}
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
    select p.enabled, p.email, exists (select 1 from person_credential c where c.person_id = p.row_id) as has_password, p.expects_google_sign_in, p.expects_microsoft_sign_in,
      exists (select 1 from sign_in_identity i where i.person_id = p.row_id and i.ended_at is null) as other_way
    from person p where p.row_id = ${person}`
  if (!row) throw new AppError('NotFoundError', `Person ${person} not found`)
  if (!row.enabled) return 'This person is disabled'
  if (row.has_password) return 'This person already has a password; they can use "Forgot password"'
  // #137: a password invite never adds a way in beside another method, an
  // expected Google or Microsoft sign-in included.
  if (row.other_way || row.expects_google_sign_in || row.expects_microsoft_sign_in) return 'This person already signs in another way, so they are not given a password'
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
    const [p] = await t`select email, full_name from person where row_id = ${person} for update`
    const why = await whyNot(person, t)
    if (why) throw new AppError('ValidationError', why)
    // Every earlier link not yet accepted, a used one still on its way to the
    // password write included: that write refuses a voided link.
    await t`update password_invite set voided_at = now() where person = ${person} and accepted_at is null and voided_at is null`
    const email = String(p.email).trim()
    const [row] = await t`insert into password_invite ${sql({
      id: 'pwi_' + randomBytes(9).toString('hex'),
      person,
      token_hash: fingerprint(key),
      invited_by: actor,
      email,
      // The clock, not the transaction's start: the newest invite is the latest.
      created_at: new Date(),
      expires_at: new Date(Date.now() + INVITE_TTL_MS),
    })} returning *`
    return { row, email, name: typeof p.full_name === 'string' ? p.full_name.trim() : '' }
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
      timer = setTimeout(() => reject(Object.assign(new Error('send deadline passed'), { code: 'ETIMEDOUT' })), deadlineMs)
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
    await sql`update password_invite set voided_at = now() where id = ${invite.row.id as string} and accepted_at is null and voided_at is null`
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
      and i.sent_at is not null and i.expires_at > now()
      and lower(trim(coalesce(p.email, ''))) = lower(i.email)`
  if (!row || (await whyNot(row.person as string))) throw new AppError('ValidationError', INVALID_INVITE)
  return { email: String(row.email).trim(), expires_at: iso(row.expires_at)! }
}

/** What an acceptance left on the person: the session issued after it must
 *  find both unchanged, or nothing changed them in between. */
interface Accepted { person: string; passwordHash: string; sessionsEndedAt: string | null }

/**
 * Use a link: set the person's first password.
 *
 * Burn-on-use, as password reset: the link is spent in its own committed
 * transaction before the password write, so a write that is then refused
 * never gives the link back. Its conditions sit in the locking query's WHERE,
 * so a concurrent use re-reads the spent row under READ COMMITTED and finds
 * nothing.
 *
 * Between the burn and the write, a resend, an email change or a shell reset
 * can still void the link (Codex, #1257): each voids every link not yet
 * accepted and takes the person's row lock, which the write takes too. So,
 * under that lock, the write refuses a voided link and one whose address is
 * no longer the person's.
 */
async function acceptPasswordInvite(key: string, newPassword: string): Promise<Accepted> {
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
  await acceptHooks.afterBurn?.()

  // Under the person's row lock: the link was not voided since, still went to
  // the person's address, and the person still has no way in (no password,
  // no other method, enabled), with nothing ending their sessions after the
  // link was made.
  const accepted = await sql.begin(async (tx) => {
    const t = tx as unknown as TxSql
    // A person row is never deleted (foreign keys restrict it); were it gone,
    // it would have no address, and the link is refused below like any other.
    const [p] = await t`select email, sessions_ended_at from person where row_id = ${used.person} for update`
    const [invite] = await t`select email, voided_at from password_invite where id = ${used.id}`
    if (!invite || invite.voided_at) throw new AppError('ValidationError', INVALID_INVITE)
    const current = typeof p?.email === 'string' ? p.email.trim().toLowerCase() : ''
    if (current !== String(invite.email).toLowerCase()) throw new AppError('ValidationError', INVALID_INVITE)
    if (p.sessions_ended_at && new Date(p.sessions_ended_at as string) > used.issuedAt)
      throw new AppError('ValidationError', INVALID_INVITE)
    if (await whyNot(used.person, t)) throw new AppError('ValidationError', INVALID_INVITE)
    await setUserPassword(used.person, newPassword, t)
    await t`update password_invite set accepted_at = now() where id = ${used.id}`
    const [after] = await t`select (select c.password_hash from person_credential c where c.person_id = person.row_id) as password_hash,
      sessions_ended_at::text as ended from person where row_id = ${used.person}`
    return { person: used.person, passwordHash: after.password_hash as string, sessionsEndedAt: (after.ended as string | null) ?? null }
  })
  await logActivity(used.person, 'password_invite_accepted')
  return accepted
}

/**
 * Use a link and sign the person in. The session is issued after the
 * password write, so a shell reset (or any password change or ended
 * sessions) that lands in between would otherwise leave a session the reset
 * did not end (Codex, #1257). Once issued, under the person's row lock, the
 * password and the sessions cut-off must still be what the acceptance left;
 * if not, the session is revoked and the link answers as spent.
 */
export async function signInWithPasswordInvite(key: string, newPassword: string, ipAddress: string | null): Promise<IssuedSession> {
  const accepted = await acceptPasswordInvite(key, newPassword)
  await acceptHooks.beforeSession?.()
  const method = await methodOfKind('password')
  if (!method) throw new AppError('ValidationError', INVALID_INVITE)
  const issued = await completeSignIn(method, { status: 'verified' }, { user: accepted.person, identity: null }, { ipAddress })
  const unchanged = await sql.begin(async (tx) => {
    const t = tx as unknown as TxSql
    const [p] = await t`select sessions_ended_at::text as ended from person where row_id = ${accepted.person} for update`
    // #1336 (Codex): read after the lock, in a statement of its own, so a
    // password change the lock waited for is seen (one statement keeps the
    // snapshot it started with).
    const [c] = await t`select password_hash from person_credential where person_id = ${accepted.person}`
    return Boolean(p) && (c?.password_hash ?? null) === accepted.passwordHash && ((p.ended as string | null) ?? null) === accepted.sessionsEndedAt
  })
  if (!unchanged) {
    const s = issued.user.sign_in!
    await revokeSession({ jti: s.session_id, person: accepted.person, expiresAt: s.expires_at })
    throw new AppError('ValidationError', INVALID_INVITE)
  }
  return issued
}

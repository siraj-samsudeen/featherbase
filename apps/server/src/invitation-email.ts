// #430: the email that tells an invited person how to sign in. The wording
// that names the instance comes from System Settings (app_name, and the
// optional invitation_email_intro), never from this public repo. A send is
// awaited — the inviter is an administrator who is told whether it went —
// and a failure never undoes the invite.
import { config } from './config'
import { emailOrigin } from './instance-addresses'
import { sql } from './db'
import { AppError } from './errors'
import { deliverEmail, type MailMessage } from './email'
import { getSystemSettings } from './settings'
import { auditIdentity, getIdentity, getSignInMethod } from './identities'

/** A pending invite's email is sent at most once in this many minutes. */
const RESEND_WAIT_MINUTES = 10

type InvitationEmail =
  | { status: 'sent' }
  | { status: 'not_sent'; reason: 'not_requested' | 'already_invited' }
  | { status: 'failed'; error: string }

/** How long one send may take before it counts as failed. SMTP's own
 *  timeouts are per connection step; this bounds the whole send. */
const SEND_DEADLINE_MS = 20_000

interface Hooks {
  deliver: (msg: MailMessage) => Promise<void>
  /** Test-only seams around the send, to prove what a failure leaves behind. */
  beforeClaim?: () => Promise<void>
  audit?: typeof auditIdentity
  deadlineMs?: number
}
const DEFAULT_HOOKS: Hooks = { deliver: deliverEmail }
let hooks: Hooks = DEFAULT_HOOKS
/** Test-only: replace the transport (null restores it). */
export function _setInvitationDeliveryForTests(fn: ((msg: MailMessage) => Promise<void>) | null): void {
  hooks = fn ? { ...hooks, deliver: fn } : DEFAULT_HOOKS
}
/** Test-only: the other seams (null restores every default). */
export function _setInvitationHooksForTests(h: Partial<Hooks> | null): void {
  hooks = h ? { ...hooks, ...h } : DEFAULT_HOOKS
}

/** The invitation is not sent when this instance has no address for emails
 *  (outside development and test with INSTANCE_ADDRESSES unset). */
export const ADDRESS_MISSING = "The invitation email was not sent: this instance's addresses (INSTANCE_ADDRESSES) are not set"

/** The page an invited person opens: the instance's own sign-in page. */
export function signInLink(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/featherbase/login`
}

// The inviter is named as people know them; an opaque id never reaches mail.
async function inviterName(actor: string): Promise<string> {
  const [row] = await sql`select full_name from person where row_id = ${actor}`
  const name = typeof row?.full_name === 'string' ? row.full_name.trim() : ''
  return name || 'An administrator'
}

export function composeInvitation(o: {
  address: string
  inviter: string
  appName: string
  intro: string
  methodLabel: string
  link: string
}): Pick<MailMessage, 'to' | 'subject' | 'body'> {
  const intro = o.intro.trim()
  // A header value must stay on one line: a configured name with a line
  // break could otherwise add headers to the message.
  const oneLine = (v: string) => v.replace(/[\r\n]+/g, ' ').trim()
  const inviter = oneLine(o.inviter)
  const appName = oneLine(o.appName)
  const body = [
    'Hello,',
    `${inviter} has invited you to sign in to ${appName}.`,
    ...(intro ? [intro] : []),
    `To sign in, open the link below and choose "Sign in with ${o.methodLabel}".\nSign in with ${o.methodLabel} using this address: ${o.address}`,
    o.link,
    'If you were not expecting this invitation, you can ignore this email.',
  ].join('\n\n')
  return { to: o.address, subject: `${inviter} invited you to ${appName}`, body }
}

// The failure class only (a transport's fixed code and the SMTP reply code),
// never free text that could carry the address.
function failureCode(err: unknown): { code: string; responseCode?: number } {
  const e = (err ?? {}) as { code?: unknown; responseCode?: unknown }
  const code = typeof e.code === 'string' && /^[A-Z_]{2,32}$/.test(e.code) ? e.code : 'EUNKNOWN'
  return { code, ...(typeof e.responseCode === 'number' ? { responseCode: e.responseCode } : {}) }
}

function logFailure(err: unknown) {
  const { code, responseCode } = failureCode(err)
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'mail_delivery_failed',
      purpose: 'sign_in_invitation',
      code,
      ...(responseCode ? { smtp_response_code: responseCode } : {}),
    }),
  )
}

/**
 * Email a pending invite's address. The message is composed first; only then
 * is the ten-minute window claimed, so two clicks send one email, and a send
 * that fails (or outlives its deadline) gives the window back so the inviter
 * can try again at once. Returns the outcome and the stored send time.
 */
export async function sendInvitation(
  identityId: string,
  actor: string,
  requestOrigin: string,
): Promise<{ invitation_email: InvitationEmail; invitation_sent_at: string | null }> {
  const identity = await getIdentity(identityId)
  if (identity.subject != null || identity.ended_at || !identity.pending_email)
    throw new AppError('ValidationError', 'Only a pending invitation can be sent again')
  // Carried as text, and bound as text: a JS Date (and the driver's
  // timestamptz parameter) drops Postgres's microseconds, and these values
  // are compared for equality below.
  const [{ previous }] = await sql`select invitation_sent_at::text as previous from sign_in_identity where id = ${identityId}`
  const previousIso = previous == null ? null : new Date(previous as string).toISOString()
  // #488: the address marked for emails; the inviter's own origin only when a
  // development or test server has no list. Never a link from the request elsewhere.
  const site = emailOrigin(config.instanceAddresses, config.environment, requestOrigin)
  if (!site) return { invitation_email: { status: 'failed', error: ADDRESS_MISSING }, invitation_sent_at: previousIso }

  const settings = await getSystemSettings()
  const [intro] = await sql`select value from single_value where table_name = 'System Settings' and field = 'invitation_email_intro'`
  const method = await getSignInMethod(identity.method)
  const message = composeInvitation({
    address: identity.pending_email,
    inviter: await inviterName(actor),
    appName: settings.app_name,
    intro: typeof intro?.value === 'string' ? intro.value : '',
    methodLabel: method?.label || 'Google',
    link: signInLink(site),
  })
  await hooks.beforeClaim?.()

  const [claimed] = await sql`
    update sign_in_identity set invitation_sent_at = now()
    where id = ${identityId} and subject is null and ended_at is null
      and invitation_sent_at is not distinct from ${previous}::text::timestamptz
      and (invitation_sent_at is null or invitation_sent_at <= now() - make_interval(mins => ${RESEND_WAIT_MINUTES}))
    returning invitation_sent_at, invitation_sent_at::text as stamp`
  if (!claimed)
    throw new AppError('RateLimitError', `An invitation was sent less than ${RESEND_WAIT_MINUTES} minutes ago; try again later`)

  // Nothing but the send sits between the claim and this try, so every way
  // out after the claim either keeps it (sent) or gives it back.
  try {
    // A send that outlives the deadline counts as failed and gives the window
    // back. Its transport may still finish later, so a resend right after a
    // timeout can deliver a second copy: one duplicate email is the price of
    // never leaving the inviter waiting, or wrongly told it went.
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('send deadline passed'), { code: 'ETIMEDOUT' })), hooks.deadlineMs ?? SEND_DEADLINE_MS)
    })
    try {
      await Promise.race([hooks.deliver(message), deadline])
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    logFailure(err)
    await sql`
      update sign_in_identity set invitation_sent_at = ${previous}::text::timestamptz
      where id = ${identityId} and invitation_sent_at = ${claimed.stamp as string}::text::timestamptz`
    return {
      invitation_email: { status: 'failed', error: `The invitation email was not sent (${failureCode(err).code})` },
      invitation_sent_at: previousIso,
    }
  }
  // The email went out: a failed audit write is logged, never reported as a
  // failed send.
  try {
    await (hooks.audit ?? auditIdentity)(actor, 'invitation_sent', identity.person_id, identity.method, identityId)
  } catch {
    console.error(JSON.stringify({ level: 'error', event: 'invitation_audit_failed', purpose: 'sign_in_invitation' }))
  }
  return { invitation_email: { status: 'sent' }, invitation_sent_at: new Date(claimed.invitation_sent_at as Date).toISOString() }
}

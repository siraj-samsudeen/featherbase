// #430: the email that tells an invited person how to sign in. The wording
// that names the instance comes from System Settings (app_name, and the
// optional invitation_email_intro), never from this public repo. A send is
// awaited — the inviter is an administrator who is told whether it went —
// and a failure never undoes the invite.
import { sql } from './db'
import { AppError } from './errors'
import { deliverEmail, type MailMessage } from './email'
import { getSystemSettings } from './settings'
import { auditIdentity, getIdentity, getSignInMethod } from './identities'

/** A pending invite's email is sent at most once in this many minutes. */
export const RESEND_WAIT_MINUTES = 10

export type InvitationEmail =
  | { status: 'sent' }
  | { status: 'not_sent'; reason: 'not_requested' | 'already_invited' }
  | { status: 'failed'; error: string }

let deliver: (msg: MailMessage) => Promise<void> = deliverEmail
/** Test-only: replace the transport (null restores it). */
export function _setInvitationDeliveryForTests(fn: ((msg: MailMessage) => Promise<void>) | null): void {
  deliver = fn ?? deliverEmail
}

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
  const body = [
    'Hello,',
    `${o.inviter} has invited you to sign in to ${o.appName}.`,
    ...(intro ? [intro] : []),
    `To sign in, open the link below and choose "Sign in with ${o.methodLabel}".\nSign in with ${o.methodLabel} using this address: ${o.address}`,
    o.link,
    'If you were not expecting this invitation, you can ignore this email.',
  ].join('\n\n')
  return { to: o.address, subject: `${o.inviter} invited you to ${o.appName}`, body }
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
 * Email a pending invite's address. Claims the ten-minute window first, so two
 * clicks send one email; a failed send gives the window back, so the inviter
 * can try again at once. Returns the outcome and the stored send time.
 */
export async function sendInvitation(
  identityId: string,
  actor: string,
  origin: string,
): Promise<{ invitation_email: InvitationEmail; invitation_sent_at: string | null }> {
  const identity = await getIdentity(identityId)
  if (identity.subject != null || identity.ended_at || !identity.pending_email)
    throw new AppError('ValidationError', 'Only a pending invitation can be sent again')
  // Carried as text, and bound as text: a JS Date (and the driver's
  // timestamptz parameter) drops Postgres's microseconds, and these values
  // are compared for equality below.
  const [{ previous }] = await sql`select invitation_sent_at::text as previous from sign_in_identity where id = ${identityId}`
  const [claimed] = await sql`
    update sign_in_identity set invitation_sent_at = now()
    where id = ${identityId} and subject is null and ended_at is null
      and invitation_sent_at is not distinct from ${previous}::text::timestamptz
      and (invitation_sent_at is null or invitation_sent_at <= now() - make_interval(mins => ${RESEND_WAIT_MINUTES}))
    returning invitation_sent_at, invitation_sent_at::text as stamp`
  if (!claimed)
    throw new AppError('RateLimitError', `An invitation was sent less than ${RESEND_WAIT_MINUTES} minutes ago; try again later`)

  const settings = await getSystemSettings()
  const [intro] = await sql`select value from single_value where table_name = 'System Settings' and field = 'invitation_email_intro'`
  const method = await getSignInMethod(identity.method)
  const message = composeInvitation({
    address: identity.pending_email,
    inviter: await inviterName(actor),
    appName: settings.app_name,
    intro: typeof intro?.value === 'string' ? intro.value : '',
    methodLabel: method?.label || 'Google',
    link: signInLink(origin),
  })
  try {
    await deliver(message)
  } catch (err) {
    logFailure(err)
    await sql`
      update sign_in_identity set invitation_sent_at = ${previous}::text::timestamptz
      where id = ${identityId} and invitation_sent_at = ${claimed.stamp as string}::text::timestamptz`
    return {
      invitation_email: { status: 'failed', error: `The invitation email was not sent (${failureCode(err).code})` },
      invitation_sent_at: previous == null ? null : new Date(previous as string).toISOString(),
    }
  }
  await auditIdentity(actor, 'invitation_sent', identity.person_id, identity.method, identityId)
  return { invitation_email: { status: 'sent' }, invitation_sent_at: new Date(claimed.invitation_sent_at as Date).toISOString() }
}

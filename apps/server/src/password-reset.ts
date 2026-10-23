import { randomBytes } from 'node:crypto'
import { config } from './config'
import { sql, type TxSql } from './db'
import { AppError } from './errors'
import { findPasswordAccount, setUserPassword } from './auth'
import { deliverToSink } from './email'

// SET-002: password reset via an emailed link. A request mints a single-use,
// time-limited token and mails a reset link to the user (the dev sink). The
// reset endpoint consumes the token and sets the new password.

const TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour
/** The one minimum password length: reset and sign-up share it. */
export const MIN_PASSWORD_LENGTH = 6
// One reader of SITE_URL, so the reset link and the OAuth redirect_uri can
// never be told two different things about where this instance lives.
export const SITE_URL = config.siteUrl || 'http://localhost:5173'

// Never reveal whether an account exists; only a real, enabled user with both
// an email and a password gets a mail (person-identities): resetting never
// gives a password to an account that signs in only through another method.
// Returns the token in dev/test so callers can assert without scraping.
export async function requestPasswordReset(usr: string): Promise<string | null> {
  const user = await findPasswordAccount(usr)
  // #137: only a person has a password to reset; a service account is not a
  // person, so it is never found here — the same silent `null` as an unknown user.
  if (!user || !user.enabled || !user.email || !user.password_hash) return null

  const token = randomBytes(24).toString('hex')
  const expires = new Date(Date.now() + TOKEN_TTL_MS)
  await sql`insert into password_reset ${sql({
    token,
    user: user.row_id as string,
    expires_at: expires,
  })}`

  const link = `${SITE_URL}/featherbase/reset-password?key=${token}`
  await deliverToSink({
    to: user.email as string,
    subject: 'Reset your password',
    body: `A password reset was requested for your account.\n\nReset it here: ${link}\n\nThis link expires in one hour. If you did not request this, ignore this email.`,
  })
  return token
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  if (!token || !newPassword) throw new AppError('ValidationError', 'Expected { key, new_password }')
  if (newPassword.length < MIN_PASSWORD_LENGTH)
    throw new AppError('ValidationError', `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)

  // #137, burn-on-use: the link is consumed the moment it is used, in its own
  // committed transaction, BEFORE the password write is attempted. A write
  // that then fails — as it does for a principal that became
  // a service account between the request and the click — does not give
  // the link back.
  //
  // The tempting alternative is to make the write and the consumption atomic,
  // but atomicity is the weaker guarantee here: rolling the write back rolls
  // the deletion back with it, so a reset link survives its own use and stays
  // live for the rest of its hour. For a credential-reset link, "usable at
  // most once" is the property worth having outright. Losing a reset to a
  // failed write costs the user one more click on "forgot password"; leaving
  // a used link alive costs them the account.
  //
  // `for update` plus deleting every outstanding token for the user settles
  // concurrent clicks: the first to take the row lock consumes them all, and
  // the losers re-read under READ COMMITTED, find nothing, and are refused.
  const link = await sql.begin(async (tx) => {
    const stx = tx as unknown as typeof sql
    const [row] = await stx`
      select "user", expires_at, created_at from password_reset where token = ${token} for update`
    if (!row || new Date(row.expires_at as string).getTime() < Date.now())
      throw new AppError('ValidationError', 'This reset link is invalid or has expired')

    await stx`delete from password_reset where "user" = ${row.user as string}`
    return { user: row.user as string, issuedAt: new Date(row.created_at as string) }
  })

  // #391: a break-glass shell reset revokes every outstanding link, but one
  // consumed just before it could still write just after it. Under the
  // person's row lock (the shell reset's write takes the same lock), refuse
  // a link issued before the latest shell reset.
  await sql.begin(async (tx) => {
    const stx = tx as unknown as TxSql
    const [person] = await stx`select sessions_ended_at from person where row_id = ${link.user} for update`
    if (person?.sessions_ended_at && new Date(person.sessions_ended_at as string) > link.issuedAt)
      throw new AppError('ValidationError', 'This reset link is invalid or has expired')
    await setUserPassword(link.user, newPassword, stx)
  })
}

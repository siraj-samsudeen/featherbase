import { randomBytes } from 'node:crypto'
import { config } from './config'
import { sql } from './db'
import { AppError } from './errors'
import { setUserPassword } from './auth'
import { deliverToSink } from './email'

// SET-002: password reset via an emailed link. A request mints a single-use,
// time-limited token and mails a reset link to the user (the dev sink). The
// reset endpoint consumes the token and sets the new password.

const TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour
// One reader of SITE_URL, so the reset link and the OAuth redirect_uri can
// never be told two different things about where this instance lives.
const SITE_URL = config.siteUrl || 'http://localhost:5173'

// Never reveal whether an account exists; only a real, enabled user gets a
// mail. Returns the token in dev/test so callers can assert without scraping.
export async function requestPasswordReset(usr: string): Promise<string | null> {
  const [user] = await sql`
    select row_id, email, enabled, user_type from "user"
    where (row_id = ${usr} or email = ${usr})`
  // #137: a service account has no password to reset. Fall through the same
  // silent `null` as an unknown user so this cannot be used to enumerate them.
  if (!user || !user.enabled || user.user_type === 'service') return null

  const token = randomBytes(24).toString('hex')
  const expires = new Date(Date.now() + TOKEN_TTL_MS)
  await sql`insert into password_reset ${sql({
    token,
    user: user.row_id as string,
    expires_at: expires,
  })}`

  const link = `${SITE_URL}/reset-password?key=${token}`
  await deliverToSink({
    to: (user.email as string) ?? (user.row_id as string),
    subject: 'Reset your password',
    body: `A password reset was requested for your account.\n\nReset it here: ${link}\n\nThis link expires in one hour. If you did not request this, ignore this email.`,
  })
  return token
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  if (!token || !newPassword) throw new AppError('ValidationError', 'Expected { key, new_password }')
  if (newPassword.length < 6)
    throw new AppError('ValidationError', 'Password must be at least 6 characters')

  // #137, burn-on-use: the link is consumed the moment it is used, in its own
  // committed transaction, BEFORE the password write is attempted. A write
  // that then fails — as it does for a principal that became
  // `user_type = 'service'` between the request and the click — does not give
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
  const user = await sql.begin(async (tx) => {
    const stx = tx as unknown as typeof sql
    const [row] = await stx`
      select "user", expires_at from password_reset where token = ${token} for update`
    if (!row || new Date(row.expires_at as string).getTime() < Date.now())
      throw new AppError('ValidationError', 'This reset link is invalid or has expired')

    await stx`delete from password_reset where "user" = ${row.user as string}`
    return row.user as string
  })

  await setUserPassword(user, newPassword)
}

import { randomBytes } from 'node:crypto'
import { sql } from './db'
import { AppError } from './errors'
import { setUserPassword } from './auth'
import { deliverToSink } from './email'

// SET-002: password reset via an emailed link. A request mints a single-use,
// time-limited token and mails a reset link to the user (the dev sink). The
// reset endpoint consumes the token and sets the new password.

const TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour
const SITE_URL = process.env.SITE_URL ?? 'http://localhost:5173'

// Never reveal whether an account exists; only a real, enabled user gets a
// mail. Returns the token in dev/test so callers can assert without scraping.
export async function requestPasswordReset(usr: string): Promise<string | null> {
  const [user] = await sql`
    select name, email, enabled from tab_user
    where (name = ${usr} or email = ${usr})`
  if (!user || !user.enabled) return null

  const token = randomBytes(24).toString('hex')
  const expires = new Date(Date.now() + TOKEN_TTL_MS)
  await sql`insert into password_reset ${sql({
    token,
    user: user.name as string,
    expires_at: expires,
  })}`

  const link = `${SITE_URL}/reset-password?key=${token}`
  await deliverToSink({
    to: (user.email as string) ?? (user.name as string),
    subject: 'Reset your password',
    body: `A password reset was requested for your account.\n\nReset it here: ${link}\n\nThis link expires in one hour. If you did not request this, ignore this email.`,
  })
  return token
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  if (!token || !newPassword) throw new AppError('ValidationError', 'Expected { key, new_password }')
  if (newPassword.length < 6)
    throw new AppError('ValidationError', 'Password must be at least 6 characters')

  const [row] = await sql`
    select "user", expires_at from password_reset where token = ${token}`
  if (!row || new Date(row.expires_at as string).getTime() < Date.now())
    throw new AppError('ValidationError', 'This reset link is invalid or has expired')

  await setUserPassword(row.user as string, newPassword)
  // Single-use: consume this token and any others outstanding for the user.
  await sql`delete from password_reset where "user" = ${row.user as string}`
}

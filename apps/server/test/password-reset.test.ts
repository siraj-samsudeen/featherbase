import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../src/db'
import { login } from '../src/auth'
import { requestPasswordReset, resetPassword } from '../src/password-reset'
import { areq } from './helpers'

// SET-002: password reset issues a single-use, time-limited token, mails a
// link to the sink, and only ever targets a real, enabled account.

const USER = 'pwreset-srv@x.com'
const DISABLED = 'pwreset-disabled@x.com'

async function cleanup() {
  for (const u of [USER, DISABLED]) {
    await sql`delete from password_reset where "user" = ${u}`
    await sql`delete from tab_email_sink where mail_to = ${u}`
    await sql`delete from tab_user where name = ${u}`
  }
}

async function save(doc: Record<string, unknown>) {
  const res = await areq('/api/save_doc', {
    method: 'POST',
    body: JSON.stringify({ doctype: 'User', doc }),
  })
  if (res.status !== 201) throw new Error(`save user: ${res.status}`)
}

beforeAll(async () => {
  await cleanup()
  await save({ name: USER, email: USER, full_name: 'Reset Me', enabled: true })
  await areq('/api/set_password', { method: 'POST', body: JSON.stringify({ user: USER, password: 'origpw123' }) })
  await save({ name: DISABLED, email: DISABLED, full_name: 'No Login', enabled: false })
})

afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('SET-002: password reset', () => {
  it('mails a reset link with a token and resets the password', async () => {
    const token = await requestPasswordReset(USER)
    expect(token).toBeTruthy()

    // The link landed in the sink and contains the key.
    const [mail] = await sql`select body from tab_email_sink where mail_to = ${USER} order by creation desc limit 1`
    expect(mail).toBeDefined()
    expect(String(mail.body)).toContain(`key=${token}`)

    // Reset works; the new password logs in and the old one does not.
    await resetPassword(token as string, 'newpw45678')
    await expect(login(USER, 'newpw45678')).resolves.toHaveProperty('token')
    await expect(login(USER, 'origpw123')).rejects.toMatchObject({ type: 'AuthenticationError' })
  })

  it('makes the token single-use', async () => {
    const token = (await requestPasswordReset(USER)) as string
    await resetPassword(token, 'secondpw123')
    await expect(resetPassword(token, 'thirdpw123')).rejects.toMatchObject({ type: 'ValidationError' })
  })

  it('rejects an expired token', async () => {
    const token = (await requestPasswordReset(USER)) as string
    await sql`update password_reset set expires_at = now() - interval '1 minute' where token = ${token}`
    await expect(resetPassword(token, 'latepw1234')).rejects.toMatchObject({ type: 'ValidationError' })
  })

  it('does not issue a token or mail for a disabled or unknown account', async () => {
    expect(await requestPasswordReset(DISABLED)).toBeNull()
    expect(await requestPasswordReset('ghost-nobody@x.com')).toBeNull()
    const [{ n }] = await sql`select count(*)::int as n from tab_email_sink where mail_to = ${DISABLED}`
    expect(n).toBe(0)
  })
})

import { describe, expect } from 'vitest'
import { sql } from '../src/db'
import { login } from '../src/auth'
import { requestPasswordReset, resetPassword } from '../src/password-reset'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

// SET-002: password reset issues a single-use, time-limited token, mails a
// link to the sink, and only ever targets a real, enabled account.

const USER = 'pwreset-srv@x.com'
const DISABLED = 'pwreset-disabled@x.com'

async function save(admin: TestClient, doc: Record<string, unknown>) {
  await admin.post('/api/save_doc', { doctype: 'User', doc })
}

// Each test creates its accounts inside its own sandbox transaction.
async function setup(admin: TestClient) {
  await save(admin, { name: USER, email: USER, full_name: 'Reset Me', enabled: true })
  await admin.post('/api/set_password', { user: USER, password: 'origpw123' })
  await save(admin, { name: DISABLED, email: DISABLED, full_name: 'No Login', enabled: false })
}

describe('SET-002: password reset', () => {
  test('mails a reset link with a token and resets the password', async ({ admin }) => {
    await setup(admin)
    const token = await requestPasswordReset(USER)
    expect(token).toBeTruthy()

    // The link landed in the sink and contains the key.
    const [mail] =
      await sql`select body from tab_email_sink where mail_to = ${USER} order by creation desc limit 1`
    expect(mail).toBeDefined()
    expect(String(mail.body)).toContain(`key=${token}`)

    // Reset works; the new password logs in and the old one does not.
    await resetPassword(token as string, 'newpw45678')
    await expect(login(USER, 'newpw45678')).resolves.toHaveProperty('token')
    await expect(login(USER, 'origpw123')).rejects.toMatchObject({ type: 'AuthenticationError' })
  })

  test('makes the token single-use', async ({ admin }) => {
    await setup(admin)
    const token = (await requestPasswordReset(USER)) as string
    await resetPassword(token, 'secondpw123')
    await expect(resetPassword(token, 'thirdpw123')).rejects.toMatchObject({
      type: 'ValidationError',
    })
  })

  test('rejects an expired token', async ({ admin }) => {
    await setup(admin)
    const token = (await requestPasswordReset(USER)) as string
    await sql`update password_reset set expires_at = now() - interval '1 minute' where token = ${token}`
    await expect(resetPassword(token, 'latepw1234')).rejects.toMatchObject({
      type: 'ValidationError',
    })
  })

  test('does not issue a token or mail for a disabled or unknown account', async ({ admin }) => {
    await setup(admin)
    expect(await requestPasswordReset(DISABLED)).toBeNull()
    expect(await requestPasswordReset('ghost-nobody@x.com')).toBeNull()
    const [{ n }] = await sql`select count(*)::int as n from tab_email_sink where mail_to = ${DISABLED}`
    expect(n).toBe(0)
  })
})

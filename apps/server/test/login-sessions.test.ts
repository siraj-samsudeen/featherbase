import { expect } from 'vitest'
import { sign } from 'hono/jwt'
import { test } from './pg-test'
import { sql } from '../src/db'
import { issueSession, login, resolveToken, setUserPassword } from '../src/auth'
import { requestPasswordReset } from '../src/password-reset'
import { bootstrapAdministrator } from '../src/admin-bootstrap'

// @spec login_sessions_are_revocable_on_every_use
test('logout revokes its copied session but not another session for the same User', async ({ api }) => {
  const a = await login('Administrator', process.env.ADMIN_PASSWORD ?? 'admin')
  const b = await login('Administrator', process.env.ADMIN_PASSWORD ?? 'admin')
  expect(a.token === b.token).toBe(false)
  expect((await api.fetch('/api/logout', { method: 'POST', headers: { authorization: `Bearer ${a.token}` } })).status).toBe(200)
  await expect(resolveToken(`Bearer ${a.token}`)).rejects.toMatchObject({ type: 'AuthenticationError' })
  expect((await resolveToken(`Bearer ${b.token}`)).row_id).toBe('Administrator')
})

// @spec login_sessions_are_revocable_on_every_use
test('User disable permanently revokes all prior sessions even when no request observes disabled state', async () => {
  const a = await issueSession('Administrator')
  const b = await issueSession('Administrator')
  await sql`update "user" set enabled = false where row_id = 'Administrator'`
  await sql`update "user" set enabled = true where row_id = 'Administrator'`
  for (const { token } of [a, b])
    await expect(resolveToken(`Bearer ${token}`)).rejects.toMatchObject({ type: 'AuthenticationError' })
  const fresh = await issueSession('Administrator')
  expect((await resolveToken(`Bearer ${fresh.token}`)).row_id).toBe('Administrator')
})

// @spec login_sessions_are_revocable_on_every_use
test('a validly signed legacy JWT is not a live server-side session', async () => {
  const token = await sign({ sub: 'Administrator', exp: Math.floor(Date.now() / 1000) + 3600 }, process.env.JWT_SECRET ?? 'dev-secret-change-me')
  await expect(resolveToken(`Bearer ${token}`)).rejects.toMatchObject({ type: 'AuthenticationError' })
})

// @spec login_sessions_are_revocable_on_every_use
test('database expiry and credential expiry independently refuse a session', async () => {
  const session = await issueSession('Administrator')
  const payload = JSON.parse(Buffer.from(session.token.split('.')[1], 'base64url').toString()) as { sid: string; sub: string; exp: number }
  const expiredToken = await sign({ ...payload, exp: Math.floor(Date.now() / 1000) - 1 }, process.env.JWT_SECRET ?? 'dev-secret-change-me')
  await expect(resolveToken(`Bearer ${expiredToken}`)).rejects.toMatchObject({ type: 'AuthenticationError' })
  expect((await resolveToken(`Bearer ${session.token}`)).row_id).toBe('Administrator')
  await sql`update login_session set expires_at = clock_timestamp() where id = ${payload.sid}`
  await expect(resolveToken(`Bearer ${session.token}`)).rejects.toMatchObject({ type: 'AuthenticationError' })
})

// @spec native_login_requires_an_enabled_native_method
test('password replacement revokes sessions and external-only reset never creates a fallback', async () => {
  const old = await login('Administrator', process.env.ADMIN_PASSWORD ?? 'admin')
  await setUserPassword('Administrator', 'changed-native-only-password')
  await expect(resolveToken(`Bearer ${old.token}`)).rejects.toMatchObject({ type: 'AuthenticationError' })
  const fresh = await login('Administrator', 'changed-native-only-password')
  expect((await resolveToken(`Bearer ${fresh.token}`)).row_id).toBe('Administrator')
  await sql`update "user" set native_login_enabled = false where row_id = 'Administrator'`
  expect(await requestPasswordReset('Administrator')).toBeNull()
  await expect(setUserPassword('Administrator', 'must-not-enable')).rejects.toMatchObject({ type: 'ValidationError' })
  await expect(login('Administrator', 'changed-native-only-password')).rejects.toMatchObject({ type: 'AuthenticationError' })
})

// @spec native_login_requires_an_enabled_native_method
test('deliberate Administrator bootstrap after migration enables its native method', async () => {
  await sql`update "user" set password_hash = null, native_login_enabled = false where row_id = 'Administrator'`
  await bootstrapAdministrator()
  expect((await login('Administrator', process.env.ADMIN_PASSWORD ?? 'admin')).user.row_id).toBe('Administrator')
})

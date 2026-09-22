import { vi } from 'vitest'
import { test, expect } from './pg-test'
import { issuer } from './oidc-issuer'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
import { login, resolveLoginSession } from '../src/auth'

// @spec hosted_login_validates_subject_and_browser_operation
// @spec session_handoff_is_bound_one_use_and_revocation_aware
test('hosted HTTP flow binds browser, redeems once and preserves exact Tasker destination', async ({ api }) => {
  const upstream = await issuer()
  try {
    await saveDoc('User', { row_id: 'route-person', full_name: 'Route Person', enabled: true })
    await sql`insert into login_provider (id, kind, issuer, client_id, enabled)
      values ('route-google', 'google', 'https://accounts.google.com', 'test-client', true)`
    await sql`insert into external_identity (id, user_id, provider_id, issuer, subject)
      values ('route-identity', 'route-person', 'route-google', 'https://accounts.google.com', 'subject-one')`
    const next = '/tasker/tasks?filter=a%26b#assigned'
    const start = await api.fetch(`/api/auth/login/route-google?next=${encodeURIComponent(next)}`)
    expect(start.status).toBe(302)
    const authorization = new URL(start.headers.get('location')!)
    expect(authorization.origin).toBe('https://accounts.google.com')
    const browserCookie = start.headers.getSetCookie()[0].split(';')[0]
    const callback = new URL(authorization.searchParams.get('redirect_uri')!)
    callback.searchParams.set('state', authorization.searchParams.get('state')!)
    callback.searchParams.set('code', upstream.code(authorization))
    const missing = await api.fetch(callback.pathname + callback.search)
    expect(missing.status).toBe(401)
    expect(upstream.exchanges).toBe(0)
    const completion = await api.fetch(callback.pathname + callback.search, { headers: { cookie: browserCookie } })
    expect(completion.status).toBe(302)
    expect(completion.headers.get('referrer-policy')).toBe('no-referrer')
    const sid = completion.headers.getSetCookie().find((c) => c.startsWith('sid='))!.split(';')[0]
    const handoff = new URL(completion.headers.get('location')!, 'http://localhost').searchParams.get('code')
    const redeem = () => api.fetch('/api/auth/session', { method: 'POST',
      headers: { cookie: sid, origin: 'http://localhost' }, body: JSON.stringify({ code: handoff }) })
    const session = await redeem()
    expect(session.status).toBe(200)
    expect(await session.json()).toMatchObject({ user: { row_id: 'route-person' }, returnTo: next })
    expect((await redeem()).status).toBe(401)
  } finally { await upstream.close() }
})

// @spec authentication_admission_and_audit_do_not_expose_secrets
// @spec stylehr_activation_is_closed_without_a_confirmed_contract
test('browser mutations reject cross-origin requests and gated StyleHR never processes credentials', async ({ api }) => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const csrf = await api.fetch('/api/auth/link', { method: 'POST', headers: { origin: 'https://attacker.test' },
      body: JSON.stringify({ providerId: 'google' }) })
    expect(csrf.status).toBe(403)
    const stylehr = await api.fetch('/api/auth/login/stylehr', { method: 'POST', headers: { origin: 'http://localhost' },
      body: JSON.stringify({ password: 'SENTINEL_PRIVATE_PASSWORD' }) })
    expect(stylehr.status).toBe(503)
    expect(await stylehr.text()).not.toContain('SENTINEL_PRIVATE_PASSWORD')
    expect(JSON.stringify(log.mock.calls)).not.toContain('SENTINEL_PRIVATE_PASSWORD')
  } finally { log.mockRestore() }
})

// @spec identity_linking_requires_two_bound_proofs
test('native step-up freshly verifies the current User and cannot select another account', async ({ api }) => {
  const source = await login('Administrator', process.env.ADMIN_PASSWORD ?? 'admin')
  await sql`update login_session set authenticated_at = clock_timestamp() - interval '6 minutes' where user_id = 'Administrator'`
  const post = (password: string) => api.fetch('/api/auth/reauthenticate/native', {
    method: 'POST', headers: { origin: 'http://localhost', authorization: `Bearer ${source.token}` },
    body: JSON.stringify({ password, userId: 'Guest' }),
  })
  const [before] = await sql`select count(*)::int as count from login_session where user_id = 'Administrator'`
  expect((await post('wrong-password')).status).toBe(401)
  expect((await sql`select count(*)::int as count from login_session where user_id = 'Administrator'`)[0].count).toBe(before.count)
  const response = await post(process.env.ADMIN_PASSWORD ?? 'admin')
  expect(response.status).toBe(200)
  const result = await response.json() as { token: string; user: { row_id: string } }
  expect(result.user.row_id).toBe('Administrator')
  const current = await resolveLoginSession(`Bearer ${result.token}`)
  expect(current.authenticatedAt!.getTime()).toBeGreaterThan(Date.now() - 5000)
})

// @spec provider_configuration_is_an_authentication_boundary
test('provider administration requires fresh manager proof and cannot duplicate a namespace or activate StyleHR', async ({ api, admin }) => {
  const upstream = await issuer()
  try {
    const source = await login('Administrator', process.env.ADMIN_PASSWORD ?? 'admin')
    const post = (payload: object) => api.fetch('/api/auth/providers', { method: 'POST',
      headers: { origin: 'http://localhost', authorization: `Bearer ${source.token}` }, body: JSON.stringify(payload) })
    const data = { kind: 'google', clientId: 'test-client' }
    expect((await admin.fetch('/api/auth/providers', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify(data) })).status).toBe(403)
    const created = await post(data)
    expect(created.status).toBe(201)
    const provider = await created.json() as { id: string }
    expect((await post(data)).status).toBe(409)
    expect((await post({ kind: 'stylehr', clientId: 'anything' })).status).toBe(503)
    expect((await api.fetch('/api/auth/providers')).status).toBe(200)
    const disable = await api.fetch('/api/auth/providers/enabled', { method: 'POST',
      headers: { origin: 'http://localhost', authorization: `Bearer ${source.token}` }, body: JSON.stringify({ id: provider.id, enabled: false }) })
    expect(disable.status).toBe(200)
    expect(await (await api.fetch('/api/auth/providers')).json()).toMatchObject({ providers: [] })
  } finally { await upstream.close() }
})

// @spec authentication_admission_and_audit_do_not_expose_secrets
test('provider outage is safely audited without leaking upstream bodies or callback secrets', async ({ api }) => {
  const upstream = await issuer()
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await sql`insert into login_provider (id, kind, issuer, client_id, enabled)
      values ('outage-google', 'google', 'https://accounts.google.com', 'test-client', true)`
    const start = await api.fetch('/api/auth/login/outage-google')
    const authorization = new URL(start.headers.get('location')!)
    const cookie = start.headers.getSetCookie()[0].split(';')[0]
    const callback = new URL(authorization.searchParams.get('redirect_uri')!)
    callback.searchParams.set('state', authorization.searchParams.get('state')!)
    callback.searchParams.set('code', 'SENTINEL_PRIVATE_CODE')
    upstream.setUnavailable(true)
    const response = await api.fetch(callback.pathname + callback.search, { headers: { cookie } })
    expect(response.status).toBe(503)
    const audits = await sql`select "user", operation, ref_table, reference_name from access_log
      where ref_table = 'Login Provider' and reference_name = 'outage-google'`
    expect(audits).toContainEqual({ user: 'Guest', operation: 'login unavailable', ref_table: 'Login Provider', reference_name: 'outage-google' })
    const observable = JSON.stringify([await response.json(), log.mock.calls, audits,
      await sql`select operation, full_name from activity_log`])
    for (const sentinel of ['SENTINEL_PASSWORD_TOKEN_RESPONSE', 'SENTINEL_PRIVATE_CODE', 'SENTINEL_ACCESS_TOKEN'])
      expect(observable).not.toContain(sentinel)
    expect(await sql`select id from login_session where method = 'external'`).toEqual([])
  } finally { log.mockRestore(); await upstream.close() }
})

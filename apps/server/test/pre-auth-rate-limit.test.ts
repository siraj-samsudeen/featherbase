import { afterEach, describe, expect, vi } from 'vitest'
import { test } from './pg-test'
import { app } from '../src/index'
import { sql } from '../src/db'

afterEach(() => vi.unstubAllEnvs())

// Socket information is supplied as the Node adapter's server-owned env,
// never as a request header. Authenticated callers use the same public guard.
function request(path: string, init: RequestInit = {}, ip = '192.0.2.10') {
  return app.request(path, init, { incoming: { socket: { remoteAddress: ip } } })
}

describe('#245 public route admission', () => {
  test('malformed zone-qualified forwarded IPs consume the trusted socket budget', async () => {
    vi.stubEnv('TRUSTED_PROXY_IPS', '192.0.2.10')
    vi.stubEnv('PREAUTH_LOGIN_MAX', '1')
    const send = () => request('/api/login', { method: 'POST', headers: { 'x-forwarded-for': 'fe80::1%eth0, 198.51.100.9' }, body: JSON.stringify({ usr: 'nobody', pwd: 'wrong' }) })
    expect((await send()).status).toBe(401)
    expect((await send()).status).toBe(429)
  })

  test('trusted proxies separate clients but untrusted sockets cannot spoof source budgets', async () => {
    vi.stubEnv('PREAUTH_LOGIN_MAX', '1')
    const send = (forwarded: string, socket: string) => request('/api/login', { method: 'POST', headers: { 'x-forwarded-for': forwarded }, body: JSON.stringify({ usr: 'nobody', pwd: 'wrong' }) }, socket)
    expect((await send('198.51.100.1', '192.0.2.10')).status).toBe(401)
    expect((await send('198.51.100.2', '192.0.2.10')).status).toBe(429)
    vi.stubEnv('TRUSTED_PROXY_IPS', '192.0.2.11')
    expect((await send('198.51.100.1', '192.0.2.11')).status).toBe(401)
    expect((await send('198.51.100.2', '192.0.2.11')).status).toBe(401)
    expect((await send('203.0.113.99, 198.51.100.1', '192.0.2.11')).status).toBe(429)
  })

  test('password credential budget normalizes username and cannot be bypassed with auth or forwarded headers', async ({ admin }) => {
    vi.stubEnv('PREAUTH_PASSWORD_MAX', '2')
    for (const usr of ['Nobody', ' nobody ', 'NOBODY']) {
      const res = await request('/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': Math.random().toString(), authorization: 'Bearer supplied' }, body: JSON.stringify({ usr, pwd: 'wrong' }) })
      expect(res.status).toBe(usr === 'NOBODY' ? 429 : 401)
      if (res.status === 429) {
        expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
        expect(await res.json()).toMatchObject({ error: { type: 'RateLimitError' } })
      }
    }
    const otherSource = await request('/api/login', { method: 'POST', body: JSON.stringify({ usr: 'Nobody', pwd: 'wrong' }) }, '192.0.2.11')
    expect(otherSource.status).toBe(401)
  })

  test('source budget spans usernames; successful auth forgives only credential attempts', async () => {
    vi.stubEnv('PREAUTH_PASSWORD_MAX', '2')
    vi.stubEnv('PREAUTH_LOGIN_MAX', '4')
    const attempt = (usr: string, pwd: string) => request('/api/login', { method: 'POST', body: JSON.stringify({ usr, pwd }) })
    expect((await attempt('Administrator', 'wrong')).status).toBe(401)
    expect((await attempt('Administrator', 'admin')).status).toBe(200)
    expect((await attempt('Administrator', 'wrong')).status).toBe(401)
    expect((await attempt('other', 'wrong')).status).toBe(401)
    expect((await attempt('different', 'wrong')).status).toBe(429)
  })

  test('OAuth initiation and callback have separate budgets; refusal preserves challenge cookies', async () => {
    vi.stubEnv('PREAUTH_OAUTH_LOGIN_MAX', '1')
    vi.stubEnv('PREAUTH_OAUTH_CALLBACK_MAX', '1')
    expect((await request('/api/oauth/google/login')).status).toBe(302)
    expect((await request('/api/oauth/google/login')).status).toBe(429)
    expect((await request('/api/oauth/google/callback?state=bad')).status).not.toBe(429)
    const blocked = await request('/api/oauth/google/callback?state=bad', { headers: { cookie: 'oauth_state=bad; oauth_verifier=keep' } })
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('set-cookie')).toBeNull()
  })

  test('successful public forms still consume budget even with a supplied session', async ({ admin }) => {
    vi.stubEnv('PREAUTH_FORM_MAX', '1')
    await admin.post('/api/table_def', { name: 'Limited Intake', columns: [{ column_name: 'title', column_type: 'Data' }] })
    await admin.post('/api/save_row', { table: 'Web Form', row: { row_id: 'Limited Intake Form', title: 'Intake', route: 'limited-intake', ref_table: 'Limited Intake', published: true, web_fields: ['title'] } })
    const login = await request('/api/login', { method: 'POST', body: JSON.stringify({ usr: 'Administrator', pwd: 'admin' }) })
    const { token } = await login.json() as { token: string }
    const send = () => request('/api/web_form/limited-intake', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ values: { title: 'one' } }) })
    expect((await send()).status).toBe(201)
    expect((await send()).status).toBe(429)
    expect((await sql`select count(*)::int as n from limited_intake`)[0].n).toBe(1)
  })
})

import { afterEach, describe, expect, vi } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { app } from '../src/index'
import { sql } from '../src/db'
import { setUserPassword } from '../src/auth'
import { preAuthPolicy } from '../src/pre-auth-rate-limit'
import { signInAddresses } from './sign-in-address-utils'

// #396: every sign-in records the client's network address on its Activity
// Log entry, derived the same way the pre-auth rate limiter finds its source:
// the socket peer; behind TRUSTED_PROXY_IPS, the right-most untrusted
// X-Forwarded-For hop; and, when CLIENT_ADDRESS_HEADER names a header the
// edge overwrites, that header's single address. The caller's left-most
// X-Forwarded-For is never believed.

afterEach(() => vi.unstubAllEnvs())

// The socket is the Node adapter's server-owned env, never a request header.
function login(usr: string, headers: Record<string, string> = {}, socket = '192.0.2.10') {
  return app.request('/api/login', { method: 'POST', headers, body: JSON.stringify({ usr, pwd: 'address-pw-1' }) }, { incoming: { socket: { remoteAddress: socket } } })
}

async function person(admin: TestClient, email: string) {
  const saved = await admin.post<{ row_id: string }>('/api/save_row', { table: 'Person', row: { email, enabled: true } })
  await setUserPassword(saved.row_id, 'address-pw-1')
  return saved.row_id
}

describe('#396: the address recorded for a password sign-in', () => {
  test('with no proxy configured, the socket peer, and forwarded headers are ignored', async ({ admin }) => {
    const id = await person(admin, 'socket.peer@example.com')
    expect((await login('socket.peer@example.com', { 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '203.0.113.9' }, '198.51.100.20')).status).toBe(200)
    expect(await signInAddresses(id)).toEqual(['198.51.100.20'])
  })

  test('behind a trusted proxy, the right-most hop it appended, never the caller-supplied left-most one', async ({ admin }) => {
    vi.stubEnv('TRUSTED_PROXY_IPS', '192.0.2.10')
    const id = await person(admin, 'behind.proxy@example.com')
    expect((await login('behind.proxy@example.com', { 'x-forwarded-for': '203.0.113.9, 198.51.100.30' })).status).toBe(200)
    expect(await signInAddresses(id)).toEqual(['198.51.100.30'])
  })

  test('with CLIENT_ADDRESS_HEADER, the single address the edge put in that header', async ({ admin }) => {
    vi.stubEnv('CLIENT_ADDRESS_HEADER', 'X-Real-IP')
    const id = await person(admin, 'edge.header@example.com')
    const res = await login('edge.header@example.com', { 'x-real-ip': ' 198.51.100.40 ', 'x-forwarded-for': '203.0.113.9' })
    expect(res.status).toBe(200)
    // The address is for the Activity Log only, never carried in the token.
    const { token } = (await res.json()) as { token: string }
    expect(Buffer.from(token.split('.')[1], 'base64url').toString()).not.toContain('198.51.100.40')
    // IPv4-mapped IPv6 is the same client, written one way.
    expect((await login('edge.header@example.com', { 'x-real-ip': '::ffff:198.51.100.41' })).status).toBe(200)
    expect((await signInAddresses(id)).sort()).toEqual(['198.51.100.40', '198.51.100.41'])
  })

  test('a list, a malformed value or a missing header in CLIENT_ADDRESS_HEADER falls back to the socket peer', async ({ admin }) => {
    vi.stubEnv('CLIENT_ADDRESS_HEADER', 'x-forwarded-for')
    const id = await person(admin, 'edge.fallback@example.com')
    const tries: Record<string, string>[] = [{ 'x-forwarded-for': '203.0.113.9, 198.51.100.50' }, { 'x-forwarded-for': 'not-an-address' }, { 'x-forwarded-for': 'fe80::1%eth0' }, {}]
    for (const headers of tries)
      expect((await login('edge.fallback@example.com', headers, '198.51.100.60')).status).toBe(200)
    expect(await signInAddresses(id)).toEqual(['198.51.100.60', '198.51.100.60', '198.51.100.60', '198.51.100.60'])
  })

  test('with no socket and no usable header, the address is left empty rather than invented', async ({ admin, api }) => {
    const id = await person(admin, 'no.socket@example.com')
    expect((await api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr: 'no.socket@example.com', pwd: 'address-pw-1' }) })).status).toBe(200)
    expect(await signInAddresses(id)).toEqual([null])
  })

  test('the pre-auth budget counts by the same address', async () => {
    vi.stubEnv('CLIENT_ADDRESS_HEADER', 'x-real-ip')
    vi.stubEnv('PREAUTH_LOGIN_MAX', '1')
    const send = (client: string) => login('nobody', { 'x-real-ip': client })
    expect((await send('198.51.100.70')).status).toBe(401)
    expect((await send('198.51.100.71')).status).toBe(401) // another client, its own budget
    expect((await send('198.51.100.70')).status).toBe(429)
  })

  test('a CLIENT_ADDRESS_HEADER that is not a header name is refused as configuration', () => {
    for (const bad of ['X-Real-IP, X-Forwarded-For', 'x real ip', 'x-real-ip:'])
      expect(() => preAuthPolicy({ CLIENT_ADDRESS_HEADER: bad })).toThrow(/CLIENT_ADDRESS_HEADER/)
    expect(preAuthPolicy({ CLIENT_ADDRESS_HEADER: ' X-Real-IP ' }).clientHeader).toBe('x-real-ip')
    expect(preAuthPolicy({}).clientHeader).toBeNull()
  })
})

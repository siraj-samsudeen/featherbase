// person-identities (D10, review M6): direct sign-up with a username and a
// password, closed unless the password method's rule is `create`.
import { describe, expect, vi, afterEach } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { setPasswordMethod } from './identity-fixtures'

const signUp = (api: { fetch: (p: string, i?: RequestInit) => Promise<Response> }, body: unknown) =>
  api.fetch('/api/signup', { method: 'POST', body: JSON.stringify(body) })

afterEach(() => vi.unstubAllEnvs())

describe('sign up with a username and password', () => {
  test('closed by default: not offered and refused like an unknown route', async ({ api }) => {
    const brand = (await (await api.fetch('/api/brand')).json()) as { sign_up_open: boolean }
    expect(brand.sign_up_open).toBe(false)
    expect((await signUp(api, { username: 'meena', password: 'meena-pw-1' })).status).toBe(404)
  })

  test('open: the account is created with no email and no roles, and signed in', async ({ api }) => {
    await setPasswordMethod({ new_person: 'create' })
    expect(((await (await api.fetch('/api/brand')).json()) as { sign_up_open: boolean }).sign_up_open).toBe(true)
    const res = await signUp(api, { username: 'meena', password: 'meena-pw-1', full_name: 'Meena K' })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { token: string; user: { row_id: string; email: string | null } }
    expect(body.user).toMatchObject({ row_id: 'meena', email: null })
    expect(res.headers.getSetCookie().some((c) => c.startsWith('sid='))).toBe(true)
    const roles = await sql`select role from has_role where parent = 'meena'`
    expect(roles).toHaveLength(0)
    expect((await api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr: 'meena', pwd: 'meena-pw-1' }) })).status).toBe(200)
  })

  test('no email, a taken or reserved username, and a short password are refused', async ({ api }) => {
    await setPasswordMethod({ new_person: 'create' })
    expect((await signUp(api, { username: 'asha', password: 'asha-pw-1', email: 'asha@example.com' })).status).toBe(417)
    expect((await signUp(api, { username: 'asha', password: 'asha-pw-1' })).status).toBe(201)
    expect((await signUp(api, { username: 'ASHA', password: 'asha-pw-2' })).status).toBe(417) // not a lowercase slug
    expect((await signUp(api, { username: 'asha', password: 'asha-pw-2' })).status).toBe(409)
    expect((await signUp(api, { username: 'administrator', password: 'x-pw-123' })).status).toBe(417)
    expect((await signUp(api, { username: 'guest', password: 'x-pw-123' })).status).toBe(417)
    expect((await signUp(api, { username: 'short', password: '123' })).status).toBe(417)
  })

  test('sign-up has its own pre-auth budget', async ({ api }) => {
    vi.stubEnv('PREAUTH_SIGNUP_MAX', '1')
    await setPasswordMethod({ new_person: 'create' })
    await signUp(api, { username: 'first', password: 'first-pw-1' })
    expect((await signUp(api, { username: 'second', password: 'second-pw-1' })).status).toBe(429)
  })
})

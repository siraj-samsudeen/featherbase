// person-identities, PR #371 Codex review and final-gate minors.
import { afterEach, describe, expect, vi } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
import { hashPassword } from '../src/auth'
import { SIGN_IN_METHOD_KINDS } from 'shared'
import { KINDS } from '../src/identities'
import { configureGoogle, inviteGoogleRaw, removeDelegated, setPasswordMethod } from './identity-fixtures'
import { googleSignIn } from './google-mock'

afterEach(() => vi.unstubAllEnvs())

const patchUser = async (admin: { fetch: (p: string, i?: RequestInit) => Promise<Response> }, id: string, change: Record<string, unknown>) => {
  const [u] = await sql`select updated_at from "user" where row_id = ${id}`
  return admin.fetch(`/api/table/User/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ ...change, updated_at: u.updated_at }) })
}

describe('Codex P1: any change of email cancels every unclaimed invite', () => {
  test('an invite to a different address dies when the email changes', async ({ admin }) => {
    await saveDoc('User', { row_id: 'RR-c1', email: 'one@jeyarama.com', enabled: true }, 'Administrator')
    await inviteGoogleRaw('RR-c1', 'other.address@gmail.com')
    expect((await patchUser(admin, 'RR-c1', { email: 'two@jeyarama.com' })).ok).toBe(true)
    expect(await sql`select 1 from user_identity where user_id = 'RR-c1' and subject is null`).toHaveLength(0)
  })

  test('an invite made while the email was empty dies when an email is set, and when it is cleared', async ({ admin }) => {
    await saveDoc('User', { row_id: 'RR-c2', enabled: true }, 'Administrator')
    await inviteGoogleRaw('RR-c2', 'staff.google@gmail.com')
    expect((await patchUser(admin, 'RR-c2', { email: 'set@jeyarama.com' })).ok).toBe(true)
    expect(await sql`select 1 from user_identity where user_id = 'RR-c2' and subject is null`).toHaveLength(0)
    await inviteGoogleRaw('RR-c2', 'again@gmail.com')
    expect((await patchUser(admin, 'RR-c2', { email: null })).ok).toBe(true)
    expect(await sql`select 1 from user_identity where user_id = 'RR-c2' and subject is null`).toHaveLength(0)
  })

  test('a claimed link is kept, and a save that does not change the email cancels nothing', async ({ admin }) => {
    await saveDoc('User', { row_id: 'RR-c3', email: 'keep@jeyarama.com', enabled: true }, 'Administrator')
    await inviteGoogleRaw('RR-c3', 'pending@gmail.com')
    await sql`insert into user_identity (id, user_id, method, subject, linked_by) values ('uid_c3', 'RR-c3', 'google', 'g-c3', 'test')`
    expect((await patchUser(admin, 'RR-c3', { email: ' KEEP@jeyarama.com ', full_name: 'Same' })).ok).toBe(true)
    expect(await sql`select 1 from user_identity where user_id = 'RR-c3'`).toHaveLength(2)
    expect((await patchUser(admin, 'RR-c3', { email: 'new@jeyarama.com' })).ok).toBe(true)
    expect(await sql`select id from user_identity where user_id = 'RR-c3'`).toEqual([{ id: 'uid_c3' }])
  })
})

describe('Codex P2: Google is never enabled while it cannot work', () => {
  test('turning Google on without a client id (and no dev mock) is refused', async ({ admin }) => {
    vi.stubEnv('ALLOW_MOCK_OAUTH', '')
    await configureGoogle({ enabled: false, client_id: '' })
    const [g] = await sql`select updated_at from sign_in_method where row_id = 'google'`
    const res = await admin.fetch(`/api/table/${encodeURIComponent('Sign In Method')}/google`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: true, updated_at: g.updated_at }),
    })
    expect(res.status).toBe(417)
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/client id/i)
  })

  test('a delegated method cannot be turned on with an unusable address', async ({ admin }) => {
    const res = await admin.fetch('/api/save_row', {
      method: 'POST',
      body: JSON.stringify({ table: 'Sign In Method', row: { row_id: 'plain_http', kind: 'delegated_password', label: 'HR', enabled: true, service_url: 'http://hr.example.test/login' } }),
    })
    expect(res.status).toBe(417)
  })
})

describe('Codex P2: sign-up takes a username and a password only', () => {
  test('a full name is refused like an email', async ({ api }) => {
    await setPasswordMethod({ new_person: 'create' })
    const res = await api.fetch('/api/signup', { method: 'POST', body: JSON.stringify({ username: 'only.two', password: 'only-two-1', full_name: 'Extra' }) })
    expect(res.status).toBe(417)
    const ok = await api.fetch('/api/signup', { method: 'POST', body: JSON.stringify({ username: 'only.two', password: 'only-two-1' }) })
    expect(ok.status).toBe(201)
    expect(((await ok.json()) as { user: { full_name: string } }).user.full_name).toBe('only.two')
  })
})

describe('Codex P2: one list of sign-in method kinds', () => {
  test('the server kinds, the Table choices and the shared list agree', async () => {
    expect(Object.keys(KINDS).sort()).toEqual([...SIGN_IN_METHOD_KINDS].sort())
    const [c] = await sql`select choices from column_def where parent = 'Sign In Method' and column_name = 'kind'`
    expect(String(c.choices).split('\n').sort()).toEqual([...SIGN_IN_METHOD_KINDS].sort())
  })
})

describe('usernames on the generic save path', () => {
  test('a username must be a lowercase slug and must not equal anyone else\'s id, username or email', async ({ admin }) => {
    await saveDoc('User', { row_id: 'RR-u1', email: 'asha@jeyarama.com', username: 'asha', enabled: true }, 'Administrator')
    const save = (row: Record<string, unknown>) => admin.fetch('/api/save_row', { method: 'POST', body: JSON.stringify({ table: 'User', row }) })
    expect((await save({ row_id: 'RR-u2', username: 'not a slug!', enabled: true })).status).toBe(417)
    expect((await save({ row_id: 'RR-u3', username: 'ASHA', enabled: true })).status).toBe(417) // folds to asha: taken
    expect((await save({ row_id: 'RR-u4', username: 'rr-u1', enabled: true })).status).toBe(417) // someone's id
    expect((await save({ row_id: 'RR-u5', username: 'asha@jeyarama.com', enabled: true })).status).toBe(417) // someone's email
    expect((await save({ row_id: 'asha@jeyarama.com', enabled: true })).status).toBe(417) // id equal to someone's email
    expect((await save({ row_id: 'RR-u6', username: 'meera', enabled: true })).status).toBe(201)
  })
})

describe('password sign-in ranks', () => {
  const login = (api: { fetch: (p: string, i?: RequestInit) => Promise<Response> }, usr: string, pwd: string) =>
    api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr, pwd }) })

  test('an id and another person\'s username at the same rank answer nobody', async ({ api }) => {
    // Only older data can hold this (saves now refuse it), so it is written directly.
    await sql`insert into "user" (row_id, enabled, password_hash, created_by, updated_by) values ('ravi', true, ${hashPassword('ravi-pw-1')}, 'Administrator', 'Administrator')`
    await sql`insert into "user" (row_id, username, enabled, password_hash, created_by, updated_by) values ('usr_ravi2', 'RAVI2', true, ${hashPassword('ravi-pw-2')}, 'Administrator', 'Administrator')`
    await sql`update "user" set username = 'ravi' where row_id = 'usr_ravi2'`
    expect((await login(api, 'Ravi', 'ravi-pw-1')).status).toBe(401)
    expect((await login(api, 'Ravi', 'ravi-pw-2')).status).toBe(401)
    expect((await login(api, 'ravi', 'ravi-pw-1')).status).toBe(200) // the exact id still wins
  })

  test('a username beats another person\'s email', async ({ api }) => {
    await sql`insert into "user" (row_id, username, enabled, password_hash, created_by, updated_by) values ('usr_meena', 'meena', true, ${hashPassword('meena-pw-1')}, 'Administrator', 'Administrator')`
    await sql`insert into "user" (row_id, email, enabled, password_hash, created_by, updated_by) values ('other', 'meena', true, ${hashPassword('other-pw-1')}, 'Administrator', 'Administrator')`
    expect((await login(api, 'meena', 'other-pw-1')).status).toBe(401)
    const ok = await login(api, 'MEENA', 'meena-pw-1')
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { user: { row_id: string } }).user.row_id).toBe('usr_meena')
  })

  test('a password reset can be asked for by username', async ({ api }) => {
    await sql`insert into "user" (row_id, username, email, enabled, password_hash, created_by, updated_by) values ('usr_reset', 'resetme', 'resetme@jeyarama.com', true, ${hashPassword('reset-pw-1')}, 'Administrator', 'Administrator')`
    const before = (await sql`select count(*)::int as n from password_reset where "user" = 'usr_reset'`)[0].n
    await api.fetch('/api/reset_password_request', { method: 'POST', body: JSON.stringify({ usr: 'ResetMe' }) })
    const after = (await sql`select count(*)::int as n from password_reset where "user" = 'usr_reset'`)[0].n
    expect(after).toBe(before + 1)
  })
})

describe('placeholder addresses are refused everywhere', () => {
  test('inviting a .invalid Google address is a 417 on email', async ({ admin }) => {
    await saveDoc('User', { row_id: 'RR-inv', enabled: true }, 'Administrator')
    const res = await admin.fetch('/api/users/RR-inv/identities', { method: 'POST', body: JSON.stringify({ method: 'google', email: 'rr-inv@staff.jeyarama.invalid' }) })
    expect(res.status).toBe(417)
    expect(((await res.json()) as { error: { fields: Record<string, string> } }).error.fields.email).toMatch(/invalid/)
  })

  test('a Google account reporting a .invalid address is not admitted', async ({ api }) => {
    await configureGoogle({ allowed_email_domains: '*', new_person: 'create' })
    expect((await googleSignIn(api, 'someone@staff.jeyarama.invalid', { subject: 'g-invalid' })).status).toBe(417)
    expect(await sql`select 1 from user_identity where subject = 'g-invalid'`).toHaveLength(0)
  })
})

describe('delegated sign-in with nothing connected', () => {
  test('any body, even an empty one, is answered as not found', async ({ api }) => {
    await removeDelegated()
    for (const body of ['{}', '', '{"usr":"x","pwd":"y","method":"stylehr"}']) {
      const res = await api.fetch('/api/login/delegated', { method: 'POST', body })
      expect(res.status, body).toBe(404)
    }
  })
})

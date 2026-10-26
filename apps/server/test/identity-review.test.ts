// person-identities, second review round (PR #371): sessions that cannot vouch
// for the person, administrator lockouts, the audit actor, sync-friendly 409s,
// and a delegated provider configured only through its row's settings.
import { afterEach, describe, expect, vi } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { sign } from 'hono/jwt'
import { test } from './pg-test'
import { sql } from '../src/db'
import { makePerson } from './fixtures'
import { hashPassword, issueSession } from '../src/auth'
import { _setDelegatedFetch } from '../src/delegated-login'
import { configureDelegated, configureGoogle, linkDelegated } from './identity-fixtures'
import { googleSignIn, redeemSession } from './google-mock'

const SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me'
const now = () => Math.floor(Date.now() / 1000)
const as = (api: TestClient, token: string) => (path: string, init: RequestInit = {}) =>
  api.fetch(path, { ...init, headers: { authorization: `Bearer ${token}` } })

afterEach(() => {
  vi.unstubAllEnvs()
  _setDelegatedFetch(null)
})

// person-rename: ids are minted; the name a test uses is the username.
async function person(username: string, extra: Record<string, unknown> = {}) {
  return makePerson({ username: username.toLowerCase(), ...extra })
}

/** The five ways to add or remove access a weak session must not reach. */
async function changesRefused(api: TestClient, token: string, identity: string) {
  const call = as(api, token)
  return [
    (await call('/api/set_password', { method: 'POST', body: JSON.stringify({ password: 'kept-forever-1' }) })).status,
    (await call('/api/access_tokens', { method: 'POST', body: JSON.stringify({ label: 'keep' }) })).status,
    (await call('/api/oauth/google/link', { redirect: 'manual' })).status,
    (await call(`/api/me/identities/${identity}`, { method: 'DELETE' })).status,
    (await call('/api/me/password', { method: 'DELETE' })).status,
  ]
}

describe('sessions that cannot vouch for the person (A-M1, B-M2)', () => {
  test('a session minted before the upgrade is ended: it reads nothing and changes nothing', async ({ api }) => {
    await configureDelegated()
    const lp = await person('legacy.person')
    const identity = await linkDelegated(lp, 'legacy_hr')
    const legacy = await sign({ sub: lp, exp: now() + 3600 }, SECRET) // no iat, no method
    expect((await as(api, legacy)('/api/whoami')).status).toBe(401)
    expect(await changesRefused(api, legacy, identity)).toEqual([401, 401, 401, 401, 401])
    expect(await sql`select 1 from sign_in_identity where id = ${identity}`).toHaveLength(1)
  })

  test('a preview click-through is marked and cannot add or remove access', async ({ api }) => {
    await configureDelegated()
    const pp = await person('preview.person')
    const identity = await linkDelegated(pp, 'preview_hr')
    vi.stubEnv('PREVIEW_LOGIN_KEY', 'k'.repeat(40))
    vi.stubEnv('PREVIEW_LOGIN_USER', pp)
    const res = await api.fetch(`/preview?key=${'k'.repeat(40)}`, { redirect: 'manual' })
    expect(res.status).toBe(302)
    const session = await redeemSession(api, res)
    expect((session.user as unknown as { sign_in: { preview: boolean } }).sign_in.preview).toBe(true)
    expect(await changesRefused(api, session.token, identity)).toEqual([403, 403, 403, 403, 403])
  })

  test('adding a first password needs a recent sign-in; changing one does not', async ({ api, admin }) => {
    const fp = await person('fresh.person')
    const old = await sign({ sub: fp, iat: now() - 3600, exp: now() + 3600, jti: 'old-session' }, SECRET)
    const body = JSON.stringify({ password: 'first-pw-123' })
    expect((await as(api, old)('/api/set_password', { method: 'POST', body })).status).toBe(401)
    const fresh = (await issueSession(fp)).token
    expect((await as(api, fresh)('/api/set_password', { method: 'POST', body })).status).toBe(200)
    expect((await as(api, old)('/api/set_password', { method: 'POST', body: JSON.stringify({ password: 'second-pw-1' }) })).status).toBe(200)
    void admin
  })
})

describe('administrators are never locked out (A-M2, minor 1)', () => {
  test('a System Manager cannot remove their password when their only other link is delegated', async ({ api, admin }) => {
    await configureDelegated()
    const smd = await person('sm.delegated', { roles: [{ role: 'System Manager' }] })
    await admin.post('/api/set_password', { user: smd, password: 'sm-delegated-1' })
    await linkDelegated(smd, 'sm_hr')
    const { token } = (await (await api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr: 'sm.delegated', pwd: 'sm-delegated-1' }) })).json()) as { token: string }
    expect((await as(api, token)('/api/me/password', { method: 'DELETE' })).status).toBe(409)
    const [row] = await sql`select password_hash is not null as has from person where row_id = ${smd}`
    expect(row.has).toBe(true)
  })

  test('Google counts only when it can sign anyone in; blanking its client id is guarded', async ({ admin }) => {
    vi.stubEnv('ALLOW_MOCK_OAUTH', '')
    await configureGoogle({ client_id: 'real-client-id' })
    const smog = await person('sm.only.google', { roles: [{ role: 'System Manager' }] })
    await sql`insert into sign_in_identity (id, person_id, method, subject, linked_by) values ('uid_smog', ${smog}, 'google', 'g-smog', 'test')`
    const [g] = await sql`select updated_at from sign_in_method where row_id = 'google'`
    const blank = await admin.fetch(`/api/table/${encodeURIComponent('Sign In Method')}/google`, {
      method: 'PATCH',
      body: JSON.stringify({ client_id: '', updated_at: g.updated_at }),
    })
    expect(blank.status).toBe(417)
    expect(((await blank.json()) as { error: { message: string } }).error.message).toContain(smog)
    // An administrator unlinking that only way in is refused too.
    expect((await admin.fetch('/api/identities/uid_smog', { method: 'DELETE' })).status).toBe(417)
  })

  test('moving a System Manager\'s only way in to someone else is refused and names them; the link stays', async ({ admin }) => {
    vi.stubEnv('ALLOW_MOCK_OAUTH', '')
    await configureGoogle({ client_id: 'real-client-id' })
    const smove = await person('sm.only.moved', { roles: [{ role: 'System Manager' }] })
    const other = await person('someone.else')
    await sql`insert into sign_in_identity (id, person_id, method, subject, linked_by) values ('uid_smove', ${smove}, 'google', 'g-smove', 'test')`
    const res = await admin.fetch('/api/identities/uid_smove', { method: 'PATCH', body: JSON.stringify({ person_id: other }) })
    expect(res.status).toBe(417)
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain(`would lock out ${smove}`)
    expect(await sql`select person_id, ended_at from sign_in_identity where id = 'uid_smove'`).toEqual([{ person_id: smove, ended_at: null }])
    // Someone who is not an administrator can have theirs moved.
    await sql`insert into sign_in_identity (id, person_id, method, subject, linked_by) values ('uid_plain', ${other}, 'google', 'g-plain', 'test')`
    const third = await person('third.person')
    expect((await admin.fetch('/api/identities/uid_plain', { method: 'PATCH', body: JSON.stringify({ person_id: third }) })).status).toBe(200)
  })
})

describe('linking for the roster sync (minor 3) and the audit actor (B-M1)', () => {
  test('re-posting the same link is 200; a clash names which rule, the identity and its owner', async ({ admin }) => {
    await configureDelegated()
    const rr50 = await person('RR-50')
    const rr51 = await person('RR-51')
    const first = await admin.fetch(`/api/people/${rr50}/identities`, { method: 'POST', body: JSON.stringify({ method: 'stylehr', subject: 'RR-50', sign_in_name: 'tl_50' }) })
    expect(first.status).toBe(201)
    const { id } = (await first.json()) as { id: string }
    const again = await admin.fetch(`/api/people/${rr50}/identities`, { method: 'POST', body: JSON.stringify({ method: 'stylehr', subject: 'RR-50', sign_in_name: 'tl_50' }) })
    expect(again.status).toBe(200)
    expect(((await again.json()) as { id: string }).id).toBe(id)

    const bySubject = await admin.fetch(`/api/people/${rr51}/identities`, { method: 'POST', body: JSON.stringify({ method: 'stylehr', subject: 'RR-50' }) })
    expect(bySubject.status).toBe(409)
    expect(((await bySubject.json()) as { error: { fields: Record<string, string> } }).error.fields).toEqual({ clash: 'subject', identity: id, person: rr50 })
    const byName = await admin.fetch(`/api/people/${rr51}/identities`, { method: 'POST', body: JSON.stringify({ method: 'stylehr', subject: 'RR-51', sign_in_name: 'TL_50' }) })
    expect(byName.status).toBe(409)
    expect(((await byName.json()) as { error: { fields: Record<string, string> } }).error.fields).toEqual({ clash: 'sign_in_name', identity: id, person: rr50 })
  })

  test('an administrator\'s link, move and unlink are recorded as theirs, naming the person', async ({ admin }) => {
    await configureDelegated()
    const rr60 = await person('RR-60')
    const rr61 = await person('RR-61')
    const { id } = await admin.post<{ id: string }>(`/api/people/${rr60}/identities`, { method: 'stylehr', subject: 'RR-60' })
    // person-resolution D4/D5: a move ends the old link (kept as history) and
    // the new holder's link carries on under its own id.
    const moved = (await (await admin.fetch(`/api/identities/${id}`, { method: 'PATCH', body: JSON.stringify({ person_id: rr61 }) })).json()) as { id: string }
    expect(moved.id).not.toBe(id)
    await admin.fetch(`/api/identities/${moved.id}`, { method: 'DELETE' })
    const rows = await sql`select "user", created_by, operation from activity_log
      where operation like ${`%(${id})`} or operation like ${`%(${moved.id})`} order by created_at`
    expect(rows.map((r) => [r.user, r.created_by])).toEqual([
      ['Administrator', 'Administrator'],
      ['Administrator', 'Administrator'],
      ['Administrator', 'Administrator'],
    ])
    expect(rows.map((r) => r.operation)).toEqual([
      `identity_linked stylehr for ${rr60} (${id})`,
      `identity_moved stylehr for ${rr60} to ${rr61} (${id})`,
      `identity_unlinked stylehr for ${rr61} (${moved.id})`,
    ])
    // Both rows are written in one transaction, so `linked_at` ties; order by
    // the reason instead, which names each row once ('moved' < 'unlinked').
    expect(await sql`select person_id, ended_reason from sign_in_identity where id in (${id}, ${moved.id}) order by ended_reason`).toEqual([
      { person_id: rr60, ended_reason: 'moved' },
      { person_id: rr61, ended_reason: 'unlinked' },
    ])
  })

  test('a sign-in records its method and whether it was test mode', async ({ api }) => {
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', 'trust-any-password')
    await configureDelegated()
    const rr70 = await person('RR-70')
    await linkDelegated(rr70, 'tl_70', { subject: 'RR-70' })
    expect((await api.fetch('/api/login/delegated', { method: 'POST', body: JSON.stringify({ usr: 'RR-70', pwd: '', method: 'stylehr' }) })).status).toBe(200)
    const [row] = await sql`select sign_in_method, test_mode from activity_log where "user" = ${rr70} and operation = 'login'`
    expect(row).toEqual({ sign_in_method: 'stylehr', test_mode: true })
  })
})

describe('sign-in details', () => {
  test('a fresh Administrator with only a password hash signs in', async ({ api }) => {
    await sql`delete from sign_in_identity where person_id = 'Administrator'`
    await sql`update person set password_hash = ${hashPassword('fresh-admin-pw')} where row_id = 'Administrator'`
    const res = await api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr: 'Administrator', pwd: 'fresh-admin-pw' }) })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { user: { sign_in: { method: string } } }).user.sign_in.method).toBe('password')
  })

  test('Google creation is refused when the address is taken, never linked', async ({ api }) => {
    await configureGoogle({ allowed_email_domains: '*' })
    // person-rename: an id is never an address, so "taken" means another
    // person's email, whatever its case.
    await person('taken', { email: 'taken@gmail.com' })
    expect((await googleSignIn(api, 'taken@gmail.com', { subject: 'g-taken-1' })).status).toBe(401)
    await person('someone', { email: 'used@gmail.com' })
    expect((await googleSignIn(api, 'USED@gmail.com', { subject: 'g-taken-2' })).status).toBe(401)
    expect(await sql`select 1 from sign_in_identity where subject in ('g-taken-1', 'g-taken-2')`).toHaveLength(0)
  })

  test('a Google account with no verified address becomes a person with an opaque id and no email', async () => {
    const { completeSignIn } = await import('../src/sign-in')
    const { methodOfKind } = await import('../src/identities')
    await configureGoogle({ new_person: 'create' })
    const google = (await methodOfKind('google'))!
    const issued = await completeSignIn(google, { status: 'verified', subject: '1234567890', email: 'unverified@gmail.com', email_verified: false }, null)
    expect(issued.user.row_id).toMatch(/^psn_[a-z2-7]{20}$/)
    expect(issued.user.email).toBeNull()
  })

  test('a second Google row is refused', async ({ admin }) => {
    const res = await admin.fetch('/api/save_row', {
      method: 'POST',
      body: JSON.stringify({ table: 'Sign In Method', row: { row_id: 'google2', kind: 'google', label: 'Google 2' } }),
    })
    expect(res.status).toBe(409)
  })
})

describe('a delegated provider is configuration only (genericity)', () => {
  test('a provider with its own field names and answer shape signs in through settings alone', async ({ api, admin }) => {
    await admin.post('/api/save_row', {
      table: 'Sign In Method',
      row: {
        row_id: 'payroll', kind: 'delegated_password', label: 'Payroll', enabled: true, new_person: 'refuse',
        service_url: 'https://payroll.example.test/login',
        settings: { id_field: 'username', password_field: 'secret', success_keys: ['session_id'], nested_keys: ['payload'], left_status_keys: ['state'], left_words: ['gone'] },
      },
    })
    const pay1 = await person('PAY-1')
    await linkDelegated(pay1, 'pay_one', { key: 'payroll', subject: 'PAY-1' })
    const bodies: unknown[] = []
    let answer: unknown = { payload: { session_id: 'abc' } }
    _setDelegatedFetch((async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)))
      return Response.json(answer)
    }) as unknown as typeof fetch)
    const signIn = () => api.fetch('/api/login/delegated', { method: 'POST', body: JSON.stringify({ usr: 'pay_one', pwd: 'pw-1', method: 'payroll' }) })
    expect((await signIn()).status).toBe(200)
    expect(bodies[0]).toEqual({ username: 'pay_one', secret: 'pw-1' })
    answer = { token: 'stylehr-shaped answer means nothing here' }
    expect((await signIn()).status).toBe(503)
    answer = { payload: { session_id: 'abc', state: 'Gone' } }
    expect((await signIn()).status).toBe(403)
  })

  test('a malformed wire format is refused when saved', async ({ admin }) => {
    const res = await admin.fetch('/api/save_row', {
      method: 'POST',
      body: JSON.stringify({ table: 'Sign In Method', row: { row_id: 'bad', kind: 'delegated_password', label: 'Bad', settings: { success_keys: 'token' } } }),
    })
    expect(res.status).toBe(417)
  })
})

describe('a delegated method\'s settings may arrive as JSON text', () => {
  const save = (admin: TestClient, row_id: string, settings: unknown) =>
    admin.fetch('/api/save_row', {
      method: 'POST',
      body: JSON.stringify({ table: 'Sign In Method', row: { row_id, kind: 'delegated_password', label: row_id, enabled: false, settings } }),
    })

  test('JSON text is parsed and checked like an object, and text that is not JSON is refused naming the field', async ({ admin }) => {
    expect((await save(admin, 'text_ok', '{"success_keys":["ok"]}')).status).toBe(201)
    const bad = await save(admin, 'text_bad', '{"success_keys": ')
    expect(bad.status).toBe(417)
    expect(await bad.json()).toMatchObject({ error: { message: 'settings must be JSON', fields: { settings: 'settings must be JSON' } } })
    const wrong = await save(admin, 'text_wrong', '{"success_keys":"ok"}')
    expect(wrong.status).toBe(417)
    expect((await save(admin, 'text_blank', '')).status).toBe(201)
  })
})

describe('third review round', () => {
  test('a delegated row with malformed settings is skipped with a warning naming it', async ({ api }) => {
    await sql`insert into sign_in_method (row_id, kind, label, enabled, new_person, self_link, service_url, settings, created_at, updated_at)
      values ('broken_hr', 'delegated_password', 'Broken HR', true, 'refuse', false, 'https://broken.example.test/login', ${sql.json({ success_keys: 'not-a-list' })}, now(), now())`
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const brand = (await (await api.fetch('/api/brand')).json()) as { sign_in_methods: { key: string }[] }
    expect(brand.sign_in_methods.map((m) => m.key)).not.toContain('broken_hr')
    expect(warn.mock.calls.map((c) => String(c[0])).some((line) => line.includes('broken_hr'))).toBe(true)
    warn.mockRestore()
  })

  test('the admin identity list names every method, including turned-off ones', async ({ admin }) => {
    await configureDelegated({ enabled: false })
    const rr80 = await person('RR-80')
    await linkDelegated(rr80, 'tl_80', { subject: 'RR-80' })
    const res = await admin.get<{ methods: { key: string; label: string; enabled: boolean }[] }>(`/api/people/${rr80}/identities`)
    expect(res.methods).toContainEqual({ key: 'stylehr', kind: 'delegated_password', label: 'StyleHR', enabled: false })
  })

  test('a failed Google link always comes back to the Sign-in methods page, never raw JSON', async ({ api }) => {
    const lf = await person('link.fail')
    const token = (await issueSession(lf, { method: 'password' })).token
    await sql`update person set password_hash = ${hashPassword('x')} where row_id = ${lf}`
    const start = await api.fetch('/api/oauth/google/link', { headers: { cookie: `sid=${token}` }, redirect: 'manual' })
    expect(start.status).toBe(302)
    const state = new URLSearchParams((start.headers.get('location') ?? '').split('?')[1]).get('state') as string
    const cookies = [`sid=${token}`, ...start.headers.getSetCookie().map((c) => c.split(';')[0])].join('; ')
    // A code the provider will not exchange.
    const bad = await api.fetch(`/api/oauth/google/callback?state=${encodeURIComponent(state)}&code=garbage`, { headers: { cookie: cookies }, redirect: 'manual' })
    expect(bad.status).toBe(302)
    expect(bad.headers.get('location')).toBe('/featherbase/account/sign-in-methods?link=google_failed')
    // A link callback that lost its state cookie (another browser, expired).
    const lost = await api.fetch(`/api/oauth/google/callback?state=${encodeURIComponent(state)}&code=garbage`, { headers: { cookie: `sid=${token}` }, redirect: 'manual' })
    expect(lost.status).toBe(302)
    expect(lost.headers.get('location')).toBe('/featherbase/account/sign-in-methods?link=expired')
  })
})

describe('a person id is permanent', () => {
  test('a Person row cannot be renamed, through the API or directly', async ({ admin }) => {
    const rr90 = await person('RR-90')
    const res = await admin.fetch(`/api/table/Person/${rr90}:rename`, { method: 'POST', body: JSON.stringify({ new_name: 'psn_rr91aaaaaaaaaaaaaaaa' }) })
    expect(res.ok).toBe(false)
    await expect(sql.begin((tx) => tx`update person set row_id = 'psn_rr92aaaaaaaaaaaaaaaa' where row_id = ${rr90}`)).rejects.toThrow(/permanent/)
    expect(await sql`select 1 from person where row_id = ${rr90}`).toHaveLength(1)
  })
})

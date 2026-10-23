// Delegated password sign-in (OpenSpec change `delegated-password-login`):
// a person signs in with their ID and password at an outside service the
// administrator connected in System Settings (StyleHR is the first). The
// provider is never contacted for real — `_setDelegatedFetch` swaps in a stub
// per test, and the afterEach restores the real fetch.
import { afterEach, describe, expect, vi } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { _setDelegatedFetch } from '../src/delegated-login'
import { grantRole } from './fixtures'
import { VIEWER_ROLE } from '../src/sales-target'
import { DELEGATED_URL, configureDelegated, linkDelegated, removeDelegated } from './identity-fixtures'

const URL_ = DELEGATED_URL
const PASSWORD = 'Sup3r-Secret-Delegated-Pw!'

// person-identities: the connected service is a Sign In Method row, and a
// person is linked by an identity carrying their login ID at the service.
const configure = (o: { label?: string; url?: string } = {}) => configureDelegated(o)
const link = (user: string, id: string) => linkDelegated(user, id)

type Call = { url: string; init: RequestInit }
function provider(answer: () => Response | Promise<Response>) {
  const calls: Call[] = []
  _setDelegatedFetch((async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return answer()
  }) as typeof fetch)
  return calls
}

// The sign-in always names its method (no single-method default).
const signIn = (api: TestClient, usr: string, pwd = PASSWORD, method = 'stylehr') =>
  api.fetch('/api/login/delegated', { method: 'POST', body: JSON.stringify({ usr, pwd, method }) })

const sidCookie = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith('sid='))

afterEach(() => {
  _setDelegatedFetch(null)
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('delegated password sign-in', () => {
  test('a verified, linked person gets a session like password sign-in', async ({ api, admin, createUser }) => {
    await configure()
    const tl = await createUser({ email: 'tl.one@example.com' })
    await link(tl.user!, 'tl_9876543210')
    const calls = provider(() => Response.json({ token: 'opaque' }))

    // Case and surrounding spaces are not part of the ID.
    const res = await signIn(api, '  TL_9876543210 ')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { token: string; user: { row_id: string } }
    expect(body.user.row_id).toBe(tl.user)
    expect(body.token.split('.')).toHaveLength(3)
    expect(Object.keys(body).filter((k) => !['token', 'user', 'landing'].includes(k))).toEqual([])
    expect(sidCookie(res)).toMatch(/HttpOnly/i)

    // The provider got exactly the StyleHR contract: JSON {email, password},
    // POST, no redirect following, and a timeout signal.
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(URL_)
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.redirect).toBe('manual')
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ email: 'TL_9876543210', password: PASSWORD })

    // The session works.
    const me = await api.fetch('/api/whoami', { headers: { authorization: `Bearer ${body.token}` } })
    expect(((await me.json()) as { row_id: string }).row_id).toBe(tl.user)
  })

  test('the landing page follows the account, as for password sign-in', async ({ api, admin, createUser }) => {
    await configure()
    await grantRole(admin, { role: VIEWER_ROLE, table: [] })
    const tl = await createUser({ email: 'tl.viewer@example.com', roles: [VIEWER_ROLE] })
    await link(tl.user!, 'viewer_1')
    provider(() => Response.json({ token: 'opaque' }))
    const res = await signIn(api, 'viewer_1')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { landing?: string }).landing).toBe('/featherbase/sales-target')
  })

  test('a provider rejection is the password-login refusal, with no session', async ({ api, admin, createUser }) => {
    await configure()
    const tl = await createUser({ email: 'tl.two@example.com' })
    await link(tl.user!, 'tl_2')
    const password = await api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr: 'Administrator', pwd: 'wrong' }) })
    const expected = ((await password.json()) as { error: { message: string } }).error.message

    for (const status of [400, 401, 403]) {
      provider(() => Response.json({ detail: 'nope' }, { status }))
      const res = await signIn(api, 'tl_2')
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: { type: 'AuthenticationError', message: expected } })
      expect(sidCookie(res)).toBeUndefined()
    }
  })

  test('a 2xx carrying an error body is a rejection, not a sign-in', async ({ api, admin, createUser }) => {
    await configure()
    const tl = await createUser({ email: 'tl.three@example.com' })
    await link(tl.user!, 'tl_3')
    for (const body of [{ error: 'Invalid credentials' }, { errors: ['bad'] }, { status: 'error' }]) {
      provider(() => Response.json(body))
      const res = await signIn(api, 'tl_3')
      expect(res.status).toBe(401)
      expect(sidCookie(res)).toBeUndefined()
    }
  })

  test('an unavailable provider is 503 naming the service, never a wrong password', async ({ api, admin, createUser }) => {
    await configure()
    const tl = await createUser({ email: 'tl.four@example.com' })
    await link(tl.user!, 'tl_4')
    const outages: Array<() => Response | Promise<Response>> = [
      () => new Response('down', { status: 500 }),
      () => new Response('bad gateway', { status: 502 }),
      () => new Response(null, { status: 302, headers: { location: 'https://hr.example.test/api/login' } }),
      () => Promise.reject(new TypeError('fetch failed')),
      () => Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError')),
    ]
    for (const outage of outages) {
      provider(outage)
      const res = await signIn(api, 'tl_4')
      expect(res.status).toBe(503)
      const body = (await res.json()) as { error: { type: string; message: string } }
      expect(body.error.type).toBe('ServiceUnavailableError')
      expect(body.error.message).toContain('StyleHR')
      expect(body.error.message).not.toMatch(/invalid|incorrect|wrong/i)
      expect(sidCookie(res)).toBeUndefined()
    }
  })

  // Review of #363: answering "not linked" AFTER asking the provider made this
  // route a password checker for every StyleHR ID with no account here (403 =
  // right password, 401 = wrong). An unlinked ID now gets password login's
  // refusal and the password never leaves.
  test('an unlinked ID is refused like a wrong password, and its password is never forwarded', async ({ api, admin }) => {
    await configure()
    const calls = provider(() => Response.json({ ok: true }))
    const res = await signIn(api, 'nobody_linked')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { type: 'AuthenticationError', message: 'Invalid login credentials' } })
    expect(sidCookie(res)).toBeUndefined()
    expect(calls).toHaveLength(0)
  })

  // Review of #363: a 2xx used to verify unless its body LOOKED like an error,
  // so an empty body, an HTML page or an unreadable stream signed anyone in.
  test('only a positive success signal verifies; anything unexplained is no sign-in', async ({ api, admin, createUser }) => {
    await configure()
    const cases: [string, () => Response, number][] = [
      ['204 no body', () => new Response(null, { status: 204 }), 503],
      ['200 empty', () => new Response('', { status: 200 }), 503],
      ['200 html', () => new Response('<!doctype html><title>Login</title>', { status: 200, headers: { 'content-type': 'text/html' } }), 503],
      ['200 unrecognised json', () => Response.json({ detail: 'Logged' }), 503],
      ['200 array', () => Response.json([{ token: 'x' }]), 503],
      ['200 success false', () => Response.json({ success: false, message: 'Invalid' }), 401],
      ['200 status false', () => Response.json({ status: false, token: 'x' }), 401],
      ['200 status failed', () => Response.json({ status: 'Failed' }), 401],
      ['200 nested error', () => Response.json({ data: { error: 'bad password' } }), 401],
      ['200 body breaks mid-stream', () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"token":')); c.error(new Error('reset')) } }), { status: 200 }), 503],
    ]
    // One linked person per case, so the per-ID attempt limit never decides the outcome.
    for (const [i, [name, answer, status]] of cases.entries()) {
      const tl = await createUser({ email: `tl.closed${i}@example.com` })
      await link(tl.user!, `tl_closed_${i}`)
      provider(answer)
      const res = await signIn(api, `tl_closed_${i}`)
      expect(res.status, name).toBe(status)
      expect(sidCookie(res), name).toBeUndefined()
    }
    const tl = await createUser({ email: 'tl.yes@example.com' })
    await link(tl.user!, 'tl_yes')
    for (const yes of [{ token: 'x' }, { access: 'jwt', refresh: 'r' }, { data: { employee_id: 8788 } }, { success: true }]) {
      provider(() => Response.json(yes))
      expect((await signIn(api, 'tl_yes')).status, JSON.stringify(yes)).toBe(200)
    }
  })

  test('a person the provider shows as having left is refused, even with the right password', async ({ api, admin, createUser }) => {
    await configure()
    const tl = await createUser({ email: 'tl.left@example.com' })
    await link(tl.user!, 'tl_left')
    for (const body of [
      { token: 'x', is_active: false },
      { token: 'x', data: { exit_date: '2026-09-01' } },
      { token: 'x', employment_status: 'Resigned' },
    ]) {
      provider(() => Response.json(body))
      const res = await signIn(api, 'tl_left')
      expect(res.status, JSON.stringify(body)).toBe(403)
      expect(((await res.json()) as { error: { message: string } }).error.message).toContain('no longer active')
      expect(sidCookie(res)).toBeUndefined()
      // person-identities (review M4): the account is disabled too. Re-enable
      // it so the next shape is judged on its own.
      const [row] = await sql`select enabled from person where row_id = ${tl.user!}`
      expect(row.enabled, JSON.stringify(body)).toBe(false)
      await sql`update person set enabled = true where row_id = ${tl.user!}`
    }
  })

  test('the Administrator and System Managers are never signed in this way', async ({ api, admin, createUser }) => {
    await configure()
    const sm = await createUser({ email: 'sm@example.com', roles: ['System Manager'] })
    await link(sm.user!, 'sm_1')
    await link('Administrator', 'admin_1')
    const calls = provider(() => Response.json({ token: 'x' }))
    for (const id of ['sm_1', 'admin_1']) {
      const res = await signIn(api, id)
      expect(res.status, id).toBe(401)
      expect(sidCookie(res)).toBeUndefined()
    }
    expect(calls).toHaveLength(0)
  })

  test('a busy provider (408, 429) is unavailable, never a wrong password', async ({ api, admin, createUser }) => {
    await configure()
    const tl = await createUser({ email: 'tl.busy@example.com' })
    await link(tl.user!, 'tl_busy')
    for (const status of [408, 429]) {
      provider(() => new Response('slow down', { status }))
      expect((await signIn(api, 'tl_busy')).status, String(status)).toBe(503)
    }
  })

  test('a disabled linked account is refused like a disabled password sign-in', async ({ api, admin, createUser }) => {
    await configure()
    const tl = await createUser({ email: 'tl.five@example.com' })
    await link(tl.user!, 'tl_5')
    await sql`update person set enabled = false where row_id = ${tl.user!}`
    const calls = provider(() => Response.json({ ok: true }))
    const res = await signIn(api, 'tl_5')
    expect(calls).toHaveLength(0)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { type: 'AuthenticationError', message: 'Invalid login credentials' } })
    expect(sidCookie(res)).toBeUndefined()
  })

  test('an automation account is never bound', async ({ api, admin }) => {
    await configure()
    // person-rename: a service account is not a person, so it cannot hold a
    // sign-in identity at all — neither through the API nor in the table.
    const bot = (await admin.post('/api/service_accounts', { label: 'bot' })) as { row_id: string }
    const res = await admin.fetch(`/api/people/${bot.row_id}/identities`, {
      method: 'POST',
      body: JSON.stringify({ method: 'stylehr', subject: 'BOT-1', sign_in_name: 'bot_1' }),
    })
    expect(res.status).toBe(417)
    await expect(sql.begin((tx) => tx`insert into sign_in_identity (id, person_id, method, subject, sign_in_name, linked_by)
      values ('uid_bot', ${bot.row_id}, 'stylehr', 'BOT-1', 'bot_1', 'test')`)).rejects.toThrow(/foreign key/)
    const calls = provider(() => Response.json({ ok: true }))
    expect((await signIn(api, 'bot_1')).status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  test('one service ID can be linked to only one account, whatever its case', async ({ admin, createUser }) => {
    await configure()
    const a = await createUser({ email: 'dup.a@example.com' })
    const b = await createUser({ email: 'dup.b@example.com' })
    await link(a.user!, 'dup_1')
    const res = await admin.fetch(`/api/people/${encodeURIComponent(b.user!)}/identities`, {
      method: 'POST',
      body: JSON.stringify({ method: 'stylehr', subject: 'B-1', sign_in_name: 'DUP_1 ' }),
    })
    expect(res.status).toBe(409)
    const rows = await sql`select person_id from sign_in_identity where method = 'stylehr' and lower(sign_in_name) = 'dup_1'`
    expect(rows.map((r) => r.person_id)).toEqual([a.user])
  })

  test('off is 404 like any unknown route, and the provider is never called', async ({ api }) => {
    const calls = provider(() => Response.json({ ok: true }))
    for (const settings of [
      {}, // nothing configured
      { url: '' },
      { url: 'http://hr.example.test/api/login/' }, // plain http to a real host
      { url: 'http://localhost.evil.test/api/login/' }, // look-alike hosts
      { url: 'http://127.0.0.1@evil.test/api/login/' },
      { url: 'http://evil.test\\@127.0.0.1/api/login/' },
      { url: 'not a url' },
    ]) {
      await removeDelegated()
      if (Object.keys(settings).length) await configure(settings)
      const res = await signIn(api, 'anyone')
      expect(res.status).toBe(404)
      expect(((await res.json()) as { error: { type: string } }).error.type).toBe('NotFoundError')
    }
    expect(calls).toHaveLength(0)
  })

  test('a local http provider is allowed, for test stubs', async ({ api, admin, createUser }) => {
    await configure({ url: 'http://127.0.0.1:9/api/login/' })
    const tl = await createUser({ email: 'tl.local@example.com' })
    await link(tl.user!, 'local_1')
    const calls = provider(() => Response.json({ ok: true }))
    expect((await signIn(api, 'local_1')).status).toBe(200)
    expect(calls[0].url).toBe('http://127.0.0.1:9/api/login/')
  })

  test('with two services connected, the sign-in must say which', async ({ api, createUser }) => {
    await configure()
    await configureDelegated({ key: 'stylehr_tn', label: 'StyleHR TN', url: 'https://tn.example.test/api/login/' })
    const tl = await createUser({ email: 'tl.two.services@example.com' })
    await linkDelegated(tl.user!, 'tn_1', { key: 'stylehr_tn' })
    const calls = provider(() => Response.json({ token: 'x' }))
    const unnamed = await api.fetch('/api/login/delegated', { method: 'POST', body: JSON.stringify({ usr: 'tn_1', pwd: PASSWORD }) })
    expect(unnamed.status).toBe(417)
    expect(calls).toHaveLength(0)
    const res = await api.fetch('/api/login/delegated', { method: 'POST', body: JSON.stringify({ usr: 'tn_1', pwd: PASSWORD, method: 'stylehr_tn' }) })
    expect(res.status).toBe(200)
    expect(calls[0].url).toBe('https://tn.example.test/api/login/')
    // A login ID is looked up only at the service it belongs to.
    expect((await api.fetch('/api/login/delegated', { method: 'POST', body: JSON.stringify({ usr: 'tn_1', pwd: PASSWORD, method: 'stylehr' }) })).status).toBe(401)
  })

  test('the password appears in no log line and no response', async ({ api, admin, createUser }) => {
    await configure()
    const tl = await createUser({ email: 'tl.six@example.com' })
    await link(tl.user!, 'tl_6')
    const logged: string[] = []
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const)
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack} ${String(a.cause)}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
      })
    const answers: Array<() => Response | Promise<Response>> = [
      () => Response.json({ echoed: PASSWORD }),
      () => Response.json({ error: PASSWORD }, { status: 401 }),
      () => new Response(PASSWORD, { status: 500 }),
      () => Promise.reject(new TypeError(`fetch failed ${PASSWORD}`)),
    ]
    const bodies: string[] = []
    for (const answer of answers) {
      provider(answer)
      const res = await signIn(api, 'tl_6')
      bodies.push(await res.text(), JSON.stringify([...res.headers]))
    }
    provider(() => Response.json({ ok: true }))
    bodies.push(await (await signIn(api, 'unlinked_6')).text())
    expect(logged.join('\n')).not.toContain(PASSWORD)
    expect(bodies.join('\n')).not.toContain(PASSWORD)
  })

  test('repeated attempts for one ID are rate limited, and the provider is not asked', async ({ api, admin, createUser }) => {
    vi.stubEnv('PREAUTH_PASSWORD_MAX', '2')
    await configure()
    const tl = await createUser({ email: 'tl.seven@example.com' })
    await link(tl.user!, 'tl_7')
    const calls = provider(() => Response.json({}, { status: 401 }))
    expect((await signIn(api, 'tl_7')).status).toBe(401)
    expect((await signIn(api, ' TL_7')).status).toBe(401)
    const blocked = await signIn(api, 'tl_7')
    expect(blocked.status).toBe(429)
    expect(((await blocked.json()) as { error: { type: string } }).error.type).toBe('RateLimitError')
    expect(calls).toHaveLength(2)
  })

  test('the per-source login budget covers it too', async ({ api }) => {
    vi.stubEnv('PREAUTH_LOGIN_MAX', '1')
    await configure()
    provider(() => Response.json({}, { status: 401 }))
    await signIn(api, 'a')
    expect((await signIn(api, 'b')).status).toBe(429)
  })

  test('the body must carry usr and pwd', async ({ api }) => {
    await configure()
    const calls = provider(() => Response.json({ ok: true }))
    for (const body of [{}, { usr: 'x', method: 'stylehr' }, { pwd: 'y', method: 'stylehr' }, { usr: '', pwd: 'y', method: 'stylehr' }, { usr: 1, pwd: 'y', method: 'stylehr' }, { usr: 'x', pwd: 'y' }]) {
      const res = await api.fetch('/api/login/delegated', { method: 'POST', body: JSON.stringify(body) })
      expect(res.status).toBe(417)
    }
    expect(calls).toHaveLength(0)
  })
})

// Test mode (#3783): while a sales-target rollout is being tried out, the
// provider is not asked, and the tester types the person's EMPLOYEE CODE (the
// account's ID) — the StyleHR login name is what the person themself would
// type, and a tester does not know it. Only accounts linked to the service
// qualify, and the usual refusals stand, so the switch decides whose report
// opens, never who becomes an administrator.
describe('delegated sign-in test mode', () => {
  const TRUST = 'trust-any-password'

  test('on: a linked person signs in by employee code alone, and the provider is never asked', async ({ api, admin, createUser }) => {
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', TRUST)
    await configure()
    const tl = await createUser({ email: 'tl.test@example.com' })
    await link(tl.user!, 'ANISHA_1716708795')
    const calls = provider(() => Response.json({ error: 'would have refused' }))

    for (const [usr, pwd] of [[tl.user!, ''], [` ${tl.user!.toUpperCase()} `, 'anything at all']]) {
      const res = await signIn(api, usr, pwd)
      expect(res.status).toBe(200)
      expect(((await res.json()) as { user: { row_id: string } }).user.row_id).toBe(tl.user)
    }
    expect(calls).toHaveLength(0)
  })

  test('on: the StyleHR login name is not how a tester signs in', async ({ api, admin, createUser }) => {
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', TRUST)
    await configure()
    const tl = await createUser({ email: 'tl.login@example.com' })
    await link(tl.user!, 'ANISHA_1716708795')
    expect((await signIn(api, 'ANISHA_1716708795', '')).status).toBe(401)
  })

  test('on: an account with no link, a disabled one and a System Manager are still refused', async ({ api, admin, createUser }) => {
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', TRUST)
    await configure()
    expect((await signIn(api, 'nobody', '')).status).toBe(401)
    const office = await createUser({ email: 'office@example.com' })
    expect((await signIn(api, office.user!, '')).status).toBe(401)
    const off = await createUser({ email: 'tl.disabled@example.com' })
    await link(off.user!, 'tl_disabled')
    await sql`update person set enabled = false where row_id = ${off.user!}`
    expect((await signIn(api, off.user!, '')).status).toBe(401)
    const sm = await createUser({ email: 'sm@example.com', roles: ['System Manager'] })
    await link(sm.user!, 'sm_1')
    expect((await signIn(api, sm.user!, '')).status).toBe(401)
  })

  test('only the exact phrase turns it on; "1" or "true" leave the provider in charge', async ({ api, admin, createUser }) => {
    await configure()
    const tl = await createUser({ email: 'tl.strict@example.com' })
    await link(tl.user!, 'tl_strict')
    for (const value of ['1', 'true', 'yes', '']) {
      vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', value)
      const calls = provider(() => Response.json({ error: 'bad password' }))
      expect((await signIn(api, 'tl_strict', 'wrong')).status).toBe(401)
      expect(calls).toHaveLength(1)
      expect((await signIn(api, 'tl_strict', '')).status).toBe(417)
    }
  })

  // person-resolution D5: the code resolves through current employee-code
  // identifier rows; a code on two people is refused; the link must be live.
  test('a code current on two people is refused, and neither is chosen', async ({ api, createUser }) => {
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', TRUST)
    await configure()
    const a = await createUser({ email: 'tl.twin.a@example.com' })
    const b = await createUser({ email: 'tl.twin.b@example.com' })
    await link(a.user!, 'twin_a')
    await link(b.user!, 'twin_b')
    // Two firms' codes collide: the same code, current, under different assigners.
    await sql`update person_identifier set assigner = 'firm-7' where person_id = ${a.user!} and system = 'stylehr-employee-code'`
    await sql`insert into person_identifier (id, person_id, system, assigner, value, verified, one_holder, source, recorded_by)
      values ('pid_twin_b_code', ${b.user!}, 'stylehr-employee-code', 'firm-12', ${a.user!.toUpperCase()}, true, true, 'test', 'test')`
    const res = await signIn(api, a.user!, '')
    expect(res.status).toBe(409)
    expect(sidCookie(res)).toBeUndefined()
  })

  test('an ended code or an ended link does not sign in', async ({ api, admin, createUser }) => {
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', TRUST)
    await configure()
    const tl = await createUser({ email: 'tl.ended@example.com' })
    const identity = await link(tl.user!, 'tl_ended')
    expect((await signIn(api, tl.user!, '')).status).toBe(200)
    // The link ends (unlinked): the code alone no longer opens the account.
    await admin.delete(`/api/identities/${identity}`).catch(() => undefined)
    await sql`update sign_in_identity set ended_at = coalesce(ended_at, now()), ended_reason = coalesce(ended_reason, 'unlinked') where id = ${identity}`
    expect((await signIn(api, tl.user!, '')).status).toBe(401)
    // A link that is live but whose code has ended does not either.
    const other = await createUser({ email: 'tl.oldcode@example.com' })
    await link(other.user!, 'tl_oldcode')
    await sql`update person_identifier set valid = daterange('2024-01-01', '2025-01-01', '[)') where person_id = ${other.user!} and system = 'stylehr-employee-code'`
    expect((await signIn(api, other.user!, '')).status).toBe(401)
  })

  test('only the method’s own employee-code system is a test-mode credential (Codex review on #385)', async ({ api, admin, createUser }) => {
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', TRUST)
    await configure()
    const tl = await createUser({ email: 'tl.other.code@example.com' })
    await link(tl.user!, 'tl_other_code')
    // A code from another payroll namespace is not a StyleHR credential.
    await admin.post('/api/save_row', { table: 'Identifier System', row: { row_id: 'other-payroll-code', label: 'Other payroll', kind: 'employee-record', source: 'other-payroll' } })
    await sql`insert into person_identifier (id, person_id, system, assigner, value, verified, one_holder, source, recorded_by)
      values ('pid_other_payroll', ${tl.user!}, 'other-payroll-code', '', 'OP-1', true, true, 'test', 'test')`
    expect((await signIn(api, 'OP-1', '')).status).toBe(401)
    expect((await signIn(api, tl.user!, '')).status).toBe(200)
  })

  test('a server that is not development or test refuses to start with test mode set', async () => {
    const { assertTestModeAllowed } = await import('../src/delegated-login')
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', TRUST)
    expect(() => assertTestModeAllowed('production')).toThrow(/development, test or staging/)
    expect(() => assertTestModeAllowed('development')).not.toThrow()
    expect(() => assertTestModeAllowed('test')).not.toThrow()
    // A hosted trial instance runs as staging: test mode starts there.
    expect(() => assertTestModeAllowed('staging')).not.toThrow()
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', '1')
    expect(() => assertTestModeAllowed('production')).not.toThrow()
  })

  test('staging is production in every other respect: no default Administrator password', async () => {
    const { bootstrapAdministrator } = await import('../src/admin-bootstrap')
    vi.stubEnv('ADMIN_PASSWORD', '')
    await sql`update person set password_hash = null where row_id = 'Administrator'`
    await bootstrapAdministrator('staging')
    expect(await sql`select password_hash from person where row_id = 'Administrator'`).toEqual([{ password_hash: null }])
    await bootstrapAdministrator('development')
    expect((await sql`select password_hash from person where row_id = 'Administrator'`)[0].password_hash).not.toBeNull()
  })

  test('the login page is told, so it can say so', async ({ api }) => {
    await configure()
    const testMode = async () =>
      ((await (await api.fetch('/api/brand')).json()) as { sign_in_methods: { key: string; test_mode: boolean }[] })
        .sign_in_methods.find((m) => m.key === 'stylehr')?.test_mode
    expect(await testMode()).toBe(false)
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', TRUST)
    expect(await testMode()).toBe(true)
    // Off when no provider is connected, whatever the variable says.
    await removeDelegated()
    expect(await testMode()).toBeUndefined()
  })
})

describe('public brand names the connected service', () => {
  test('absent when off, the label when on, the host when the label is blank', async ({ api }) => {
    await removeDelegated()
    const label = async () =>
      ((await (await api.fetch('/api/brand')).json()) as { sign_in_methods: { kind: string; label: string }[] })
        .sign_in_methods.find((m) => m.kind === 'delegated_password')?.label
    expect(await label()).toBeUndefined()
    await configure()
    expect(await label()).toBe('StyleHR')
    await configure({ label: '   ' })
    expect(await label()).toBe('hr.example.test')
    await configure({ url: 'ftp://hr.example.test/' })
    expect(await label()).toBeUndefined()
  })

  test('the old single-service brand fields are gone', async ({ api }) => {
    await configure()
    const brand = (await (await api.fetch('/api/brand')).json()) as Record<string, unknown>
    expect(brand).not.toHaveProperty('delegated_login_label')
    expect(brand).not.toHaveProperty('delegated_login_test_mode')
  })
})

// person-identities (review M4, D7, B1).
describe('delegated sign-in through linked identities', () => {
  const TRUST = 'trust-any-password'

  test('a leaver is disabled: every session they hold ends and every other way in refuses them', async ({ api, admin, createUser }) => {
    await configure()
    const tl = await createUser({ email: 'tl.leaver@example.com' })
    await link(tl.user!, 'tl_leaver')
    await admin.post('/api/set_password', { user: tl.user, password: 'local-pw-123' })
    const local = await api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr: tl.user, pwd: 'local-pw-123' }) })
    const { token } = (await local.json()) as { token: string }
    const whoami = () => api.fetch('/api/whoami', { headers: { authorization: `Bearer ${token}` } })
    expect((await whoami()).status).toBe(200)

    provider(() => Response.json({ token: 'x', employment_status: 'Resigned' }))
    expect((await signIn(api, 'tl_leaver')).status).toBe(403)
    const [row] = await sql`select enabled from person where row_id = ${tl.user!}`
    expect(row.enabled).toBe(false)
    expect((await whoami()).status).toBe(401)
    const again = await api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr: tl.user, pwd: 'local-pw-123' }) })
    expect(again.status).toBe(401)
    // History is kept: the disable is a recorded change, and the link stays.
    const [link_] = await sql`select 1 from sign_in_identity where person_id = ${tl.user!}`
    expect(link_).toBeTruthy()
  })

  test('an outage never falls back to the person\'s Featherbase password', async ({ api, admin, createUser }) => {
    await configure()
    const tl = await createUser({ email: 'tl.fallback@example.com' })
    await link(tl.user!, 'tl_fallback')
    await admin.post('/api/set_password', { user: tl.user, password: PASSWORD })
    provider(() => new Response('down', { status: 503 }))
    const res = await signIn(api, 'tl_fallback')
    expect(res.status).toBe(503)
    expect(sidCookie(res)).toBeUndefined()
  })

  test('a duplicated login ID migrated with no sign-in name still opens in test mode by employee code', async ({ api, createUser }) => {
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', TRUST)
    await configure()
    const tl = await createUser({ email: 'tl.dup.migrated@example.com' })
    await linkDelegated(tl.user!, null)
    expect((await signIn(api, ` ${tl.user!.toUpperCase()} `, '')).status).toBe(200)
  })

  test('a test-mode session cannot set a password, mint a token or change sign-in methods', async ({ api, createUser }) => {
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', TRUST)
    await configure()
    const tl = await createUser({ email: 'tl.tm.session@example.com' })
    const identity = await link(tl.user!, 'tl_tm')
    const res = await signIn(api, tl.user!, '')
    expect(res.status).toBe(200)
    const { token, user } = (await res.json()) as { token: string; user: { sign_in: { test_mode: boolean } } }
    expect(user.sign_in.test_mode).toBe(true)
    const as = (path: string, init: RequestInit = {}) =>
      api.fetch(path, { ...init, headers: { authorization: `Bearer ${token}` } })
    expect((await as('/api/set_password', { method: 'POST', body: JSON.stringify({ password: 'kept-forever' }) })).status).toBe(403)
    expect((await as('/api/access_tokens', { method: 'POST', body: JSON.stringify({ label: 'keep' }) })).status).toBe(403)
    expect((await as(`/api/me/identities/${identity}`, { method: 'DELETE' })).status).toBe(403)
    expect((await as('/api/oauth/google/link', { redirect: 'manual' })).status).toBe(403)
    const [row] = await sql`select password_hash from person where row_id = ${tl.user!}`
    expect(row.password_hash).toBeNull()
  })

  test('a linked sign-in stamps when it was last used and carries its identity in the session', async ({ api, createUser }) => {
    await configure()
    const tl = await createUser({ email: 'tl.stamp@example.com' })
    const identity = await link(tl.user!, 'tl_stamp')
    provider(() => Response.json({ token: 'x' }))
    const res = await signIn(api, 'tl_stamp')
    const body = (await res.json()) as { user: { sign_in: { method: string; identity: string } } }
    expect(body.user.sign_in).toMatchObject({ method: 'stylehr', identity })
    const [row] = await sql`select last_used_at from sign_in_identity where id = ${identity}`
    expect(row.last_used_at).not.toBeNull()
  })
})

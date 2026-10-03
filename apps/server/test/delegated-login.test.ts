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

const URL_ = 'https://hr.example.test/api/login/'
const COLUMN = 'stylehr_username'
const PASSWORD = 'Sup3r-Secret-Delegated-Pw!'

async function setSetting(field: string, value: string) {
  await sql`
    insert into single_value (table_name, field, value)
    values ('System Settings', ${field}, ${value})
    on conflict (table_name, field) do update set value = excluded.value`
}

async function configure(overrides: Partial<Record<'label' | 'url' | 'column', string>> = {}) {
  await setSetting('delegated_login_label', overrides.label ?? 'StyleHR')
  await setSetting('delegated_login_url', overrides.url ?? URL_)
  await setSetting('delegated_login_user_column', overrides.column ?? COLUMN)
}

// The realistic path: the provider ID is a Custom Field on User.
async function addIdColumn(admin: TestClient) {
  const res = await admin.fetch('/api/save_row', {
    method: 'POST',
    body: JSON.stringify({
      table: 'Custom Field',
      row: { row_id: `User-${COLUMN}`, dt: 'User', column_name: COLUMN, label: 'StyleHR Username', column_type: 'Data' },
    }),
  })
  expect(res.status).toBe(201)
}

async function link(user: string, id: string) {
  await sql`update "user" set ${sql(COLUMN)} = ${id} where row_id = ${user}`
}

type Call = { url: string; init: RequestInit }
function provider(answer: () => Response | Promise<Response>) {
  const calls: Call[] = []
  _setDelegatedFetch((async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return answer()
  }) as typeof fetch)
  return calls
}

const signIn = (api: TestClient, usr: string, pwd = PASSWORD) =>
  api.fetch('/api/login/delegated', { method: 'POST', body: JSON.stringify({ usr, pwd }) })

const sidCookie = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith('sid='))

afterEach(() => {
  _setDelegatedFetch(null)
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('delegated password sign-in', () => {
  test('a verified, linked person gets a session like password sign-in', async ({ api, admin, createUser }) => {
    await configure()
    await addIdColumn(admin)
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
    await addIdColumn(admin)
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
    await addIdColumn(admin)
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
    await addIdColumn(admin)
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
    await addIdColumn(admin)
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
    await addIdColumn(admin)
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
    await addIdColumn(admin)
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
    await addIdColumn(admin)
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
    }
  })

  test('the Administrator and System Managers are never signed in this way', async ({ api, admin, createUser }) => {
    await configure()
    await addIdColumn(admin)
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
    await addIdColumn(admin)
    const tl = await createUser({ email: 'tl.busy@example.com' })
    await link(tl.user!, 'tl_busy')
    for (const status of [408, 429]) {
      provider(() => new Response('slow down', { status }))
      expect((await signIn(api, 'tl_busy')).status, String(status)).toBe(503)
    }
  })

  test('a disabled linked account is refused like a disabled password sign-in', async ({ api, admin, createUser }) => {
    await configure()
    await addIdColumn(admin)
    const tl = await createUser({ email: 'tl.five@example.com' })
    await link(tl.user!, 'tl_5')
    await sql`update "user" set enabled = false where row_id = ${tl.user!}`
    const calls = provider(() => Response.json({ ok: true }))
    const res = await signIn(api, 'tl_5')
    expect(calls).toHaveLength(0)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { type: 'AuthenticationError', message: 'Invalid login credentials' } })
    expect(sidCookie(res)).toBeUndefined()
  })

  test('an automation account is never bound', async ({ api, admin, createUser }) => {
    await configure()
    await addIdColumn(admin)
    const bot = await createUser({ email: 'bot@example.com' })
    await link(bot.user!, 'bot_1')
    await sql`update "user" set user_type = 'service' where row_id = ${bot.user!}`
    const calls = provider(() => Response.json({ ok: true }))
    expect((await signIn(api, 'bot_1')).status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  test('two accounts linked to one ID are refused, never one picked', async ({ api, admin, createUser }) => {
    await configure()
    await addIdColumn(admin)
    const a = await createUser({ email: 'dup.a@example.com' })
    const b = await createUser({ email: 'dup.b@example.com' })
    await link(a.user!, 'dup_1')
    await link(b.user!, 'DUP_1 ')
    provider(() => Response.json({ ok: true }))
    const res = await signIn(api, 'dup_1')
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { type: string } }).error.type).toBe('ConflictError')
    expect(sidCookie(res)).toBeUndefined()
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
      { column: '' },
    ]) {
      await sql`delete from single_value where table_name = 'System Settings' and field like 'delegated_login_%'`
      if (Object.keys(settings).length) await configure(settings)
      const res = await signIn(api, 'anyone')
      expect(res.status).toBe(404)
      expect(((await res.json()) as { error: { type: string } }).error.type).toBe('NotFoundError')
    }
    expect(calls).toHaveLength(0)
  })

  test('a local http provider is allowed, for test stubs', async ({ api, admin, createUser }) => {
    await configure({ url: 'http://127.0.0.1:9/api/login/' })
    await addIdColumn(admin)
    const tl = await createUser({ email: 'tl.local@example.com' })
    await link(tl.user!, 'local_1')
    const calls = provider(() => Response.json({ ok: true }))
    expect((await signIn(api, 'local_1')).status).toBe(200)
    expect(calls[0].url).toBe('http://127.0.0.1:9/api/login/')
  })

  test('a column that is unsafe or missing is a setup error, and no password leaves', async ({ api }) => {
    const calls = provider(() => Response.json({ ok: true }))
    // `position` is a real User column but not text: lower(trim()) on it would fail after
    // the provider had already verified.
    for (const column of ['no_such_column', 'email; drop table "user"', 'Email', 'position']) {
      await configure({ column })
      const res = await signIn(api, 'anyone')
      expect(res.status).toBe(503)
      expect(((await res.json()) as { error: { message: string } }).error.message).toContain('StyleHR')
    }
    expect(calls).toHaveLength(0)
  })

  test('the password appears in no log line and no response', async ({ api, admin, createUser }) => {
    await configure()
    await addIdColumn(admin)
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
    await addIdColumn(admin)
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
    for (const body of [{}, { usr: 'x' }, { pwd: 'y' }, { usr: '', pwd: 'y' }, { usr: 1, pwd: 'y' }]) {
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
    await addIdColumn(admin)
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
    await addIdColumn(admin)
    const tl = await createUser({ email: 'tl.login@example.com' })
    await link(tl.user!, 'ANISHA_1716708795')
    expect((await signIn(api, 'ANISHA_1716708795', '')).status).toBe(401)
  })

  test('on: an account with no link, a disabled one and a System Manager are still refused', async ({ api, admin, createUser }) => {
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', TRUST)
    await configure()
    await addIdColumn(admin)
    expect((await signIn(api, 'nobody', '')).status).toBe(401)
    const office = await createUser({ email: 'office@example.com' })
    expect((await signIn(api, office.user!, '')).status).toBe(401)
    const off = await createUser({ email: 'tl.disabled@example.com' })
    await link(off.user!, 'tl_disabled')
    await sql`update "user" set enabled = false where row_id = ${off.user!}`
    expect((await signIn(api, off.user!, '')).status).toBe(401)
    const sm = await createUser({ email: 'sm@example.com', roles: ['System Manager'] })
    await link(sm.user!, 'sm_1')
    expect((await signIn(api, sm.user!, '')).status).toBe(401)
  })

  test('only the exact phrase turns it on; "1" or "true" leave the provider in charge', async ({ api, admin, createUser }) => {
    await configure()
    await addIdColumn(admin)
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

  test('the login page is told, so it can say so', async ({ api }) => {
    await configure()
    const brand = async () => (await (await api.fetch('/api/brand')).json()) as Record<string, unknown>
    expect((await brand()).delegated_login_test_mode).toBe(false)
    vi.stubEnv('DELEGATED_LOGIN_TEST_MODE', TRUST)
    expect((await brand()).delegated_login_test_mode).toBe(true)
    // Off when no provider is connected, whatever the variable says.
    await sql`delete from single_value where table_name = 'System Settings' and field like 'delegated_login_%'`
    expect((await brand()).delegated_login_test_mode).toBe(false)
  })
})

describe('public brand names the connected service', () => {
  test('null when off, the label when on, the host when the label is blank', async ({ api }) => {
    await sql`delete from single_value where table_name = 'System Settings' and field like 'delegated_login_%'`
    const brand = async () => (await (await api.fetch('/api/brand')).json()) as Record<string, unknown>
    expect((await brand()).delegated_login_label).toBeNull()
    await configure()
    expect(await brand()).toMatchObject({ delegated_login_label: 'StyleHR' })
    await setSetting('delegated_login_label', '   ')
    expect((await brand()).delegated_login_label).toBe('hr.example.test')
    await configure({ url: 'ftp://hr.example.test/' })
    expect((await brand()).delegated_login_label).toBeNull()
  })
})

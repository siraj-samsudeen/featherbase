import { sign } from 'hono/jwt'
import { describe, expect, vi } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { issueSession, revokeSession } from '../src/auth'
import { expectStatus, makePerson } from './fixtures'
import { withTimeFromNow } from './clock'

// #1255: one browser holds several signed-in accounts (design D1–D9). The
// browser's list rides the httpOnly `sid_accounts` cookie, read only by
// /api/accounts; the active account is `sid`.

type Api = { fetch: (path: string, init?: RequestInit) => Promise<Response> }
type Account = { session: string; person: string; name: string | null; active: boolean; state: 'live' | 'ended'; reason?: string; last_used: number }
type List = { accounts: Account[]; full: boolean }

const json = { 'content-type': 'application/json' }

/** A browser: the cookies it holds, updated from every answer, as a browser would. */
function browser(api: Api) {
  const jar = new Map<string, { value: string; path: string }>()
  const take = (res: Response) => {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';').map((s) => s.trim())
      const eq = pair.indexOf('=')
      const name = pair.slice(0, eq)
      const value = pair.slice(eq + 1)
      const path = attrs.find((a) => a.toLowerCase().startsWith('path='))?.slice(5) ?? '/'
      const gone = attrs.some((a) => /^max-age=0$/i.test(a)) || value === ''
      if (gone) jar.delete(name)
      else jar.set(name, { value, path })
    }
    return res
  }
  const cookieFor = (path: string) =>
    [...jar].filter(([, c]) => path.startsWith(c.path)).map(([n, c]) => `${n}=${c.value}`).join('; ')
  const send = async (path: string, init: RequestInit = {}) => {
    const cookie = cookieFor(path)
    return take(await api.fetch(path, { ...init, headers: { ...(init.headers as Record<string, string>), ...(cookie ? { cookie } : {}) } }))
  }
  return {
    jar,
    send,
    /** Sign in on this browser: the server would set `sid`, exactly as a sign-in route does. */
    signIn(token: string) { jar.set('sid', { value: token, path: '/' }) },
    sid: () => jar.get('sid')?.value,
    list: async () => (await (await send('/api/accounts', { method: 'POST' })).json()) as List,
    post: (path: string, body: unknown = {}) => send(path, { method: 'POST', headers: json, body: JSON.stringify(body) }),
  }
}

const sessionOf = async (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).jti as string
const whoami = async (api: Api, token: string) => (await api.fetch('/api/whoami', { headers: { authorization: `Bearer ${token}` } })).status
const log = (operation: string) => sql`select "user", reference_name, method from access_log where operation = ${operation} order by created_at`

async function twoAccounts(api: Api) {
  const siraj = await makePerson({ full_name: 'Siraj StyleHR' })
  const rb = await makePerson({ full_name: 'RB' })
  const b = browser(api)
  const first = (await issueSession(siraj)).token
  b.signIn(first)
  await b.list()
  const second = (await issueSession(rb)).token
  b.signIn(second)
  return { b, siraj, rb, first, second }
}

describe('#1255: the browser holds its signed-in accounts', () => {
  test('an account joins the list the first time the switcher sees it; the cookie is httpOnly and only for /api/accounts', async ({ api }) => {
    const id = await makePerson({ full_name: 'Siraj StyleHR' })
    const b = browser(api)
    b.signIn((await issueSession(id)).token)

    const res = await b.send('/api/accounts', { method: 'POST' })
    await expectStatus(res, 200)
    const cookie = res.headers.getSetCookie().find((l) => l.startsWith('sid_accounts='))!
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/Path=\/api\/accounts/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
    const list = (await res.json()) as List
    expect(list.accounts).toMatchObject([{ person: id, name: 'Siraj StyleHR', active: true, state: 'live' }])
    expect(list.full).toBe(false)
  })

  test('a second sign-in on the browser is listed beside the first and recorded as on the same browser', async ({ api }) => {
    const { b, siraj, rb } = await twoAccounts(api)
    const list = await b.list()
    expect(list.accounts.map((a) => [a.person, a.active, a.state])).toEqual([[rb, true, 'live'], [siraj, false, 'live']])
    expect(await log('account_added')).toEqual([{ user: rb, reference_name: siraj, method: 'same_browser' }])
    // Seen again, it is not recorded again.
    await b.list()
    expect(await log('account_added')).toHaveLength(1)
  })

  test('the same person signing in again replaces their older entry', async ({ api }) => {
    const id = await makePerson({ full_name: 'Siraj StyleHR' })
    const b = browser(api)
    b.signIn((await issueSession(id)).token)
    await b.list()
    const again = (await issueSession(id)).token
    b.signIn(again)
    const list = await b.list()
    expect(list.accounts).toHaveLength(1)
    expect(list.accounts[0].session).toBe(await sessionOf(again))
  })

  test('each account says how it signed in and the ID to type again: a connected service ID, else the email', async ({ api }) => {
    const siraj = await makePerson({ full_name: 'Siraj StyleHR', email: 'siraj.made-up@example.test' })
    await sql`insert into sign_in_method (row_id, kind, label, enabled) values ('stylehr-made-up', 'delegated_password', 'StyleHR', true)`
    await sql`insert into sign_in_identity (id, person_id, method, subject, sign_in_name, linked_by) values ('idn-siraj', ${siraj}, 'stylehr-made-up', 'sub-siraj', 'EMP0412', 'Administrator')`
    const rb = await makePerson({ full_name: 'RB', email: 'rb.made-up@example.test' })
    const b = browser(api)
    b.signIn((await issueSession(siraj, { method: 'stylehr-made-up', identity: 'idn-siraj' })).token)
    await b.list()
    b.signIn((await issueSession(rb)).token)
    const list = await b.list()
    // A built-in account with no email or username is typed by its name.
    b.signIn((await issueSession('Administrator')).token)
    expect((await b.list()).accounts.find((a) => a.person === 'Administrator')).toMatchObject({ sign_in_id: 'Administrator' })
    expect(list.accounts.map((a) => [a.name, (a as unknown as { method_label: string | null }).method_label, (a as unknown as { sign_in_id: string | null }).sign_in_id]))
      .toEqual([['RB', null, 'rb.made-up@example.test'], ['Siraj StyleHR', 'StyleHR', 'EMP0412']])
  })

  test('a forged entry in the cookie names nobody and is dropped', async ({ api }) => {
    const id = await makePerson({ full_name: 'Siraj StyleHR' })
    const b = browser(api)
    b.signIn((await issueSession(id)).token)
    await b.list()
    const forged = await sign({ sub: id, iat: 1, jti: 'forged', exp: Math.floor(Date.now() / 1000) + 3600 }, 'not-the-secret', 'HS256')
    const entry = b.jar.get('sid_accounts')!
    b.jar.set('sid_accounts', { ...entry, value: `${entry.value}~1!${forged}` })
    const list = await b.list()
    expect(list.accounts.map((a) => a.session)).not.toContain('forged')
    expect(list.accounts).toHaveLength(1)
  })

  test('a list of five live accounts is full; a sixth sign-in pushes out the least recently used and ends it, so no live session sits off the list', async ({ api }) => {
    const b = browser(api)
    const tokens: string[] = []
    for (let i = 0; i < 5; i++) {
      const token = (await issueSession(await makePerson({ full_name: `P${i}` }))).token
      tokens.push(token)
      b.signIn(token)
      await b.list()
    }
    expect((await b.list()).full).toBe(true)
    const sixth = (await issueSession(await makePerson({ full_name: 'P5' }))).token
    b.signIn(sixth)
    const list = await b.list()
    expect(list.accounts).toHaveLength(5)
    expect(list.accounts.map((a) => a.session)).not.toContain(await sessionOf(tokens[0]))
    expect(await whoami(api, tokens[0])).toBe(401)
    expect(await whoami(api, tokens[1])).toBe(200)
  })
})

describe('#1255: a held account ends as any session does, and says why', () => {
  test.for([
    ['turned_off', async (person: string) => { await sql`update person set enabled = false where row_id = ${person}` }],
    ['sessions_ended', async (person: string) => { await sql`update person set sessions_ended_at = now() + interval '1 second' where row_id = ${person}` }],
  ] as const)('%s', async ([reason, end], { api }) => {
    const { b, siraj, second } = await twoAccounts(api)
    await b.list()
    await end(siraj)
    const list = await b.list()
    expect(list.accounts.find((a) => a.person === siraj)).toMatchObject({ state: 'ended', reason })
    const target = list.accounts.find((a) => a.person === siraj)!.session
    const res = await b.post('/api/accounts/switch', { session: target })
    expect(res.status).toBe(409)
    expect(b.sid()).toBe(second)
  })

  test('signed_out: a held session signed out elsewhere', async ({ api }) => {
    const { b, siraj, first } = await twoAccounts(api)
    await b.list()
    await revokeSession({ jti: await sessionOf(first), person: siraj, expiresAt: Math.floor(Date.now() / 1000) + 3600 })
    expect((await b.list()).accounts.find((a) => a.person === siraj)).toMatchObject({ state: 'ended', reason: 'signed_out' })
  })

  test('expired: a held session past its time', async ({ api }) => {
    const id = await makePerson({ full_name: 'Siraj StyleHR' })
    const now = Math.floor(Date.now() / 1000)
    // Joins the list while live, with a minute left.
    const short = await sign({ sub: id, iat: now, at: now, jti: 'short-one', exp: now + 60 }, 'dev-secret-change-me', 'HS256')
    const b = browser(api)
    b.signIn(short)
    await b.list()
    b.signIn((await issueSession(await makePerson({ full_name: 'RB' }))).token)
    await b.list()
    const later = await withTimeFromNow(120_000, () => b.list())
    expect(later.accounts.find((a) => a.person === id)).toMatchObject({ state: 'ended', reason: 'expired' })
    // The list's cookie outlives its sessions by 30 days, so a long absence still finds it…
    const res = await b.send('/api/accounts', { method: 'POST' })
    const maxAge = Number(res.headers.getSetCookie().find((l) => l.startsWith('sid_accounts='))?.match(/Max-Age=(\d+)/i)?.[1] ?? 0)
    expect(maxAge).toBeGreaterThan(30 * 24 * 3600 - 60)
    // …and an account more than 30 days past its end is dropped.
    const gone = await withTimeFromNow(31 * 24 * 3600 * 1000, () => b.list())
    expect(gone.accounts.map((a) => a.person)).not.toContain(id)
  })
})

describe('#1255: switching', () => {
  test('a switch is checked on the server, sets sid, answers as sign-in does, and is recorded', async ({ api }) => {
    const { b, siraj, rb, first } = await twoAccounts(api)
    await b.list()
    const res = await b.post('/api/accounts/switch', { session: await sessionOf(first) })
    await expectStatus(res, 200)
    const body = (await res.json()) as { token: string; user: { row_id: string }; landing?: string }
    expect(body.token).toBe(first)
    expect(body.user.row_id).toBe(siraj)
    expect(b.sid()).toBe(first)
    expect(await log('account_switch')).toEqual([{ user: siraj, reference_name: rb, method: 'account_switch' }])
    const list = await b.list()
    expect(list.accounts.find((a) => a.active)?.person).toBe(siraj)
    expect(list.accounts).toHaveLength(2)
  })

  test('a switch whose record cannot be written does not take effect; the retry records it', async ({ api }) => {
    const { b, siraj, first, second } = await twoAccounts(api)
    await b.list()
    await sql.unsafe(`create function featherbase.t1255_no_log() returns trigger language plpgsql as $$ begin if new.operation = 'account_switch' then raise exception 'down'; end if; return new; end $$`)
    await sql`create trigger t1255_no_log before insert on featherbase.access_log for each row execute function featherbase.t1255_no_log()`
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await b.post('/api/accounts/switch', { session: await sessionOf(first) })).status).toBe(500)
    expect(b.sid()).toBe(second)
    await sql`drop trigger t1255_no_log on featherbase.access_log`
    await expectStatus(await b.post('/api/accounts/switch', { session: await sessionOf(first) }), 200)
    expect(b.sid()).toBe(first)
    expect((await log('account_switch')).map((r) => r.user)).toEqual([siraj])
  })

  test('a session the browser does not hold cannot be chosen', async ({ api }) => {
    const { b, second } = await twoAccounts(api)
    await b.list()
    const elsewhere = (await issueSession(await makePerson({ full_name: 'Someone else' }))).token
    const res = await b.post('/api/accounts/switch', { session: await sessionOf(elsewhere) })
    expect(res.status).toBe(404)
    expect(b.sid()).toBe(second)
  })

  test('a switch ends any View as on the session it leaves', async ({ api }) => {
    const { b, rb, first, second } = await twoAccounts(api)
    await b.list()
    const viewed = await makePerson({ full_name: 'Meena' })
    await sql`insert into view_as_session (session_id, tester, person, expires_at) values (${await sessionOf(second)}, ${rb}, ${viewed}, now() + interval '1 hour')`
    await expectStatus(await b.post('/api/accounts/switch', { session: await sessionOf(first) }), 200)
    expect(await sql`select count(*)::int as n from view_as_session`).toEqual([{ n: 0 }])
    expect(await log('view_as_end')).toEqual([{ user: rb, reference_name: viewed, method: 'account_switch' }])
  })
})

describe('#1255: signing out and removing', () => {
  test('sign out ends this session, takes it off the list, and continues as the next live account', async ({ api }) => {
    const { b, siraj, first, second } = await twoAccounts(api)
    await b.list()
    const res = await b.post('/api/accounts/sign_out')
    await expectStatus(res, 200)
    const body = (await res.json()) as { token?: string; user?: { row_id: string } }
    expect(body.user?.row_id).toBe(siraj)
    expect(b.sid()).toBe(first)
    expect(await whoami(api, second)).toBe(401)
    expect((await b.list()).accounts.map((a) => a.person)).toEqual([siraj])
  })

  test('a sign-out retried after its answer was lost signs out no other account', async ({ api }) => {
    const { b, siraj, first, second } = await twoAccounts(api)
    await b.list()
    const page = { authorization: `Bearer ${second}` }
    // The first attempt ends RB's session and moves sid on to Siraj's; its answer is lost.
    await expectStatus(await b.send('/api/accounts/sign_out', { method: 'POST', headers: page }), 200)
    expect(b.sid()).toBe(first)
    // The page, still holding RB's copy, tries again.
    const retry = await b.send('/api/accounts/sign_out', { method: 'POST', headers: page })
    await expectStatus(retry, 200)
    expect(((await retry.json()) as { user?: { row_id: string } }).user?.row_id).toBe(siraj)
    expect(await whoami(api, first)).toBe(200)
    expect(b.sid()).toBe(first)
  })

  test('signing out of the last account clears sid and leaves the list empty', async ({ api }) => {
    const id = await makePerson({ full_name: 'Siraj StyleHR' })
    const b = browser(api)
    const token = (await issueSession(id)).token
    b.signIn(token)
    await b.list()
    const body = (await (await b.post('/api/accounts/sign_out')).json()) as { signed_out?: boolean }
    expect(body.signed_out).toBe(true)
    expect(b.sid()).toBeUndefined()
    expect(await whoami(api, token)).toBe(401)
    expect((await b.list()).accounts).toEqual([])
  })

  test('sign out of all ends every session the browser holds and clears both cookies', async ({ api }) => {
    const { b, first, second } = await twoAccounts(api)
    await b.list()
    await expectStatus(await b.post('/api/accounts/sign_out_all'), 200)
    expect(await whoami(api, first)).toBe(401)
    expect(await whoami(api, second)).toBe(401)
    expect(b.sid()).toBeUndefined()
    expect(b.jar.has('sid_accounts')).toBe(false)
  })

  test('a sign-out of all that could not be recorded keeps every account, so the retry ends them all', async ({ api }) => {
    const { b, first, second } = await twoAccounts(api)
    await b.list()
    const firstJti = await sessionOf(first)
    // The sign-out list refuses the first account's row, as a failing write would.
    await sql.unsafe(`create function featherbase.t1255_refuse() returns trigger language plpgsql as $$ begin if new.jti = '${firstJti}' then raise exception 'down'; end if; return new; end $$`)
    await sql`create trigger t1255_refuse before insert on featherbase.revoked_session for each row execute function featherbase.t1255_refuse()`
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await b.post('/api/accounts/sign_out_all')).status).toBe(503)
    expect(b.sid()).toBe(second)
    expect(b.jar.has('sid_accounts')).toBe(true)
    expect(await whoami(api, first)).toBe(200)
    await sql`drop trigger t1255_refuse on featherbase.revoked_session`
    await expectStatus(await b.post('/api/accounts/sign_out_all'), 200)
    expect(await whoami(api, first)).toBe(401)
    expect(await whoami(api, second)).toBe(401)
  })

  test('removing an account ends its session and drops it from the list', async ({ api }) => {
    const { b, rb, first, second } = await twoAccounts(api)
    await b.list()
    await expectStatus(await b.post('/api/accounts/remove', { session: await sessionOf(first) }), 200)
    expect(await whoami(api, first)).toBe(401)
    expect(await whoami(api, second)).toBe(200)
    expect((await b.list()).accounts.map((a) => a.person)).toEqual([rb])
  })

  test('removing a session the browser does not hold is refused and ends nothing', async ({ api }) => {
    const { b } = await twoAccounts(api)
    await b.list()
    const elsewhere = (await issueSession(await makePerson({ full_name: 'Someone else' }))).token
    expect((await b.post('/api/accounts/remove', { session: await sessionOf(elsewhere) })).status).toBe(404)
    expect(await whoami(api, elsewhere)).toBe(200)
  })
})

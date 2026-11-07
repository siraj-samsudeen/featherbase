import { afterEach, beforeEach, describe, expect, vi } from 'vitest'
import { resolve } from 'node:path'
import { test } from './pg-test'
import { config } from '../src/config'
import { parseInstanceAddresses } from '../src/instance-addresses'
import { configureGoogle, inviteGoogleRaw } from './identity-fixtures'
import { saveDoc } from '../src/document'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { alertAccessRequest } from '../src/waiting-for-access'
import { makePerson } from './fixtures'
import { setPasswordFromShell } from '../src/auth'
import { preAuthPolicy } from '../src/pre-auth-rate-limit'
import { preflightRelease } from '../src/release-preflight'

// The mock provider, admitting any address (oauth.test.ts drives it the same way).
const setGoogleOpen = () => configureGoogle({ allowed_email_domains: '*' })

// #488: INSTANCE_ADDRESSES over HTTP. The request's Host only SELECTS a listed
// address; everything the server builds comes from the list.

const BAR = 'https://bar.example.com'
const ADMIN = 'https://featherbase.example.com'
const ROOT = '/barproof/' // the app's root
const BAR_PROOF = resolve('../..', 'test-apps/fixtures/bar-proof')
const ADDRESSES = parseInstanceAddresses(
  JSON.stringify([
    { address: BAR, opens: 'barproof', emails: true },
    { address: ADMIN, opens: 'admin' },
  ]),
  'test',
)

beforeEach(() => {
  config.instanceAddresses = ADDRESSES
})
afterEach(async () => {
  config.instanceAddresses = null
  vi.unstubAllEnvs()
  // An installed app stays loaded in this process after its rows roll back.
  const { discoverPackages } = await import('../src/runtime-packages')
  await discoverPackages([])
})

const redirectUriOf = (res: Response) =>
  new URLSearchParams((res.headers.get('location') ?? '').split('?')[1]).get('redirect_uri')

describe('Google sign-in per address', () => {
  test('on an app address, the redirect_uri is that address', async ({ api }) => {
    await configureGoogle({ client_id: 'test-client-id' })
    const res = await api.fetch(`${BAR}/api/oauth/google/login`)
    expect(redirectUriOf(res)).toBe(`${BAR}/api/oauth/google/callback`)
  })

  // Codex round 2: the state would record the unlisted host while the callback
  // comes back to the admin address, so the sign-in could never finish there.
  test('a forged Host cannot create an origin: an unlisted host is sent to start Google sign-in on the admin address', async ({ api }) => {
    await configureGoogle({ client_id: 'test-client-id' })
    const res = await api.fetch('https://evil.example.net/api/oauth/google/login?email=a%40example.com', { headers: { 'x-forwarded-proto': 'http' } })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`${ADMIN}/api/oauth/google/login?email=a%40example.com`)
  })

  test('an unlisted host gets no login challenge cookies of its own', async ({ api }) => {
    await configureGoogle({ client_id: 'test-client-id' })
    const res = await api.fetch('https://evil.example.net/api/oauth/google/login')
    expect(res.headers.getSetCookie()).toEqual([])
  })

  test('Google sign-in started on an unlisted host finishes on the admin address', async ({ api }) => {
    await setGoogleOpen()
    const away = await api.fetch('https://evil.example.net/api/oauth/google/login')
    const { callback, cookie } = await mockCallbackUrl(api, new URL(away.headers.get('location')!).origin, 'unlisted.start@gmail.com')
    const res = await api.fetch(`${ADMIN}${callback}`, { headers: { cookie } })
    expect(res.headers.get('location')).toContain('/featherbase/oauth-callback?code=')
  })

  test('the matched host ignores its case and its port', async ({ api }) => {
    await configureGoogle({ client_id: 'test-client-id' })
    const res = await api.fetch('https://BAR.example.com:8443/api/oauth/google/login')
    expect(redirectUriOf(res)).toBe(`${BAR}/api/oauth/google/callback`)
  })
})

// The mock provider's dance, started on one address and finished on another.
async function mockCallbackUrl(api: TestClient, startOn: string, email: string): Promise<{ callback: string; cookie: string }> {
  const login = await api.fetch(`${startOn}/api/oauth/google/login`)
  const state = new URLSearchParams((login.headers.get('location') as string).split('?')[1]).get('state') as string
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  const approve = await api.fetch(
    `${startOn}/api/oauth/mock/approve?${new URLSearchParams({ state, redirect_uri: '/api/oauth/google/callback', email, name: 'Someone' })}`,
    { headers: { cookie } },
  )
  return { callback: approve.headers.get('location') as string, cookie }
}

describe('the OAuth state is bound to its address', () => {
  test('a callback arriving on another listed host is refused', async ({ api }) => {
    await setGoogleOpen()
    const { callback, cookie } = await mockCallbackUrl(api, BAR, 'someone@gmail.com')
    const res = await api.fetch(`${ADMIN}${callback}`, { headers: { cookie } })
    expect(res.status).toBe(401)
  })

  test('a callback on the host that started the sign-in completes', async ({ api }) => {
    await setGoogleOpen()
    const { callback, cookie } = await mockCallbackUrl(api, BAR, 'someone@gmail.com')
    const res = await api.fetch(`${BAR}${callback}`, { headers: { cookie } })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('/featherbase/oauth-callback?code=')
  })
})

describe('on an address that opens an app', () => {
  const get = (api: TestClient, url: string) => api.fetch(url, { headers: { accept: 'text/html' } })

  test('/ redirects to the app root', async ({ api }) => {
    const res = await get(api, `${BAR}/`)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(ROOT)
  })

  test('an Admin page redirects to the app root', async ({ api }) => {
    // #489 item 13: Sign-in methods left the Admin for the account pages, so
    // its old Admin path is an Admin page like any other here.
    for (const page of ['/featherbase/admin/table/Person', '/featherbase/admin', '/featherbase/admin/sign-in-methods', '/featherbase/admin/sign-in-methods-other', '/featherbase/admin/waiting-for-access']) {
      const res = await get(api, `${BAR}${page}`)
      expect([page, res.status, res.headers.get('location')]).toEqual([page, 302, ROOT])
    }
  })

  // Codex round 2, then #489 item 13: the Account menu and the Google link
  // flow's return lead to the account page, which every address serves.
  test('the Sign-in methods page is served', async ({ api }) => {
    for (const page of ['/featherbase/account/sign-in-methods', '/featherbase/account/sign-in-methods?link=linked'])
      expect([page, (await get(api, `${BAR}${page}`)).status]).not.toEqual([page, 302])
  })

  test("another app's root redirects to the app root", async ({ api }) => {
    const res = await get(api, `${BAR}/tasker/`)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(ROOT)
  })

  test("the sign-in pages, the bar's script and the app root are served", async ({ api, admin }) => {
    for (const path of ['/featherbase/login?next=x', '/featherbase/reset-password?key=k', '/featherbase/oauth-callback?code=c', '/featherbase/bar.js'])
      expect([path, (await get(api, `${BAR}${path}`)).status]).not.toEqual([path, 302])
    // Signed in, since a signed-out visit to an app root is first sent to sign in.
    for (const path of [ROOT, `${ROOT}notes`])
      expect([path, (await get(admin, `${BAR}${path}`)).status]).not.toEqual([path, 302])
  })

  // #501: the password-reset page was already served on every address.
  test('the password-reset page is served', async ({ api }) => {
    expect((await get(api, `${BAR}/featherbase/reset-password?key=k`)).status).not.toBe(302)
  })

  // #501 item 4: a public web form link opens on an app's address too.
  test('a public web form is served', async ({ api }) => {
    for (const path of ['/featherbase/form/Feedback', '/featherbase/form/Feedback/new?x=1'])
      expect([path, (await get(api, `${BAR}${path}`)).status]).not.toEqual([path, 302])
  })

  test('the Portal redirects to the app root', async ({ api }) => {
    for (const path of ['/featherbase/portal', '/featherbase/portal/Person'])
      expect([path, (await get(api, `${BAR}${path}`)).headers.get('location')]).toEqual([path, ROOT])
  })

  test('a path that only starts like the form pages redirects to the app root', async ({ api }) => {
    for (const path of ['/featherbase/formx', '/featherbase/forms/Feedback', '/featherbase/form-builder'])
      expect([path, (await get(api, `${BAR}${path}`)).headers.get('location')]).toEqual([path, ROOT])
  })

  test('the API and the privacy notice are served', async ({ api }) => {
    expect((await api.fetch(`${BAR}/api/ping`)).status).toBe(200)
    expect((await get(api, `${BAR}/privacy`)).status).not.toBe(302)
  })

  test('on the admin address nothing is redirected', async ({ api }) => {
    expect((await get(api, `${ADMIN}/featherbase/admin`)).status).not.toBe(302)
  })

  test('an app that is not installed shows "Application unavailable"', async ({ admin }) => {
    config.instanceAddresses = parseInstanceAddresses(
      JSON.stringify([{ address: BAR, opens: 'not_installed', emails: true }, { address: ADMIN, opens: 'admin' }]),
      'test',
    )
    const home = await get(admin, `${BAR}/`)
    expect(home.headers.get('location')).toBe('/not_installed/')
    const root = await get(admin, `${BAR}/not_installed/`)
    expect(root.status).toBe(404)
    expect(await root.text()).toContain('Application unavailable')
  })
})

// ---- landing after sign-in, and the hand-off between addresses -------------

type SignedIn = { token: string; user: { row_id: string }; landing?: string; handoff?: string }

/** test-apps/fixtures/bar-proof installed: an app open to its Bar Reader role alone. */
async function installBar(admin: TestClient) {
  const [have] = await sql`select 1 from installed_app where name = 'barproof'`
  if (have) return
  const { discoverPackages } = await import('../src/runtime-packages')
  expect(await discoverPackages([BAR_PROOF])).toEqual([])
  await admin.post('/api/install_app', { name: 'barproof' })
}

/** A person with a password and these roles; returns their id and login name. */
async function personWith(admin: TestClient, name: string, roles: string[]) {
  if (roles.includes('Bar Reader')) await installBar(admin)
  const id = await makePerson({ email: `${name}@example.com`, full_name: name, roles: roles.map((role) => ({ role })) })
  await admin.post('/api/set_password', { user: id, password: 'landing-pw-1' })
  return { id, usr: `${name}@example.com` }
}

const cookieOf = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.split(';')[0] ?? ''

/** A password sign-in; `sid` is the cookie this browser now holds on `origin`. */
async function signIn(api: TestClient, origin: string, usr: string): Promise<{ res: Response; body: SignedIn; sid: string }> {
  const res = await api.fetch(`${origin}/api/login`, { method: 'POST', body: JSON.stringify({ usr, pwd: 'landing-pw-1' }) })
  return { res, body: (await res.json()) as SignedIn, sid: cookieOf(res, 'sid') }
}

/** One browser following a hand-off: to the target (which sets its nonce
 *  cookie), back to the source (which needs this browser's sid there), then
 *  to the target's callback URL. Returns the code and the target's cookie. */
async function followHandoff(api: TestClient, handoff: string, sourceSid: string): Promise<{ code: string | null; nonce: string; bind: Response }> {
  const start = await api.fetch(handoff)
  const nonce = cookieOf(start, 'handoff_nonce')
  const bind = await api.fetch(start.headers.get('location') ?? '', { headers: { cookie: sourceSid } })
  const code = bind.status === 302 ? new URL(bind.headers.get('location')!).searchParams.get('code') : null
  return { code, nonce, bind }
}

function redeemOn(api: TestClient, origin: string, code: string | null, cookie = '') {
  return api.fetch(`${origin}/api/oauth/session`, { method: 'POST', headers: cookie ? { cookie } : {}, body: JSON.stringify({ code }) })
}

describe('landing after sign-in', () => {
  test("on an app's address, a person who can open the app stays on its root", async ({ api, admin }) => {
    const viewer = await personWith(admin, 'viewer.stays', ['Bar Reader'])
    const { body } = await signIn(api, BAR, viewer.usr)
    expect(body).toMatchObject({ landing: ROOT })
    expect(body.handoff).toBeUndefined()
  })

  test("on an app's address, a person who cannot open it but can use Admin is handed to the admin address", async ({ api, admin }) => {
    const manager = await personWith(admin, 'manager.handed', ['System Manager'])
    const { body } = await signIn(api, BAR, manager.usr)
    expect(body.handoff).toMatch(new RegExp(`^${ADMIN}/api/handoff/start\\?ticket=`))
  })

  test('on the admin address, a person who can use Admin stays', async ({ api, admin }) => {
    const manager = await personWith(admin, 'manager.stays', ['System Manager', 'Bar Reader'])
    const { body } = await signIn(api, ADMIN, manager.usr)
    expect(body.handoff).toBeUndefined()
    expect(body.landing).toBeUndefined()
  })

  test("on the admin address, a person who can only open an app is handed to the app's address", async ({ api, admin }) => {
    const viewer = await personWith(admin, 'viewer.handed', ['Bar Reader'])
    const { body } = await signIn(api, ADMIN, viewer.usr)
    expect(body.handoff).toMatch(new RegExp(`^${BAR}/api/handoff/start\\?ticket=`))
  })

  test('on the admin address, a person who can do nothing gets the no-access page', async ({ api, admin }) => {
    const nobody = await personWith(admin, 'nobody.admin', [])
    const { body } = await signIn(api, ADMIN, nobody.usr)
    expect(body.handoff).toBeUndefined()
    expect(body.landing).toBeUndefined()
  })

  test("on an app's address, a person who can do nothing stays on the app's root, which refuses them", async ({ api, admin }) => {
    const nobody = await personWith(admin, 'nobody.dash', [])
    const { body } = await signIn(api, BAR, nobody.usr)
    expect(body.handoff).toBeUndefined()
    expect(body.landing).toBe(ROOT)
  })

  test('a Google sign-in on the admin address hands an app reader to the app address', async ({ api, admin }) => {
    await setGoogleOpen()
    await installBar(admin)
    const viewer = await makePerson({ email: 'google.viewer@example.com', full_name: 'Google Viewer', roles: [{ role: 'Bar Reader' }] })
    await inviteGoogleRaw(viewer, 'google.viewer@example.com')
    const { callback, cookie } = await mockCallbackUrl(api, ADMIN, 'google.viewer@example.com')
    const back = await api.fetch(`${ADMIN}${callback}`, { headers: { cookie } })
    const sid = cookieOf(back, 'sid')
    const code = new URL(back.headers.get('location')!, ADMIN).searchParams.get('code')
    const redeemed = await api.fetch(`${ADMIN}/api/oauth/session`, { method: 'POST', headers: { cookie: sid }, body: JSON.stringify({ code }) })
    const { handoff } = (await redeemed.json()) as SignedIn
    expect(handoff).toMatch(new RegExp(`^${BAR}/api/handoff/start\\?ticket=`))
    const followed = await followHandoff(api, handoff!, sid)
    expect((await redeemOn(api, BAR, followed.code, followed.nonce)).status).toBe(200)
  })
})

describe('the hand-off between addresses', () => {
  test('missing unknown wrong-address and spent tickets refuse without account changes while a genuine transfer succeeds', async ({ api, admin }) => {
    const viewer = await personWith(admin, 'viewer.ticket.refusals', ['Bar Reader'])
    const source = await signIn(api, ADMIN, viewer.usr)
    expect(source.res.status).toBe(200)
    const handoff = new URL(source.body.handoff!)
    expect(handoff.origin).toBe(BAR)
    const accounts = async () => ({
      people: await sql`select * from person order by row_id`,
      identities: await sql`select * from sign_in_identity order by id`,
      revoked: await sql`select * from revoked_session order by jti`,
      activity: await sql`select * from activity_log order by row_id`,
    })
    const refused = async (response: Response) => {
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: { type: 'AuthenticationError', message: 'Invalid or expired sign-in code' } })
      expect(response.headers.get('location')).toBeNull()
      expect(response.headers.getSetCookie()).toEqual([])
    }
    const before = await accounts()
    for (const suffix of ['', '?ticket=never-issued-ticket'])
      await refused(await api.fetch(`${BAR}/api/handoff/start${suffix}`))
    const wrongTarget = new URL(handoff.pathname + handoff.search, ADMIN)
    await refused(await api.fetch(wrongTarget.href))
    expect(await accounts()).toEqual(before)

    const start = await api.fetch(handoff.href)
    expect(start.status).toBe(302)
    const bind = new URL(start.headers.get('location')!)
    expect(bind.origin).toBe(ADMIN)
    expect(bind.searchParams.get('ticket')).toBe(handoff.searchParams.get('ticket'))
    expect(cookieOf(start, 'handoff_nonce')).not.toBe('')
    // Keep the producer's nonce hash and source cookie intact: only the
    // untrusted ticket value (or the receiving address) differs.
    for (const ticket of [undefined, 'never-issued-ticket']) {
      const invalid = new URL(bind)
      if (ticket === undefined) invalid.searchParams.delete('ticket')
      else invalid.searchParams.set('ticket', ticket)
      await refused(await api.fetch(invalid.href, { headers: { cookie: source.sid } }))
    }
    const wrongSource = new URL(bind.pathname + bind.search, BAR)
    await refused(await api.fetch(wrongSource.href, { headers: { cookie: source.sid } }))
    expect(await accounts()).toEqual(before)

    // A separate genuine login supplies an unspent control ticket; do not
    // invent or re-sign a ticket after the rejected bind.
    const control = await signIn(api, ADMIN, viewer.usr)
    expect(control.res.status).toBe(200)
    const started = await api.fetch(control.body.handoff!)
    expect(started.status).toBe(302)
    const bound = await api.fetch(started.headers.get('location')!, { headers: { cookie: control.sid } })
    expect(bound.status).toBe(302)
    const callback = new URL(bound.headers.get('location')!)
    expect(callback.origin).toBe(BAR)
    const completed = await redeemOn(api, BAR, callback.searchParams.get('code'), cookieOf(started, 'handoff_nonce'))
    expect(completed.status).toBe(200)
    const target = await completed.json() as SignedIn
    expect(target.user.row_id).toBe(viewer.id)
    expect(target.token).not.toBe(control.body.token)
    expect(target.landing).toBe(ROOT)
    expect(cookieOf(completed, 'sid')).toBe(`sid=${target.token}`)
    const who = await api.fetch(`${BAR}/api/whoami`, { headers: { cookie: cookieOf(completed, 'sid') } })
    expect(who.status).toBe(200)
    expect(await who.json()).toMatchObject({ row_id: viewer.id })
    const after = await accounts()
    expect(after.people).toEqual(before.people)
    expect(after.identities).toEqual(before.identities)
    expect(after.revoked).toEqual(before.revoked)
    expect(await sql`select operation from activity_log where "user" = ${viewer.id} and operation = 'login'`)
      .toEqual([{ operation: 'login' }, { operation: 'login' }, { operation: 'login' }])
    await refused(await api.fetch(started.headers.get('location')!, { headers: { cookie: control.sid } }))
    await refused(await api.fetch(control.body.handoff!))
    await refused(await redeemOn(api, BAR, callback.searchParams.get('code'), cookieOf(started, 'handoff_nonce')))
    expect(await accounts()).toEqual(after)
  })

  test('the target sets a host-only, HttpOnly nonce cookie and sends the browser back to the source', async ({ api, admin }) => {
    const viewer = await personWith(admin, 'viewer.round.trip', ['Bar Reader'])
    const { body } = await signIn(api, ADMIN, viewer.usr)
    const start = await api.fetch(body.handoff!)
    expect(start.status).toBe(302)
    expect(start.headers.get('location')).toMatch(new RegExp(`^${ADMIN}/api/handoff/bind\\?`))
    const cookie = start.headers.getSetCookie().find((c) => c.startsWith('handoff_nonce='))!
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/Secure/i)
    expect(cookie).not.toMatch(/domain=/i)
  })

  test('the browser that started it redeems the code on the target and gets a new session there', async ({ api, admin }) => {
    const viewer = await personWith(admin, 'viewer.redeems', ['Bar Reader'])
    const { body: source, sid } = await signIn(api, ADMIN, viewer.usr)
    const { code, nonce } = await followHandoff(api, source.handoff!, sid)
    const res = await redeemOn(api, BAR, code, nonce)
    expect(res.status).toBe(200)
    const target = (await res.json()) as SignedIn
    expect(target.user.row_id).toBe(viewer.id)
    expect(target.token).not.toBe(source.token)
    expect(target.landing).toBe(ROOT)
    expect(cookieOf(res, 'sid')).toContain(target.token)
  })

  test('a code redeemed by another browser, with no nonce cookie, is refused', async ({ api, admin }) => {
    const attacker = await personWith(admin, 'attacker.no.nonce', ['Bar Reader'])
    const { body, sid } = await signIn(api, ADMIN, attacker.usr)
    const { code } = await followHandoff(api, body.handoff!, sid)
    expect((await redeemOn(api, BAR, code)).status).toBe(401)
  })

  test("a code redeemed by another browser, with that browser's own nonce cookie, is refused", async ({ api, admin }) => {
    const attacker = await personWith(admin, 'attacker.other.nonce', ['Bar Reader'])
    const mine = await signIn(api, ADMIN, attacker.usr)
    const { code } = await followHandoff(api, mine.body.handoff!, mine.sid)
    const theirs = await signIn(api, ADMIN, attacker.usr)
    const victimNonce = cookieOf(await api.fetch(theirs.body.handoff!), 'handoff_nonce')
    expect((await redeemOn(api, BAR, code, victimNonce)).status).toBe(401)
  })

  test('a hand-off link opened in another browser is refused at the source, which has no session for it', async ({ api, admin }) => {
    const attacker = await personWith(admin, 'attacker.link', ['Bar Reader'])
    const { body } = await signIn(api, ADMIN, attacker.usr)
    const { bind, code } = await followHandoff(api, body.handoff!, '')
    expect(bind.status).toBe(401)
    expect(code).toBeNull()
  })

  test('a replayed code is refused', async ({ api, admin }) => {
    const viewer = await personWith(admin, 'viewer.replays', ['Bar Reader'])
    const { body, sid } = await signIn(api, ADMIN, viewer.usr)
    const { code, nonce } = await followHandoff(api, body.handoff!, sid)
    expect((await redeemOn(api, BAR, code, nonce)).status).toBe(200)
    expect((await redeemOn(api, BAR, code, nonce)).status).toBe(401)
  })

  test('a code redeemed on another host is refused, and spent', async ({ api, admin }) => {
    const viewer = await personWith(admin, 'viewer.wrong.host', ['Bar Reader'])
    const { body, sid } = await signIn(api, ADMIN, viewer.usr)
    const { code, nonce } = await followHandoff(api, body.handoff!, sid)
    expect((await redeemOn(api, ADMIN, code, nonce)).status).toBe(401)
    expect((await redeemOn(api, BAR, code, nonce)).status).toBe(401)
  })

  test('a code older than one minute is refused', async ({ api, admin }) => {
    const viewer = await personWith(admin, 'viewer.late', ['Bar Reader'])
    const { body, sid } = await signIn(api, ADMIN, viewer.usr)
    const { code, nonce } = await followHandoff(api, body.handoff!, sid)
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 61_000)
    try {
      expect((await redeemOn(api, BAR, code, nonce)).status).toBe(401)
    } finally {
      clock.mockRestore()
    }
  })

  test('a code is refused once the source session has signed out', async ({ api, admin }) => {
    const viewer = await personWith(admin, 'viewer.source.out', ['Bar Reader'])
    const { body, sid } = await signIn(api, ADMIN, viewer.usr)
    const { code, nonce } = await followHandoff(api, body.handoff!, sid)
    await api.fetch(`${ADMIN}/api/logout`, { method: 'POST', headers: { cookie: sid } })
    expect((await redeemOn(api, BAR, code, nonce)).status).toBe(401)
  })

  test("a code is refused once an operator's password reset ends the person's sessions", async ({ api, admin }) => {
    const viewer = await personWith(admin, 'viewer.source.reset', ['Bar Reader'])
    const { body, sid } = await signIn(api, ADMIN, viewer.usr)
    const { code, nonce } = await followHandoff(api, body.handoff!, sid)
    // The shell reset ends sessions issued before it, to the second, and its
    // now() is this test transaction's start, earlier than the session. Move
    // the cut-off a second past the wall clock, as a reset just after would.
    await setPasswordFromShell(viewer.id, 'reset-by-operator-1')
    await sql`update person set sessions_ended_at = clock_timestamp() + interval '1 second' where row_id = ${viewer.id}`
    expect((await redeemOn(api, BAR, code, nonce)).status).toBe(401)
  })
})

// Codex round 2: a store's staff share one public IP. The hand-off has its own
// budget, so the Google sign-ins that budget allows each finish their hand-off.
describe('the hand-off budget', () => {
  test('as many Google sign-ins as the OAuth budget allows, from one source, each finish a full hand-off', async ({ api, admin }) => {
    await setGoogleOpen()
    await installBar(admin)
    const viewer = await makePerson({ email: 'burst.viewer@example.com', full_name: 'Burst Viewer', roles: [{ role: 'Bar Reader' }] })
    await inviteGoogleRaw(viewer, 'burst.viewer@example.com')
    const { limits } = preAuthPolicy()
    const outcomes: number[] = []
    for (let i = 0; i < limits.OAUTH_LOGIN; i++) {
      const { callback, cookie } = await mockCallbackUrl(api, ADMIN, 'burst.viewer@example.com')
      const back = await api.fetch(`${ADMIN}${callback}`, { headers: { cookie } })
      const sid = cookieOf(back, 'sid')
      const code = new URL(back.headers.get('location')!, ADMIN).searchParams.get('code')
      const signedIn = await api.fetch(`${ADMIN}/api/oauth/session`, { method: 'POST', headers: { cookie: sid }, body: JSON.stringify({ code }) })
      const followed = await followHandoff(api, ((await signedIn.json()) as SignedIn).handoff!, sid)
      outcomes.push((await redeemOn(api, BAR, followed.code, followed.nonce)).status)
    }
    expect(outcomes).toEqual(Array(limits.OAUTH_LOGIN).fill(200))
  }, 60_000)
})

describe('sessions stay per address', () => {
  test('the sid cookie is host-only', async ({ api, admin }) => {
    const manager = await personWith(admin, 'manager.cookie', ['System Manager'])
    const { res } = await signIn(api, ADMIN, manager.usr)
    expect(res.headers.getSetCookie().find((c) => c.startsWith('sid='))).not.toMatch(/domain=/i)
  })

  test('signing out on one address ends only that address’s session', async ({ api, admin }) => {
    const viewer = await personWith(admin, 'viewer.signs.out', ['Bar Reader'])
    const { body: source, sid } = await signIn(api, ADMIN, viewer.usr)
    const { code, nonce } = await followHandoff(api, source.handoff!, sid)
    const target = (await (await redeemOn(api, BAR, code, nonce)).json()) as SignedIn
    const out = await api.fetch(`${BAR}/api/logout`, { method: 'POST', headers: { authorization: `Bearer ${target.token}` } })
    expect(out.status).toBe(200)
    const whoami = (token: string, origin: string) => api.fetch(`${origin}/api/whoami`, { headers: { authorization: `Bearer ${token}` } })
    expect((await whoami(target.token, BAR)).status).toBe(401)
    expect((await whoami(source.token, ADMIN)).status).toBe(200)
  })
})

describe('the brand', () => {
  test("on an app's address, /api/brand names the app", async ({ api, admin }) => {
    await installBar(admin)
    expect(((await (await api.fetch(`${BAR}/api/brand`)).json()) as { app_name: string }).app_name).toBe('Bar proof')
  })

  test('on the admin address, /api/brand names the instance', async ({ api }) => {
    const instance = ((await (await api.fetch('/api/brand')).json()) as { app_name: string }).app_name
    expect(((await (await api.fetch(`${ADMIN}/api/brand`)).json()) as { app_name: string }).app_name).toBe(instance)
    expect(instance).not.toBe('Bar proof')
  })
})

describe('the release preflight', () => {
  // A test database is stamped `test`; these cases ask about other environments.
  // A production release also needs the rest of a production environment
  // (env.ts): its own JWT_SECRET, and no mock Google provider.
  const asRelease = async <T>(run: () => Promise<T>) => {
    vi.stubEnv('JWT_SECRET', 'a-production-secret')
    vi.stubEnv('ALLOW_MOCK_OAUTH', '')
    const before = process.env.DISABLE_DATABASE_ENVIRONMENT_CHECK
    process.env.DISABLE_DATABASE_ENVIRONMENT_CHECK = '1'
    try {
      return await run()
    } finally {
      if (before === undefined) delete process.env.DISABLE_DATABASE_ENVIRONMENT_CHECK
      else process.env.DISABLE_DATABASE_ENVIRONMENT_CHECK = before
    }
  }

  test('refuses a production server with no INSTANCE_ADDRESSES', async () => {
    config.instanceAddresses = null
    await asRelease(() => expect(preflightRelease({ environment: 'production' })).rejects.toThrow(/INSTANCE_ADDRESSES is not set on a "production" server/))
  })

  test('refuses a list a production server may not use', async () => {
    config.instanceAddresses = parseInstanceAddresses('[{"address":"http://dash.example.com","opens":"admin","emails":true}]', 'test')
    await asRelease(() => expect(preflightRelease({ environment: 'production' })).rejects.toThrow(/must use https on a "production" server/))
  })

  test('passes a valid list and says what it opens', async () => {
    await asRelease(async () =>
      expect(await preflightRelease({ environment: 'production' })).toContain(
        'INSTANCE_ADDRESSES: https://bar.example.com opens barproof (emails), https://featherbase.example.com opens admin',
      ))
  })

  test('allows no list on a development server', async () => {
    config.instanceAddresses = null
    expect(await preflightRelease({ environment: 'test' })).toContain('INSTANCE_ADDRESSES unset, allowed on a "test" server')
  })
})

describe('emailed links use the address marked for emails', () => {
  test('a password reset requested on the admin address links to the emails address', async ({ admin }) => {
    const person = await makePerson({ email: 'reset.488@example.com', full_name: 'Reset Person' })
    await admin.post('/api/set_password', { user: person, password: 'origpw123' })
    const res = await admin.fetch(`${ADMIN}/api/reset_password_request`, { method: 'POST', body: JSON.stringify({ usr: 'reset.488@example.com' }) })
    expect(res.status).toBe(200)
    const [mail] = await sql`select body from email_sink where mail_to = 'reset.488@example.com'`
    expect(String(mail.body)).toContain(`${BAR}/featherbase/reset-password?key=`)
  })

  test('an invitation sent from the admin address links to the emails address', async ({ admin }) => {
    const person = await makePerson({ full_name: 'Invited Person' })
    const res = await admin.fetch(`${ADMIN}/api/people/${encodeURIComponent(person)}/identities`, {
      method: 'POST',
      body: JSON.stringify({ method: 'google', email: 'invited.488@example.com' }),
    })
    expect(res.status).toBe(201)
    const [mail] = await sql`select body from email_sink where mail_to = 'invited.488@example.com'`
    expect(String(mail.body)).toContain(`${BAR}/featherbase/login`)
  })

  test('the waiting-for-access alert, an Admin page, links to the admin address even when emails use an app address', async () => {
    await makePerson({ email: 'manager.488@example.com', full_name: 'Manager', roles: [{ role: 'System Manager' }] })
    const arrival = await makePerson({ full_name: 'New Arrival', email: 'new.arrival@staff.example.com' })
    await alertAccessRequest(arrival, { name: 'featherbase', title: 'Featherbase' })
    const [mail] = await sql`select body from email_queue where lower(recipient) = 'manager.488@example.com'`
    expect(String(mail.body)).toContain(`${ADMIN}/featherbase/admin/waiting-for-access`)
  })
})

describe('an address that opens an installed app package', () => {
  test('its sign-in page carries the package title, and a person who can open the app lands on its root', async ({ api, admin }) => {
    const { discoverPackages } = await import('../src/runtime-packages')
    const { resolve } = await import('node:path')
    await discoverPackages([resolve('../..', 'test-apps/other')])
    await admin.post('/api/install_app', { name: 'other' })
    const OTHER = 'https://other.example.com'
    config.instanceAddresses = parseInstanceAddresses(
      JSON.stringify([{ address: OTHER, opens: 'other', emails: true }, { address: ADMIN, opens: 'admin' }]),
      'test',
    )
    expect(await (await api.fetch(`${OTHER}/api/brand`)).json()).toMatchObject({ app_name: 'Other tasks', opens: 'other' })
    const manager = await personWith(admin, 'other.opener', ['System Manager'])
    const { body } = await signIn(api, OTHER, manager.usr)
    expect(body).toMatchObject({ landing: '/other/' })
    expect(body.handoff).toBeUndefined()
  })
})

// #671: an address opens its installed app, names it, and signs its readers in to it.
describe('an address whose app is installed and open to everyone', () => {
  const STAND_IN = 'https://stand-in.example.com'
  beforeEach(() => {
    config.instanceAddresses = parseInstanceAddresses(
      JSON.stringify([{ address: STAND_IN, opens: 'dash', emails: true }, { address: ADMIN, opens: 'admin' }]),
      'test',
    )
  })
  const APP_ROOT = '/dash/'
  const get = (api: TestClient, url: string) => api.fetch(url, { headers: { accept: 'text/html' } })

  /** The stand-in installed as dash: readable by All, so anyone can
   *  open it and no one gains a Table grant of their own by it. */
  async function installDashApp(admin: TestClient) {
    const { discoverPackages } = await import('../src/runtime-packages')
    const { resolve } = await import('node:path')
    expect(await discoverPackages([resolve('../..', 'test-apps/fixtures/dash-stand-in')])).toEqual([])
    await admin.post('/api/install_app', { name: 'dash' })
  }

  // The installed app stays loaded in this process after its rows roll back.
  afterEach(async () => {
    const { discoverPackages } = await import('../src/runtime-packages')
    await discoverPackages([])
  })

  test('/ redirects to the app root', async ({ api, admin }) => {
    await installDashApp(admin)
    expect((await get(api, `${STAND_IN}/`)).headers.get('location')).toBe(APP_ROOT)
  })

  test("the address's brand is the installed app's title", async ({ api, admin }) => {
    await installDashApp(admin)
    expect(await (await api.fetch(`${STAND_IN}/api/brand`)).json()).toMatchObject({ app_name: 'Dash stand-in', opens: 'dash' })
  })

  test('a person who can open the app lands on its root', async ({ api, admin }) => {
    await installDashApp(admin)
    const reader = await personWith(admin, 'dash.app.reader', [])
    const { body } = await signIn(api, STAND_IN, reader.usr)
    expect(body).toMatchObject({ landing: APP_ROOT })
  })

  // ADR 0011: with no list the platform names no app to land in, and an app
  // open to everyone (All) claims no one in particular.
  test('with no list, an app open to everyone is no one\'s landing', async ({ api, admin }) => {
    await installDashApp(admin)
    config.instanceAddresses = null
    const reader = await personWith(admin, 'dash.app.unlisted', [])
    const { body } = await signIn(api, 'http://localhost', reader.usr)
    expect(body.landing).toBeUndefined()
  })

  // Codex round 1 on #672: routing follows the installation recorded in the
  // database, never whether this process is serving the app. A disabled,
  // pending or locally unloaded app is still installed: its address keeps to
  // the app's root, which answers that the app is unavailable.
  const disable = (admin: TestClient) => admin.post('/api/set_app_enabled', { name: 'dash', enabled: false })

  test('a disabled app keeps / on the app root', async ({ api, admin }) => {
    await installDashApp(admin)
    await disable(admin)
    expect((await get(api, `${STAND_IN}/`)).headers.get('location')).toBe(APP_ROOT)
  })

  // Signed in: a signed-out visit to any app root is first sent to sign in.
  test("a disabled app's root answers that the app is unavailable", async ({ admin }) => {
    await installDashApp(admin)
    await disable(admin)
    const res = await get(admin, `${STAND_IN}${APP_ROOT}`)
    expect([res.status, res.headers.get('location')]).toEqual([404, null])
  })

  test("a disabled app's address is still named for the app", async ({ api, admin }) => {
    await installDashApp(admin)
    await disable(admin)
    expect(await (await api.fetch(`${STAND_IN}/api/brand`)).json()).toMatchObject({ app_name: 'Dash stand-in' })
  })

  test('a person signing in while the app is disabled lands on the app root', async ({ api, admin }) => {
    await installDashApp(admin)
    await disable(admin)
    const reader = await personWith(admin, 'dash.app.disabled', [])
    const { body } = await signIn(api, STAND_IN, reader.usr)
    expect(body).toMatchObject({ landing: APP_ROOT })
  })

  test('an app pending activation, as a restarted process finds it, keeps / on the app root', async ({ api, admin }) => {
    const { discoverPackages } = await import('../src/runtime-packages')
    await installDashApp(admin)
    await sql`update installed_app set activation_pending = true where name = 'dash'`
    await discoverPackages([])
    expect((await get(api, `${STAND_IN}/`)).headers.get('location')).toBe(APP_ROOT)
  })

  test("a process that has not loaded the installed app answers at the app's root that it is unavailable", async ({ admin }) => {
    const { discoverPackages } = await import('../src/runtime-packages')
    await installDashApp(admin)
    await discoverPackages([])
    const res = await get(admin, `${STAND_IN}${APP_ROOT}`)
    expect([res.status, res.headers.get('location')]).toEqual([404, null])
  })

})

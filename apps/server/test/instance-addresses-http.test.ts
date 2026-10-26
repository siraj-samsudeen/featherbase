import { afterEach, beforeEach, describe, expect, vi } from 'vitest'
import { test } from './pg-test'
import { config } from '../src/config'
import { parseInstanceAddresses } from '../src/instance-addresses'
import { configureGoogle, inviteGoogleRaw } from './identity-fixtures'
import { saveDoc } from '../src/document'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { methodOfKind } from '../src/identities'
import { alertNewArrival } from '../src/waiting-for-access'
import { makePerson } from './fixtures'
import { preflightRelease } from '../src/release-preflight'

// The mock provider, admitting any address (oauth.test.ts drives it the same way).
const setGoogleOpen = () => configureGoogle({ allowed_email_domains: '*' })

// #488: INSTANCE_ADDRESSES over HTTP. The request's Host only SELECTS a listed
// address; everything the server builds comes from the list.

const DASH = 'https://dash.example.com'
const ADMIN = 'https://featherbase.example.com'
const ROOT = '/featherbase/sales-target' // feather_dash's interim root (design D8)
const ADDRESSES = parseInstanceAddresses(
  JSON.stringify([
    { address: DASH, opens: 'feather_dash', emails: true },
    { address: ADMIN, opens: 'admin' },
  ]),
  'test',
)

beforeEach(() => {
  config.instanceAddresses = ADDRESSES
})
afterEach(() => {
  config.instanceAddresses = null
})

const redirectUriOf = (res: Response) =>
  new URLSearchParams((res.headers.get('location') ?? '').split('?')[1]).get('redirect_uri')

describe('Google sign-in per address', () => {
  test('on an app address, the redirect_uri is that address', async ({ api }) => {
    await configureGoogle({ client_id: 'test-client-id' })
    const res = await api.fetch(`${DASH}/api/oauth/google/login`)
    expect(redirectUriOf(res)).toBe(`${DASH}/api/oauth/google/callback`)
  })

  test('a forged Host cannot create an origin: an unlisted host gets the admin address', async ({ api }) => {
    await configureGoogle({ client_id: 'test-client-id' })
    const res = await api.fetch('https://evil.example.net/api/oauth/google/login', { headers: { 'x-forwarded-proto': 'http' } })
    expect(redirectUriOf(res)).toBe(`${ADMIN}/api/oauth/google/callback`)
  })

  test('the matched host ignores its case and its port', async ({ api }) => {
    await configureGoogle({ client_id: 'test-client-id' })
    const res = await api.fetch('https://DASH.example.com:8443/api/oauth/google/login')
    expect(redirectUriOf(res)).toBe(`${DASH}/api/oauth/google/callback`)
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
    const { callback, cookie } = await mockCallbackUrl(api, DASH, 'someone@gmail.com')
    const res = await api.fetch(`${ADMIN}${callback}`, { headers: { cookie } })
    expect(res.status).toBe(401)
  })

  test('a callback on the host that started the sign-in completes', async ({ api }) => {
    await setGoogleOpen()
    const { callback, cookie } = await mockCallbackUrl(api, DASH, 'someone@gmail.com')
    const res = await api.fetch(`${DASH}${callback}`, { headers: { cookie } })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('/featherbase/oauth-callback?code=')
  })
})

describe('on an address that opens an app', () => {
  const get = (api: TestClient, url: string) => api.fetch(url, { headers: { accept: 'text/html' } })

  test('/ redirects to the app root', async ({ api }) => {
    const res = await get(api, `${DASH}/`)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(ROOT)
  })

  test('an Admin page redirects to the app root', async ({ api }) => {
    const res = await get(api, `${DASH}/featherbase/admin/table/Person`)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(ROOT)
  })

  test("another app's root redirects to the app root", async ({ api }) => {
    const res = await get(api, `${DASH}/tasker/`)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(ROOT)
  })

  test('the sign-in pages, the shell assets and the app root are served', async ({ api }) => {
    for (const path of ['/featherbase/login?next=x', '/featherbase/reset-password?key=k', '/featherbase/oauth-callback?code=c', '/featherbase/runtime-shell.css', ROOT, `${ROOT}/`])
      expect([path, (await get(api, `${DASH}${path}`)).status]).not.toEqual([path, 302])
  })

  test('the API and the privacy notice are served', async ({ api }) => {
    expect((await api.fetch(`${DASH}/api/ping`)).status).toBe(200)
    expect((await get(api, `${DASH}/privacy`)).status).not.toBe(302)
  })

  test('on the admin address nothing is redirected', async ({ api }) => {
    expect((await get(api, `${ADMIN}/featherbase/admin`)).status).not.toBe(302)
  })

  test('an app that is not installed shows "Application unavailable"', async ({ admin }) => {
    config.instanceAddresses = parseInstanceAddresses(
      JSON.stringify([{ address: DASH, opens: 'not_installed', emails: true }, { address: ADMIN, opens: 'admin' }]),
      'test',
    )
    const home = await get(admin, `${DASH}/`)
    expect(home.headers.get('location')).toBe('/not_installed/')
    const root = await get(admin, `${DASH}/not_installed/`)
    expect(root.status).toBe(404)
    expect(await root.text()).toContain('Application unavailable')
  })
})

// ---- landing after sign-in, and the hand-off between addresses -------------

type SignedIn = { token: string; user: { row_id: string }; landing?: string; handoff?: string }

async function viewerRole() {
  const [have] = await sql`select 1 from role where row_id = 'Sales Target Viewer'`
  if (!have) await saveDoc('Role', { row_id: 'Sales Target Viewer' }, 'Administrator')
}

/** A person with a password and these roles; returns their id and login name. */
async function personWith(admin: TestClient, name: string, roles: string[]) {
  await viewerRole()
  const id = await makePerson({ email: `${name}@example.com`, full_name: name, roles: roles.map((role) => ({ role })) })
  await admin.post('/api/set_password', { user: id, password: 'landing-pw-1' })
  return { id, usr: `${name}@example.com` }
}

async function signIn(api: TestClient, origin: string, usr: string): Promise<{ res: Response; body: SignedIn }> {
  const res = await api.fetch(`${origin}/api/login`, { method: 'POST', body: JSON.stringify({ usr, pwd: 'landing-pw-1' }) })
  return { res, body: (await res.json()) as SignedIn }
}

const handoffCodeOf = (handoff: string | undefined) => new URL(handoff ?? 'http://x/').searchParams.get('code')

function redeemOn(api: TestClient, origin: string, code: string | null) {
  return api.fetch(`${origin}/api/oauth/session`, { method: 'POST', body: JSON.stringify({ code }) })
}

describe('landing after sign-in', () => {
  test("on an app's address, a person who can open the app stays on its root", async ({ api, admin }) => {
    const viewer = await personWith(admin, 'viewer.stays', ['Sales Target Viewer'])
    const { body } = await signIn(api, DASH, viewer.usr)
    expect(body).toMatchObject({ landing: ROOT })
    expect(body.handoff).toBeUndefined()
  })

  test("on an app's address, a person who cannot open it but can use Admin is handed to the admin address", async ({ api, admin }) => {
    const manager = await personWith(admin, 'manager.handed', ['System Manager'])
    const { body } = await signIn(api, DASH, manager.usr)
    expect(body.handoff).toMatch(new RegExp(`^${ADMIN}/featherbase/oauth-callback\\?code=`))
  })

  test('on the admin address, a person who can use Admin stays', async ({ api, admin }) => {
    const manager = await personWith(admin, 'manager.stays', ['System Manager', 'Sales Target Viewer'])
    const { body } = await signIn(api, ADMIN, manager.usr)
    expect(body.handoff).toBeUndefined()
    expect(body.landing).toBeUndefined()
  })

  test("on the admin address, a person who can only open an app is handed to the app's address", async ({ api, admin }) => {
    const viewer = await personWith(admin, 'viewer.handed', ['Sales Target Viewer'])
    const { body } = await signIn(api, ADMIN, viewer.usr)
    expect(body.handoff).toMatch(new RegExp(`^${DASH}/featherbase/oauth-callback\\?code=`))
  })

  test('on the admin address, a person who can do nothing gets the no-access page', async ({ api, admin }) => {
    const nobody = await personWith(admin, 'nobody.admin', [])
    const { body } = await signIn(api, ADMIN, nobody.usr)
    expect(body.handoff).toBeUndefined()
    expect(body.landing).toBeUndefined()
  })

  test("on an app's address, a person who can do nothing stays on the app's root, which refuses them", async ({ api, admin }) => {
    const nobody = await personWith(admin, 'nobody.dash', [])
    const { body } = await signIn(api, DASH, nobody.usr)
    expect(body.handoff).toBeUndefined()
    expect(body.landing).toBe(ROOT)
  })

  test('a Google sign-in on the admin address hands a report viewer to the app address', async ({ api }) => {
    await setGoogleOpen()
    await viewerRole()
    const viewer = await makePerson({ email: 'google.viewer@example.com', full_name: 'Google Viewer', roles: [{ role: 'Sales Target Viewer' }] })
    await inviteGoogleRaw(viewer, 'google.viewer@example.com')
    const { callback, cookie } = await mockCallbackUrl(api, ADMIN, 'google.viewer@example.com')
    const back = await api.fetch(`${ADMIN}${callback}`, { headers: { cookie } })
    const sid = back.headers.getSetCookie().find((c) => c.startsWith('sid='))!.split(';')[0]
    const code = new URL(back.headers.get('location')!, ADMIN).searchParams.get('code')
    const redeemed = await api.fetch(`${ADMIN}/api/oauth/session`, { method: 'POST', headers: { cookie: sid }, body: JSON.stringify({ code }) })
    expect(((await redeemed.json()) as SignedIn).handoff).toMatch(new RegExp(`^${DASH}/featherbase/oauth-callback\\?code=`))
  })
})

describe('the hand-off code', () => {
  test('redeemed on its target address, it mints a new session there', async ({ api, admin }) => {
    const viewer = await personWith(admin, 'viewer.redeems', ['Sales Target Viewer'])
    const { body: source } = await signIn(api, ADMIN, viewer.usr)
    const res = await redeemOn(api, DASH, handoffCodeOf(source.handoff))
    expect(res.status).toBe(200)
    const target = (await res.json()) as SignedIn
    expect(target.user.row_id).toBe(viewer.id)
    expect(target.token).not.toBe(source.token)
    expect(target.landing).toBe(ROOT)
    expect(res.headers.getSetCookie().find((c) => c.startsWith('sid='))).toContain(target.token)
  })

  test('a replayed code is refused', async ({ api, admin }) => {
    const viewer = await personWith(admin, 'viewer.replays', ['Sales Target Viewer'])
    const code = handoffCodeOf((await signIn(api, ADMIN, viewer.usr)).body.handoff)
    expect((await redeemOn(api, DASH, code)).status).toBe(200)
    expect((await redeemOn(api, DASH, code)).status).toBe(401)
  })

  test('a code redeemed on another host is refused, and spent', async ({ api, admin }) => {
    const viewer = await personWith(admin, 'viewer.wrong.host', ['Sales Target Viewer'])
    const code = handoffCodeOf((await signIn(api, ADMIN, viewer.usr)).body.handoff)
    expect((await redeemOn(api, ADMIN, code)).status).toBe(401)
    expect((await redeemOn(api, DASH, code)).status).toBe(401)
  })

  test('a code older than one minute is refused', async ({ api, admin }) => {
    const viewer = await personWith(admin, 'viewer.late', ['Sales Target Viewer'])
    const code = handoffCodeOf((await signIn(api, ADMIN, viewer.usr)).body.handoff)
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 61_000)
    try {
      expect((await redeemOn(api, DASH, code)).status).toBe(401)
    } finally {
      clock.mockRestore()
    }
  })
})

describe('sessions stay per address', () => {
  test('the sid cookie is host-only', async ({ api, admin }) => {
    const manager = await personWith(admin, 'manager.cookie', ['System Manager'])
    const { res } = await signIn(api, ADMIN, manager.usr)
    expect(res.headers.getSetCookie().find((c) => c.startsWith('sid='))).not.toMatch(/domain=/i)
  })

  test('signing out on one address ends only that address’s session', async ({ api, admin }) => {
    const viewer = await personWith(admin, 'viewer.signs.out', ['Sales Target Viewer'])
    const { body: source } = await signIn(api, ADMIN, viewer.usr)
    const target = (await (await redeemOn(api, DASH, handoffCodeOf(source.handoff))).json()) as SignedIn
    const out = await api.fetch(`${DASH}/api/logout`, { method: 'POST', headers: { authorization: `Bearer ${target.token}` } })
    expect(out.status).toBe(200)
    const whoami = (token: string, origin: string) => api.fetch(`${origin}/api/whoami`, { headers: { authorization: `Bearer ${token}` } })
    expect((await whoami(target.token, DASH)).status).toBe(401)
    expect((await whoami(source.token, ADMIN)).status).toBe(200)
  })
})

describe('the brand', () => {
  test("on an app's address, /api/brand names the app", async ({ api }) => {
    expect(((await (await api.fetch(`${DASH}/api/brand`)).json()) as { app_name: string }).app_name).toBe('Feather Dash')
  })

  test('on the admin address, /api/brand names the instance', async ({ api }) => {
    const instance = ((await (await api.fetch('/api/brand')).json()) as { app_name: string }).app_name
    expect(((await (await api.fetch(`${ADMIN}/api/brand`)).json()) as { app_name: string }).app_name).toBe(instance)
    expect(instance).not.toBe('Feather Dash')
  })
})

describe('the release preflight', () => {
  // A test database is stamped `test`; these cases ask about other environments.
  const asRelease = async <T>(run: () => Promise<T>) => {
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
        'INSTANCE_ADDRESSES: https://dash.example.com opens feather_dash (emails), https://featherbase.example.com opens admin',
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
    expect(String(mail.body)).toContain(`${DASH}/featherbase/reset-password?key=`)
  })

  test('an invitation sent from the admin address links to the emails address', async ({ admin }) => {
    const person = await makePerson({ full_name: 'Invited Person' })
    const res = await admin.fetch(`${ADMIN}/api/people/${encodeURIComponent(person)}/identities`, {
      method: 'POST',
      body: JSON.stringify({ method: 'google', email: 'invited.488@example.com' }),
    })
    expect(res.status).toBe(201)
    const [mail] = await sql`select body from email_sink where mail_to = 'invited.488@example.com'`
    expect(String(mail.body)).toContain(`${DASH}/featherbase/login`)
  })

  test('the waiting-for-access alert links to the emails address', async () => {
    await makePerson({ email: 'manager.488@example.com', full_name: 'Manager', roles: [{ role: 'System Manager' }] })
    const arrival = await makePerson({ full_name: 'New Arrival', email: 'new.arrival@staff.example.com' })
    await alertNewArrival(arrival, (await methodOfKind('google'))!)
    const [mail] = await sql`select body from email_queue where lower(recipient) = 'manager.488@example.com'`
    expect(String(mail.body)).toContain(`${DASH}/featherbase/`)
  })
})

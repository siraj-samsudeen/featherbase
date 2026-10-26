import { afterEach, beforeEach, describe, expect, vi } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { config } from '../src/config'
import { parseInstanceAddresses } from '../src/instance-addresses'
import { saveDoc } from '../src/document'
import { sql } from '../src/db'
import { makePerson } from './fixtures'
import { configureGoogle } from './identity-fixtures'

// #489 (design D3, "One top bar on every address"): what the shared top bar
// asks the server. The bar draws its name from the address it is on, and
// "Open Admin" reaches the Admin address through #488's hand-off, never a
// guessed URL.

const DASH = 'https://dash.example.com'
const ADMIN = 'https://featherbase.example.com'
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

const brandOf = async (api: TestClient, url: string) => (await (await api.fetch(url)).json()) as { opens: string | null }

describe('/api/brand says what the address opens', () => {
  test("on an app's address, the app", async ({ api }) => {
    expect((await brandOf(api, `${DASH}/api/brand`)).opens).toBe('feather_dash')
  })

  test('on the admin address, admin', async ({ api }) => {
    expect((await brandOf(api, `${ADMIN}/api/brand`)).opens).toBe('admin')
  })

  test('on a host the list does not name, nothing', async ({ api }) => {
    expect((await brandOf(api, '/api/brand')).opens).toBeNull()
  })
})

// ---- "Open Admin" ------------------------------------------------------------

type Opened = { handoff?: string; landing?: string }

async function viewerRole() {
  const [have] = await sql`select 1 from role where row_id = 'Sales Target Viewer'`
  if (!have) await saveDoc('Role', { row_id: 'Sales Target Viewer' }, 'Administrator')
}

const cookieOf = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.split(';')[0] ?? ''

/** A person with these roles, signed in on `origin` in one browser: `sid` is
 *  the cookie it holds there. `openAdmin` asks from `at`, as that browser does
 *  (its bearer token and its cookie). */
async function signedIn(api: TestClient, admin: TestClient, name: string, roles: string[], origin: string, minutesAgo = 0) {
  await viewerRole()
  const id = await makePerson({ email: `${name}@example.com`, full_name: name, roles: roles.map((role) => ({ role })) })
  await admin.post('/api/set_password', { user: id, password: 'top-bar-pw-1' })
  // The sign-in alone happens `minutesAgo`: its session carries that time.
  const now = Date.now()
  const clock = minutesAgo ? vi.spyOn(Date, 'now').mockReturnValue(now - minutesAgo * 60_000) : null
  let res: Response
  try {
    res = await api.fetch(`${origin}/api/login`, { method: 'POST', body: JSON.stringify({ usr: `${name}@example.com`, pwd: 'top-bar-pw-1' }) })
  } finally {
    clock?.mockRestore()
  }
  const { token } = (await res.json()) as { token: string }
  const sid = cookieOf(res, 'sid')
  return {
    id,
    sid,
    token,
    openAdmin: (at: string) => api.fetch(`${at}/api/open_admin`, { method: 'POST', headers: { authorization: `Bearer ${token}`, cookie: sid } }),
  }
}

/** One browser following #488's hand-off: to the target (its nonce cookie),
 *  back to the source with `sourceSid`, then redeeming the code at the target. */
async function follow(api: TestClient, handoff: string, sourceSid: string): Promise<Response | null> {
  const start = await api.fetch(handoff)
  const nonce = cookieOf(start, 'handoff_nonce')
  const bind = await api.fetch(start.headers.get('location') ?? '', { headers: { cookie: sourceSid } })
  if (bind.status !== 302) return null
  const callback = new URL(bind.headers.get('location')!)
  const code = callback.searchParams.get('code')
  return api.fetch(`${callback.origin}/api/oauth/session`, { method: 'POST', headers: { cookie: nonce }, body: JSON.stringify({ code }) })
}

describe('POST /api/open_admin', () => {
  test("on an app's address, a person who can use Admin is handed to the admin address", async ({ api, admin }) => {
    const both = await signedIn(api, admin, 'both.opens', ['System Manager', 'Sales Target Viewer'], DASH)
    const res = await both.openAdmin(DASH)
    expect(res.status).toBe(200)
    expect(((await res.json()) as Opened).handoff).toMatch(new RegExp(`^${ADMIN}/api/handoff/start\\?ticket=`))
  })

  test('the hand-off signs the same person in on the admin address', async ({ api, admin }) => {
    const both = await signedIn(api, admin, 'both.redeems', ['System Manager', 'Sales Target Viewer'], DASH)
    const { handoff } = (await (await both.openAdmin(DASH)).json()) as Opened
    const res = await follow(api, handoff!, both.sid)
    expect(res?.status).toBe(200)
    expect(((await res!.json()) as { user: { row_id: string } }).user.row_id).toBe(both.id)
  })

  test('the hand-off cannot be completed by a browser without that session', async ({ api, admin }) => {
    const both = await signedIn(api, admin, 'both.stolen', ['System Manager', 'Sales Target Viewer'], DASH)
    const { handoff } = (await (await both.openAdmin(DASH)).json()) as Opened
    expect(await follow(api, handoff!, '')).toBeNull()
  })

  test('a person who cannot use Admin is refused', async ({ api, admin }) => {
    const viewer = await signedIn(api, admin, 'viewer.refused', ['Sales Target Viewer'], DASH)
    expect((await viewer.openAdmin(DASH)).status).toBe(403)
  })

  test('on the admin address, Admin is this address', async ({ api, admin }) => {
    const manager = await signedIn(api, admin, 'manager.here', ['System Manager'], ADMIN)
    expect(await (await manager.openAdmin(ADMIN)).json()).toEqual({ landing: '/featherbase/admin' })
  })

  test('with no list, Admin is this address', async ({ api, admin }) => {
    config.instanceAddresses = null
    const manager = await signedIn(api, admin, 'manager.nolist', ['System Manager'], 'http://localhost')
    expect(await (await manager.openAdmin('http://localhost')).json()).toEqual({ landing: '/featherbase/admin' })
  })

  test('signed out, it is refused', async ({ api }) => {
    expect((await api.fetch(`${DASH}/api/open_admin`, { method: 'POST' })).status).toBe(401)
  })
})

// ---- a hand-off never makes a sign-in younger (Codex round 1 on #495) ----------

/** Signed in `minutesAgo` on DASH, then handed to ADMIN by Open Admin: the
 *  session the admin address minted for this browser. */
type Session = { token: string; user: { sign_in: { expires_at: number } } }

async function handedOverAfter(api: TestClient, admin: TestClient, name: string, minutesAgo: number) {
  const both = await signedIn(api, admin, name, ['System Manager', 'Sales Target Viewer'], DASH, minutesAgo)
  const { handoff } = (await (await both.openAdmin(DASH)).json()) as Opened
  const res = await follow(api, handoff!, both.sid)
  const source = (await (await api.fetch(`${DASH}/api/whoami`, { headers: { authorization: `Bearer ${both.token}` } })).json()) as Session['user']
  return { target: (await res!.json()) as Session, source }
}

const startLinkingGoogle = (api: TestClient, token: string) =>
  api.fetch(`${ADMIN}/api/oauth/google/link`, { headers: { authorization: `Bearer ${token}` }, redirect: 'manual' })

describe('a handed-over session keeps the time its person signed in', () => {
  beforeEach(() => configureGoogle({ client_id: 'test-client-id', self_link: true }))

  test('Google linking on the admin address is refused when the sign-in on the app address is older than 15 minutes', async ({ api, admin }) => {
    const { target } = await handedOverAfter(api, admin, 'stale.linker', 20)
    expect((await startLinkingGoogle(api, target.token)).status).toBe(401)
  })

  test('Google linking on the admin address starts when the sign-in on the app address is fresh', async ({ api, admin }) => {
    const { target } = await handedOverAfter(api, admin, 'fresh.linker', 1)
    expect((await startLinkingGoogle(api, target.token)).status).toBe(302)
  })

  test('the handed-over session expires when the original sign-in would', async ({ api, admin }) => {
    const { target, source } = await handedOverAfter(api, admin, 'expiry.keeper', 60)
    expect(target.user.sign_in.expires_at).toBe(source.sign_in.expires_at)
  })
})

// ---- the account pages (#489 item 13) -----------------------------------------

describe('the account pages', () => {
  test("are served on an app's address", async ({ api }) => {
    const res = await api.fetch(`${DASH}/featherbase/account/sign-in-methods`, { headers: { accept: 'text/html' } })
    expect(res.status).not.toBe(302)
  })
})

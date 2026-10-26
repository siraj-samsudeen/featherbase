import { afterEach, beforeEach, describe, expect } from 'vitest'
import { test } from './pg-test'
import { config } from '../src/config'
import { parseInstanceAddresses } from '../src/instance-addresses'
import { configureGoogle } from './identity-fixtures'
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

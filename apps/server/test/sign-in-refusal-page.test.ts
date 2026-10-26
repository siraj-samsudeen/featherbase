// A refused Google sign-in is a browser navigation, so it lands on the
// sign-in page with a short reason code instead of a raw JSON error
// (OpenSpec change `quiet-test-mode-and-friendly-sign-in-refusals`). A caller
// that does not ask for a page (fetch/XHR) still gets the JSON error.
import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { makePerson } from './fixtures'
import { configureGoogle } from './identity-fixtures'

const PAGE = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }

async function beginLogin(api: TestClient, headers: Record<string, string> = {}) {
  const res = await api.fetch('/api/oauth/google/login', { headers })
  const location = res.headers.get('location') as string
  const state = new URLSearchParams(location.split('?')[1]).get('state') as string
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  return { state, cookie }
}

/** The mock Google dance; the last hop (the callback) is sent with `headers`. */
async function googleSignIn(api: TestClient, email: string, headers: Record<string, string>, opts: { before?: () => Promise<void> } = {}) {
  const { state, cookie } = await beginLogin(api)
  const approve = await api.fetch(
    '/api/oauth/mock/approve?' +
      new URLSearchParams({ state, redirect_uri: '/api/oauth/google/callback', email, name: 'Someone' }).toString(),
    { headers: { cookie } },
  )
  await opts.before?.()
  return api.fetch(approve.headers.get('location') as string, { headers: { ...headers, cookie } })
}

const refusalCode = (res: Response) => {
  const location = res.headers.get('location') ?? ''
  expect(location.startsWith('/featherbase/login?')).toBe(true)
  return new URLSearchParams(location.split('?')[1]).get('error')
}

describe('a refused Google sign-in lands on the sign-in page', () => {
  test('an account nobody set up is sent back with not_provisioned, and nothing else about why', async ({ api }) => {
    await configureGoogle({ allowed_email_domains: '' })
    const res = await googleSignIn(api, 'stranger@gmail.com', PAGE)
    expect(res.status).toBe(302)
    expect(refusalCode(res)).toBe('not_provisioned')
    // Only the code travels: no address, no domain, no reason text.
    const location = res.headers.get('location') as string
    expect(location).not.toMatch(/stranger|gmail|domain|IT/i)
    expect([...new URLSearchParams(location.split('?')[1]).keys()]).toEqual(['error'])
    const [row] = await sql`select 1 from person where email = 'stranger@gmail.com'`
    expect(row).toBeUndefined()
  })

  test('an API caller still gets the JSON error', async ({ api }) => {
    await configureGoogle({ allowed_email_domains: '' })
    const res = await googleSignIn(api, 'stranger.api@gmail.com', { accept: 'application/json' })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: { type: 'AuthenticationError', message: 'Access not provisioned for this account. Contact IT.' },
    })
  })

  test('a disabled person is sent back with not_allowed', async ({ api }) => {
    await configureGoogle({ allowed_email_domains: '*' })
    expect((await googleSignIn(api, 'leaver@outside.io', PAGE)).status).toBe(302)
    await sql`update person set enabled = false where email = 'leaver@outside.io'`
    const res = await googleSignIn(api, 'leaver@outside.io', PAGE)
    expect(refusalCode(res)).toBe('not_allowed')
  })

  test('an address another account already uses is sent back with address_in_use', async ({ api }) => {
    await makePerson({ email: 'taken.page@outside.io', roles: [] })
    await configureGoogle({ allowed_email_domains: '*' })
    const res = await googleSignIn(api, 'taken.page@outside.io', PAGE)
    expect(refusalCode(res)).toBe('address_in_use')
  })

  test('Google turned off mid-sign-in, or before it starts, is sent back with google_off', async ({ api }) => {
    await configureGoogle({ allowed_email_domains: '*' })
    const res = await googleSignIn(api, 'midway@outside.io', PAGE, { before: () => configureGoogle({ enabled: false }) })
    expect(refusalCode(res)).toBe('google_off')
    const start = await api.fetch('/api/oauth/google/login', { headers: PAGE })
    expect(start.status).toBe(302)
    expect(refusalCode(start)).toBe('google_off')
    // An API caller of the start route keeps the JSON answer.
    expect((await api.fetch('/api/oauth/google/login')).status).toBe(401)
  })

  test('a forged or expired state is sent back with expired', async ({ api }) => {
    const res = await api.fetch('/api/oauth/google/callback?code=abc&state=forged.signature', { headers: PAGE })
    expect(refusalCode(res)).toBe('expired')
  })
})

// #474: the panel's "Try another Google account" starts Google sign-in again
// with `?prompt=select_account`. Google must show its account picker, so the
// refused account is never silently reused.
test('a retry start sends Google the account picker', async ({ api }) => {
  await configureGoogle({ client_id: 'test-client-id' })
  const res = await api.fetch('/api/oauth/google/login?prompt=select_account', { headers: PAGE })
  expect(res.status).toBe(302)
  const loc = res.headers.get('location') as string
  expect(loc.startsWith('https://accounts.google.com/o/oauth2/v2/auth?')).toBe(true)
  expect(new URLSearchParams(loc.split('?')[1]).get('prompt')).toBe('select_account')
})

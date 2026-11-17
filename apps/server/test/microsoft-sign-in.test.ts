// Sign in with Microsoft (microsoft-sign-in): what the scenarios don't show.
// The real authorize and token exchange (Microsoft faked at fetch), the method
// turned off, linking from the Sign-in methods page, the expected mark being
// a System Manager's, the domain rule re-checked on a domain-ruled link, and
// the tenant setting.
import { describe, expect, vi } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { createUserWithRole, expectStatus, makePerson } from './fixtures'
import { mockOAuth, redeemSession } from './google-mock'
import { TENANT, configureMicrosoft, microsoftLink, microsoftLinks, microsoftSignIn, withMicrosoftFetch } from './microsoft-mock'
import { canSignInNow, linkIdentity } from '../src/identities'
import { issueSession } from '../src/auth'
import { microsoftNonce } from '../src/microsoft'

const DOMAIN = 'bisquared.example'
const CLIENT = 'b1e2c3d4-0000-4000-8000-00000000c1d0'
const OID = '5f1e2d3c-4b5a-4968-8776-655443322110'
const enc = encodeURIComponent

const idToken = (claims: Record<string, unknown>) =>
  ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.')

describe('real Microsoft', () => {
  test('login sends the browser to the organizations endpoint with PKCE, a nonce bound to the state, and the absolute callback', async ({ api }) => {
    await configureMicrosoft({ client_id: CLIENT })
    const res = await api.fetch('/api/oauth/microsoft/login')
    await expectStatus(res, 302)
    const to = new URL(res.headers.get('location')!)
    expect(`${to.origin}${to.pathname}`).toBe('https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize')
    const q = to.searchParams
    expect(q.get('client_id')).toBe(CLIENT)
    expect(q.get('response_type')).toBe('code')
    expect(q.get('response_mode')).toBe('query')
    expect(q.get('scope')).toBe('openid profile email')
    expect(q.get('code_challenge_method')).toBe('S256')
    expect(q.get('code_challenge')).toBeTruthy()
    expect(q.get('nonce')).toBe(microsoftNonce(q.get('state')!))
    expect(q.get('redirect_uri')).toMatch(/^https?:\/\/[^/]+\/api\/oauth\/microsoft\/callback$/)
  })

  test('a configured tenant is the endpoint used', async ({ api }) => {
    await configureMicrosoft({ client_id: CLIENT, tenant: TENANT })
    const res = await api.fetch('/api/oauth/microsoft/login')
    expect(new URL(res.headers.get('location')!).pathname).toBe(`/${TENANT}/oauth2/v2.0/authorize`)
  })

  test('the callback redeems the code with the secret and verifier, and signs in the linked person', async ({ api }) => {
    vi.stubEnv('MICROSOFT_CLIENT_SECRET', 'test-only-secret')
    await configureMicrosoft({ client_id: CLIENT, allowed_email_domains: DOMAIN })
    const person = await makePerson({ email: `asha@${DOMAIN}` })
    await linkIdentity(person, { method: 'microsoft', subject: `${TENANT}/${OID}` }, 'Administrator')
    const start = await api.fetch('/api/oauth/microsoft/login')
    const cookie = start.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!
    const seen: { url: string; body: URLSearchParams }[] = []
    const res = await withMicrosoftFetch(
      async (url, init) => {
        seen.push({ url: String(url), body: new URLSearchParams(String(init?.body)) })
        return Response.json({
          id_token: idToken({
            iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, aud: CLIENT, exp: Math.floor(Date.now() / 1000) + 600,
            nonce: microsoftNonce(state), tid: TENANT, oid: OID, email: `asha@${DOMAIN}`, xms_edov: true, name: 'Asha',
          }),
        })
      },
      () => api.fetch(`/api/oauth/microsoft/callback?code=the-code&state=${enc(state)}`, { headers: { cookie, accept: 'text/html' } }),
    )
    await expectStatus(res, 302)
    expect((await redeemSession(api, res)).user.row_id).toBe(person)
    expect(seen).toHaveLength(1)
    expect(seen[0].url).toBe('https://login.microsoftonline.com/organizations/oauth2/v2.0/token')
    const body = seen[0].body
    expect(body.get('client_id')).toBe(CLIENT)
    expect(body.get('client_secret')).toBe('test-only-secret')
    expect(body.get('code')).toBe('the-code')
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code_verifier')).toBeTruthy()
    expect(body.get('redirect_uri')).toMatch(/\/api\/oauth\/microsoft\/callback$/)
  })

  test('Microsoft failing the exchange is explained as Microsoft failing', async ({ api }) => {
    await configureMicrosoft({ client_id: CLIENT })
    const start = await api.fetch('/api/oauth/microsoft/login')
    const cookie = start.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!
    const res = await withMicrosoftFetch(
      async () => new Response('{"error":"invalid_grant"}', { status: 400 }),
      () => api.fetch(`/api/oauth/microsoft/callback?code=x&state=${enc(state)}`, { headers: { cookie, accept: 'text/html' } }),
    )
    expect(res.headers.get('location')).toBe('/featherbase/login?error=microsoft_failed')
  })
})

describe('turned off', () => {
  test('a disabled method, or one without a client and without the stand-in, sends the browser back explained', async ({ api }) => {
    await configureMicrosoft({ enabled: false })
    const res = await api.fetch('/api/oauth/microsoft/login', { headers: { accept: 'text/html' } })
    expect(res.headers.get('location')).toBe('/featherbase/login?error=microsoft_off')
    mockOAuth(false)
    await configureMicrosoft({ client_id: '' })
    const again = await api.fetch('/api/oauth/microsoft/login', { headers: { accept: 'text/html' } })
    expect(again.headers.get('location')).toBe('/featherbase/login?error=microsoft_off')
  })

  test('the stand-in refuses to serve once a real client is set', async ({ api }) => {
    await configureMicrosoft({ client_id: CLIENT })
    await expectStatus(await api.fetch('/api/oauth/mock/microsoft/consent?state=x&redirect_uri=/api/oauth/microsoft/callback'), 400)
  })

  test('the stand-in only sends its code to Microsoft sign-in\'s own callback', async ({ api }) => {
    await configureMicrosoft({ client_id: '' })
    const start = await api.fetch('/api/oauth/microsoft/login')
    const cookie = start.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
    const state = new URLSearchParams(start.headers.get('location')!.split('?')[1]).get('state')!
    const p = new URLSearchParams({ state, redirect_uri: 'https://evil.example/x', email: 'a@b.example', tid: TENANT, oid: OID, edov: '1' })
    await expectStatus(await api.fetch(`/api/oauth/mock/microsoft/approve?${p}`, { headers: { cookie } }), 400)
  })
})

describe('linking from the Sign-in methods page', () => {
  test('a person links their own Microsoft account, kept by tenant + object ID', async ({ api }) => {
    await configureMicrosoft({ allowed_email_domains: DOMAIN, self_link: true })
    const person = await makePerson({ email: `asha@${DOMAIN}` })
    const { token } = await issueSession(person)
    const res = await microsoftLink(api, token, `asha@${DOMAIN}`, { oid: OID })
    expect(res.headers.get('location')).toMatch(/link=linked$/)
    expect(await microsoftLinks(person)).toEqual([{ subject: `${TENANT}/${OID}`, linked_by: 'self', email: `asha@${DOMAIN}` }])
  })

  test('an account from a domain the method does not admit is refused', async ({ api }) => {
    await configureMicrosoft({ allowed_email_domains: DOMAIN, self_link: true })
    const person = await makePerson({ email: `asha@${DOMAIN}` })
    const { token } = await issueSession(person)
    const res = await microsoftLink(api, token, 'asha@elsewhere.example', { oid: OID })
    expect(res.headers.get('location')).toMatch(/link=domain_not_allowed$/)
    // An address Microsoft did not confirm is not admitted either.
    const unconfirmed = await microsoftLink(api, token, `asha@${DOMAIN}`, { oid: OID, edov: false })
    expect(unconfirmed.headers.get('location')).toMatch(/link=domain_not_allowed$/)
    expect(await microsoftLinks(person)).toHaveLength(0)
  })
})

describe('the domain rule keeps governing a link it made', () => {
  test('a self-made link stops opening the account when Microsoft no longer confirms the address', async ({ api }) => {
    await configureMicrosoft({ allowed_email_domains: DOMAIN, self_link: true })
    const person = await makePerson({ email: `asha@${DOMAIN}` })
    const { token } = await issueSession(person)
    await microsoftLink(api, token, `asha@${DOMAIN}`, { oid: OID })
    expect(await canSignInNow(person)).toBe(true)
    const res = await microsoftSignIn(api, `asha@${DOMAIN}`, { oid: OID, edov: false })
    expect(res.headers.get('location')).toBe('/featherbase/login?error=not_provisioned')
    const ok = await microsoftSignIn(api, `asha@${DOMAIN}`, { oid: OID })
    expect((await redeemSession(api, ok)).user.row_id).toBe(person)
  })

  test('a Google personal domain is not exempt for Microsoft', async ({ api }) => {
    await configureMicrosoft({ allowed_email_domains: 'gmail.com' })
    const person = await makePerson({ email: 'asha@gmail.com', expects_microsoft_sign_in: true })
    const res = await microsoftSignIn(api, 'asha@gmail.com', { oid: OID, edov: false })
    expect(res.headers.get('location')).toBe('/featherbase/login?error=not_provisioned')
    expect(await microsoftLinks(person)).toHaveLength(0)
  })
})

describe('the expected-sign-in mark', () => {
  test('someone who does not manage the system cannot set it', async ({ admin, createUser }) => {
    const clerk = await createUserWithRole(admin, createUser, { role: 'People Clerk MS', table: 'Person', can_read: true, can_write: true, can_create: true })
    const create = await clerk.fetch('/api/table/Person', { method: 'POST', body: JSON.stringify({ email: `new@${DOMAIN}`, expects_microsoft_sign_in: true, enabled: true }) })
    await expectStatus(create, 403)
    const asha = await makePerson({ email: `asha@${DOMAIN}` })
    const [a] = await sql`select updated_at from person where row_id = ${asha}`
    const res = await clerk.fetch(`/api/table/Person/${enc(asha)}`, { method: 'PATCH', body: JSON.stringify({ expects_microsoft_sign_in: true, updated_at: a.updated_at }) })
    await expectStatus(res, 403)
  })

  test('a System Manager sets it, and the administrator\'s panel shows it', async ({ admin }) => {
    const asha = await makePerson({ email: `asha@${DOMAIN}` })
    const [a] = await sql`select updated_at from person where row_id = ${asha}`
    await expectStatus(await admin.fetch(`/api/table/Person/${enc(asha)}`, { method: 'PATCH', body: JSON.stringify({ expects_microsoft_sign_in: true, updated_at: a.updated_at }) }), 200)
    const panel = await admin.get<{ expects_microsoft_sign_in: boolean }>(`/api/people/${enc(asha)}/identities`)
    expect(panel.expects_microsoft_sign_in).toBe(true)
  })

  test('changing the address clears it', async () => {
    const asha = await makePerson({ email: `asha@${DOMAIN}`, expects_microsoft_sign_in: true })
    await sql`update person set email = ${`asha.k@${DOMAIN}`} where row_id = ${asha}`
    const [row] = await sql`select expects_microsoft_sign_in from person where row_id = ${asha}`
    expect(row.expects_microsoft_sign_in).toBe(false)
  })
})

describe('the tenant setting', () => {
  test('only organizations or a tenant ID can be saved', async ({ admin }) => {
    const [m] = await sql`select updated_at from sign_in_method where row_id = 'microsoft'`
    const bad = await admin.fetch('/api/table/Sign%20In%20Method/microsoft', { method: 'PATCH', body: JSON.stringify({ settings: { tenant: 'common' }, updated_at: m.updated_at }) })
    await expectStatus(bad, 417)
    const good = await admin.fetch('/api/table/Sign%20In%20Method/microsoft', { method: 'PATCH', body: JSON.stringify({ settings: { tenant: TENANT }, updated_at: m.updated_at }) })
    await expectStatus(good, 200)
  })
})

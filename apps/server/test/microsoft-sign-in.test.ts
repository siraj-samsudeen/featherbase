// Sign in with Microsoft (microsoft-sign-in): what the scenarios don't show.
// The real authorize and token exchange (Microsoft faked at fetch), the method
// turned off, linking from the Sign-in methods page, the expected mark being
// a System Manager's, the domain rule re-checked on a domain-ruled link, and
// the tenant setting.
import { afterEach, describe, expect, vi } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { createUserWithRole, expectStatus, makePerson } from './fixtures'
import { beginMockApproval, mockOAuth, redeemSession } from './google-mock'
import { configureGoogle } from './identity-fixtures'
import { TENANT, configureMicrosoft, microsoftLink, microsoftLinks, microsoftSignIn, withMicrosoftFetch } from './microsoft-mock'
import { canSignInNow, linkIdentity } from '../src/identities'
import { issueSession } from '../src/auth'
import { microsoftNonce, mockMicrosoftApproveRedirect } from '../src/microsoft'

const DOMAIN = 'bisquared.example'
const CLIENT = 'b1e2c3d4-0000-4000-8000-00000000c1d0'
const OID = '5f1e2d3c-4b5a-4968-8776-655443322110'
const enc = encodeURIComponent

// A stubbed variable (the stand-in switched off, the secret) lasts one test.
afterEach(() => vi.unstubAllEnvs())

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
    expect(res.headers.get('location')).toBe('/featherbase/login?error=microsoft_failed&via=microsoft')
  })
})

describe('turned off', () => {
  test('a disabled method, or one without a client and without the stand-in, sends the browser back explained', async ({ api }) => {
    await configureMicrosoft({ enabled: false })
    const res = await api.fetch('/api/oauth/microsoft/login', { headers: { accept: 'text/html' } })
    expect(res.headers.get('location')).toBe('/featherbase/login?error=microsoft_off&via=microsoft')
    mockOAuth(false)
    await configureMicrosoft({ client_id: '' })
    const again = await api.fetch('/api/oauth/microsoft/login', { headers: { accept: 'text/html' } })
    expect(again.headers.get('location')).toBe('/featherbase/login?error=microsoft_off&via=microsoft')
  })

  test('the stand-in refuses to serve once a real client is set', async ({ api }) => {
    await configureMicrosoft({ client_id: CLIENT })
    await expectStatus(await api.fetch('/api/oauth/mock/microsoft/consent?state=x&redirect_uri=/api/oauth/microsoft/callback'), 417)
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
    expect(res.headers.get('location')).toMatch(/link=linked&via=microsoft$/)
    expect(await microsoftLinks(person)).toEqual([{ subject: `${TENANT}/${OID}`, linked_by: 'self', email: `asha@${DOMAIN}` }])
  })

  test('an account from a domain the method does not admit is refused', async ({ api }) => {
    await configureMicrosoft({ allowed_email_domains: DOMAIN, self_link: true })
    const person = await makePerson({ email: `asha@${DOMAIN}` })
    const { token } = await issueSession(person)
    const res = await microsoftLink(api, token, 'asha@elsewhere.example', { oid: OID })
    expect(res.headers.get('location')).toMatch(/link=domain_not_allowed&via=microsoft$/)
    // An address Microsoft did not confirm is not admitted either.
    const unconfirmed = await microsoftLink(api, token, `asha@${DOMAIN}`, { oid: OID, edov: false })
    expect(unconfirmed.headers.get('location')).toMatch(/link=domain_not_allowed&via=microsoft$/)
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
    expect(res.headers.get('location')).toBe('/featherbase/login?error=not_provisioned&via=microsoft')
    const ok = await microsoftSignIn(api, `asha@${DOMAIN}`, { oid: OID })
    expect((await redeemSession(api, ok)).user.row_id).toBe(person)
  })

  test('a Google personal domain is not exempt for Microsoft', async ({ api }) => {
    await configureMicrosoft({ allowed_email_domains: 'gmail.com' })
    const person = await makePerson({ email: 'asha@gmail.com', expects_microsoft_sign_in: true })
    const res = await microsoftSignIn(api, 'asha@gmail.com', { oid: OID, edov: false })
    expect(res.headers.get('location')).toBe('/featherbase/login?error=not_provisioned&via=microsoft')
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

describe('the tenant is part of who may still sign in (Codex adversarial round 1)', () => {
  const OTHER_TENANT = '44444444-4444-4444-8444-444444444444'
  const tenantPatch = async (admin: { fetch: (u: string, i?: RequestInit) => Promise<Response> }, tenant: string) => {
    const [m] = await sql`select updated_at from sign_in_method where row_id = 'microsoft'`
    return admin.fetch('/api/table/Sign%20In%20Method/microsoft', { method: 'PATCH', body: JSON.stringify({ settings: { tenant }, updated_at: m.updated_at }) })
  }

  test('narrowing to one tenant is refused when it strands a System Manager linked through another', async ({ admin }) => {
    await configureMicrosoft({ allowed_email_domains: DOMAIN })
    const manager = await makePerson({ email: `boss@${DOMAIN}`, roles: [{ role: 'System Manager' }] })
    await linkIdentity(manager, { method: 'microsoft', subject: `${TENANT}/${OID}` }, 'Administrator')
    expect(await canSignInNow(manager)).toBe(true)
    const res = await tenantPatch(admin, OTHER_TENANT)
    await expectStatus(res, 417)
    expect(await res.text()).toContain(manager)
    // Their own tenant is fine.
    await expectStatus(await tenantPatch(admin, TENANT), 200)
  })

  test('a link outside the method\'s tenant is not a way in', async () => {
    await configureMicrosoft({ allowed_email_domains: DOMAIN, tenant: OTHER_TENANT })
    const person = await makePerson({ email: `asha@${DOMAIN}` })
    await linkIdentity(person, { method: 'microsoft', subject: `${TENANT}/${OID}` }, 'Administrator')
    expect(await canSignInNow(person)).toBe(false)
  })

  test('narrowing the tenant ends sessions opened through a link it no longer admits', async ({ admin, api }) => {
    await configureMicrosoft({ allowed_email_domains: DOMAIN })
    const person = await makePerson({ email: `asha@${DOMAIN}` })
    await linkIdentity(person, { method: 'microsoft', subject: `${TENANT}/${OID}` }, 'Administrator')
    const session = await redeemSession(api, await microsoftSignIn(api, `asha@${DOMAIN}`, { oid: OID }))
    await expectStatus(await api.fetch('/api/whoami', { headers: { authorization: `Bearer ${session.token}` } }), 200)
    await expectStatus(await tenantPatch(admin, OTHER_TENANT), 200)
    await expectStatus(await api.fetch('/api/whoami', { headers: { authorization: `Bearer ${session.token}` } }), 401)
  })
})

describe('a tenant narrowed while Microsoft is answering (Codex adversarial round 2)', () => {
  test('the sign-in is judged by the method as it is after the exchange', async ({ api }) => {
    await configureMicrosoft({ client_id: CLIENT, allowed_email_domains: DOMAIN })
    const person = await makePerson({ email: `asha@${DOMAIN}` })
    await linkIdentity(person, { method: 'microsoft', subject: `${TENANT}/${OID}` }, 'Administrator')
    const start = await api.fetch('/api/oauth/microsoft/login')
    const cookie = start.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!
    const res = await withMicrosoftFetch(
      async () => {
        // An administrator narrows the tenant while the exchange is in flight.
        await sql`update sign_in_method set settings = ${JSON.stringify({ tenant: '55555555-5555-4555-8555-555555555555' })}::text::jsonb where row_id = 'microsoft'`
        return Response.json({
          id_token: idToken({
            iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, aud: CLIENT, exp: Math.floor(Date.now() / 1000) + 600,
            nonce: microsoftNonce(state), tid: TENANT, oid: OID, email: `asha@${DOMAIN}`, xms_edov: true,
          }),
        })
      },
      () => api.fetch(`/api/oauth/microsoft/callback?code=c&state=${enc(state)}`, { headers: { cookie, accept: 'text/html' } }),
    )
    expect(res.headers.get('location')).toBe('/featherbase/login?error=microsoft_failed&via=microsoft')
  })
})

describe('the stand-in honours the tenant (Codex standard round 2)', () => {
  test('a method set to one tenant refuses the stand-in\'s account from another', async ({ api }) => {
    await configureMicrosoft({ allowed_email_domains: DOMAIN, tenant: '66666666-6666-4666-8666-6666aaaa6666' })
    const person = await makePerson({ email: `asha@${DOMAIN}`, expects_microsoft_sign_in: true })
    const res = await microsoftSignIn(api, `asha@${DOMAIN}`, { oid: OID })
    expect(res.headers.get('location')).toBe('/featherbase/login?error=microsoft_failed&via=microsoft')
    expect(await microsoftLinks(person)).toHaveLength(0)
  })
})

describe('what Microsoft or the stand-in may hand back (coverage of the refusals)', () => {
  const startReal = async (api: Parameters<Parameters<typeof test>[1]>[0]['api']) => {
    await configureMicrosoft({ client_id: CLIENT })
    const start = await api.fetch('/api/oauth/microsoft/login')
    const cookie = start.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!
    return { cookie, state }
  }

  test.for([
    ['no ID token at all', {}],
    ['an ID token that is not three parts', { id_token: 'only.two' }],
    ['an ID token whose claims are not JSON', { id_token: 'e30.%%%.sig' }],
    ['an ID token whose claims are a list', { id_token: `e30.${Buffer.from('[1]').toString('base64url')}.sig` }],
  ] as [string, Record<string, unknown>][])('%s is refused as Microsoft failing', async ([, body], { api }) => {
    const { cookie, state } = await startReal(api)
    const res = await withMicrosoftFetch(
      async () => Response.json(body),
      () => api.fetch(`/api/oauth/microsoft/callback?code=c&state=${enc(state)}`, { headers: { cookie, accept: 'text/html' } }),
    )
    expect(res.headers.get('location')).toBe('/featherbase/login?error=microsoft_failed&via=microsoft')
  })

  test('the stand-in\'s consent page carries the sign-in it belongs to, escaped', async ({ api }) => {
    await configureMicrosoft({ client_id: '' })
    const res = await api.fetch(`/api/oauth/mock/microsoft/consent?state=${enc('s"<x>')}&redirect_uri=/api/oauth/microsoft/callback`)
    await expectStatus(res, 200)
    const html = await res.text()
    expect(html).toContain('Sign in with Microsoft')
    expect(html).toContain('value="s&quot;&lt;x&gt;"')
    expect(html).not.toContain('<x>')
  })

  test('a Microsoft stand-in code is not Google\'s to redeem', async ({ api }) => {
    await configureGoogle({ enabled: true, client_id: '' })
    const { start, cookie } = await beginMockApproval(api, `asha@${DOMAIN}`)
    const state = new URLSearchParams((start.headers.get('location') as string).split('?')[1]).get('state') as string
    const forged = mockMicrosoftApproveRedirect(state, '/api/oauth/microsoft/callback', { email: `asha@${DOMAIN}`, name: 'A', tid: TENANT, oid: OID, edov: true })
    const code = new URLSearchParams(forged.split('?')[1]).get('code')!
    const res = await api.fetch(`/api/oauth/google/callback?code=${enc(code)}&state=${enc(state)}`, { headers: { cookie } })
    await expectStatus(res, 401)
  })

  test('linking Microsoft is refused while people may not link it themselves', async ({ api }) => {
    await configureMicrosoft({ self_link: false })
    const person = await makePerson({ email: `asha@${DOMAIN}` })
    const { token } = await issueSession(person)
    await expectStatus(await api.fetch('/api/oauth/microsoft/link', { headers: { cookie: `sid=${token}` } }), 403)
  })
})

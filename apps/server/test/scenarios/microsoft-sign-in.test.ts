// microsoft-sign-in's scenarios (sign-in-and-accounts): Sign in with Microsoft,
// and linking a first Microsoft sign-in to a person who expects it. Driven
// through the development stand-in for Microsoft, which signs its accounts'
// claims into the same ID-token checks a real sign-in goes through.
import { afterEach, expect, vi } from 'vitest'
import { test } from '../pg-test'
import { scenarioFor } from '../scenario'
import { expectStatus, makePerson } from '../fixtures'
import { mockOAuth, redeemSession } from '../google-mock'
import { TENANT, configureMicrosoft, microsoftLinks, microsoftSignIn } from '../microsoft-mock'
import { linkIdentity } from '../../src/identities'
import { sql } from '../../src/db'

const scenario = scenarioFor(test, 'sign-in-and-accounts')

afterEach(() => vi.unstubAllEnvs())

const DOMAIN = 'bisquared.example'
const ASHA = { oid: '5f1e2d3c-4b5a-4968-8776-655443322110', name: 'Asha Kumar' }

const asha = (values: Record<string, unknown> = {}) =>
  makePerson({ email: `asha@${DOMAIN}`, full_name: 'Asha Kumar', ...values })

scenario('A linked Microsoft account opens the account', async ({ api }, step) => {
  let person = ''
  let res: Response
  await step("Asha's Microsoft work account is linked to her account", async () => {
    await configureMicrosoft({ allowed_email_domains: DOMAIN })
    person = await asha()
    await linkIdentity(person, { method: 'microsoft', subject: `${TENANT}/${ASHA.oid}` }, 'Administrator')
  })
  await step('Asha signs in with Microsoft', async () => {
    res = await microsoftSignIn(api, `asha@${DOMAIN}`, ASHA)
  })
  await step('she is signed in to her own account', async () => {
    await expectStatus(res, 302)
    const session = await redeemSession(api, res)
    expect(session.user.row_id).toBe(person)
    expect(session.user.sign_in?.method).toBe('microsoft')
  })
})

scenario('An address whose domain Microsoft has not confirmed is refused', async ({ api }, step) => {
  let person = ''
  let res: Response
  await step('Asha is expected to sign in with Microsoft', async () => {
    await configureMicrosoft({ allowed_email_domains: DOMAIN })
    person = await asha({ expects_microsoft_sign_in: true })
  })
  await step(/someone signs in with a Microsoft account that shows Asha's address/, async () => {
    // Another organisation's account, given Asha's address by its own administrator.
    res = await microsoftSignIn(api, `asha@${DOMAIN}`, { oid: '9a8b7c6d-5e4f-4321-8765-0fedcba98765', tid: '33333333-3333-4333-8333-3333bbbb3333', edov: false })
  })
  await step('they are refused and told to contact IT', async () => {
    await expectStatus(res, 302)
    expect(res.headers.get('location')).toBe('/featherbase/login?error=not_provisioned&via=microsoft')
  })
  await step("Asha's account has no Microsoft sign-in", async () => {
    expect(await microsoftLinks(person)).toHaveLength(0)
  })
})

scenario('Microsoft sign-in is not offered until it is set up', async ({ api }, step) => {
  let methods: { kind: string }[] = []
  await step('Microsoft sign-in has no client set up', async () => {
    mockOAuth(false)
    await configureMicrosoft({ client_id: '' })
  })
  await step('the user opens the sign-in page', async () => {
    methods = ((await (await api.fetch('/api/brand')).json()) as { sign_in_methods: { kind: string }[] }).sign_in_methods
  })
  await step('Microsoft is not offered', async () => {
    expect(methods.map((m) => m.kind)).not.toContain('microsoft')
    // Once it has a client it is offered.
    await configureMicrosoft({ client_id: 'b1e2c3d4-0000-4000-8000-00000000c1d0' })
    const after = ((await (await api.fetch('/api/brand')).json()) as { sign_in_methods: { kind: string }[] }).sign_in_methods
    expect(after.map((m) => m.kind)).toContain('microsoft')
  })
})

scenario('The person expecting Microsoft sign-in is linked', async ({ api }, step) => {
  let person = ''
  let res: Response
  await step('Asha is expected to sign in with Microsoft', async () => {
    await configureMicrosoft({ allowed_email_domains: DOMAIN })
    person = await asha({ expects_microsoft_sign_in: true })
  })
  await step('Asha signs in with Microsoft using her own confirmed work address', async () => {
    res = await microsoftSignIn(api, `Asha@${DOMAIN}`, ASHA)
  })
  await step('she is signed in to her own account', async () => {
    await expectStatus(res, 302)
    expect((await redeemSession(api, res)).user.row_id).toBe(person)
    expect(await microsoftLinks(person)).toEqual([{ subject: `${TENANT}/${ASHA.oid}`, linked_by: 'expected-sign-in', email: `asha@${DOMAIN}` }])
    const [row] = await sql`select expects_microsoft_sign_in from person where row_id = ${person}`
    expect(row.expects_microsoft_sign_in).toBe(false)
  })
  await step('the activity log records that the system linked her Microsoft sign-in', async () => {
    const audit = await sql`select "user" from activity_log where operation like ${'identity_linked_on_expected_sign_in microsoft for ' + person + '%'}`
    expect(audit).toEqual([{ user: 'system' }])
  })
})

scenario('The same address from another Microsoft account later', async ({ api }, step) => {
  let person = ''
  let res: Response
  await step("Asha's first Microsoft sign-in has linked to her", async () => {
    await configureMicrosoft({ allowed_email_domains: DOMAIN })
    person = await asha({ expects_microsoft_sign_in: true })
    await expectStatus(await microsoftSignIn(api, `asha@${DOMAIN}`, ASHA), 302)
  })
  await step("a different Microsoft account with Asha's address signs in", async () => {
    res = await microsoftSignIn(api, `asha@${DOMAIN}`, { oid: '11112222-3333-4444-8555-6666cccc8888' })
  })
  await step("it is refused, and only Asha's own Microsoft account opens her account", async () => {
    expect(res.headers.get('location')).toBe('/featherbase/login?error=not_provisioned&via=microsoft')
    expect(await microsoftLinks(person)).toEqual([expect.objectContaining({ subject: `${TENANT}/${ASHA.oid}` })])
  })
})

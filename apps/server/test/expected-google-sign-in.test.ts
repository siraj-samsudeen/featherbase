// link-google-sign-in-when-expected (#473): an administrator can mark a person
// as expecting Google sign-in. The first Google sign-in with that person's own
// address then links to them, but only when every condition holds; anything
// else keeps the old answer (refused, a new person, or an invite claimed).
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { createUserWithRole, makePerson } from './fixtures'
import { configureGoogle, inviteGoogleRaw } from './identity-fixtures'
import { googleSignIn, redeemSession } from './google-mock'
import { resolveVerified } from '../src/sign-in'
import { methodOfKind } from '../src/identities'

const DOMAIN = 'example.com'
const enc = encodeURIComponent

async function expectedPerson(values: Record<string, unknown> = {}) {
  return makePerson({ email: `asha@${DOMAIN}`, full_name: 'Asha', expects_google_sign_in: true, ...values })
}

async function flagOf(person: string): Promise<boolean> {
  const [row] = await sql`select expects_google_sign_in from person where row_id = ${person}`
  return row.expects_google_sign_in === true
}

async function googleLinks(person: string) {
  return sql`select subject, linked_by from sign_in_identity where person_id = ${person} and method = 'google' and ended_at is null`
}

describe('the first Google sign-in links to a person who expects it', () => {
  test('every condition holds: linked, signed in, the flag consumed and the link logged as a system action', async ({ api }) => {
    await configureGoogle({ allowed_email_domains: DOMAIN })
    const asha = await expectedPerson()
    const res = await googleSignIn(api, `Asha@${DOMAIN}`, { subject: 'g-asha' })
    expect(res.status).toBe(302)
    const session = await redeemSession(api, res)
    expect(session.user.row_id).toBe(asha)
    expect(session.user.sign_in?.method).toBe('google')
    expect(await googleLinks(asha)).toEqual([{ subject: 'g-asha', linked_by: 'expected-sign-in' }])
    expect(await flagOf(asha)).toBe(false)
    const audit = await sql`select "user", operation from activity_log where operation like ${'identity_linked_on_expected_sign_in google for ' + asha + '%'}`
    expect(audit).toHaveLength(1)
    expect(audit[0].user).toBe('system')
    // The link is permanent: the same Google account opens the account again.
    expect((await redeemSession(api, await googleSignIn(api, `asha@${DOMAIN}`, { subject: 'g-asha' }))).user.row_id).toBe(asha)
  })

  test('the flag is consumed: a different Google account with the same address later is refused', async ({ api }) => {
    await configureGoogle({ allowed_email_domains: DOMAIN })
    const asha = await expectedPerson()
    expect((await googleSignIn(api, `asha@${DOMAIN}`, { subject: 'g-asha' })).status).toBe(302)
    expect((await googleSignIn(api, `asha@${DOMAIN}`, { subject: 'g-reused-mailbox' })).status).toBe(401)
    expect(await googleLinks(asha)).toEqual([{ subject: 'g-asha', linked_by: 'expected-sign-in' }])
  })
})

describe('any condition missing keeps today\'s answer', () => {
  test('1. without the flag the address is still in use and refused', async ({ api }) => {
    await configureGoogle({ allowed_email_domains: DOMAIN, new_person: 'create_if_email_domain_allowed' })
    const asha = await expectedPerson({ expects_google_sign_in: false })
    const res = await googleSignIn(api, `asha@${DOMAIN}`, { subject: 'g-asha' })
    expect(res.status).toBe(401)
    expect(await res.text()).toContain('An account already uses this address')
    expect(await googleLinks(asha)).toHaveLength(0)
  })

  test('2. an email Google has not verified does not link', async () => {
    await configureGoogle({ allowed_email_domains: DOMAIN })
    const asha = await expectedPerson()
    const google = (await methodOfKind('google'))!
    await expect(
      resolveVerified(google, { status: 'verified', subject: 'g-asha', email: `asha@${DOMAIN}`, email_verified: false, hosted_domain: DOMAIN }),
    ).rejects.toThrow()
    expect(await googleLinks(asha)).toHaveLength(0)
    expect(await flagOf(asha)).toBe(true)
  })

  test('3. an address outside the allowed domains does not link', async ({ api }) => {
    await configureGoogle({ allowed_email_domains: 'other.example' })
    const asha = await expectedPerson()
    expect((await googleSignIn(api, `asha@${DOMAIN}`, { subject: 'g-asha' })).status).toBe(401)
    // No domains at all admits nobody either.
    await configureGoogle({ allowed_email_domains: '' })
    expect((await googleSignIn(api, `asha@${DOMAIN}`, { subject: 'g-asha' })).status).toBe(401)
    expect(await googleLinks(asha)).toHaveLength(0)
    expect(await flagOf(asha)).toBe(true)
  })

  test('3. a company domain whose Google account carries no matching hosted domain does not link', async ({ api }) => {
    await configureGoogle({ allowed_email_domains: DOMAIN })
    const asha = await expectedPerson()
    expect((await googleSignIn(api, `asha@${DOMAIN}`, { subject: 'g-asha', hd: '' })).status).toBe(401)
    expect(await googleLinks(asha)).toHaveLength(0)
  })

  test('4. a different address does not link, even on the same domain', async ({ api }) => {
    await configureGoogle({ allowed_email_domains: DOMAIN, new_person: 'refuse' })
    const asha = await expectedPerson()
    expect((await googleSignIn(api, `asha.k@${DOMAIN}`, { subject: 'g-other' })).status).toBe(401)
    // Where the method creates new people, it is someone new — never Asha.
    await configureGoogle({ new_person: 'create_if_email_domain_allowed' })
    const other = await redeemSession(api, await googleSignIn(api, `asha.k@${DOMAIN}`, { subject: 'g-other' }))
    expect(other.user.row_id).not.toBe(asha)
    expect(await googleLinks(asha)).toHaveLength(0)
    expect(await flagOf(asha)).toBe(true)
  })

  test('5. a disabled person is not linked', async ({ api }) => {
    await configureGoogle({ allowed_email_domains: DOMAIN })
    const asha = await expectedPerson({ enabled: false })
    expect((await googleSignIn(api, `asha@${DOMAIN}`, { subject: 'g-asha' })).status).toBe(401)
    expect(await googleLinks(asha)).toHaveLength(0)
    expect(await flagOf(asha)).toBe(true)
  })

  test('6. a person who already has a Google sign-in is not linked to a second one', async ({ api }) => {
    await configureGoogle({ allowed_email_domains: DOMAIN })
    const asha = await expectedPerson()
    await sql`insert into sign_in_identity (id, person_id, method, subject, linked_by) values ('uid_asha_g', ${asha}, 'google', 'g-first', 'test')`
    expect((await googleSignIn(api, `asha@${DOMAIN}`, { subject: 'g-second' })).status).toBe(401)
    expect((await googleLinks(asha)).map((r) => r.subject)).toEqual(['g-first'])
  })

  test('linking Google any other way consumes the flag, so a later unlink does not reopen it', async ({ api, admin }) => {
    await configureGoogle({ allowed_email_domains: DOMAIN })
    const asha = await expectedPerson()
    const linked = (await admin.post(`/api/people/${asha}/identities`, { method: 'google', subject: 'g-admin-linked' })) as { id: string }
    expect(await flagOf(asha)).toBe(false)
    await admin.post('/api/set_password', { user: asha, password: 'asha-pw-123' })
    expect((await admin.fetch(`/api/identities/${linked.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await googleSignIn(api, `asha@${DOMAIN}`, { subject: 'g-later' })).status).toBe(401)
  })

  test('a pending invite is still claimed the way it always was', async ({ api }) => {
    await configureGoogle({ allowed_email_domains: DOMAIN })
    const asha = await expectedPerson()
    const invite = await inviteGoogleRaw(asha, `asha@${DOMAIN}`)
    const session = await redeemSession(api, await googleSignIn(api, `asha@${DOMAIN}`, { subject: 'g-asha' }))
    expect(session.user.sign_in).toMatchObject({ method: 'google', identity: invite })
    expect(await flagOf(asha)).toBe(false)
  })

  test('someone new on an allowed domain still gets a new person', async ({ api }) => {
    await configureGoogle({ allowed_email_domains: DOMAIN, new_person: 'create_if_email_domain_allowed' })
    await expectedPerson()
    const session = await redeemSession(api, await googleSignIn(api, `new.hire@${DOMAIN}`, { subject: 'g-new' }))
    const [row] = await sql`select email, expects_google_sign_in from person where row_id = ${session.user.row_id}`
    expect(row).toEqual({ email: `new.hire@${DOMAIN}`, expects_google_sign_in: false })
  })
})

describe('who may set the flag', () => {
  test('someone who does not manage the system cannot set or change it', async ({ admin, createUser }) => {
    // A role that may create and write people, but is not System Manager.
    const clerk = await createUserWithRole(admin, createUser, { role: 'People Clerk 473', table: 'Person', can_read: true, can_write: true, can_create: true })

    // Creating a person who expects Google sign-in is refused…
    const create = await clerk.fetch('/api/table/Person', { method: 'POST', body: JSON.stringify({ email: `new@${DOMAIN}`, expects_google_sign_in: true, enabled: true }) })
    expect(create.status).toBe(403)
    expect(await sql`select 1 from person where email = ${`new@${DOMAIN}`}`).toHaveLength(0)
    // …but an ordinary person is still theirs to create.
    expect((await clerk.fetch('/api/table/Person', { method: 'POST', body: JSON.stringify({ email: `plain@${DOMAIN}`, enabled: true }) })).status).toBe(201)

    // Turning it on, or off, on an existing person is refused.
    for (const [start, to] of [[false, true], [true, false]]) {
      const asha = await expectedPerson({ email: `asha.${String(to)}@${DOMAIN}`, expects_google_sign_in: start })
      const [a] = await sql`select updated_at from person where row_id = ${asha}`
      const res = await clerk.fetch(`/api/table/Person/${enc(asha)}`, { method: 'PATCH', body: JSON.stringify({ expects_google_sign_in: to, updated_at: a.updated_at }) })
      expect(res.status).toBe(403)
      expect(await flagOf(asha)).toBe(start)
      // An unchanged value rides along, so the form still saves other edits.
      const edit = await clerk.fetch(`/api/table/Person/${enc(asha)}`, { method: 'PATCH', body: JSON.stringify({ full_name: 'Asha K', expects_google_sign_in: start, updated_at: a.updated_at }) })
      expect(edit.status).toBe(200)
    }
  })

  test('a System Manager sets it', async ({ admin }) => {
    const asha = await expectedPerson({ expects_google_sign_in: false })
    const [a] = await sql`select updated_at from person where row_id = ${asha}`
    const res = await admin.fetch(`/api/table/Person/${enc(asha)}`, { method: 'PATCH', body: JSON.stringify({ expects_google_sign_in: true, updated_at: a.updated_at }) })
    expect(res.status).toBe(200)
    expect(await flagOf(asha)).toBe(true)
  })

  test('only a true or false is accepted', async ({ admin }) => {
    const asha = await expectedPerson({ expects_google_sign_in: false })
    const [a] = await sql`select updated_at from person where row_id = ${asha}`
    const res = await admin.fetch(`/api/table/Person/${enc(asha)}`, { method: 'PATCH', body: JSON.stringify({ expects_google_sign_in: 'yes', updated_at: a.updated_at }) })
    expect(res.status).toBe(417)
    expect(await flagOf(asha)).toBe(false)
  })
})

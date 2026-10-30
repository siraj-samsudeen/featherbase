// #693: Google's allowed email domains govern a person linking an account to
// themselves, and every later sign-in through a link the domain rule made.
// An administrator's own link stays that administrator's decision.
import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { makePerson } from './fixtures'
import { configureDelegated, configureGoogle } from './identity-fixtures'
import { googleLink, googleSignIn, linkOutcome, redeemSession } from './google-mock'

const COMPANY = 'example.com'

async function passwordSession(api: TestClient, admin: TestClient, username: string) {
  const id = await makePerson({ username })
  await admin.post('/api/set_password', { user: id, password: `${username}-pw-1` })
  const res = await api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr: username, pwd: `${username}-pw-1` }) })
  return { id, token: ((await res.json()) as { token: string }).token }
}

const googleLinksOf = (person: string) =>
  sql`select subject, linked_by from sign_in_identity where person_id = ${person} and method = 'google' and ended_at is null`

async function rawLink(person: string, id: string, subject: string, email: string, linkedBy: string, hostedDomain: string | null = null) {
  await sql`insert into sign_in_identity (id, person_id, method, subject, email, linked_by, hosted_domain)
    values (${id}, ${person}, 'google', ${subject}, ${email}, ${linkedBy}, ${hostedDomain})`
}

async function setDomains(admin: TestClient, domains: string) {
  const [g] = await sql`select updated_at from sign_in_method where row_id = 'google'`
  return admin.fetch(`/api/table/${encodeURIComponent('Sign In Method')}/google`, {
    method: 'PATCH',
    body: JSON.stringify({ allowed_email_domains: domains, updated_at: g.updated_at }),
  })
}

describe('a person links Google to themselves under allowed domains', () => {
  test('an account on an allowed company domain links, and then signs them in', async ({ api, admin }) => {
    await configureGoogle({ allowed_email_domains: COMPANY })
    const { id, token } = await passwordSession(api, admin, 'link.ok')
    expect(linkOutcome(await googleLink(api, token, `link.ok@${COMPANY}`, { subject: 'g-link-ok' }))).toBe('linked')
    expect(await googleLinksOf(id)).toEqual([{ subject: 'g-link-ok', linked_by: 'self' }])
    expect(await sql`select hosted_domain from sign_in_identity where subject = 'g-link-ok'`).toEqual([{ hosted_domain: COMPANY }])
    expect((await redeemSession(api, await googleSignIn(api, `link.ok@${COMPANY}`, { subject: 'g-link-ok' }))).user.row_id).toBe(id)
    // Each sign-in records the claim it carried, including none.
    await configureGoogle({ allowed_email_domains: '' })
    await redeemSession(api, await googleSignIn(api, `link.ok@${COMPANY}`, { subject: 'g-link-ok', hd: '' }))
    expect(await sql`select hosted_domain from sign_in_identity where subject = 'g-link-ok'`).toEqual([{ hosted_domain: '' }])
  })

  test('an account from another domain is refused with its own code, and nothing is written', async ({ api, admin }) => {
    await configureGoogle({ allowed_email_domains: COMPANY })
    const { id, token } = await passwordSession(api, admin, 'link.gmail')
    expect(linkOutcome(await googleLink(api, token, 'link.gmail@gmail.com', { subject: 'g-link-gmail' }))).toBe('domain_not_allowed')
    // A personal account registered on the company address (no hosted-domain claim) is refused too.
    expect(linkOutcome(await googleLink(api, token, `link.gmail@${COMPANY}`, { subject: 'g-link-nohd', hd: '' }))).toBe('domain_not_allowed')
    expect(await sql`select 1 from sign_in_identity where person_id = ${id} or subject in ('g-link-gmail', 'g-link-nohd')`).toHaveLength(0)
    expect(await sql`select 1 from activity_log where operation like ${'identity_linked google for ' + id + '%'}`).toHaveLength(0)
  })

  test('with no allowed domains listed, any Google account links as before', async ({ api, admin }) => {
    await configureGoogle({ allowed_email_domains: '' })
    const { id, token } = await passwordSession(api, admin, 'link.open')
    expect(linkOutcome(await googleLink(api, token, 'link.open@gmail.com', { subject: 'g-link-open' }))).toBe('linked')
    expect(await googleLinksOf(id)).toEqual([{ subject: 'g-link-open', linked_by: 'self' }])
    expect((await redeemSession(api, await googleSignIn(api, 'link.open@gmail.com', { subject: 'g-link-open' }))).user.row_id).toBe(id)
  })
})

describe('signing in through an existing link re-checks the domains', () => {
  test('a self-made link from before the fix stops signing in; an administrator\'s link keeps working', async ({ api }) => {
    await configureGoogle({ allowed_email_domains: COMPANY })
    const selfLinked = await makePerson({})
    const adminLinked = await makePerson({})
    await rawLink(selfLinked, 'uid_693_self', 'g-693-self', 'old.self@gmail.com', 'self')
    await rawLink(adminLinked, 'uid_693_admin', 'g-693-admin', 'contractor@gmail.com', 'Administrator')
    expect((await googleSignIn(api, 'old.self@gmail.com', { subject: 'g-693-self' })).status).toBe(401)
    expect((await redeemSession(api, await googleSignIn(api, 'contractor@gmail.com', { subject: 'g-693-admin' }))).user.row_id).toBe(adminLinked)
    // The refused link is not ended: re-admitting the domain (or clearing the list) restores it.
    await configureGoogle({ allowed_email_domains: '' })
    expect((await redeemSession(api, await googleSignIn(api, 'old.self@gmail.com', { subject: 'g-693-self' }))).user.row_id).toBe(selfLinked)
  })

  test('a domain dropped from the list ends sign-ins through links that domain admitted', async ({ api }) => {
    await configureGoogle({ allowed_email_domains: `${COMPANY}, sister.test`, new_person: 'create_if_email_domain_allowed' })
    const first = await googleSignIn(api, 'arrival@sister.test', { subject: 'g-693-sister' })
    const arrival = (await redeemSession(api, first)).user.row_id
    expect(await googleLinksOf(arrival)).toEqual([{ subject: 'g-693-sister', linked_by: 'new-person' }])
    await configureGoogle({ allowed_email_domains: COMPANY })
    expect((await googleSignIn(api, 'arrival@sister.test', { subject: 'g-693-sister' })).status).toBe(401)
  })

  test('narrowing the list may not lock out a System Manager whose only way in it would end', async ({ admin }) => {
    await configureGoogle({ allowed_email_domains: `${COMPANY},sister.test` })
    const sm = await makePerson({ username: 'sm.693.sister', roles: [{ role: 'System Manager' }] })
    await rawLink(sm, 'uid_693_sm', 'g-693-sm', 'sm@sister.test', 'self', 'sister.test')
    const narrow = async () => {
      const [g] = await sql`select updated_at from sign_in_method where row_id = 'google'`
      return admin.fetch(`/api/table/${encodeURIComponent('Sign In Method')}/google`, {
        method: 'PATCH',
        body: JSON.stringify({ allowed_email_domains: COMPANY, updated_at: g.updated_at }),
      })
    }
    const refused = await narrow()
    expect(refused.status).toBe(417)
    expect(((await refused.json()) as { error: { message: string } }).error.message).toContain(`would lock out ${sm}`)
    expect(await sql`select allowed_email_domains from sign_in_method where row_id = 'google'`).toEqual([
      { allowed_email_domains: `${COMPANY},sister.test` },
    ])
    // With another way in (a password), the same change goes through.
    await admin.post('/api/set_password', { user: sm, password: 'sm-693-pw-1' })
    expect((await narrow()).status).toBe(200)
  })
})

// Codex review on #698: the way-in counts must use the sign-in rule itself,
// so a company address whose last sign-in carried no hosted-domain claim
// ('' recorded) is not a way in once the list names that company domain.
describe('the way-in counts need the hosted-domain claim for a company domain', () => {
  for (const before of ['', '*']) {
    test(`narrowing '${before}' to the company domain cannot lock out a Google-only System Manager whose account has no claim`, async ({ admin }) => {
      await configureGoogle({ allowed_email_domains: before })
      const sm = await makePerson({ username: `sm.693.nohd${before ? '.star' : ''}`, roles: [{ role: 'System Manager' }] })
      await rawLink(sm, `uid_693_nohd${before ? '_star' : ''}`, 'g-693-nohd', `sm@${COMPANY}`, 'self', '')
      const refused = await setDomains(admin, COMPANY)
      expect(refused.status).toBe(417)
      expect(((await refused.json()) as { error: { message: string } }).error.message).toContain(`would lock out ${sm}`)
      expect(await sql`select allowed_email_domains from sign_in_method where row_id = 'google'`).toEqual([{ allowed_email_domains: before }])
    })

    test(`with the matching claim recorded, narrowing '${before}' to the company domain is allowed`, async ({ admin }) => {
      await configureGoogle({ allowed_email_domains: before })
      const sm = await makePerson({ username: `sm.693.hd${before ? '.star' : ''}`, roles: [{ role: 'System Manager' }] })
      await rawLink(sm, `uid_693_hd${before ? '_star' : ''}`, 'g-693-hd', `sm@${COMPANY}`, 'self', COMPANY)
      expect((await setDomains(admin, COMPANY)).status).toBe(200)
    })
  }

  test('removing your own password does not count a company-address link without the claim', async ({ api, admin }) => {
    await configureGoogle({ allowed_email_domains: COMPANY })
    const noClaim = await passwordSession(api, admin, 'pw.693.nohd')
    await rawLink(noClaim.id, 'uid_693_pw_nohd', 'g-693-pw-nohd', `pw.nohd@${COMPANY}`, 'self', '')
    const call = (token: string) => api.fetch('/api/me/password', { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })
    expect((await call(noClaim.token)).status).toBe(409)
    expect(await sql`select password_hash is not null as kept from person where row_id = ${noClaim.id}`).toEqual([{ kept: true }])
    // With the matching claim recorded, the link is a way in and the password can go.
    const withClaim = await passwordSession(api, admin, 'pw.693.hd')
    await rawLink(withClaim.id, 'uid_693_pw_hd', 'g-693-pw-hd', `pw.hd@${COMPANY}`, 'self', COMPANY)
    expect((await call(withClaim.token)).status).toBe(200)
  })
})

// Codex review round 2 on #698: one reading of the domain list everywhere. A
// typo with a space inside an entry is refused when saved, so the lockout
// guard and sign-in can never read it differently.
describe('a malformed domain list is refused when saved', () => {
  for (const [typo, says] of [
    ['exam ple.com', '"exam ple.com" is not a domain such as example.com, or *'],
    [`${COMPANY},`, 'has an empty entry: remove the extra comma'],
    [`${COMPANY},,sister.test`, 'has an empty entry: remove the extra comma'],
    ['example', '"example" is not a domain such as example.com, or *'],
    ['@example.com', '"@example.com" is not a domain such as example.com, or *'],
  ] as const) {
    test(`"${typo}" is refused with a clear message, and the list is unchanged`, async ({ admin }) => {
      await configureGoogle({ allowed_email_domains: COMPANY })
      const res = await setDomains(admin, typo)
      expect(res.status).toBe(417)
      expect(((await res.json()) as { error: { message: string } }).error.message).toBe(`Allowed email domains ${says}`)
      expect(await sql`select allowed_email_domains from sign_in_method where row_id = 'google'`).toEqual([{ allowed_email_domains: COMPANY }])
    })
  }

  test('a typo cannot strand a Google-only System Manager; their sign-in still works', async ({ api, admin }) => {
    await configureGoogle({ allowed_email_domains: COMPANY })
    const sm = await makePerson({ username: 'sm.693.typo', roles: [{ role: 'System Manager' }] })
    await rawLink(sm, 'uid_693_typo', 'g-693-typo', `sm.typo@${COMPANY}`, 'self', COMPANY)
    expect((await setDomains(admin, 'exam ple.com')).status).toBe(417)
    expect((await redeemSession(api, await googleSignIn(api, `sm.typo@${COMPANY}`, { subject: 'g-693-typo' }))).user.row_id).toBe(sm)
  })

  test('spaces around entries, mixed case and * are accepted and read the same everywhere', async ({ api, admin }) => {
    await configureGoogle({ allowed_email_domains: '' })
    expect((await setDomains(admin, ` Example.COM ,  sister.test `)).status).toBe(200)
    const sm = await makePerson({ username: 'sm.693.spaced', roles: [{ role: 'System Manager' }] })
    await rawLink(sm, 'uid_693_spaced', 'g-693-spaced', 'sm@sister.test', 'self', 'sister.test')
    expect((await redeemSession(api, await googleSignIn(api, 'sm@sister.test', { subject: 'g-693-spaced' }))).user.row_id).toBe(sm)
    // Dropping sister.test would strand them: the guard reads the same list.
    expect((await setDomains(admin, ' Example.COM ')).status).toBe(417)
    expect((await setDomains(admin, '*')).status).toBe(200)
  })
})

// Codex review rounds 3-4 on #698: a link from before migration 0004 has no
// claim recorded (NULL). It may still work (sign-in checks Google's fresh
// claim), so a change that would take it away is refused; but it never proves
// a company-domain way in remains, so nothing may rely on it either.
describe('a link whose claim was never recorded', () => {
  async function googleOnlySm(username: string, id: string, subject: string, claim: string | null) {
    const sm = await makePerson({ username, roles: [{ role: 'System Manager' }] })
    await rawLink(sm, id, subject, `${username}@${COMPANY}`, 'self', claim)
    return sm
  }
  const setGoogle = async (admin: TestClient, change: Record<string, unknown>) => {
    const [g] = await sql`select updated_at from sign_in_method where row_id = 'google'`
    return admin.fetch(`/api/table/${encodeURIComponent('Sign In Method')}/google`, {
      method: 'PATCH',
      body: JSON.stringify({ ...change, updated_at: g.updated_at }),
    })
  }
  const refusesNaming = async (res: Response, who: string) => {
    expect(res.status).toBe(417)
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain(`would lock out ${who}`)
  }

  test('blocks turning Google off and removing its domain for a Google-only System Manager', async ({ admin }) => {
    await configureGoogle({ allowed_email_domains: COMPANY })
    const sm = await googleOnlySm('sm.693.unrecorded', 'uid_693_unrecorded', 'g-693-unrecorded', null)
    await refusesNaming(await setGoogle(admin, { enabled: false }), sm)
    await refusesNaming(await setGoogle(admin, { allowed_email_domains: 'other.test' }), sm)
    expect(await sql`select enabled, allowed_email_domains from sign_in_method where row_id = 'google'`).toEqual([
      { enabled: true, allowed_email_domains: COMPANY },
    ])
  })

  test('under *, narrowing to the company domain is refused: a possible way in is lost and none is proven', async ({ admin }) => {
    await configureGoogle({ allowed_email_domains: '*' })
    const sm = await googleOnlySm('sm.693.star', 'uid_693_star', 'g-693-star', null)
    await refusesNaming(await setGoogle(admin, { allowed_email_domains: COMPANY }), sm)
    expect(await sql`select allowed_email_domains from sign_in_method where row_id = 'google'`).toEqual([{ allowed_email_domains: '*' }])
  })

  test('removing your own password is refused when the other way in is an unrecorded company link', async ({ api, admin }) => {
    await configureGoogle({ allowed_email_domains: COMPANY })
    const { id, token } = await passwordSession(api, admin, 'pw.693.unrecorded')
    await rawLink(id, 'uid_693_pw_unrecorded', 'g-693-pw-unrecorded', `pw.unrecorded@${COMPANY}`, 'self', null)
    const res = await api.fetch('/api/me/password', { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })
    expect(res.status).toBe(409)
    expect(await sql`select password_hash is not null as kept from person where row_id = ${id}`).toEqual([{ kept: true }])
  })

  test('under *, an unrecorded link needs no claim, so the password can go', async ({ api, admin }) => {
    await configureGoogle({ allowed_email_domains: '*' })
    const { id, token } = await passwordSession(api, admin, 'pw.693.star')
    await rawLink(id, 'uid_693_pw_star', 'g-693-pw-star', `pw.star@${COMPANY}`, 'self', null)
    expect((await api.fetch('/api/me/password', { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })).status).toBe(200)
  })

  test('once a sign-in records that Google sent no claim, the recorded-claim rule decides', async ({ api, admin }) => {
    await configureGoogle({ allowed_email_domains: '*' })
    const sm = await googleOnlySm('sm.693.recorded', 'uid_693_recorded', 'g-693-recorded', null)
    // A personal account on the company address signs in under '*', recording ''.
    await redeemSession(api, await googleSignIn(api, `sm.693.recorded@${COMPANY}`, { subject: 'g-693-recorded', hd: '' }))
    expect(await sql`select hosted_domain from sign_in_identity where id = 'uid_693_recorded'`).toEqual([{ hosted_domain: '' }])
    await refusesNaming(await setGoogle(admin, { allowed_email_domains: COMPANY }), sm)
    // Under the company domain that link cannot sign in at all, so turning
    // Google off takes nothing away from them.
    await configureGoogle({ allowed_email_domains: COMPANY })
    expect((await setGoogle(admin, { enabled: false })).status).toBe(200)
  })

  test('widening the list, or changing another method, restricts nothing and is allowed', async ({ admin }) => {
    await configureGoogle({ allowed_email_domains: COMPANY })
    await googleOnlySm('sm.693.widen', 'uid_693_widen', 'g-693-widen', null)
    expect((await setGoogle(admin, { allowed_email_domains: `${COMPANY},sister.test` })).status).toBe(200)
    const [pw] = await sql`select updated_at, label from sign_in_method where row_id = 'password'`
    const other = await admin.fetch(`/api/table/${encodeURIComponent('Sign In Method')}/password`, {
      method: 'PATCH',
      body: JSON.stringify({ label: `${pw.label ?? 'Password'} (renamed)`, updated_at: pw.updated_at }),
    })
    expect(other.status).toBe(200)
    // Another method turned off and on again restricts none of their Google ways in either.
    await configureDelegated()
    const [hr] = await sql`select updated_at from sign_in_method where row_id = 'stylehr'`
    expect((await admin.fetch(`/api/table/${encodeURIComponent('Sign In Method')}/stylehr`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false, updated_at: hr.updated_at }),
    })).status).toBe(200)
  })

  test('a recorded matching claim behaves as before: removing its domain is refused, a change that keeps it is allowed', async ({ admin }) => {
    await configureGoogle({ allowed_email_domains: COMPANY })
    const sm = await googleOnlySm('sm.693.matching', 'uid_693_matching', 'g-693-matching', COMPANY)
    await refusesNaming(await setGoogle(admin, { allowed_email_domains: 'other.test' }), sm)
    expect((await setGoogle(admin, { allowed_email_domains: `${COMPANY},other.test` })).status).toBe(200)
  })
})

// Codex review round 5 on #698: a non-empty list, even *, admits only a
// verified address (domainAdmitted). A link that recorded no verified address
// (email NULL) is no way in under any list, so nothing may rely on it.
describe('a link with no verified address', () => {
  const setGoogle = async (admin: TestClient, change: Record<string, unknown>) => {
    const [g] = await sql`select updated_at from sign_in_method where row_id = 'google'`
    return admin.fetch(`/api/table/${encodeURIComponent('Sign In Method')}/google`, {
      method: 'PATCH',
      body: JSON.stringify({ ...change, updated_at: g.updated_at }),
    })
  }
  const noEmailLink = (person: string, id: string, subject: string) =>
    sql`insert into sign_in_identity (id, person_id, method, subject, email, linked_by, hosted_domain)
      values (${id}, ${person}, 'google', ${subject}, null, 'self', '')`

  test('setting an empty list to * cannot strand a Google-only System Manager whose link has none', async ({ admin }) => {
    await configureGoogle({ allowed_email_domains: '' })
    const sm = await makePerson({ username: 'sm.693.noemail', roles: [{ role: 'System Manager' }] })
    await noEmailLink(sm, 'uid_693_noemail', 'g-693-noemail')
    const res = await setGoogle(admin, { allowed_email_domains: '*' })
    expect(res.status).toBe(417)
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain(`would lock out ${sm}`)
    expect(await sql`select allowed_email_domains from sign_in_method where row_id = 'google'`).toEqual([{ allowed_email_domains: '' }])
  })

  test('under *, removing your own password is refused when the other way in has no verified address', async ({ api, admin }) => {
    await configureGoogle({ allowed_email_domains: '*' })
    const { id, token } = await passwordSession(api, admin, 'pw.693.noemail')
    await noEmailLink(id, 'uid_693_pw_noemail', 'g-693-pw-noemail')
    const res = await api.fetch('/api/me/password', { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })
    expect(res.status).toBe(409)
    expect(await sql`select password_hash is not null as kept from person where row_id = ${id}`).toEqual([{ kept: true }])
  })

  test('a link verified once, then signed in unverified under an empty list, cannot strand its owner when the list becomes *', async ({ admin }) => {
    await configureGoogle({ allowed_email_domains: '' })
    const sm = await makePerson({ username: 'sm.693.stale', roles: [{ role: 'System Manager' }] })
    await rawLink(sm, 'uid_693_stale', 'g-693-stale', 'sm.stale@gmail.com', 'self', '')
    await sql`update sign_in_identity set email_verified = true where id = 'uid_693_stale'`
    const { completeSignIn } = await import('../src/sign-in')
    const { methodOfKind } = await import('../src/identities')
    const google = (await methodOfKind('google'))!
    await completeSignIn(google, { status: 'verified', subject: 'g-693-stale', email: 'sm.stale@gmail.com', email_verified: false }, null)
    expect(await sql`select email, email_verified from sign_in_identity where id = 'uid_693_stale'`).toEqual([
      { email: 'sm.stale@gmail.com', email_verified: false },
    ])
    const res = await setGoogle(admin, { allowed_email_domains: '*' })
    expect(res.status).toBe(417)
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain(`would lock out ${sm}`)
  })

  test('under *, a link with a verified address still counts: the password can go and * can be set', async ({ api, admin }) => {
    await configureGoogle({ allowed_email_domains: '' })
    const sm = await makePerson({ username: 'sm.693.withemail', roles: [{ role: 'System Manager' }] })
    await rawLink(sm, 'uid_693_withemail', 'g-693-withemail', 'sm.withemail@gmail.com', 'self', '')
    expect((await setGoogle(admin, { allowed_email_domains: '*' })).status).toBe(200)
    const { id, token } = await passwordSession(api, admin, 'pw.693.withemail')
    await rawLink(id, 'uid_693_pw_withemail', 'g-693-pw-withemail', `pw.withemail@${COMPANY}`, 'self', '')
    expect((await api.fetch('/api/me/password', { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })).status).toBe(200)
  })
})

// Codex review round 8 on #698: the guard and sign-in share one consumer-domain
// list. A consumer address needs no hosted-domain claim in either, so a
// Google-only System Manager on gmail.com, with none recorded, both signs in
// and is counted as a way in that removing gmail.com would end.
describe('a listed consumer domain is read the same by sign-in and the guard', () => {
  test('a gmail.com link with no claim signs in, and removing gmail.com is refused for its Google-only System Manager', async ({ api, admin }) => {
    await configureGoogle({ allowed_email_domains: `${COMPANY},gmail.com` })
    const sm = await makePerson({ username: 'sm.693.consumer', roles: [{ role: 'System Manager' }] })
    await rawLink(sm, 'uid_693_consumer', 'g-693-consumer', 'sm.consumer@gmail.com', 'self', '')
    expect((await redeemSession(api, await googleSignIn(api, 'sm.consumer@gmail.com', { subject: 'g-693-consumer' }))).user.row_id).toBe(sm)
    const res = await setDomains(admin, COMPANY)
    expect(res.status).toBe(417)
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain(`would lock out ${sm}`)
    // Keeping gmail.com keeps them in: the change is allowed.
    expect((await setDomains(admin, `gmail.com,${COMPANY},sister.test`)).status).toBe(200)
  })
})

// #693 (Siraj, 30-Oct-2026): when a change to Google's domain list stops
// admitting a link the domain rule made, the sessions opened through that
// link end. Administrator links and sessions opened another way are untouched.
describe('narrowing the list ends sessions through links it no longer admits', () => {
  const whoami = (api: TestClient, token: string) => api.fetch('/api/whoami', { headers: { authorization: `Bearer ${token}` } })

  test('a self-linked gmail.com session ends; an administrator-linked and a password session survive; re-widening does not revive it', async ({ api, admin }) => {
    await configureGoogle({ allowed_email_domains: `${COMPANY},gmail.com` })
    const selfLinked = await makePerson({})
    const adminLinked = await makePerson({})
    await rawLink(selfLinked, 'uid_693_end_self', 'g-693-end-self', 'end.self@gmail.com', 'self', '')
    await rawLink(adminLinked, 'uid_693_end_admin', 'g-693-end-admin', 'end.admin@gmail.com', 'Administrator', '')
    const selfSession = await redeemSession(api, await googleSignIn(api, 'end.self@gmail.com', { subject: 'g-693-end-self' }))
    const adminSession = await redeemSession(api, await googleSignIn(api, 'end.admin@gmail.com', { subject: 'g-693-end-admin' }))
    const password = await passwordSession(api, admin, 'pw.693.end')
    for (const token of [selfSession.token, adminSession.token, password.token]) expect((await whoami(api, token)).status).toBe(200)

    expect((await setDomains(admin, COMPANY)).status).toBe(200)
    expect((await whoami(api, selfSession.token)).status).toBe(401)
    expect((await whoami(api, adminSession.token)).status).toBe(200)
    expect((await whoami(api, password.token)).status).toBe(200)
    // The link is kept; one log entry for that person, with no address in it.
    expect(await sql`select ended_at from sign_in_identity where id = 'uid_693_end_self'`).toEqual([{ ended_at: null }])
    const logged = await sql`select "user", operation from activity_log where "user" = ${selfLinked} and operation like 'google_sessions_ended%'`
    expect(logged).toEqual([{ user: selfLinked, operation: 'google_sessions_ended_domain_not_allowed google' }])
    expect(JSON.stringify(logged)).not.toContain('@')
    expect(await sql`select 1 from activity_log where "user" = ${adminLinked} and operation like 'google_sessions_ended%'`).toHaveLength(0)

    // Re-widening lets them sign in again, but the ended session stays ended.
    expect((await setDomains(admin, `${COMPANY},gmail.com`)).status).toBe(200)
    expect((await whoami(api, selfSession.token)).status).toBe(401)
    await new Promise((r) => setTimeout(r, 1100)) // sessions carry whole seconds
    const fresh = await redeemSession(api, await googleSignIn(api, 'end.self@gmail.com', { subject: 'g-693-end-self' }))
    expect(fresh.user.row_id).toBe(selfLinked)
    expect((await whoami(api, fresh.token)).status).toBe(200)
  })

  test('a change that keeps the link admitted ends nothing', async ({ api, admin }) => {
    await configureGoogle({ allowed_email_domains: 'gmail.com' })
    const p = await makePerson({})
    await rawLink(p, 'uid_693_keep', 'g-693-keep', 'keep@gmail.com', 'self', '')
    const session = await redeemSession(api, await googleSignIn(api, 'keep@gmail.com', { subject: 'g-693-keep' }))
    expect((await setDomains(admin, `gmail.com,${COMPANY}`)).status).toBe(200)
    expect((await whoami(api, session.token)).status).toBe(200)
    expect(await sql`select sessions_ended_at from sign_in_identity where id = 'uid_693_keep'`).toEqual([{ sessions_ended_at: null }])
  })
})

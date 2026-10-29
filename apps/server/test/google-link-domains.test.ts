// #693: Google's allowed email domains govern a person linking an account to
// themselves, and every later sign-in through a link the domain rule made.
// An administrator's own link stays that administrator's decision.
import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { makePerson } from './fixtures'
import { configureGoogle } from './identity-fixtures'
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

async function rawLink(person: string, id: string, subject: string, email: string, linkedBy: string) {
  await sql`insert into sign_in_identity (id, person_id, method, subject, email, linked_by)
    values (${id}, ${person}, 'google', ${subject}, ${email}, ${linkedBy})`
}

describe('a person links Google to themselves under allowed domains', () => {
  test('an account on an allowed company domain links, and then signs them in', async ({ api, admin }) => {
    await configureGoogle({ allowed_email_domains: COMPANY })
    const { id, token } = await passwordSession(api, admin, 'link.ok')
    expect(linkOutcome(await googleLink(api, token, `link.ok@${COMPANY}`, { subject: 'g-link-ok' }))).toBe('linked')
    expect(await googleLinksOf(id)).toEqual([{ subject: 'g-link-ok', linked_by: 'self' }])
    expect((await redeemSession(api, await googleSignIn(api, `link.ok@${COMPANY}`, { subject: 'g-link-ok' }))).user.row_id).toBe(id)
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
    await rawLink(sm, 'uid_693_sm', 'g-693-sm', 'sm@sister.test', 'self')
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

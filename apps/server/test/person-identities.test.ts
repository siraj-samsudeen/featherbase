// person-identities (#275): a User is a person; email is optional contact
// data; Google is recognised by its permanent account ID, never by email;
// sessions remember how they were opened.
import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { makePerson } from './fixtures'
import { issueSession } from '../src/auth'
import { configureGoogle, inviteGoogleRaw, linkDelegated, configureDelegated } from './identity-fixtures'
import { googleSignIn, redeemSession } from './google-mock'

const enc = encodeURIComponent

async function setEnabled(admin: TestClient, table: string, row: string, enabled: boolean) {
  const [r] = table === 'Sign In Method'
    ? await sql`select updated_at from sign_in_method where row_id = ${row}`
    : await sql`select updated_at from person where row_id = ${row}`
  return admin.fetch(`/api/table/${enc(table)}/${enc(row)}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled, updated_at: r.updated_at }),
  })
}

describe('email is optional contact data', () => {
  test('an account saves with no email; a blank one means none', async () => {
    const a = await makePerson({ full_name: 'Store staff' })
    const b = await makePerson({ email: '   ' })
    const rows = await sql`select row_id, email from person where row_id in ${sql([a, b])} order by row_id`
    expect(rows.map((r) => r.email)).toEqual([null, null])
  })

  test('a placeholder address that can never receive mail is refused', async ({ admin }) => {
    const res = await admin.fetch('/api/save_row', {
      method: 'POST',
      body: JSON.stringify({ table: 'Person', row: { email: 'rr-7964@staff.jeyarama.invalid', enabled: true } }),
    })
    expect(res.status).toBe(417)
    expect(Object.keys(((await res.json()) as { error: { fields: Record<string, string> } }).error.fields)).toEqual(['email'])
  })

  test('two accounts cannot share an address, whatever its capitals; the error names email', async ({ admin }) => {
    await makePerson({ email: 'asha@example.com' })
    const res = await admin.fetch('/api/save_row', {
      method: 'POST',
      body: JSON.stringify({ table: 'Person', row: { email: 'Asha@Example.com', enabled: true } }),
    })
    expect(res.status).toBe(417)
    const body = (await res.json()) as { error: { fields?: Record<string, string> } }
    expect(Object.keys(body.error.fields ?? {})).toEqual(['email'])
  })

  test('the Person definition cannot be edited back to a case-sensitive unique email', async ({ admin }) => {
    const res = await admin.fetch('/api/table_def/Person', {
      method: 'PUT',
      body: JSON.stringify({ name: 'Person', columns: [{ column_name: 'email', column_type: 'Data', unique: true }] }),
    })
    expect(res.ok).toBe(false)
    const [c] = await sql`select "unique", reqd from column_def where parent = 'Person' and column_name = 'email'`
    expect(c).toEqual({ unique: false, reqd: false })
  })
})

describe('Google is matched by its permanent account ID', () => {
  test('a changed Google address still opens the same account', async ({ api }) => {
    await configureGoogle({ allowed_email_domains: '*' })
    const first = await redeemSession(api, await googleSignIn(api, 'kavya@gmail.com', { subject: 'g-100' }))
    const again = await googleSignIn(api, 'kavya.renamed@gmail.com', { subject: 'g-100' })
    expect(again.status).toBe(302)
    expect((await redeemSession(api, again)).user.row_id).toBe(first.user.row_id)
  })

  test('an unlinked Google account with someone else\'s address never opens that account', async ({ api }) => {
    const meera = await makePerson({ email: 'meera@jeyarama.com' })
    await configureGoogle({ allowed_email_domains: '' })
    expect((await googleSignIn(api, 'meera@jeyarama.com', { subject: 'g-stranger' })).status).toBe(401)
    // Even with open admission it is refused, not linked: the address is in use.
    await configureGoogle({ allowed_email_domains: '*' })
    const res = await googleSignIn(api, 'meera@jeyarama.com', { subject: 'g-stranger' })
    expect(res.status).toBe(401)
    const links = await sql`select 1 from sign_in_identity where person_id = ${meera}`
    expect(links).toHaveLength(0)
  })

  test('an invite is claimed once, by the first verified sign-in, and the address is never used again', async ({ api }) => {
    const rr1 = await makePerson({ email: 'sm.atk@jeyarama.com' })
    const invite = await inviteGoogleRaw(rr1, 'sm.atk@jeyarama.com')
    const first = await googleSignIn(api, 'SM.ATK@jeyarama.com', { subject: 'g-sm-1' })
    expect(first.status).toBe(302)
    const session = await redeemSession(api, first)
    expect(session.user.row_id).toBe(rr1)
    expect(session.user.sign_in).toMatchObject({ method: 'google', identity: invite })
    const [row] = await sql`select subject, pending_email, linked_by from sign_in_identity where id = ${invite}`
    expect(row).toEqual({ subject: 'g-sm-1', pending_email: null, linked_by: 'first-sign-in' })
    const audit = await sql`select operation from activity_log where "user" = ${rr1} and operation like 'identity_claimed%'`
    expect(audit).toHaveLength(1)
    // A different Google account with the same address later: not this person.
    expect((await googleSignIn(api, 'sm.atk@jeyarama.com', { subject: 'g-sm-2' })).status).toBe(401)
  })

  test('an invite is never claimed onto a disabled account', async ({ api }) => {
    const rr2 = await makePerson({ email: 'gone@jeyarama.com', enabled: false })
    const invite = await inviteGoogleRaw(rr2, 'gone@jeyarama.com')
    expect((await googleSignIn(api, 'gone@jeyarama.com', { subject: 'g-gone' })).status).toBe(401)
    const [row] = await sql`select subject from sign_in_identity where id = ${invite}`
    expect(row.subject).toBeNull()
  })

  test('changing or clearing the email cancels an invite for the old address', async ({ api, admin }) => {
    const rr3 = await makePerson({ email: 'old@jeyarama.com' })
    await inviteGoogleRaw(rr3, 'old@jeyarama.com')
    const [u] = await sql`select updated_at from person where row_id = ${rr3}`
    const res = await admin.fetch(`/api/table/Person/${rr3}`, { method: 'PATCH', body: JSON.stringify({ email: 'new@jeyarama.com', updated_at: u.updated_at }) })
    expect(res.ok).toBe(true)
    expect(await sql`select 1 from sign_in_identity where person_id = ${rr3}`).toHaveLength(0)
    await configureGoogle({ allowed_email_domains: '' })
    expect((await googleSignIn(api, 'old@jeyarama.com', { subject: 'g-old' })).status).toBe(401)
  })

  test('domain admission needs the Workspace claim for a company domain', async ({ api }) => {
    await configureGoogle({ allowed_email_domains: 'jeyarama.com' })
    // A personal Google account registered on a company address: no hd claim.
    expect((await googleSignIn(api, 'someone@jeyarama.com', { subject: 'g-personal', hd: '' })).status).toBe(401)
    expect((await googleSignIn(api, 'someone@jeyarama.com', { subject: 'g-workspace', hd: 'jeyarama.com' })).status).toBe(302)
  })

  test('the method\'s rule decides unknown people: refuse, or create for anyone', async ({ api }) => {
    await configureGoogle({ allowed_email_domains: '*', new_person: 'refuse' })
    expect((await googleSignIn(api, 'nobody@gmail.com', { subject: 'g-nobody' })).status).toBe(401)
    await configureGoogle({ allowed_email_domains: '', new_person: 'create' })
    expect((await googleSignIn(api, 'anybody@outside.io', { subject: 'g-anybody' })).status).toBe(302)
  })

  test('turning Google off ends Google sessions; sessions opened by password continue', async ({ api, admin }) => {
    await configureGoogle({ allowed_email_domains: '*' })
    const google = await redeemSession(api, await googleSignIn(api, 'ends@gmail.com', { subject: 'g-ends' }))
    const legacy = (await issueSession(google.user.row_id)).token // minted before the upgrade: no method
    const who = (token: string) => api.fetch('/api/whoami', { headers: { authorization: `Bearer ${token}` } })
    expect((await who(google.token)).status).toBe(200)
    expect((await setEnabled(admin, 'Sign In Method', 'google', false)).status).toBe(200)
    expect((await who(google.token)).status).toBe(401)
    // Sessions from before the upgrade carry no method and run to expiry.
    expect((await who(legacy)).status).toBe(200)
    expect((await googleSignIn(api, 'ends@gmail.com', { subject: 'g-ends' })).status).toBe(401)
  })
})

describe('password sign-in', () => {
  test('a username beats an email, and capitals do not matter', async ({ api, admin }) => {
    const meena = await makePerson({ username: 'meena' })
    const other = await makePerson({ email: 'meena' })
    await admin.post('/api/set_password', { user: meena, password: 'meena-pw-1' })
    await admin.post('/api/set_password', { user: other, password: 'other-pw-1' })
    const login = (usr: string, pwd: string) => api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr, pwd }) })
    expect((await login('meena', 'other-pw-1')).status).toBe(401)
    const ok = await login('MEENA', 'meena-pw-1')
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { user: { row_id: string; sign_in: { method: string } } }).user).toMatchObject({ row_id: meena, sign_in: { method: 'password' } })
  })

  test('removing your password ends password sessions, but not your last way in', async ({ api, admin }) => {
    const ravi = await makePerson({ username: 'ravi' })
    await admin.post('/api/set_password', { user: ravi, password: 'ravi-pw-1' })
    const { token } = (await (await api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr: 'ravi', pwd: 'ravi-pw-1' }) })).json()) as { token: string }
    const as = (path: string, init: RequestInit = {}) => api.fetch(path, { ...init, headers: { authorization: `Bearer ${token}` } })
    expect((await as('/api/me/password', { method: 'DELETE' })).status).toBe(409)
    await configureDelegated()
    await linkDelegated(ravi, 'ravi_hr')
    expect((await as('/api/me/password', { method: 'DELETE' })).status).toBe(200)
    expect((await as('/api/whoami')).status).toBe(401)
  })

  test('a reset never gives a password to an account without one, nor mails an account without email', async ({ api }) => {
    await makePerson({ username: 'hr.only', email: 'hr.only@jeyarama.com' })
    const noMail = await makePerson({ username: 'no.mail' })
    await sql`update person set password_hash = 'x:y' where row_id = ${noMail}`
    const before = await sql`select count(*)::int as n from password_reset`
    for (const usr of ['hr.only', 'hr.only@jeyarama.com', 'no.mail'])
      expect((await api.fetch('/api/reset_password_request', { method: 'POST', body: JSON.stringify({ usr }) })).status).toBe(200)
    const after = await sql`select count(*)::int as n from password_reset`
    expect(after[0].n).toBe(before[0].n)
  })
})

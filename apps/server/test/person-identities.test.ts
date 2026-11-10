// person-identities (#275): a User is a person; email is optional contact
// data; Google is recognised by its permanent account ID, never by email;
// sessions remember how they were opened.
import { afterEach, describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test, patchDoc } from './pg-test'
import { sql } from '../src/db'
import { expectApiError, expectStatus, makePerson } from './fixtures'
import { issueSession } from '../src/auth'
import { configureGoogle, inviteGoogleRaw, linkDelegated, configureDelegated } from './identity-fixtures'
import { googleSignIn, redeemSession } from './google-mock'
import { _setDelegatedFetch } from '../src/delegated-login'
import {
  candidate, disableLeaver, getIdentity, getSignInMethod, inviteGoogle, linkIdentity,
  listIdentities, methodOfKind, touchIdentity,
} from '../src/identities'

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
    await expectStatus(res, 417)
    expect(Object.keys(((await res.json()) as { error: { fields: Record<string, string> } }).error.fields)).toEqual(['email'])
  })

  test('two accounts cannot share an address, whatever its capitals; the error names email', async ({ admin }) => {
    await makePerson({ email: 'asha@example.com' })
    const res = await admin.fetch('/api/save_row', {
      method: 'POST',
      body: JSON.stringify({ table: 'Person', row: { email: 'Asha@Example.com', enabled: true } }),
    })
    await expectStatus(res, 417)
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
    await expectStatus(again, 302)
    expect((await redeemSession(api, again)).user.row_id).toBe(first.user.row_id)
  })

  test('an unlinked Google account with someone else\'s address never opens that account', async ({ api }) => {
    const meera = await makePerson({ email: 'member@jeyarama.com' })
    await configureGoogle({ allowed_email_domains: '' })
    await expectStatus(await googleSignIn(api, 'member@jeyarama.com', { subject: 'g-stranger' }), 401)
    // Even with open admission it is refused, not linked: the address is in use.
    await configureGoogle({ allowed_email_domains: '*' })
    const res = await googleSignIn(api, 'member@jeyarama.com', { subject: 'g-stranger' })
    await expectStatus(res, 401)
    const links = await sql`select 1 from sign_in_identity where person_id = ${meera}`
    expect(links).toHaveLength(0)
  })

  test('an invite is claimed once, by the first verified sign-in, and the address is never used again', async ({ api }) => {
    const rr1 = await makePerson({ email: 'sm.atk@jeyarama.com' })
    const invite = await inviteGoogleRaw(rr1, 'sm.atk@jeyarama.com')
    const first = await googleSignIn(api, 'SM.ATK@jeyarama.com', { subject: 'g-sm-1' })
    await expectStatus(first, 302)
    const session = await redeemSession(api, first)
    expect(session.user.row_id).toBe(rr1)
    expect(session.user.sign_in).toMatchObject({ method: 'google', identity: invite })
    const [row] = await sql`select subject, pending_email, linked_by from sign_in_identity where id = ${invite}`
    expect(row).toEqual({ subject: 'g-sm-1', pending_email: null, linked_by: 'first-sign-in' })
    const audit = await sql`select operation from activity_log where "user" = ${rr1} and operation like 'identity_claimed%'`
    expect(audit).toHaveLength(1)
    // A different Google account with the same address later: not this person.
    await expectStatus(await googleSignIn(api, 'sm.atk@jeyarama.com', { subject: 'g-sm-2' }), 401)
  })

  test('an invite is never claimed onto a disabled account', async ({ api }) => {
    const rr2 = await makePerson({ email: 'gone@jeyarama.com', enabled: false })
    const invite = await inviteGoogleRaw(rr2, 'gone@jeyarama.com')
    await expectStatus(await googleSignIn(api, 'gone@jeyarama.com', { subject: 'g-gone' }), 401)
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
    await expectStatus(await googleSignIn(api, 'old@jeyarama.com', { subject: 'g-old' }), 401)
  })

  test('domain admission needs the Workspace claim for a company domain', async ({ api }) => {
    await configureGoogle({ allowed_email_domains: 'jeyarama.com' })
    // A personal Google account registered on a company address: no hd claim.
    await expectStatus(await googleSignIn(api, 'someone@jeyarama.com', { subject: 'g-personal', hd: '' }), 401)
    await expectStatus(await googleSignIn(api, 'someone@jeyarama.com', { subject: 'g-workspace', hd: 'jeyarama.com' }), 302)
  })

  test('the method\'s rule decides unknown people: refuse, or create for anyone', async ({ api }) => {
    await configureGoogle({ allowed_email_domains: '*', new_person: 'refuse' })
    await expectStatus(await googleSignIn(api, 'nobody@gmail.com', { subject: 'g-nobody' }), 401)
    await configureGoogle({ allowed_email_domains: '', new_person: 'create' })
    await expectStatus(await googleSignIn(api, 'anybody@outside.io', { subject: 'g-anybody' }), 302)
  })

  test('turning Google off ends Google sessions; sessions opened by password continue', async ({ api, admin }) => {
    await configureGoogle({ allowed_email_domains: '*' })
    const google = await redeemSession(api, await googleSignIn(api, 'ends@gmail.com', { subject: 'g-ends' }))
    const legacy = (await issueSession(google.user.row_id)).token // minted before the upgrade: no method
    const who = (token: string) => api.fetch('/api/whoami', { headers: { authorization: `Bearer ${token}` } })
    await expectStatus(await who(google.token), 200)
    await expectStatus(await setEnabled(admin, 'Sign In Method', 'google', false), 200)
    await expectStatus(await who(google.token), 401)
    // Sessions from before the upgrade carry no method and run to expiry.
    await expectStatus(await who(legacy), 200)
    await expectStatus(await googleSignIn(api, 'ends@gmail.com', { subject: 'g-ends' }), 401)
  })
})

describe('password sign-in', () => {
  test('a username beats an email, and capitals do not matter', async ({ api, admin }) => {
    const meena = await makePerson({ username: 'meena' })
    const other = await makePerson({ email: 'meena' })
    await admin.post('/api/set_password', { user: meena, password: 'meena-pw-1' })
    await admin.post('/api/set_password', { user: other, password: 'other-pw-1' })
    const login = (usr: string, pwd: string) => api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr, pwd }) })
    await expectStatus(await login('meena', 'other-pw-1'), 401)
    const ok = await login('MEENA', 'meena-pw-1')
    await expectStatus(ok, 200)
    expect(((await ok.json()) as { user: { row_id: string; sign_in: { method: string } } }).user).toMatchObject({ row_id: meena, sign_in: { method: 'password' } })
  })

  test('removing your password ends password sessions, but not your last way in', async ({ api, admin }) => {
    const ravi = await makePerson({ username: 'ravi' })
    await admin.post('/api/set_password', { user: ravi, password: 'ravi-pw-1' })
    const { token } = (await (await api.fetch('/api/login', { method: 'POST', body: JSON.stringify({ usr: 'ravi', pwd: 'ravi-pw-1' }) })).json()) as { token: string }
    const as = (path: string, init: RequestInit = {}) => api.fetch(path, { ...init, headers: { authorization: `Bearer ${token}` } })
    await expectStatus(await as('/api/me/password', { method: 'DELETE' }), 409)
    await configureDelegated()
    await linkDelegated(ravi, 'ravi_hr')
    await expectStatus(await as('/api/me/password', { method: 'DELETE' }), 200)
    await expectStatus(await as('/api/whoami'), 401)
  })

  test('a reset never gives a password to an account without one, nor mails an account without email', async ({ api }) => {
    await makePerson({ username: 'hr.only', email: 'hr.only@jeyarama.com' })
    const noMail = await makePerson({ username: 'no.mail' })
    await sql`update person set password_hash = 'x:y' where row_id = ${noMail}`
    const before = await sql`select count(*)::int as n from password_reset`
    for (const usr of ['hr.only', 'hr.only@jeyarama.com', 'no.mail'])
      await expectStatus(await api.fetch('/api/reset_password_request', { method: 'POST', body: JSON.stringify({ usr }) }), 200)
    const after = await sql`select count(*)::int as n from password_reset`
    expect(after[0].n).toBe(before[0].n)
  })
})

// The HR system answers yes to every check in these tests; it is never contacted for real.
const hrSaysYes = () => _setDelegatedFetch((async () => Response.json({ token: 'opaque' })) as typeof fetch)
const hrSignIn = (api: TestClient, usr: string) =>
  api.fetch('/api/login/delegated', { method: 'POST', body: JSON.stringify({ usr, pwd: 'Hr-Password-1', method: 'stylehr' }) })

describe('One person, several ways to sign in', () => {
  afterEach(() => _setDelegatedFetch(null))

  test('a Team Leader linked to Google and to the HR system opens the same account both ways', async ({ api }) => {
    await configureGoogle({ allowed_email_domains: '*' })
    await configureDelegated()
    hrSaysYes()
    const monday = await redeemSession(api, await googleSignIn(api, 'tl.both@gmail.com', { subject: 'g-both' }))
    const person = monday.user.row_id
    await linkDelegated(person, 'tl_both_hr')
    const tuesday = await hrSignIn(api, 'tl_both_hr')
    await expectStatus(tuesday, 200)
    expect(((await tuesday.json()) as { user: { row_id: string } }).user.row_id).toBe(person)
    // One account: the two links hang off the same person, nothing was copied.
    const links = await sql`select method from sign_in_identity where person_id = ${person} and ended_at is null order by method`
    expect(links.map((l) => l.method)).toEqual(['google', 'stylehr'])
    expect((await sql`select count(*)::int as n from person where row_id = ${person}`)[0].n).toBe(1)
  })
})

describe('Email is optional: store staff without email', () => {
  afterEach(() => _setDelegatedFetch(null))

  test('a staff member saved with no email signs in with their HR system ID', async ({ api }) => {
    await configureDelegated()
    hrSaysYes()
    const staff = await makePerson({ full_name: 'Store Staff' })
    expect((await sql`select email from person where row_id = ${staff}`)[0].email).toBeNull()
    await linkDelegated(staff, 'staff_no_mail')
    const res = await hrSignIn(api, 'staff_no_mail')
    await expectStatus(res, 200)
    const body = (await res.json()) as { user: { row_id: string; email: string | null } }
    expect(body.user).toMatchObject({ row_id: staff, email: null })
  })
})

describe("An account's permanent reference is never an address or a code", () => {
  test('a person created by a Google sign-in keeps the same reference when their Google address changes', async ({ api }) => {
    await configureGoogle({ allowed_email_domains: '*' })
    const first = await redeemSession(api, await googleSignIn(api, 'asha.old@gmail.com', { subject: 'g-asha' }))
    const person = first.user.row_id
    // Featherbase assigns the reference: neither the address nor its local part.
    expect(person).toMatch(/^psn_/)
    expect(person.toLowerCase()).not.toContain('asha')
    const again = await redeemSession(api, await googleSignIn(api, 'asha.new@gmail.com', { subject: 'g-asha' }))
    expect(again.user.row_id).toBe(person)
    // The Google sign-in now records the new address; the reference is untouched.
    const [link] = await sql`select person_id, email from sign_in_identity where method = 'google' and subject = 'g-asha' and ended_at is null`
    expect(link).toMatchObject({ person_id: person, email: 'asha.new@gmail.com' })
    expect((await sql`select count(*)::int as n from person where row_id = ${person}`)[0].n).toBe(1)
    // Their contact address follows the new Google address.
    expect((await sql`select email from person where row_id = ${person}`)[0].email).toBe('asha.new@gmail.com')
  })

  test('a contact address set by hand stays put when the Google address changes', async ({ api, admin }) => {
    await configureGoogle({ allowed_email_domains: '*' })
    const first = await redeemSession(api, await googleSignIn(api, 'ravi.old@gmail.com', { subject: 'g-ravi' }))
    const person = first.user.row_id
    const [row] = await sql`select updated_at from person where row_id = ${person}`
    await patchDoc(admin, `/api/table/Person/${person}`, { updated_at: row.updated_at, email: 'ravi@store.example' })
    await redeemSession(api, await googleSignIn(api, 'ravi.new@gmail.com', { subject: 'g-ravi' }))
    expect((await sql`select email from person where row_id = ${person}`)[0].email).toBe('ravi@store.example')
  })

  test('a new Google address another person already uses does not move onto this person', async ({ api }) => {
    await configureGoogle({ allowed_email_domains: '*' })
    const first = await redeemSession(api, await googleSignIn(api, 'mina.old@gmail.com', { subject: 'g-mina' }))
    const person = first.user.row_id
    await makePerson({ email: 'taken@gmail.com' })
    await redeemSession(api, await googleSignIn(api, 'taken@gmail.com', { subject: 'g-mina' }))
    expect((await sql`select email from person where row_id = ${person}`)[0].email).toBe('mina.old@gmail.com')
  })
})

describe('only a person has sign-in methods', () => {
  test('inviting a service account to sign in with Google says to issue an access token; an unknown id is not found', async () => {
    const { inviteGoogle } = await import('../src/identities')
    const { createServiceAccount } = await import('../src/service-accounts')
    const bot = await createServiceAccount('invite-probe-bot', [], 'Administrator')
    await expect(inviteGoogle(bot.row_id, 'bot@example.com', 'Administrator')).rejects.toMatchObject({
      type: 'ValidationError',
      message: 'Service accounts have no sign-in methods — issue an access token instead',
    })
    await expect(inviteGoogle('psn_nobody', 'nobody@example.com', 'Administrator')).rejects.toMatchObject({
      type: 'NotFoundError',
      message: 'Person psn_nobody not found',
    })
    expect(await sql`select 1 from sign_in_identity where person_id in (${bot.row_id}, 'psn_nobody')`).toHaveLength(0)
  })
})

describe('linked identity validation and lifecycle through the public APIs', () => {
  test('malformed Google sign-in expectations leave the person unchanged', async ({ admin }) => {
    const person = await admin.post<{ row_id: string; expects_google_sign_in: boolean }>('/api/table/Person', {
      full_name: 'Google expectation holder', email: 'expectation@example.com', enabled: true, expects_google_sign_in: true,
    })
    expect(person.expects_google_sign_in).toBe(true)
    await admin.post(`/api/people/${person.row_id}/identities`, {
      method: 'google', email: 'expectation@example.com', send_invitation_email: false,
    })
    const before = await sql`select * from person where row_id = ${person.row_id}`
    const identities = await sql`select * from sign_in_identity where person_id = ${person.row_id} order by id`
    expect(identities).toHaveLength(1)

    for (const [value, message] of [
      ['true', 'Expected boolean, received string'],
      [1, 'Expected boolean, received number'],
    ] as const) {
      const error = await expectApiError(patchDoc(admin, `/api/table/Person/${person.row_id}`, {
        updated_at: before[0].updated_at,
        full_name: 'Refused edit',
        expects_google_sign_in: value,
      }), {
        status: 417, type: 'ValidationError', message: '417 ValidationError: Invalid values for Person',
      })
      expect(error.fields).toEqual({ expects_google_sign_in: message })
      expect(await sql`select * from person where row_id = ${person.row_id}`).toEqual(before)
      expect(await sql`select * from sign_in_identity where person_id = ${person.row_id} order by id`).toEqual(identities)
    }
  })

  test('outside links require a known non-password method, a subject and a real person', async ({ admin }) => {
    const person = await makePerson()
    for (const method of ['missing-method', 'password']) {
      await expectApiError(admin.post(`/api/people/${person}/identities`, { method, subject: 'outside-id' }), {
        status: 417, type: 'ValidationError', message: `417 ValidationError: Unknown outside sign-in method "${method}"`,
      })
    }
    await expectApiError(admin.post(`/api/people/${person}/identities`, { method: 'google', subject: '   ' }), {
      status: 417, type: 'ValidationError', message: '417 ValidationError: Expected { subject }', fields: { subject: 'required' },
    })
    await expectApiError(admin.post('/api/people/psn_missing/identities', { method: 'google', subject: 'outside-id' }), {
      status: 404, type: 'NotFoundError', message: '404 NotFoundError: Person psn_missing not found',
    })
    expect(await listIdentities(person)).toEqual([])
    expect(await getSignInMethod('missing-method')).toBeNull()
    expect(await candidate('psn_missing')).toBeNull()
  })

  test('an outside link sent with no subject at all is refused naming the subject', async ({ admin }) => {
    const person = await makePerson()
    await expectApiError(admin.post(`/api/people/${person}/identities`, { method: 'google' }), {
      status: 417, type: 'ValidationError', fields: { subject: 'required' },
    })
  })

  test('a subject already held through a method with no label is named by the method\'s key', async ({ admin }) => {
    const owner = await makePerson()
    const other = await makePerson()
    await admin.post(`/api/people/${owner}/identities`, { method: 'google', subject: 'held-subject' })
    await sql`update sign_in_method set label = '' where row_id = 'google'`
    await expectApiError(admin.post(`/api/people/${other}/identities`, { method: 'google', subject: 'held-subject' }), {
      status: 409, type: 'ConflictError', message: `409 ConflictError: This google ID is already linked to ${owner}`,
    })
  })

  test('removing an unused Google method leaves no invitation mechanism', async ({ admin }) => {
    const person = await makePerson()
    await admin.delete('/api/table/Sign%20In%20Method/google')
    expect(await methodOfKind('google')).toBeNull()
    await expect(inviteGoogle(person, 'staff@example.com', 'Administrator')).rejects.toMatchObject({
      type: 'ValidationError', message: 'Google sign-in is not set up',
    })
    expect(await listIdentities(person)).toEqual([])
  })

  test('invitations validate addresses, fold repeat invitations and preserve the holder on a clash', async ({ admin }) => {
    const owner = await makePerson()
    const other = await makePerson()
    for (const email of ['', '  ', 'not-an-address']) {
      await expect(inviteGoogle(owner, email, 'Administrator')).rejects.toMatchObject({
        type: 'ValidationError', message: 'Expected { email }', fields: { email: 'a real address' },
      })
    }
    await expect(inviteGoogle(owner, 'staff@EXAMPLE.INVALID.', 'Administrator')).rejects.toMatchObject({
      type: 'ValidationError', message: 'That address cannot receive mail', fields: { email: 'not a real address (.invalid)' },
    })
    const first = await inviteGoogle(owner, ' Staff@Example.com ', 'Administrator')
    const original = await getIdentity(first.id)
    expect(first).toMatchObject({ created: true, pending_email: 'staff@example.com', subject: null })
    expect(await inviteGoogle(owner, 'STAFF@example.com', other)).toEqual({ ...original, created: false })
    await expectApiError(admin.post(`/api/people/${other}/identities`, {
      method: 'google', email: 'STAFF@example.com', send_invitation_email: false,
    }), {
      status: 409, type: 'ConflictError', message: `409 ConflictError: This invited address is already linked to ${owner}`,
      fields: { clash: 'invite', identity: first.id, person: owner },
    })
    expect(await getIdentity(first.id)).toEqual(original)
    expect(await listIdentities(other)).toEqual([])
    expect(await sql`select operation from activity_log where operation = ${`identity_invited google for ${owner} (${first.id})`}`).toHaveLength(1)
  })

  test('reposting a subject renames only its sign-in name, with blank and null names meaning none', async ({ admin }) => {
    const person = await makePerson()
    const first = await linkIdentity(person, {
      method: 'google', subject: ' permanent-id ', email: 'first@example.com', display_name: 'First name',
    }, 'Administrator')
    const original = await getIdentity(first.id)
    expect(first).toMatchObject({ created: true, subject: 'permanent-id', sign_in_name: null })
    expect(await linkIdentity(person, {
      method: 'google', subject: 'permanent-id', sign_in_name: '   ', email: 'ignored@example.com', display_name: 'Ignored',
    }, 'Administrator')).toEqual({ ...original, created: false })
    const httpOriginal = JSON.parse(JSON.stringify(original))
    const renamed = await admin.post(`/api/people/${person}/identities`, {
      method: 'google', subject: 'permanent-id', sign_in_name: ' New.Name ',
    })
    expect(renamed).toEqual({ ...httpOriginal, sign_in_name: 'New.Name' })
    expect(await patchDoc(admin, `/api/identities/${first.id}`, {})).toEqual(renamed)
    expect(await patchDoc(admin, `/api/identities/${first.id}`, { person_id: person, sign_in_name: null })).toEqual(httpOriginal)
    await patchDoc(admin, `/api/identities/${first.id}`, { sign_in_name: 'another' })
    expect(await patchDoc(admin, `/api/identities/${first.id}`, { sign_in_name: '  ' })).toEqual(httpOriginal)
    expect(await listIdentities(person)).toEqual([original])
  })

  test('a conflicting rename, including one during a move, rolls back both original links', async ({ admin }) => {
    const owner = await makePerson()
    const other = await makePerson()
    const first = await linkIdentity(owner, { method: 'google', subject: 'rename-owner', sign_in_name: 'held.name' }, 'Administrator')
    const second = await linkIdentity(other, { method: 'google', subject: 'rename-other', sign_in_name: 'other.name' }, 'Administrator')
    const originals = await Promise.all([getIdentity(first.id), getIdentity(second.id)])
    for (const change of [{ sign_in_name: 'HELD.NAME' }, { person_id: owner, sign_in_name: 'HELD.NAME' }]) {
      await expectApiError(patchDoc(admin, `/api/identities/${second.id}`, change), {
        status: 409, type: 'ConflictError', message: `409 ConflictError: This sign-in name is already linked to ${owner}`,
        fields: { clash: 'sign_in_name', identity: first.id, person: owner },
      })
      expect(await listIdentities(owner, { includeEnded: true })).toEqual([originals[0]])
      expect(await listIdentities(other, { includeEnded: true })).toEqual([originals[1]])
    }
    expect(await sql`select operation from activity_log where operation like ${`identity_moved %(${second.id})`}
      or operation like ${`identity_renamed %(${second.id})`}`).toEqual([])
  })

  test('only managers manage links, and self-removal cannot remove another person\'s link', async ({ admin, createUser }) => {
    const owner = await createUser()
    const other = await createUser()
    const linked = await linkIdentity(owner.user!, { method: 'google', subject: 'permission-owner' }, 'Administrator')
    const original = await getIdentity(linked.id)
    for (const request of [
      () => other.get(`/api/people/${owner.user}/identities`),
      () => other.post(`/api/people/${owner.user}/identities`, { method: 'google', subject: 'permission-new' }),
      () => patchDoc(other, `/api/identities/${linked.id}`, { person_id: other.user }),
      () => other.delete(`/api/identities/${linked.id}`),
    ]) {
      await expectApiError(request(), {
        status: 403, type: 'PermissionError', message: '403 PermissionError: Requires the System Manager role',
      })
    }
    await expectApiError(other.delete(`/api/me/identities/${linked.id}`), {
      status: 404, type: 'NotFoundError', message: `404 NotFoundError: Linked sign-in ${linked.id} not found`,
    })
    expect(await getIdentity(linked.id)).toEqual(original)
    expect(await listIdentities(other.user!)).toEqual([])
    await admin.delete(`/api/identities/${linked.id}`)
    const ended = await getIdentity(linked.id)
    expect(ended).toMatchObject({ ...original, ended_at: expect.any(Date), ended_reason: 'unlinked' })
    await expectApiError(patchDoc(admin, `/api/identities/${linked.id}`, { sign_in_name: 'cannot-revive' }), {
      status: 404, type: 'NotFoundError', message: `404 NotFoundError: Linked sign-in ${linked.id} not found`,
    })
    await expectApiError(owner.delete(`/api/me/identities/${linked.id}`), {
      status: 404, type: 'NotFoundError', message: `404 NotFoundError: Linked sign-in ${linked.id} not found`,
    })
    expect(await getIdentity(linked.id)).toEqual(ended)
  })

  test('a pending invitation moves without becoming a credential, and its holder can cancel it without another way in', async ({ admin, createUser }) => {
    const owner = await makePerson()
    const next = await createUser()
    const invite = await inviteGoogle(owner, 'move.pending@example.com', 'Administrator')
    const moved = await patchDoc<{ id: string }>(admin, `/api/identities/${invite.id}`, { person_id: next.user })
    expect(moved.id).not.toBe(invite.id)
    expect(await getIdentity(invite.id)).toMatchObject({ person_id: owner, subject: null, ended_reason: 'moved', ended_at: expect.any(Date) })
    expect(await getIdentity(moved.id)).toMatchObject({ person_id: next.user, subject: null, pending_email: 'move.pending@example.com', ended_at: null })
    expect(await next.delete(`/api/me/identities/${moved.id}`)).toEqual({ ok: true })
    await expect(getIdentity(moved.id)).rejects.toMatchObject({ type: 'NotFoundError', message: `Linked sign-in ${moved.id} not found` })
    expect(await listIdentities(next.user!, { includeEnded: true })).toEqual([])
    expect(await getIdentity(invite.id)).toMatchObject({ ended_reason: 'moved' })
  })

  test('provider email updates do not replace contact data without an active Google link and an old matching address', async ({ admin }) => {
    const googlePerson = await makePerson({ email: 'contact@example.com' })
    const google = await linkIdentity(googlePerson, { method: 'google', subject: 'no-old-address' }, 'Administrator')
    await touchIdentity(google.id, { email: 'provider@example.com', display_name: 'Provider Name' })
    expect(await getIdentity(google.id)).toMatchObject({ email: 'provider@example.com', display_name: 'Provider Name', last_used_at: expect.any(Date) })
    expect(await sql`select email from person where row_id = ${googlePerson}`).toEqual([{ email: 'contact@example.com' }])

    await configureDelegated()
    const delegatedPerson = await makePerson({ email: 'delegated.old@example.com' })
    const delegated = await linkIdentity(delegatedPerson, { method: 'stylehr', subject: 'email-probe', email: 'delegated.old@example.com' }, 'Administrator')
    await touchIdentity(delegated.id, { email: 'delegated.new@example.com' })
    expect(await getIdentity(delegated.id)).toMatchObject({ email: 'delegated.new@example.com' })
    expect(await sql`select email from person where row_id = ${delegatedPerson}`).toEqual([{ email: 'delegated.old@example.com' }])

    await admin.delete(`/api/identities/${google.id}`)
    await touchIdentity(google.id, { email: 'ended.new@example.com' })
    expect(await getIdentity(google.id)).toMatchObject({ email: 'ended.new@example.com', ended_reason: 'unlinked' })
    expect(await sql`select email from person where row_id = ${googlePerson}`).toEqual([{ email: 'contact@example.com' }])
  })

  test('leaver reports for missing or already disabled people are no-ops', async () => {
    const person = await makePerson({ enabled: false })
    const before = await sql`select * from person where row_id = ${person}`
    await disableLeaver('psn_missing', 'google')
    await disableLeaver(person, 'google')
    expect(await sql`select * from person where row_id = ${person}`).toEqual(before)
    expect(await sql`select operation from activity_log where "user" in (${person}, 'psn_missing') and operation like 'disabled_as_leaver%'`).toEqual([])
  })
})

// #833: the Person's Sign-in methods card starts a Google invite from the
// Person's own address, explains an expected Google sign-in, and says where an
// invitation went: "emailed" only when an SMTP server is set.
describe('#833: what the Sign-in methods card is told', () => {
  const read = (admin: TestClient, person: string) =>
    admin.get<{ email: string | null; expects_google_sign_in: boolean; mail_transport: string }>(`/api/people/${person}/identities`)
  const smtp = process.env.SMTP_HOST
  const port = process.env.SMTP_PORT
  afterEach(() => {
    for (const [k, v] of [['SMTP_HOST', smtp], ['SMTP_PORT', port]] as const) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  test('the Person\'s address and expected Google sign-in come with their sign-in methods', async ({ admin }) => {
    const person = await makePerson({ email: 'card.guest@gmail.com', expects_google_sign_in: true })
    expect(await read(admin, person)).toMatchObject({ email: 'card.guest@gmail.com', expects_google_sign_in: true })
    const none = await makePerson()
    expect(await read(admin, none)).toMatchObject({ email: null, expects_google_sign_in: false })
  })

  test('mail goes to the Email Sink with no SMTP server, and through SMTP when one is set, even a broken one', async ({ admin }) => {
    const person = await makePerson({ email: 'card.mail@gmail.com' })
    delete process.env.SMTP_HOST
    expect((await read(admin, person)).mail_transport).toBe('email_sink')
    process.env.SMTP_HOST = 'smtp.example.test'
    expect((await read(admin, person)).mail_transport).toBe('smtp')
    // A broken setting still counts as SMTP: the send itself then fails and
    // says so, rather than the card claiming the Email Sink.
    process.env.SMTP_PORT = 'not-a-port'
    expect((await read(admin, person)).mail_transport).toBe('smtp')
  })
})

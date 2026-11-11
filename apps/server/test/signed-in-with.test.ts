// #1176: the account menu says which sign-in THIS session was made with: the method's label and
// the identity used, from the session's own claims, never a list of every linked method.
// Made-up people, methods and IDs.
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { issueSession } from '../src/auth'
import { signedInWith } from '../src/signed-in-with'
import { makePerson } from './fixtures'

type Claims = Parameters<typeof signedInWith>[0]
const claims = (over: Partial<NonNullable<Claims>>): NonNullable<Claims> =>
  ({ expires_at: 0, method: null, identity: null, test_mode: false, preview: false, issued_at: 0, authenticated_at: 0, session_id: 's', ...over })

async function methods() {
  await sql`insert into sign_in_method (row_id, kind, label, enabled, new_person) values ('stylehr', 'delegated_password', 'StyleHR', true, 'refuse')
    on conflict (row_id) do update set label = excluded.label`
  await sql`insert into sign_in_method (row_id, kind, label, enabled, new_person) values ('google', 'google', 'Google', true, 'refuse')
    on conflict (row_id) do update set label = excluded.label`
}

describe('the sign-in this session was made with', () => {
  test('StyleHR: its label and the ID people type, never the internal record code', async () => {
    await methods()
    const person = await makePerson({ full_name: 'Made-up Reader', email: 'made.up.reader@example.com' })
    await sql`insert into sign_in_identity (id, person_id, method, subject, sign_in_name, linked_by)
      values ('uid_sihr', ${person}, 'stylehr', 'KL-RR-9001', 'RR-9001', 'test')`
    expect(await signedInWith(claims({ method: 'stylehr', identity: 'uid_sihr' }), person)).toEqual({ method: 'StyleHR', value: 'RR-9001' })
  })

  test("Google: its label and the Google account's email", async () => {
    await methods()
    const person = await makePerson({ full_name: 'Made-up Googler', email: 'made.up.person@example.com' })
    await sql`insert into sign_in_identity (id, person_id, method, subject, email, linked_by)
      values ('uid_sig', ${person}, 'google', 'g-made-up', 'made.up.google@example.com', 'test')`
    expect(await signedInWith(claims({ method: 'google', identity: 'uid_sig' }), person)).toEqual({ method: 'Google', value: 'made.up.google@example.com' })
  })

  test("email and password: 'email' and the account's email", async () => {
    const person = await makePerson({ full_name: 'Made-up Typist', email: 'made.up.typist@example.com' })
    const [password] = await sql`select row_id from sign_in_method where kind = 'password' limit 1`
    expect(await signedInWith(claims({ method: String(password.row_id) }), person)).toEqual({ method: 'email', value: 'made.up.typist@example.com' })
  })

  test('nothing is said for a session with no recorded sign-in, in test mode, as a preview, or naming another person\'s identity', async () => {
    await methods()
    const person = await makePerson({ full_name: 'Made-up Other', email: 'made.up.other@example.com' })
    const someoneElse = await makePerson({ full_name: 'Made-up Someone', email: 'made.up.someone@example.com' })
    await sql`insert into sign_in_identity (id, person_id, method, subject, sign_in_name, linked_by)
      values ('uid_other', ${someoneElse}, 'stylehr', 'KL-RR-9002', 'RR-9002', 'test')`
    expect(await Promise.all([
      signedInWith(undefined, person),
      signedInWith(claims({}), person),
      signedInWith(claims({ method: 'stylehr', identity: 'uid_other', test_mode: true }), person),
      signedInWith(claims({ method: 'stylehr', preview: true }), person),
      signedInWith(claims({ method: 'stylehr', identity: 'uid_other' }), person),
      signedInWith(claims({ method: 'no-such-method' }), person),
    ])).toEqual([null, null, null, null, null, null])
  })

  test('nothing is said when the method is known but the session names no identity, or the identity has no value', async () => {
    await methods()
    const [password] = await sql`select row_id from sign_in_method where kind = 'password' limit 1`
    const noEmail = await makePerson({ full_name: 'Made-up No Email' })
    await sql`insert into sign_in_identity (id, person_id, method, subject, linked_by)
      values ('uid_noemail_g', ${noEmail}, 'google', 'g-no-email', 'test')`
    expect(await Promise.all([
      signedInWith(claims({ method: 'stylehr' }), noEmail),
      signedInWith(claims({ method: String(password.row_id) }), noEmail),
      signedInWith(claims({ method: 'google', identity: 'uid_noemail_g' }), noEmail),
    ])).toEqual([null, null, null])
  })

  test('whoami carries it for the session', async ({ createUser }) => {
    await methods()
    const reader = await createUser({ email: 'whoami.signed.in@example.com', roles: [] })
    await sql`insert into sign_in_identity (id, person_id, method, subject, sign_in_name, linked_by)
      values ('uid_who', ${reader.user!}, 'stylehr', 'KL-RR-9003', 'RR-9003', 'test')`
    const issued = await issueSession(reader.user!, { method: 'stylehr', identity: 'uid_who' })
    const res = await reader.fetch('/api/whoami', { headers: { authorization: `Bearer ${issued.token}` } })
    expect(((await res.json()) as { signed_in_with: unknown }).signed_in_with).toEqual({ method: 'StyleHR', value: 'RR-9003' })
  })
})

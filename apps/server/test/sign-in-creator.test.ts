// #829: a Person a sign-in rule creates is recorded as created by that
// sign-in, not by Administrator, so the record says how it came to exist.
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { expectStatus, makePerson } from './fixtures'
import { configureGoogle } from './identity-fixtures'
import { completeSignIn } from '../src/sign-in'
import { methodOfKind } from '../src/identities'

const DOMAIN = 'staff.example.com'

async function firstGoogleSignIn(email: string, subject: string) {
  await configureGoogle({ client_id: 'real-client-id', allowed_email_domains: DOMAIN })
  const google = (await methodOfKind('google'))!
  const issued = await completeSignIn(
    google,
    { status: 'verified', subject, email, email_verified: true, display_name: 'New Starter', hosted_domain: DOMAIN },
    null,
    { testMode: true },
  )
  return issued.user.row_id
}

describe('who created a person', () => {
  test('a person a first Google sign-in creates is created by google-sign-in', async () => {
    const person = await firstGoogleSignIn(`starter@${DOMAIN}`, 'g-829-a')
    const [row] = await sql`select created_by, updated_by from person where row_id = ${person}`
    expect(row).toEqual({ created_by: 'google-sign-in', updated_by: 'google-sign-in' })
  })

  test('the sign-in actor is not a person and holds no role of its own', async () => {
    await firstGoogleSignIn(`second@${DOMAIN}`, 'g-829-b')
    const [role] = await sql`select 1 from has_role where parent = 'google-sign-in'`
    expect(role).toBeUndefined()
    const [person] = await sql`select 1 from person where row_id = 'google-sign-in'`
    expect(person).toBeUndefined()
  })

  test("the person's Activity starts with who created it", async ({ admin }) => {
    const signedUp = await firstGoogleSignIn(`third@${DOMAIN}`, 'g-829-c')
    const byHand = await makePerson({ full_name: 'Typed In' }, 'Administrator')
    const created = async (id: string) => {
      const res = await admin.fetch(`/api/activity/Person/${id}`)
      await expectStatus(res, 200)
      return ((await res.json()) as { created: { created_by: string; author_name: string; created_at: string } }).created
    }
    expect(await created(signedUp)).toMatchObject({ created_by: 'google-sign-in', author_name: 'Google sign-in' })
    expect(await created(byHand)).toMatchObject({ created_by: 'Administrator' })
  })

  test('a creator that is no person, service account or known sign-in reads as Unknown person', async ({ admin }) => {
    const row = await makePerson({ full_name: 'From an old import' }, 'Administrator')
    await sql`update person set created_by = 'old-importer' where row_id = ${row}`
    const body = (await (await admin.fetch(`/api/activity/Person/${row}`)).json()) as { created: { created_by: string; author_name: string } }
    expect(body.created).toMatchObject({ created_by: 'old-importer', author_name: 'Unknown person' })
  })
})

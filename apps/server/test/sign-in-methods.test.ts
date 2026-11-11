// person-identities (D2, review M5): Sign In Method rows are configuration,
// checked against what each kind can vouch for, and no change may lock an
// Administrator or System Manager out.
import { describe, expect, vi } from 'vitest'
import { getSignInMethod, methodUsable } from '../src/identities'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { expectStatus, makePerson } from './fixtures'
import { configureDelegated, linkDelegated } from './identity-fixtures'

const save = (admin: TestClient, row: Record<string, unknown>) =>
  admin.fetch('/api/save_row', { method: 'POST', body: JSON.stringify({ table: 'Sign In Method', row }) })

async function patchMethod(admin: TestClient, key: string, change: Record<string, unknown>) {
  const [r] = await sql`select updated_at from sign_in_method where row_id = ${key}`
  return admin.fetch(`/api/table/${encodeURIComponent('Sign In Method')}/${key}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...change, updated_at: r.updated_at }),
  })
}

describe('Sign In Method rows', () => {
  test('the upgrade leaves password and Google rows that reproduce today', async () => {
    const rows = await sql`select row_id, kind, enabled, new_person from sign_in_method where row_id in ('password', 'google') order by row_id`
    expect(rows).toEqual([
      { row_id: 'google', kind: 'google', enabled: true, new_person: 'create_if_email_domain_allowed' },
      { row_id: 'password', kind: 'password', enabled: true, new_person: 'refuse' },
    ])
  })

  test('a policy the kind cannot vouch for is refused', async ({ admin }) => {
    const cases: Record<string, unknown>[] = [
      { row_id: 'hr_create', kind: 'delegated_password', label: 'HR', new_person: 'create' },
      { row_id: 'hr_self', kind: 'delegated_password', label: 'HR', self_link: true },
      { row_id: 'hr_domain', kind: 'delegated_password', label: 'HR', new_person: 'create_if_email_domain_allowed' },
    ]
    for (const row of cases) expect((await save(admin, row)).status, String(row.row_id)).toBe(417)
    await expectStatus(await patchMethod(admin, 'password', { new_person: 'create_if_email_domain_allowed' }), 417)
    await expectStatus(await patchMethod(admin, 'password', { kind: 'google' }), 417)
    await expectStatus(await save(admin, { row_id: 'password2', kind: 'password', label: 'Again' }), 409)
  })

  test('the password method cannot be deleted, and a method in use cannot be deleted', async ({ admin }) => {
    expect((await admin.fetch(`/api/table/${encodeURIComponent('Sign In Method')}/password`, { method: 'DELETE' })).ok).toBe(false)
    await configureDelegated()
    const rrDel = await makePerson({})
    await linkDelegated(rrDel, 'rr_del')
    await expectStatus(await admin.fetch(`/api/table/${encodeURIComponent('Sign In Method')}/stylehr`, { method: 'DELETE' }), 409)
    expect(await sql`select 1 from sign_in_method where row_id = 'stylehr'`).toHaveLength(1)
  })

  test('with the Google method deleted, a Google method can be added again', async ({ admin }) => {
    await expectStatus(await admin.fetch(`/api/table/${encodeURIComponent('Sign In Method')}/google`, { method: 'DELETE' }), 200)
    await expectStatus(await save(admin, { row_id: 'google_again', kind: 'google', label: 'Google' }), 201)
    expect(await sql`select row_id from sign_in_method where kind = 'google'`).toEqual([{ row_id: 'google_again' }])
  })

  test('turning a method off is refused while it is an administrator\'s only way in', async ({ admin }) => {
    const smg = await makePerson({ username: 'sm.google', roles: [{ role: 'System Manager' }] })
    await sql`insert into sign_in_identity (id, person_id, method, subject, linked_by) values ('uid_smg', ${smg}, 'google', 'g-sm', 'test')`
    const refused = await patchMethod(admin, 'google', { enabled: false })
    await expectStatus(refused, 417)
    expect(((await refused.json()) as { error: { message: string } }).error.message).toContain(smg)
    // Give them a password and the same change is allowed.
    await admin.post('/api/set_password', { user: smg, password: 'sm-google-pw' })
    await expectStatus(await patchMethod(admin, 'google', { enabled: false }), 200)
  })

  test('passwords cannot be turned off while the Administrator signs in only with one', async ({ admin }) => {
    await sql`update person set password_hash = coalesce(password_hash, 'x:y') where row_id = 'Administrator'`
    await sql`delete from sign_in_identity where person_id = 'Administrator'`
    const res = await patchMethod(admin, 'password', { enabled: false })
    await expectStatus(res, 417)
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain('Administrator')
  })
})

describe('a sign-in method row with fields left empty', () => {
  test('reads a missing label as blank', async () => {
    await sql`update sign_in_method set label = null where row_id = 'google'`
    expect((await getSignInMethod('google'))!.label).toBe('')
  })

  test('reads a missing new-person rule as refuse', async () => {
    await sql`update sign_in_method set new_person = null where row_id = 'google'`
    expect((await getSignInMethod('google'))!.new_person).toBe('refuse')
  })

  test('reads a blank new-person rule as refuse', async () => {
    await sql`update sign_in_method set new_person = '' where row_id = 'google'`
    expect((await getSignInMethod('google'))!.new_person).toBe('refuse')
  })

  test('a new-person rule cleared by an edit is read as refuse', async ({ admin }) => {
    await expectStatus(await patchMethod(admin, 'google', { new_person: null }), 200)
    expect((await getSignInMethod('google'))!.new_person).toBe('refuse')
  })

  test('a method stored with no new-person rule can still be edited', async ({ admin }) => {
    await sql`update sign_in_method set new_person = null where row_id = 'google'`
    await expectStatus(await patchMethod(admin, 'google', { label: 'Google Workspace' }), 200)
    expect((await getSignInMethod('google'))!.label).toBe('Google Workspace')
  })

  test('a connected service with no address is refused while it is on', async ({ admin }) => {
    const res = await save(admin, { row_id: 'hr_bare', kind: 'delegated_password', label: 'HR' })
    await expectStatus(res, 417)
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain('needs an https address')
  })

  test('Google with no client id at all is not usable without the mock provider', () => {
    vi.stubEnv('ALLOW_MOCK_OAUTH', '')
    try {
      expect(methodUsable({ kind: 'google', enabled: true })).toBe(false)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

// person-identities (D2, review M5): Sign In Method rows are configuration,
// checked against what each kind can vouch for, and no change may lock an
// Administrator or System Manager out.
import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
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
    expect((await patchMethod(admin, 'password', { new_person: 'create_if_email_domain_allowed' })).status).toBe(417)
    expect((await patchMethod(admin, 'password', { kind: 'google' })).status).toBe(417)
    expect((await save(admin, { row_id: 'password2', kind: 'password', label: 'Again' })).status).toBe(409)
  })

  test('the password method cannot be deleted, and a method in use cannot be deleted', async ({ admin }) => {
    expect((await admin.fetch(`/api/table/${encodeURIComponent('Sign In Method')}/password`, { method: 'DELETE' })).ok).toBe(false)
    await configureDelegated()
    await saveDoc('User', { row_id: 'RR-del', enabled: true }, 'Administrator')
    await linkDelegated('RR-del', 'rr_del')
    expect((await admin.fetch(`/api/table/${encodeURIComponent('Sign In Method')}/stylehr`, { method: 'DELETE' })).status).toBe(409)
    expect(await sql`select 1 from sign_in_method where row_id = 'stylehr'`).toHaveLength(1)
  })

  test('turning a method off is refused while it is an administrator\'s only way in', async ({ admin }) => {
    await saveDoc('User', { row_id: 'sm.google', enabled: true, roles: [{ role: 'System Manager' }] }, 'Administrator')
    await sql`insert into user_identity (id, user_id, method, subject, linked_by) values ('uid_smg', 'sm.google', 'google', 'g-sm', 'test')`
    const refused = await patchMethod(admin, 'google', { enabled: false })
    expect(refused.status).toBe(417)
    expect(((await refused.json()) as { error: { message: string } }).error.message).toContain('sm.google')
    // Give them a password and the same change is allowed.
    await admin.post('/api/set_password', { user: 'sm.google', password: 'sm-google-pw' })
    expect((await patchMethod(admin, 'google', { enabled: false })).status).toBe(200)
  })

  test('passwords cannot be turned off while the Administrator signs in only with one', async ({ admin }) => {
    await sql`update "user" set password_hash = coalesce(password_hash, 'x:y') where row_id = 'Administrator'`
    await sql`delete from user_identity where user_id = 'Administrator'`
    const res = await patchMethod(admin, 'password', { enabled: false })
    expect(res.status).toBe(417)
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain('Administrator')
  })
})

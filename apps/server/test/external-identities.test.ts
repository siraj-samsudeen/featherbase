import { expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { test } from './pg-test'
import { sql } from '../src/db'
import { getDoc, saveDoc } from '../src/document'
import { issueExternalSession as sessionFromProof, resolveToken } from '../src/auth'

const issueExternalSession = (provider: string, issuer: string, subject: string, time: Date | null) =>
  sessionFromProof(provider, issuer, subject, time, new Date())

async function seedIdentities() {
  await saveDoc('User', { row_id: 'person-a', full_name: 'Person A' })
  await saveDoc('User', { row_id: 'person-b', full_name: 'Person B' })
  await sql`update "user" set native_login_enabled = false where row_id in ('person-a', 'person-b')`
  await sql`insert into login_provider (id, kind, issuer, client_id, enabled) values
    ('google-test', 'google', 'https://accounts.google.com', 'synthetic-google-client', true),
    ('microsoft-test', 'microsoft', 'https://login.microsoftonline.com/common/v2.0', 'synthetic-ms-client', true)`
  await sql`insert into external_identity (id, user_id, provider_id, issuer, subject, email) values
    ('identity-a', 'person-a', 'google-test', 'https://accounts.google.com', 'Subject-A', 'shared@example.test'),
    ('identity-b', 'person-b', 'microsoft-test', 'https://login.microsoftonline.com/tenant-a/v2.0', 'Subject-A', 'shared@example.test'),
    ('identity-c', 'person-a', 'microsoft-test', 'https://login.microsoftonline.com/tenant-b/v2.0', 'Subject-C', null)`
}

// @spec external_identity_ownership_is_subject_based
test('different people and providers stay distinct despite matching email and subject text; missing email is allowed', async () => {
  await seedIdentities()
  const google = await issueExternalSession('google-test', 'https://accounts.google.com', 'Subject-A', null)
  const microsoft = await issueExternalSession('microsoft-test', 'https://login.microsoftonline.com/tenant-a/v2.0', 'Subject-A', null)
  expect(google.user).toMatchObject({ row_id: 'person-a', email: null })
  expect(microsoft.user.row_id).toBe('person-b')
  await sql`update external_identity set email = 'changed@example.test', email_verified = true where id = 'identity-a'`
  expect((await issueExternalSession('google-test', 'https://accounts.google.com', 'Subject-A', null)).user.row_id).toBe('person-a')
  await expect(issueExternalSession('google-test', 'https://accounts.google.com', 'subject-a', null)).rejects.toMatchObject({ type: 'AuthenticationError' })
  await expect(issueExternalSession('google-test', 'https://accounts.google.com', 'Changed-Subject', null)).rejects.toMatchObject({ type: 'AuthenticationError' })
  await expect(issueExternalSession('microsoft-test', 'https://login.microsoftonline.com/tenant-b/v2.0', 'Subject-A', null)).rejects.toMatchObject({ type: 'AuthenticationError' })
})

// @spec login_sessions_are_revocable_on_every_use
test('provider disable and unlink revoke dependent sessions without revoking another linked method', async () => {
  await seedIdentities()
  const google = await issueExternalSession('google-test', 'https://accounts.google.com', 'Subject-A', null)
  const microsoft = await issueExternalSession('microsoft-test', 'https://login.microsoftonline.com/tenant-b/v2.0', 'Subject-C', null)
  await sql`update login_provider set enabled = false where id = 'google-test'`
  await sql`update login_provider set enabled = true where id = 'google-test'`
  await expect(resolveToken(`Bearer ${google.token}`)).rejects.toMatchObject({ type: 'AuthenticationError' })
  expect((await resolveToken(`Bearer ${microsoft.token}`)).row_id).toBe('person-a')
  await sql`update external_identity set revoked_at = clock_timestamp() where id = 'identity-c'`
  await sql`update external_identity set revoked_at = null where id = 'identity-c'`
  await expect(resolveToken(`Bearer ${microsoft.token}`)).rejects.toMatchObject({ type: 'AuthenticationError' })
})

// @spec provider_configuration_is_an_authentication_boundary
test('a provider namespace cannot change after binding and StyleHR cannot be enabled', async () => {
  await seedIdentities()
  await expect(sql.begin(async (tx) => {
    await tx`update login_provider set client_id = 'other-client' where id = 'google-test'`
  })).rejects.toThrow()
  await expect(sql.begin(async (tx) => {
    await tx`insert into login_provider (id, kind, issuer, client_id, enabled) values ('stylehr', 'stylehr', 'stylehr', '', true)`
  })).rejects.toThrow()
})

// @spec external_identity_ownership_is_subject_based
test('identity and session infrastructure cannot be exposed by generic metadata APIs', async ({ admin }) => {
  for (const name of ['Login Provider', 'External Identity', 'Login Session']) {
    expect((await admin.fetch(`/api/table/${encodeURIComponent(name)}`)).status).toBe(404)
    await expect(admin.post('/api/table_def', { name, columns: [] })).rejects.toMatchObject({ status: 417 })
  }
  await seedIdentities()
  const loaded = await getDoc('User', 'person-a')
  await expect(saveDoc('User', { ...loaded, native_login_enabled: true, auth_generation: 0 }))
    .rejects.toMatchObject({ type: 'ValidationError', message: 'Unknown fields: native_login_enabled, auth_generation' })
  const [user] = await sql`select native_login_enabled from "user" where row_id = 'person-a'`
  expect(user.native_login_enabled).toBe(false)
})

// @spec login_sessions_are_revocable_on_every_use
test('whole-User offboarding stops every linked provider without affecting another person', async () => {
  await seedIdentities()
  const a = await issueExternalSession('google-test', 'https://accounts.google.com', 'Subject-A', null)
  const b = await issueExternalSession('microsoft-test', 'https://login.microsoftonline.com/tenant-b/v2.0', 'Subject-C', null)
  const other = await issueExternalSession('microsoft-test', 'https://login.microsoftonline.com/tenant-a/v2.0', 'Subject-A', null)
  await sql`update "user" set enabled = false where row_id = 'person-a'`
  await expect(issueExternalSession('google-test', 'https://accounts.google.com', 'Subject-A', null)).rejects.toMatchObject({ type: 'AuthenticationError' })
  await sql`update "user" set enabled = true where row_id = 'person-a'`
  for (const session of [a, b]) await expect(resolveToken(`Bearer ${session.token}`)).rejects.toMatchObject({ type: 'AuthenticationError' })
  expect((await resolveToken(`Bearer ${other.token}`)).row_id).toBe('person-b')
})

// @spec login_sessions_are_revocable_on_every_use
test('anonymous proofs begun before User disable or identity unlink cannot survive re-enable', async () => {
  await seedIdentities()
  const begun = new Date(Date.now() - 1000)
  await sql`update "user" set enabled = false where row_id = 'person-a'`
  await sql`update "user" set enabled = true where row_id = 'person-a'`
  await expect(sessionFromProof('google-test', 'https://accounts.google.com', 'Subject-A', null, begun))
    .rejects.toMatchObject({ type: 'AuthenticationError' })
  await sql`update external_identity set revoked_at = clock_timestamp() where id = 'identity-b'`
  await sql`update external_identity set revoked_at = null where id = 'identity-b'`
  await expect(sessionFromProof('microsoft-test', 'https://login.microsoftonline.com/tenant-a/v2.0', 'Subject-A', null, begun))
    .rejects.toMatchObject({ type: 'AuthenticationError' })
})

// @spec external_enrollment_requires_explicit_authority
test('legacy configuration migration preserves the OAuth client but never invents subject ownership', async () => {
  await saveDoc('User', { row_id: 'legacy-google-person', email: 'legacy@example.test', full_name: 'Legacy Person' })
  await sql`alter table "user" add column if not exists social_login text`
  await sql`update "user" set social_login = 'google', identity_enrolled = true where row_id = 'legacy-google-person'`
  await sql`insert into single_value (table_name, field, value) values
    ('System Settings', 'google_client_id', 'legacy-client'),
    ('System Settings', 'allowed_login_domains', 'example.test')
    on conflict (table_name, field) do update set value = excluded.value`
  const migration = readFileSync(new URL('../migrations/0104_retire_email_login.sql', import.meta.url), 'utf8')
  await sql.unsafe(migration)
  expect(await sql`select kind, issuer, client_id, enabled from login_provider where client_id = 'legacy-client'`)
    .toEqual([{ kind: 'google', issuer: 'https://accounts.google.com', client_id: 'legacy-client', enabled: true }])
  expect(await sql`select id from external_identity where user_id = 'legacy-google-person'`).toEqual([])
  expect(await sql`select row_id, email, identity_enrolled from "user" where row_id = 'legacy-google-person'`)
    .toEqual([{ row_id: 'legacy-google-person', email: 'legacy@example.test', identity_enrolled: true }])
  expect(await sql`select column_name from column_def where (parent = 'User' and column_name = 'social_login')
    or (parent = 'System Settings' and column_name in ('google_client_id', 'allowed_login_domains'))`).toEqual([])
  expect(await sql`select field from single_value where table_name = 'System Settings'
    and field in ('google_client_id', 'allowed_login_domains')`).toEqual([])
})

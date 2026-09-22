import { expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { getDoc, saveDoc } from '../src/document'
import { issueExternalSession, resolveToken } from '../src/auth'

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

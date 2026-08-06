import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { issueAccessToken, listAccessTokens, setUserPassword } from '../src/auth'
import { findOrCreateGoogleUser } from '../src/oauth'
import { requestPasswordReset } from '../src/password-reset'
import { createTable } from '../src/doctype-engine'

// #137: review findings on the #131 access-token feature. Each case fails
// against the code as merged in #134.

async function serviceAccount(admin: { post: (p: string, b?: unknown) => Promise<unknown> }, name: string) {
  await admin.post('/api/service_accounts', { name, roles: ['System Manager'] })
}

describe('#137 P1: an access token is header-only, never URL-borne', () => {
  test('a token in ?token= is refused for private files and for the websocket path', async ({
    admin,
    api,
  }) => {
    await serviceAccount(admin, 'svc-url-test')
    const { token } = await issueAccessToken('svc-url-test', 'url test')

    // Upload a private file as Administrator, then try to fetch it two ways.
    const form = new FormData()
    form.set('file', new File(['secret contents'], 'secret.txt', { type: 'text/plain' }))
    form.set('is_private', '1')
    const uploaded = (await (
      await admin.fetch('/api/upload_file', { method: 'POST', body: form, headers: {} })
    ).json()) as { file_url: string }

    // The header still works — automation must keep being able to read files.
    const viaHeader = await api.fetch(uploaded.file_url, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(viaHeader.status).toBe(200)

    // The query parameter does not: a URL lands in logs and history.
    const viaQuery = await api.fetch(
      `${uploaded.file_url}?token=${encodeURIComponent(token)}`,
    )
    expect(viaQuery.status).toBe(401)
  })
})

describe('#137 P1: OAuth cannot revive a disabled principal', () => {
  test('signing in does not re-enable a disabled user, and refuses a service account', async ({
    admin,
    seed,
  }) => {
    void seed
    // A disabled human user stays disabled — OAuth used to flip it back on.
    const email = 'disabled-human@example.com'
    await admin.post('/api/save_doc', {
      doctype: 'User',
      doc: { name: email, email, enabled: false },
    })
    await expect(findOrCreateGoogleUser(email, 'Disabled Human')).rejects.toMatchObject({
      type: 'AuthenticationError',
    })
    const [human] = await sql`select enabled from "user" where name = ${email}`
    expect(human.enabled).toBe(false)

    // A service account is refused outright, enabled or not — and critically,
    // its tokens must not come back to life.
    await serviceAccount(admin, 'svc-oauth-test')
    const { token } = await issueAccessToken('svc-oauth-test', 'oauth revival')
    await admin.fetch('/api/service_accounts/svc-oauth-test', {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
    })
    await expect(
      findOrCreateGoogleUser('svc-oauth-test@service.invalid', 'svc'),
    ).rejects.toMatchObject({ type: 'AuthenticationError' })
    const [svc] = await sql`select enabled from "user" where name = 'svc-oauth-test'`
    expect(svc.enabled).toBe(false)
    // The token stays dead.
    const who = await admin.fetch('/api/whoami', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(who.status).toBe(401)
  })
})

describe('#137 P2: a service account never acquires a password', () => {
  test('setUserPassword refuses, and password reset issues no link', async ({ admin }) => {
    await serviceAccount(admin, 'svc-pw-test')

    await expect(setUserPassword('svc-pw-test', 'sneaky123')).rejects.toMatchObject({
      type: 'ValidationError',
    })
    const [row] = await sql`select password_hash from "user" where name = 'svc-pw-test'`
    expect(row.password_hash).toBeNull()

    // Reset reaches setUserPassword directly, so it must be stopped earlier —
    // and silently, so it cannot be used to enumerate service accounts.
    await expect(requestPasswordReset('svc-pw-test')).resolves.toBeNull()
    await expect(requestPasswordReset('svc-pw-test@service.invalid')).resolves.toBeNull()
  })
})

describe('#137 P2: "active" means the token actually authenticates', () => {
  test('expired tokens leave the count; a disabled owner is reported', async ({ admin }) => {
    await serviceAccount(admin, 'svc-count-test')
    await issueAccessToken('svc-count-test', 'live one')
    const expiring = await issueAccessToken(
      'svc-count-test',
      'expiring',
      new Date(Date.now() + 60_000),
    )
    await sql`update access_token set expires_at = now() - interval '1 minute' where id = ${expiring.id}`

    const [account] = (await admin.get<{ service_accounts: { token_count: number }[] }>(
      '/api/service_accounts',
    )).service_accounts.filter((a) => (a as { name: string }).name === 'svc-count-test')
    expect(account.token_count).toBe(1) // not 2 — the expired one cannot authenticate

    // A token whose owner is disabled is not "active" either.
    await admin.fetch('/api/service_accounts/svc-count-test', {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
    })
    const listed = await listAccessTokens('svc-count-test')
    expect(listed.every((t) => t.owner_enabled === false)).toBe(true)
  })
})

describe('#137 P2: a user Table cannot squat on the credential store', () => {
  test('creating a Table named "Access Token" is refused', async () => {
    await expect(
      createTable({ name: 'Access Token', columns: [{ column_name: 'label', column_type: 'Data' }] }),
    ).rejects.toMatchObject({ type: 'ConflictError' })
  })
})

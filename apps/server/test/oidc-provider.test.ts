import { expect } from 'vitest'
import { test } from './pg-test'
import { issuer } from './oidc-issuer'
import { sql } from '../src/db'
import { hostedAuthorization, verifyHostedCode } from '../src/hosted-providers'
import { beginHostedLogin, beginIdentityLink, completeHostedOperation, redeemLoginHandoff, unlinkIdentity,
  provisionExternalUser, issueIdentityInvitation, beginInvitedLogin, approveIdentityRecovery, beginIdentityReauthentication } from '../src/login-operations'
import { saveDoc } from '../src/document'
import { login, resolveToken, revokeSession } from '../src/auth'

async function finishHostedLogin(...args: Parameters<typeof completeHostedOperation>) {
  const result = await completeHostedOperation(...args)
  if (result.kind !== 'session') throw new Error('Expected an authenticated session, not pending recovery')
  return result
}

// @spec hosted_login_validates_subject_and_browser_operation
test('hosted proof requires signature, issuer, audience, nonce, expiry, PKCE and single-use code', async () => {
  const upstream = await issuer()
  try {
    await sql`insert into login_provider (id, kind, issuer, client_id, enabled)
      values ('google-oidc', 'google', 'https://accounts.google.com', 'test-client', true)`
    const challenge = { state: 'synthetic-state', nonce: 'synthetic-nonce', verifier: 'x'.repeat(43), redirectUri: 'http://localhost/callback' }
    const url = await hostedAuthorization('google-oidc', challenge)
    expect(url.origin).toBe('https://accounts.google.com')
    expect(url.searchParams.get('scope')).toBe('openid profile email')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    const callback = (code: string) => new URL(`${challenge.redirectUri}?code=${code}&state=${challenge.state}`)
    const code = upstream.code(url)
    const proof = await verifyHostedCode('google-oidc', callback(code), challenge)
    expect(proof).toMatchObject({ issuer: 'https://accounts.google.com', subject: 'subject-one', authenticatedAt: null })
    expect(JSON.stringify(proof)).not.toContain('SENTINEL_ACCESS_TOKEN')
    await expect(verifyHostedCode('google-oidc', callback(code), challenge)).rejects.toMatchObject({ type: 'AuthenticationError' })
    for (const claims of [{ iss: 'https://attacker.example' }, { aud: 'wrong-client' }, { nonce: 'wrong-nonce' }, { exp: 1 }]) {
      upstream.setClaims(claims)
      await expect(verifyHostedCode('google-oidc', callback(upstream.code(url)), challenge)).rejects.toMatchObject({ type: 'AuthenticationError' })
    }
    upstream.setClaims({}, true)
    await expect(verifyHostedCode('google-oidc', callback(upstream.code(url)), challenge)).rejects.toMatchObject({ type: 'AuthenticationError' })
    upstream.setClaims({})
    await expect(verifyHostedCode('google-oidc', callback(upstream.code(url)), { ...challenge, verifier: 'y'.repeat(43) })).rejects.toMatchObject({ type: 'AuthenticationError' })
    const before = upstream.exchanges
    await sql`update login_provider set enabled = false where id = 'google-oidc'`
    await expect(verifyHostedCode('google-oidc', callback(upstream.code(url)), challenge)).rejects.toMatchObject({ type: 'AuthenticationError' })
    expect(upstream.exchanges).toBe(before)
  } finally { await upstream.close() }
})

// @spec session_handoff_is_bound_one_use_and_revocation_aware
test('durable browser operation and handoff preserve the exact destination and current revocation authority', async () => {
  const upstream = await issuer()
  try {
    await saveDoc('User', { row_id: 'hosted-person', full_name: 'Hosted Person' })
    await sql`insert into login_provider (id, kind, issuer, client_id, enabled)
      values ('google-oidc', 'google', 'https://accounts.google.com', 'test-client', true)`
    await sql`insert into external_identity (id, user_id, provider_id, issuer, subject)
      values ('hosted-identity', 'hosted-person', 'google-oidc', 'https://accounts.google.com', 'subject-one')`
    const returnTo = '/tasker/?label=a%2Fb&label=c#task-17'
    const operation = await beginHostedLogin('google-oidc', 'http://localhost/callback', returnTo)
    const callback = new URL(`http://localhost/callback?state=${operation.state}&code=${upstream.code(operation.authorizationUrl)}`)
    await expect(finishHostedLogin(callback, 'another-browser').then(() => null)).rejects.toMatchObject({ type: 'AuthenticationError' })
    const result = await finishHostedLogin(callback, operation.browserSecret)
    expect((await resolveToken(`Bearer ${result.session.token}`)).row_id).toBe('hosted-person')
    await expect(finishHostedLogin(callback, operation.browserSecret).then(() => null)).rejects.toMatchObject({ type: 'AuthenticationError' })
    await expect(redeemLoginHandoff(result.handoff, 'another-session').then(() => null)).rejects.toMatchObject({ type: 'AuthenticationError' })
    const handed = await redeemLoginHandoff(result.handoff, result.session.token)
    expect(handed.returnTo).toBe(returnTo)
    expect(handed.user.row_id).toBe('hosted-person')
    await expect(redeemLoginHandoff(result.handoff, result.session.token).then(() => null)).rejects.toMatchObject({ type: 'AuthenticationError' })

    const pending = await beginHostedLogin('google-oidc', 'http://localhost/callback', returnTo)
    const completed = await finishHostedLogin(new URL(`http://localhost/callback?state=${pending.state}&code=${upstream.code(pending.authorizationUrl)}`), pending.browserSecret)
    await sql`update "user" set enabled = false where row_id = 'hosted-person'`
    await expect(redeemLoginHandoff(completed.handoff, completed.session.token).then(() => null)).rejects.toMatchObject({ type: 'AuthenticationError' })
  } finally { await upstream.close() }
})

// @spec identity_linking_requires_two_bound_proofs
test('link requires recent source proof, binds the original session and refuses collisions without email merging', async () => {
  const upstream = await issuer()
  try {
    await sql`insert into login_provider (id, kind, issuer, client_id, enabled)
      values ('google-oidc', 'google', 'https://accounts.google.com', 'test-client', true)`
    const source = await login('Administrator', process.env.ADMIN_PASSWORD ?? 'admin')
    const operation = await beginIdentityLink(`Bearer ${source.token}`, 'google-oidc', 'http://localhost/callback')
    const callback = new URL(`http://localhost/callback?state=${operation.state}&code=${upstream.code(operation.authorizationUrl)}`)
    const unrelated = await login('Administrator', process.env.ADMIN_PASSWORD ?? 'admin')
    await expect(finishHostedLogin(callback, operation.browserSecret, unrelated.token).then(() => null))
      .rejects.toMatchObject({ type: 'AuthenticationError' })
    const restarted = await beginIdentityLink(`Bearer ${source.token}`, 'google-oidc', 'http://localhost/callback')
    const linked = await finishHostedLogin(new URL(`http://localhost/callback?state=${restarted.state}&code=${upstream.code(restarted.authorizationUrl)}`), restarted.browserSecret, source.token)
    expect(linked.session.user.row_id).toBe('Administrator')
    // Missing Google auth_time does not block ordinary login, but cannot authorize linking.
    await expect(beginIdentityLink(`Bearer ${linked.session.token}`, 'google-oidc', 'http://localhost/callback').then(() => null))
      .rejects.toMatchObject({ type: 'PermissionError' })

    await saveDoc('User', { row_id: 'different-person', full_name: 'Different Person' })
    await sql`insert into external_identity (id, user_id, provider_id, issuer, subject)
      values ('occupied-identity', 'different-person', 'google-oidc', 'https://accounts.google.com', 'occupied-subject')`
    upstream.setClaims({ sub: 'occupied-subject' })
    const collision = await beginIdentityLink(`Bearer ${source.token}`, 'google-oidc', 'http://localhost/callback')
    await expect(finishHostedLogin(new URL(`http://localhost/callback?state=${collision.state}&code=${upstream.code(collision.authorizationUrl)}`), collision.browserSecret, source.token).then(() => null))
      .rejects.toMatchObject({ type: 'ConflictError' })
    const [owner] = await sql`select user_id from external_identity where subject = 'occupied-subject'`
    expect(owner.user_id).toBe('different-person')

    const revoked = await beginIdentityLink(`Bearer ${source.token}`, 'google-oidc', 'http://localhost/callback')
    await revokeSession(`Bearer ${source.token}`)
    await expect(finishHostedLogin(new URL(`http://localhost/callback?state=${revoked.state}&code=${upstream.code(revoked.authorizationUrl)}`), revoked.browserSecret, source.token).then(() => null))
      .rejects.toMatchObject({ type: 'AuthenticationError' })
  } finally { await upstream.close() }
})

// @spec identity_unlink_and_recovery_preserve_account_control
test('unlink retains ownership, revokes the removed method and refuses the last available method', async () => {
  const upstream = await issuer()
  try {
    await saveDoc('User', { row_id: 'external-only', full_name: 'External Only' })
    await sql`update "user" set native_login_enabled = false where row_id = 'external-only'`
    await sql`insert into login_provider (id, kind, issuer, client_id, enabled)
      values ('google-oidc', 'google', 'https://accounts.google.com', 'test-client', true)`
    await sql`insert into external_identity (id, user_id, provider_id, issuer, subject)
      values ('only-identity', 'external-only', 'google-oidc', 'https://accounts.google.com', 'subject-one')`
    upstream.setClaims({ auth_time: Math.floor(Date.now() / 1000) })
    const operation = await beginHostedLogin('google-oidc', 'http://localhost/callback')
    const current = await finishHostedLogin(new URL(`http://localhost/callback?state=${operation.state}&code=${upstream.code(operation.authorizationUrl)}`), operation.browserSecret)
    await expect(unlinkIdentity(`Bearer ${current.session.token}`, 'only-identity')).rejects.toMatchObject({ type: 'ValidationError' })
    await sql`insert into external_identity (id, user_id, provider_id, issuer, subject)
      values ('replacement-identity', 'external-only', 'google-oidc', 'https://accounts.google.com', 'subject-two')`
    await unlinkIdentity(`Bearer ${current.session.token}`, 'only-identity')
    await expect(resolveToken(`Bearer ${current.session.token}`)).rejects.toMatchObject({ type: 'AuthenticationError' })
    const [tombstone] = await sql`select user_id, revoked_at is not null as revoked from external_identity where id = 'only-identity'`
    expect(tombstone).toMatchObject({ user_id: 'external-only', revoked: true })
  } finally { await upstream.close() }
})

// @spec external_enrollment_requires_explicit_authority
// @spec identity_linking_requires_two_bound_proofs.one_person_uses_three_google_identities_for_the_same_tasker_work
test('one admitted User enrolls a personal identity and explicitly links two Workspace identities', async () => {
  const upstream = await issuer()
  try {
    await sql`insert into login_provider (id, kind, issuer, client_id, enabled)
      values ('google-oidc', 'google', 'https://accounts.google.com', 'test-client', true)`
    const operator = await login('Administrator', process.env.ADMIN_PASSWORD ?? 'admin')
    const actor = `Bearer ${operator.token}`
    const userId = await provisionExternalUser(actor, 'Example Consultant')
    const invitation = await issueIdentityInvitation(actor, userId, 'google-oidc', 'enroll')
    const initial = await beginInvitedLogin(invitation, 'http://localhost/callback')
    await expect(beginInvitedLogin(invitation, 'http://localhost/callback').then(() => null)).rejects.toMatchObject({ type: 'AuthenticationError' })
    upstream.setClaims({ sub: 'personal-subject', auth_time: Math.floor(Date.now() / 1000), email: 'person@personal.example' })
    let current = await finishHostedLogin(new URL(`http://localhost/callback?state=${initial.state}&code=${upstream.code(initial.authorizationUrl)}`), initial.browserSecret)
    expect(current.session.user.row_id).toBe(userId)
    for (const [sub, email] of [['workspace-one', 'person@work-one.example'], ['workspace-two', 'different@work-two.example']]) {
      upstream.setClaims({ sub, email, auth_time: Math.floor(Date.now() / 1000) })
      const target = await beginIdentityLink(`Bearer ${current.session.token}`, 'google-oidc', 'http://localhost/callback')
      current = await finishHostedLogin(new URL(`http://localhost/callback?state=${target.state}&code=${upstream.code(target.authorizationUrl)}`), target.browserSecret, current.session.token)
      expect(current.session.user.row_id).toBe(userId)
    }
    const identities = await sql`select subject, user_id from external_identity where user_id = ${userId} order by subject`
    expect(identities.map((i) => i.subject)).toEqual(['personal-subject', 'workspace-one', 'workspace-two'])
    const [person] = await sql`select email, native_login_enabled, password_hash from "user" where row_id = ${userId}`
    expect(person).toMatchObject({ email: null, native_login_enabled: false, password_hash: null })
    await expect(issueIdentityInvitation(actor, userId, 'google-oidc', 'enroll').then(() => null)).rejects.toMatchObject({ type: 'ValidationError' })
    await expect(issueIdentityInvitation(actor, 'Administrator', 'google-oidc', 'enroll').then(() => null)).rejects.toMatchObject({ type: 'ValidationError' })
    for (const subject of identities.map((i) => i.subject)) {
      upstream.setClaims({ sub: subject })
      const next = await beginHostedLogin('google-oidc', 'http://localhost/callback')
      const authenticated = await finishHostedLogin(new URL(`http://localhost/callback?state=${next.state}&code=${upstream.code(next.authorizationUrl)}`), next.browserSecret)
      expect(authenticated.session.user.row_id).toBe(userId)
    }
  } finally { await upstream.close() }
})

// @spec identity_unlink_and_recovery_preserve_account_control
test('recovery invitation is not approval; operator approval binds exactly one proved target and revokes old sessions', async () => {
  const upstream = await issuer()
  try {
    await sql`insert into login_provider (id, kind, issuer, client_id, enabled)
      values ('google-oidc', 'google', 'https://accounts.google.com', 'test-client', true)`
    const operator = await login('Administrator', process.env.ADMIN_PASSWORD ?? 'admin')
    const actor = `Bearer ${operator.token}`
    const invitation = await issueIdentityInvitation(actor, 'Administrator', 'google-oidc', 'recover')
    const target = await beginInvitedLogin(invitation, 'http://localhost/callback')
    const pending = await completeHostedOperation(new URL(`http://localhost/callback?state=${target.state}&code=${upstream.code(target.authorizationUrl)}`), target.browserSecret)
    expect(pending.kind).toBe('recovery-pending')
    if (pending.kind !== 'recovery-pending') throw new Error('Recovery must not issue a session')
    expect((await sql`select count(*)::int as count from external_identity`)[0].count).toBe(0)
    const exact = { userId: 'Administrator', providerId: 'google-oidc', issuer: 'https://accounts.google.com', subject: 'subject-one' }
    await expect(approveIdentityRecovery(actor, pending.recoveryId!, { ...exact, userId: 'Guest' }, 'in-person', 'case-001')).rejects.toMatchObject({ type: 'ValidationError' })
    await approveIdentityRecovery(actor, pending.recoveryId!, exact, 'in-person', 'case-001')
    await expect(resolveToken(actor)).rejects.toMatchObject({ type: 'AuthenticationError' })
    const [binding] = await sql`select user_id from external_identity where subject = 'subject-one'`
    expect(binding.user_id).toBe('Administrator')
    const fresh = await login('Administrator', process.env.ADMIN_PASSWORD ?? 'admin')
    await expect(approveIdentityRecovery(`Bearer ${fresh.token}`, pending.recoveryId!, exact, 'in-person', 'case-001')).rejects.toMatchObject({ type: 'ValidationError' })
  } finally { await upstream.close() }
})

// @spec identity_linking_requires_two_bound_proofs
test('source reauthentication names an existing identity and uses signed auth_time, never fresh token iat', async () => {
  const upstream = await issuer()
  try {
    await sql`insert into login_provider (id, kind, issuer, client_id, enabled)
      values ('google-oidc', 'google', 'https://accounts.google.com', 'test-client', true)`
    await sql`insert into external_identity (id, user_id, provider_id, issuer, subject)
      values ('existing-google', 'Administrator', 'google-oidc', 'https://accounts.google.com', 'subject-one')`
    const source = await login('Administrator', process.env.ADMIN_PASSWORD ?? 'admin')
    await sql`update login_session set authenticated_at = clock_timestamp() - interval '6 minutes' where user_id = 'Administrator'`
    for (const auth_time of [undefined, Math.floor(Date.now() / 1000) - 301, Math.floor(Date.now() / 1000) + 60]) {
      upstream.setClaims({ auth_time })
      const operation = await beginIdentityReauthentication(`Bearer ${source.token}`, 'existing-google', 'http://localhost/callback')
      await expect(completeHostedOperation(new URL(`http://localhost/callback?state=${operation.state}&code=${upstream.code(operation.authorizationUrl)}`), operation.browserSecret, source.token).then(() => null))
        .rejects.toMatchObject({ type: 'PermissionError' })
      expect((await resolveToken(`Bearer ${source.token}`)).row_id).toBe('Administrator')
    }
    upstream.setClaims({ auth_time: Math.floor(Date.now() / 1000), sub: 'another-subject' })
    const wrong = await beginIdentityReauthentication(`Bearer ${source.token}`, 'existing-google', 'http://localhost/callback')
    await expect(completeHostedOperation(new URL(`http://localhost/callback?state=${wrong.state}&code=${upstream.code(wrong.authorizationUrl)}`), wrong.browserSecret, source.token).then(() => null))
      .rejects.toMatchObject({ type: 'AuthenticationError' })
    upstream.setClaims({ auth_time: Math.floor(Date.now() / 1000) })
    const fresh = await beginIdentityReauthentication(`Bearer ${source.token}`, 'existing-google', 'http://localhost/callback')
    const verified = await finishHostedLogin(new URL(`http://localhost/callback?state=${fresh.state}&code=${upstream.code(fresh.authorizationUrl)}`), fresh.browserSecret, source.token)
    expect((await beginIdentityLink(`Bearer ${verified.session.token}`, 'google-oidc', 'http://localhost/callback')).authorizationUrl.origin).toBe('https://accounts.google.com')
  } finally { await upstream.close() }
})

// @spec hosted_login_validates_subject_and_browser_operation
test('Microsoft common authority validates the actual tenant issuer for personal and work subjects', async () => {
  const upstream = await issuer('microsoft')
  try {
    await sql`insert into login_provider (id, kind, issuer, client_id, enabled)
      values ('microsoft-oidc', 'microsoft', 'https://login.microsoftonline.com/common/v2.0', 'test-client', true)`
    const challenge = { state: 'state-ms', nonce: 'nonce-ms', verifier: 'm'.repeat(43), redirectUri: 'http://localhost/callback' }
    const authorization = await hostedAuthorization('microsoft-oidc', challenge)
    expect(authorization.origin).toBe('https://login.microsoftonline.com')
    const verify = () => verifyHostedCode('microsoft-oidc', new URL(`http://localhost/callback?state=${challenge.state}&code=${upstream.code(authorization)}`), challenge)
    expect(await verify()).toMatchObject({ issuer: upstream.tokenIssuer, subject: 'subject-one' })
    const tenant = '12345678-1234-1234-1234-123456789abc'
    upstream.setClaims({ tid: tenant, iss: `https://login.microsoftonline.com/${tenant}/v2.0` })
    expect(await verify()).toMatchObject({ issuer: `https://login.microsoftonline.com/${tenant}/v2.0`, subject: 'subject-one' })
    for (const claims of [{ tid: tenant }, { iss: 'https://attacker.test/tenant/v2.0' }, { tid: '../common' }]) {
      upstream.setClaims(claims)
      await expect(verify()).rejects.toMatchObject({ type: 'AuthenticationError' })
    }
  } finally { await upstream.close() }
})

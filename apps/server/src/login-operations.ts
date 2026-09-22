import { createHash, randomBytes } from 'node:crypto'
import { safeLoginDestination } from 'shared'
import { sql, withTransaction } from './db'
import { AppError } from './errors'
import { issueExternalSession, resolveLoginSession, resolveSessionRecord, type LoginSessionRecord } from './auth'
import { configuredHostedProvider, hostedAuthorization, verifyHostedCode, HOSTED_ISSUERS, type VerifiedExternalProof } from './hosted-providers'
import { logActivity } from './audit'
import { getRoles } from './permissions'
import { saveDoc } from './document'

export const loginSecretHash = (value: string) => createHash('sha256').update(value).digest('hex')
const secret = () => randomBytes(32).toString('base64url')

// @spec hosted_login_validates_subject_and_browser_operation
export async function beginHostedLogin(providerId: string, redirectUri: string, returnTo?: string) {
  return beginOperation(providerId, redirectUri, { purpose: 'login', returnTo })
}

function freshAuthenticationDeadline(authenticatedAt: Date | null) {
  const time = authenticatedAt?.getTime()
  if (!time || time > Date.now() || time + 300_000 <= Date.now())
    throw new AppError('PermissionError', 'Recent authentication is required. Google account selection alone is not reauthentication; use another linked method or administrator recovery.')
  return time + 300_000
}

function requireRecentAuthentication(session: LoginSessionRecord) {
  return new Date(Math.min(freshAuthenticationDeadline(session.method === 'internal' ? null : session.authenticatedAt), session.expiresAt.getTime()))
}

// @spec identity_linking_requires_two_bound_proofs
export async function beginIdentityLink(authorization: string | undefined, providerId: string, redirectUri: string) {
  const source = await resolveLoginSession(authorization)
  requireRecentAuthentication(source)
  return beginOperation(providerId, redirectUri, { purpose: 'link', source })
}

export async function beginIdentityReauthentication(authorization: string | undefined, identityId: string, redirectUri: string) {
  const source = await resolveLoginSession(authorization)
  const [identity] = await sql`select provider_id from external_identity where id = ${identityId}
    and user_id = ${source.user.row_id} and revoked_at is null`
  if (!identity) throw new AppError('AuthenticationError', 'Linked identity is unavailable')
  return beginOperation(identity.provider_id as string, redirectUri, { purpose: 'reauthenticate', source, identityId })
}

interface InvitationTarget {
  purpose: 'enroll' | 'recover'
  userId: string
  userGeneration: string
  providerGeneration: string
  expiresAt: Date
}

type OperationIntent =
  | { purpose: 'login'; returnTo?: string }
  | { purpose: 'link'; source: LoginSessionRecord }
  | { purpose: 'reauthenticate'; source: LoginSessionRecord; identityId: string }
  | { purpose: 'enroll' | 'recover'; invitation: InvitationTarget }

async function beginOperation(providerId: string, redirectUri: string, intent: OperationIntent) {
  const source = 'source' in intent ? intent.source : undefined
  const invitation = 'invitation' in intent ? intent.invitation : undefined
  const returnTo = intent.purpose === 'login' ? intent.returnTo : source ? '/featherbase/account' : undefined
  const provider = await configuredHostedProvider(providerId)
  if (invitation && provider.generation !== invitation.providerGeneration)
    throw new AppError('AuthenticationError', 'Invalid or expired invitation')
  const state = secret()
  const browserSecret = secret()
  const challenge = { state, nonce: secret(), verifier: secret(), redirectUri }
  const authorizationUrl = await hostedAuthorization(providerId, challenge)
  await sql`delete from login_operation where expires_at <= clock_timestamp()`
  await sql`delete from login_handoff where expires_at <= clock_timestamp()`
  const expires = intent.purpose === 'link' ? requireRecentAuthentication(intent.source)
    : new Date(Math.min(Date.now() + 600_000, invitation?.expiresAt.getTime() ?? Infinity, source?.expiresAt.getTime() ?? Infinity))
  await sql`insert into login_operation (state_hash, browser_hash, provider_id, provider_generation,
    nonce, pkce_verifier, redirect_uri, return_to, expires_at, purpose,
    source_session_id, source_user_id, source_user_generation, source_authenticated_at, invited_user_id, invited_user_generation, expected_identity_id)
    values (${loginSecretHash(state)}, ${loginSecretHash(browserSecret)}, ${providerId}, ${provider.generation},
      ${challenge.nonce}, ${challenge.verifier}, ${redirectUri}, ${safeLoginDestination(returnTo) ?? null}, ${expires}, ${intent.purpose},
      ${source?.id ?? null}, ${source?.user.row_id ?? null}, ${source?.userGeneration ?? null}, ${source?.authenticatedAt ?? null},
      ${invitation?.userId ?? null}, ${invitation?.userGeneration ?? null}, ${intent.purpose === 'reauthenticate' ? intent.identityId : null})`
  return { state, browserSecret, authorizationUrl }
}

// All identity mutations take provider locks before User/identity/session locks.
// Count only these locked providers when deciding whether unlink strands a User.
async function lockAccount(source: LoginSessionRecord, extraProvider?: string, extraUser?: string) {
  const users = [source.user.row_id, extraUser ?? source.user.row_id]
  const providers = await sql`select id from login_provider where id = ${extraProvider ?? ''}
    or id in (select provider_id from external_identity where user_id in ${sql(users)})
    order by id for update`
  await sql`select row_id from "user" where row_id in ${sql(users)} order by row_id for update`
  await sql`select id from external_identity where user_id in ${sql(users)} order by id for update`
  await sql`select id from login_session where id = ${source.id} for update`
  const current = await resolveSessionRecord(source.id)
  return { current, providers: providers.map((p) => p.id as string) }
}

async function bindIdentity(userId: string, providerId: string, proof: VerifiedExternalProof, recovery = false) {
  const [identity] = await sql`insert into external_identity (id, user_id, provider_id, issuer, subject, email, email_verified, display_name)
    values (${secret()}, ${userId}, ${providerId}, ${proof.issuer}, ${proof.subject}, ${proof.email}, ${proof.emailVerified}, ${proof.displayName})
    on conflict (provider_id, issuer, subject) do update set revoked_at = null,
      email = excluded.email, email_verified = excluded.email_verified, display_name = excluded.display_name
    where external_identity.user_id = excluded.user_id and (external_identity.revoked_at is not null or ${recovery})
    returning id`
  if (!identity) throw new AppError('ConflictError', 'Identity cannot be linked')
  await sql`update "user" set identity_enrolled = true where row_id = ${userId}`
  await logActivity(userId, 'identity linked')
}

export async function completeHostedOperation(callback: URL, browserSecret: string | undefined, currentCookie?: string) {
  const state = callback.searchParams.get('state')
  if (!state || !browserSecret) throw new AppError('AuthenticationError', 'Invalid or expired login operation')
  // Consume before calling the provider, outside the binding/session transaction.
  // An upstream failure must never restore a state or PKCE verifier for replay.
  const [operation] = await sql`delete from login_operation
    where state_hash = ${loginSecretHash(state)} and browser_hash = ${loginSecretHash(browserSecret)}
      and expires_at > clock_timestamp()
    returning *`
  if (!operation) throw new AppError('AuthenticationError', 'Invalid or expired login operation')
  let source: LoginSessionRecord | undefined
  if (operation.purpose === 'link' || operation.purpose === 'reauthenticate') {
    source = await resolveLoginSession(currentCookie ? `Bearer ${currentCookie}` : undefined)
    if (source.id !== operation.source_session_id || source.user.row_id !== operation.source_user_id
      || source.userGeneration !== operation.source_user_generation)
      throw new AppError('AuthenticationError', 'Login operation belongs to another session')
    if (operation.purpose === 'link') requireRecentAuthentication(source)
  }
  const providerId = operation.provider_id as string
  const proof = await verifyHostedCode(providerId, callback, {
    state, nonce: operation.nonce as string, verifier: operation.pkce_verifier as string,
    redirectUri: operation.redirect_uri as string,
  })
  return withTransaction(async () => {
    if (source) {
      const { current } = await lockAccount(source, providerId)
      if (operation.purpose === 'link') requireRecentAuthentication(current)
    }
    const [provider] = await sql`select id from login_provider
      where id = ${providerId} and enabled and auth_generation = ${operation.provider_generation} for update`
    if (!provider || new Date(operation.expires_at as string).getTime() <= Date.now())
      throw new AppError('AuthenticationError', 'Invalid or expired login operation')
    if (source && operation.purpose === 'link') await bindIdentity(source.user.row_id, providerId, proof)
    if (source && operation.purpose === 'reauthenticate') {
      freshAuthenticationDeadline(proof.authenticatedAt)
      const [existing] = await sql`select id from external_identity where id = ${operation.expected_identity_id}
        and user_id = ${source.user.row_id} and provider_id = ${providerId} and issuer = ${proof.issuer}
        and subject = ${proof.subject} and revoked_at is null`
      if (!existing) throw new AppError('AuthenticationError', 'Reauthentication requires the selected linked identity')
    }
    if (operation.purpose === 'enroll' || operation.purpose === 'recover') {
      const [user] = await sql`select row_id, identity_enrolled, password_hash from "user"
        where row_id = ${operation.invited_user_id} and enabled and user_type <> 'service'
          and auth_generation = ${operation.invited_user_generation} for update`
      if (!user) throw new AppError('AuthenticationError', 'Invalid or expired invitation')
      if (operation.purpose === 'recover') {
        const recoveryId = secret()
        await sql`insert into identity_recovery (id, user_id, user_generation, provider_id, provider_generation,
          issuer, subject, email, email_verified, display_name)
          values (${recoveryId}, ${user.row_id}, ${operation.invited_user_generation}, ${providerId}, ${operation.provider_generation},
            ${proof.issuer}, ${proof.subject}, ${proof.email}, ${proof.emailVerified}, ${proof.displayName})`
        return { kind: 'recovery-pending' as const, recoveryId }
      }
      if (user.identity_enrolled || user.password_hash) throw new AppError('AuthenticationError', 'Invalid or expired invitation')
      await bindIdentity(user.row_id as string, providerId, proof)
    }
    const session = await issueExternalSession(providerId, proof.issuer, proof.subject, proof.authenticatedAt, new Date(operation.created_at as string))
    // Only display metadata changes; neither verified email nor name owns a User.
    await sql`update external_identity set email = ${proof.email}, email_verified = ${proof.emailVerified}, display_name = ${proof.displayName}
      where provider_id = ${providerId} and issuer = ${proof.issuer} and subject = ${proof.subject}`
    const record = await resolveLoginSession(`Bearer ${session.token}`)
    const handoff = secret()
    await sql`insert into login_handoff (code_hash, credential_hash, session_id, return_to)
      values (${loginSecretHash(handoff)}, ${loginSecretHash(session.token)}, ${record.id}, ${operation.return_to ?? null})`
    return { kind: 'session' as const, session, handoff }
  })
}

async function requireRecoveryOperator(source: LoginSessionRecord) {
  requireRecentAuthentication(source)
  if (!(await getRoles(source.user.row_id)).includes('System Manager'))
    throw new AppError('PermissionError', 'System Manager is required')
}

// @spec provider_configuration_is_an_authentication_boundary
export async function createHostedProvider(authorization: string | undefined, kind: string, clientId: string) {
  const source = await resolveLoginSession(authorization)
  await requireRecoveryOperator(source)
  if (kind === 'stylehr') throw new AppError('ProviderUnavailableError', 'StyleHR sign-in is not activated')
  if (!(kind === 'google' || kind === 'microsoft') || !clientId.trim() || clientId.length > 500)
    throw new AppError('ValidationError', 'A supported provider and client ID are required')
  return withTransaction(async () => {
    await requireRecoveryOperator((await lockAccount(source)).current)
    const id = secret()
    const [created] = await sql`insert into login_provider (id, kind, issuer, client_id, enabled)
      values (${id}, ${kind}, ${HOSTED_ISSUERS[kind]}, ${clientId.trim()}, true)
      on conflict do nothing returning id`
    if (!created) throw new AppError('ConflictError', 'That provider client is already configured')
    await configuredHostedProvider(id)
    await logActivity(source.user.row_id, 'login provider configured')
    return id
  })
}

export async function setHostedProviderEnabled(authorization: string | undefined, providerId: string, enabled: boolean) {
  const source = await resolveLoginSession(authorization)
  await requireRecoveryOperator(source)
  await withTransaction(async () => {
    await requireRecoveryOperator((await lockAccount(source, providerId)).current)
    const [provider] = await sql`select kind from login_provider where id = ${providerId}`
    if (!provider) throw new AppError('NotFoundError', 'Login provider not found')
    if (provider.kind === 'stylehr' && enabled) throw new AppError('ProviderUnavailableError', 'StyleHR sign-in is not activated')
    await sql`update login_provider set enabled = ${enabled} where id = ${providerId}`
    if (enabled) await configuredHostedProvider(providerId)
    await logActivity(source.user.row_id, enabled ? 'login provider enabled' : 'login provider disabled')
  })
}

export async function identityAdministration(authorization: string | undefined) {
  const source = await resolveLoginSession(authorization)
  await requireRecoveryOperator(source)
  return {
    users: await sql`select row_id, full_name, enabled, identity_enrolled from "user" where user_type <> 'service' order by full_name, row_id`,
    providers: await sql`select id, kind, client_id, enabled from login_provider order by kind, id`,
    recoveries: await sql`select id, user_id, provider_id, issuer, subject, display_name, email from identity_recovery
      where approved_at is null and expires_at > clock_timestamp() order by expires_at`,
  }
}

export async function provisionExternalUser(authorization: string | undefined, fullName: string, email?: string) {
  const source = await resolveLoginSession(authorization)
  await requireRecoveryOperator(source)
  if (!fullName.trim()) throw new AppError('ValidationError', 'A display name is required')
  return withTransaction(async () => {
    await requireRecoveryOperator((await lockAccount(source)).current)
    const userId = `person_${randomBytes(16).toString('hex')}`
    await saveDoc('User', { row_id: userId, full_name: fullName.trim(), email: email?.trim() || null, enabled: true }, source.user.row_id)
    await sql`update "user" set native_login_enabled = false where row_id = ${userId}`
    await logActivity(source.user.row_id, 'external user provisioned')
    return userId
  })
}

// @spec external_enrollment_requires_explicit_authority
export async function issueIdentityInvitation(authorization: string | undefined, userId: string, providerId: string, purpose: 'enroll' | 'recover') {
  const source = await resolveLoginSession(authorization)
  await requireRecoveryOperator(source)
  await configuredHostedProvider(providerId)
  return withTransaction(async () => {
    await requireRecoveryOperator((await lockAccount(source, providerId, userId)).current)
    const [user] = await sql`select enabled, user_type, identity_enrolled, password_hash from "user" where row_id = ${userId}`
    if (!user?.enabled || user.user_type === 'service' || (purpose === 'enroll' && (user.identity_enrolled || user.password_hash)))
      throw new AppError('ValidationError', 'User is not eligible for this invitation')
    if (purpose === 'enroll') await sql`update "user" set native_login_enabled = false where row_id = ${userId}`
    const [current] = await sql`select auth_generation from "user" where row_id = ${userId}`
    const [provider] = await sql`select enabled, auth_generation from login_provider where id = ${providerId}`
    if (!provider.enabled) throw new AppError('ValidationError', 'Login method is unavailable')
    await sql`delete from identity_invitation where expires_at <= clock_timestamp()`
    const invitation = secret()
    await sql`insert into identity_invitation (secret_hash, purpose, user_id, user_generation, provider_id, provider_generation, issued_by)
      values (${loginSecretHash(invitation)}, ${purpose}, ${userId}, ${current.auth_generation}, ${providerId}, ${provider.auth_generation}, ${source.user.row_id})`
    await logActivity(source.user.row_id, purpose === 'enroll' ? 'identity enrollment invited' : 'identity recovery invited')
    return invitation
  })
}

export async function beginInvitedLogin(invitation: string, redirectUri: string) {
  const [row] = await sql`delete from identity_invitation where secret_hash = ${loginSecretHash(invitation)}
    and expires_at > clock_timestamp() returning *`
  if (!row) throw new AppError('AuthenticationError', 'Invalid or expired invitation')
  const invitationTarget: InvitationTarget = {
    purpose: row.purpose as 'enroll' | 'recover', userId: row.user_id as string, userGeneration: row.user_generation as string,
    providerGeneration: row.provider_generation as string, expiresAt: new Date(row.expires_at as string),
  }
  return beginOperation(row.provider_id as string, redirectUri, { purpose: invitationTarget.purpose, invitation: invitationTarget })
}

// @spec identity_unlink_and_recovery_preserve_account_control
export async function approveIdentityRecovery(
  authorization: string | undefined, recoveryId: string,
  expected: { userId: string; providerId: string; issuer: string; subject: string },
  verificationMethod: string, caseReference: string,
) {
  const source = await resolveLoginSession(authorization)
  await requireRecoveryOperator(source)
  if (!['in-person', 'organizational-record', 'video-call'].includes(verificationMethod) || !caseReference.trim() || caseReference.length > 100)
    throw new AppError('ValidationError', 'Independent claimant verification method and case reference are required')
  return withTransaction(async () => {
    await requireRecoveryOperator((await lockAccount(source, expected.providerId, expected.userId)).current)
    const [candidate] = await sql`select * from identity_recovery where id = ${recoveryId}
      and user_id = ${expected.userId} and provider_id = ${expected.providerId} and issuer = ${expected.issuer} and subject = ${expected.subject}
      and approved_at is null and expires_at > clock_timestamp() for update`
    if (!candidate) throw new AppError('ValidationError', 'Recovery target is invalid or expired')
    const [eligible] = await sql`select row_id from "user" where row_id = ${expected.userId} and enabled and user_type <> 'service'
      and auth_generation = ${candidate.user_generation}`
    const [provider] = await sql`select id from login_provider where id = ${expected.providerId} and enabled and auth_generation = ${candidate.provider_generation}`
    if (!eligible || !provider) throw new AppError('ValidationError', 'Recovery target is invalid or expired')
    await bindIdentity(expected.userId, expected.providerId, { issuer: expected.issuer, subject: expected.subject,
      authenticatedAt: null, email: candidate.email as string | null, emailVerified: candidate.email_verified as boolean,
      displayName: candidate.display_name as string | null }, true)
    await sql`update "user" set recovery_completed_at = clock_timestamp() where row_id = ${expected.userId}`
    await sql`update identity_recovery set approved_at = clock_timestamp(), approved_by = ${source.user.row_id},
      verification_method = ${verificationMethod}, case_reference = ${caseReference.trim()} where id = ${recoveryId}`
    await logActivity(source.user.row_id, 'identity recovery approved')
  })
}

// @spec identity_unlink_and_recovery_preserve_account_control
export async function unlinkIdentity(authorization: string | undefined, identityId: string): Promise<void> {
  const source = await resolveLoginSession(authorization)
  requireRecentAuthentication(source)
  await withTransaction(async () => {
    const { providers, current } = await lockAccount(source)
    requireRecentAuthentication(current)
    const [target] = await sql`select id from external_identity where id = ${identityId} and user_id = ${source.user.row_id} and revoked_at is null`
    if (!target) throw new AppError('NotFoundError', 'Linked identity not found')
    const [native] = await sql`select native_login_enabled and password_hash is not null and password_hash <> '' as available
      from "user" where row_id = ${source.user.row_id}`
    const [replacement] = await sql`select i.id from external_identity i join login_provider p on p.id = i.provider_id
      where i.user_id = ${source.user.row_id} and i.id <> ${identityId} and i.revoked_at is null
        and p.enabled and p.id in ${sql(providers)} limit 1`
    if (!native?.available && !replacement)
      throw new AppError('ValidationError', 'Verify another login method before removing your last method')
    await sql`update external_identity set revoked_at = clock_timestamp() where id = ${identityId}`
    await logActivity(source.user.row_id, 'identity unlinked')
  })
}

// @spec session_handoff_is_bound_one_use_and_revocation_aware
export async function redeemLoginHandoff(code: string | undefined, cookie: string | undefined) {
  if (!code || !cookie) throw new AppError('AuthenticationError', 'Invalid or expired sign-in handoff')
  const [handoff] = await sql`delete from login_handoff
    where code_hash = ${loginSecretHash(code)} and credential_hash = ${loginSecretHash(cookie)}
      and expires_at > clock_timestamp() returning session_id, return_to`
  if (!handoff) throw new AppError('AuthenticationError', 'Invalid or expired sign-in handoff')
  const session = await resolveLoginSession(`Bearer ${cookie}`)
  if (session.id !== handoff.session_id) throw new AppError('AuthenticationError', 'Invalid or expired sign-in handoff')
  return { token: cookie, user: session.user, returnTo: handoff.return_to as string | null }
}

import * as oidc from 'openid-client'
import { sql } from './db'
import { environment } from './config'
import { AppError } from './errors'

export const HOSTED_ISSUERS = {
  google: 'https://accounts.google.com',
  microsoft: 'https://login.microsoftonline.com/common/v2.0',
} as const

export interface HostedChallenge {
  state: string
  nonce: string
  verifier: string
  redirectUri: string
}

export interface VerifiedExternalProof {
  issuer: string
  subject: string
  authenticatedAt: Date | null
  email: string | null
  emailVerified: boolean
  displayName: string | null
}

let testTransport: oidc.CustomFetch | null = null
// A test-only HTTP transport, not a configurable issuer or browser endpoint.
// Fixed real namespaces still undergo all issuer/audience/signature checks.
export function setOidcTestTransport(transport: oidc.CustomFetch | null): void {
  if (environment !== 'test') throw new Error('Synthetic identity transport is test-only')
  testTransport = transport
}

function secretFor(kind: keyof typeof HOSTED_ISSUERS): string | undefined {
  if (testTransport) return 'synthetic-client-secret'
  return kind === 'google' ? process.env.GOOGLE_CLIENT_SECRET : process.env.MICROSOFT_CLIENT_SECRET
}

// @spec provider_configuration_is_an_authentication_boundary
export async function configuredHostedProvider(id: string) {
  const [provider] = await sql`select id, kind, issuer, client_id, enabled, auth_generation from login_provider where id = ${id}`
  const kind: unknown = provider?.kind
  if (!provider?.enabled || !(kind === 'google' || kind === 'microsoft')
    || provider.issuer !== HOSTED_ISSUERS[kind] || !provider.client_id || !secretFor(kind))
    throw new AppError('AuthenticationError', 'Login method is unavailable')
  return { id: provider.id as string, kind, issuer: provider.issuer as string,
    clientId: provider.client_id as string, generation: provider.auth_generation as string } as const
}

export async function availableLoginProviders() {
  const rows = await sql`select id, kind from login_provider where enabled order by id`
  return rows.filter((p) => (p.kind === 'google' || p.kind === 'microsoft') && Boolean(secretFor(p.kind)))
    .map((p) => ({ id: p.id as string, label: p.kind === 'google' ? 'Google' : 'Microsoft', kind: p.kind as string }))
}

async function client(id: string) {
  const provider = await configuredHostedProvider(id)
  const options: oidc.DiscoveryRequestOptions = {
    timeout: 10,
    // The code flow otherwise trusts only the TLS token endpoint. Our contract
    // also requires cryptographic validation of every ID token using JWKS.
    execute: [oidc.enableNonRepudiationChecks, ...(testTransport ? [oidc.allowInsecureRequests] : [])],
    ...(testTransport ? { [oidc.customFetch]: testTransport } : {}),
  }
  try {
    return await oidc.discovery(new URL(provider.issuer), provider.clientId, secretFor(provider.kind), undefined, options)
  } catch {
    throw new AppError('ProviderUnavailableError', 'Login provider is temporarily unavailable')
  }
}

// @spec hosted_login_validates_subject_and_browser_operation
export async function hostedAuthorization(id: string, challenge: HostedChallenge): Promise<URL> {
  const configuration = await client(id)
  return oidc.buildAuthorizationUrl(configuration, {
    redirect_uri: challenge.redirectUri, response_type: 'code', scope: 'openid profile email',
    state: challenge.state, nonce: challenge.nonce,
    code_challenge: await oidc.calculatePKCECodeChallenge(challenge.verifier), code_challenge_method: 'S256',
    prompt: 'select_account',
    // Google may omit this. Neither account selection nor a new iat can replace it.
    claims: JSON.stringify({ id_token: { auth_time: { essential: false } } }),
  })
}

// @spec authentication_admission_and_audit_do_not_expose_secrets
export async function verifyHostedCode(id: string, callback: URL, challenge: HostedChallenge): Promise<VerifiedExternalProof> {
  const configuration = await client(id)
  try {
    if (callback.origin + callback.pathname !== new URL(challenge.redirectUri).origin + new URL(challenge.redirectUri).pathname)
      throw new AppError('AuthenticationError', 'Invalid identity proof')
    const tokens = await oidc.authorizationCodeGrant(configuration, callback, {
      expectedState: challenge.state, expectedNonce: challenge.nonce,
      pkceCodeVerifier: challenge.verifier, idTokenExpected: true,
    })
    const claims = tokens.claims()
    if (!claims || typeof claims.sub !== 'string' || !claims.sub || typeof claims.iss !== 'string')
      throw new AppError('AuthenticationError', 'Invalid identity proof')
    // @spec identity_linking_requires_two_bound_proofs
    const time = claims.auth_time
    const authenticatedAt = typeof time === 'number' && Number.isSafeInteger(time) && time > 0 && time <= Math.floor(Date.now() / 1000)
      ? new Date(time * 1000) : null
    return { issuer: claims.iss, subject: claims.sub, authenticatedAt,
      email: typeof claims.email === 'string' ? claims.email : null,
      emailVerified: claims.email_verified === true,
      displayName: typeof claims.name === 'string' ? claims.name : null }
  } catch (error) {
    // Never include upstream messages, responses, causes or token/code values.
    if (error instanceof TypeError || (error instanceof oidc.ResponseBodyError && error.status >= 500))
      throw new AppError('ProviderUnavailableError', 'Login provider is temporarily unavailable')
    throw new AppError('AuthenticationError', 'Invalid or expired identity proof')
  }
}

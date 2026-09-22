import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { AppError, errorResponse } from './errors'
import { authCredential, externalOrigin, requireAuthOrigin, setSidCookie } from './auth-http'
import { availableLoginProviders } from './hosted-providers'
import { resolveLoginSession, reauthenticateNative } from './auth'
import { publicLimit, passwordAttempt, forgive } from './pre-auth-rate-limit'
import { sql } from './db'
import { getRoles } from './permissions'
import { landingFor } from './sales-target'
import { beginHostedLogin, beginIdentityLink, beginIdentityReauthentication, beginInvitedLogin,
  completeHostedOperation, redeemLoginHandoff, loginSecretHash, provisionExternalUser,
  issueIdentityInvitation, approveIdentityRecovery, unlinkIdentity, createHostedProvider,
  setHostedProviderEnabled, identityAdministration } from './login-operations'

export const identityRoutes = new Hono()

// @spec authentication_admission_and_audit_do_not_expose_secrets
identityRoutes.onError((error, c) => {
  if (error instanceof AppError || error instanceof SyntaxError) return errorResponse(c, error)
  // Unlike generic application errors, auth exceptions must never be logged:
  // a driver/library error can embed its bound credentials or raw responses.
  console.error('Authentication operation failed')
  return errorResponse(c, new AppError('InternalError', 'Authentication operation failed'))
})

identityRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
  if (c.req.method === 'POST') requireAuthOrigin(c)
  await next()
})

const callbackUri = (c: Context) => `${externalOrigin(c).origin}/api/auth/callback`
const operationCookie = (state: string) => `fb_login_${loginSecretHash(state).slice(0, 32)}`

function rememberOperation(c: Context, operation: Awaited<ReturnType<typeof beginHostedLogin>>) {
  setCookie(c, operationCookie(operation.state), operation.browserSecret, {
    path: '/api/auth/callback', httpOnly: true, sameSite: 'Lax', maxAge: 600,
    secure: externalOrigin(c).protocol === 'https:',
  })
  return operation.authorizationUrl.toString()
}

async function body(c: Context) {
  const value: unknown = await c.req.json()
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AppError('BadRequestError', 'Expected an object')
  return value as Record<string, unknown>
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 2000)
    throw new AppError('BadRequestError', 'Required text is missing or too long')
  return value
}

identityRoutes.get('/providers', async (c) => c.json({ providers: await availableLoginProviders(),
  stylehr: { available: false, reason: 'Awaiting confirmed provider identity and eligibility contract' } }))

// @spec stylehr_activation_is_closed_without_a_confirmed_contract
identityRoutes.all('/login/stylehr', () => {
  throw new AppError('ProviderUnavailableError', 'StyleHR sign-in is not activated')
})

identityRoutes.get('/login/:provider', publicLimit('OAUTH_LOGIN'), async (c) => {
  const operation = await beginHostedLogin(text(c.req.param('provider')), callbackUri(c), c.req.query('next'))
  return c.redirect(rememberOperation(c, operation))
})

identityRoutes.get('/callback', publicLimit('OAUTH_CALLBACK'), async (c) => {
  const cookieName = operationCookie(c.req.query('state') ?? '')
  const browserSecret = getCookie(c, cookieName)
  deleteCookie(c, cookieName, { path: '/api/auth/callback' })
  const callback = new URL(callbackUri(c))
  callback.search = new URL(c.req.url).search
  const result = await completeHostedOperation(callback, browserSecret, getCookie(c, 'sid'))
  if (result.kind === 'recovery-pending') return c.redirect('/featherbase/login?recovery=pending')
  setSidCookie(c, result.session.token)
  return c.redirect(`/featherbase/oauth-callback?code=${encodeURIComponent(result.handoff)}`)
})

identityRoutes.post('/session', publicLimit('OAUTH_CALLBACK'), async (c) => {
  const input = await body(c)
  const result = await redeemLoginHandoff(text(input.code), getCookie(c, 'sid'))
  return c.json({ ...result, landing: await landingFor(result.user.row_id) })
})

identityRoutes.post('/invitation', publicLimit('OAUTH_LOGIN'), async (c) => {
  const input = await body(c)
  return c.json({ authorizationUrl: rememberOperation(c, await beginInvitedLogin(text(input.invitation), callbackUri(c))) })
})

identityRoutes.get('/account', async (c) => {
  const source = await resolveLoginSession(authCredential(c))
  const identities = await sql`select i.id, i.provider_id, p.kind, p.enabled, i.display_name, i.email
    from external_identity i join login_provider p on p.id = i.provider_id
    where i.user_id = ${source.user.row_id} and i.revoked_at is null order by i.created_at, i.id`
  const [user] = await sql`select native_login_enabled and password_hash is not null as native_available from "user" where row_id = ${source.user.row_id}`
  const time = source.authenticatedAt?.getTime() ?? 0
  return c.json({ identities, nativeAvailable: user.native_available,
    recentAuthentication: source.method !== 'internal' && time > Date.now() - 300_000 && time <= Date.now(),
    manager: (await getRoles(source.user.row_id)).includes('System Manager'), providers: await availableLoginProviders() })
})

identityRoutes.post('/link', publicLimit('OAUTH_LOGIN'), async (c) => {
  const input = await body(c)
  return c.json({ authorizationUrl: rememberOperation(c, await beginIdentityLink(authCredential(c), text(input.providerId), callbackUri(c))) })
})

identityRoutes.post('/reauthenticate/identity', publicLimit('OAUTH_LOGIN'), async (c) => {
  const input = await body(c)
  return c.json({ authorizationUrl: rememberOperation(c, await beginIdentityReauthentication(authCredential(c), text(input.identityId), callbackUri(c))) })
})

identityRoutes.post('/reauthenticate/native', publicLimit('LOGIN'), async (c) => {
  const source = await resolveLoginSession(authCredential(c))
  const attempt = await passwordAttempt(c, source.user.row_id)
  if (attempt.refusal) return attempt.refusal
  const session = await reauthenticateNative(authCredential(c), text((await body(c)).password))
  await forgive(attempt.ticket)
  setSidCookie(c, session.token)
  return c.json(session)
})

identityRoutes.post('/unlink', publicLimit('OAUTH_LOGIN'), async (c) => {
  await unlinkIdentity(authCredential(c), text((await body(c)).identityId))
  return c.json({ ok: true })
})

identityRoutes.post('/users', publicLimit('OAUTH_LOGIN'), async (c) => {
  const input = await body(c)
  return c.json({ userId: await provisionExternalUser(authCredential(c), text(input.fullName), input.email ? text(input.email) : undefined) })
})

identityRoutes.get('/administration', async (c) => c.json(await identityAdministration(authCredential(c))))

identityRoutes.post('/providers', publicLimit('OAUTH_LOGIN'), async (c) => {
  const input = await body(c)
  return c.json({ id: await createHostedProvider(authCredential(c), text(input.kind), text(input.clientId)) }, 201)
})

identityRoutes.post('/providers/enabled', publicLimit('OAUTH_LOGIN'), async (c) => {
  const input = await body(c)
  if (typeof input.enabled !== 'boolean') throw new AppError('BadRequestError', 'Expected enabled boolean')
  await setHostedProviderEnabled(authCredential(c), text(input.id), input.enabled)
  return c.json({ ok: true })
})

identityRoutes.post('/invitations', publicLimit('OAUTH_LOGIN'), async (c) => {
  const input = await body(c)
  if (input.purpose !== 'enroll' && input.purpose !== 'recover') throw new AppError('BadRequestError', 'Invalid invitation purpose')
  return c.json({ invitation: await issueIdentityInvitation(authCredential(c), text(input.userId), text(input.providerId), input.purpose) })
})

identityRoutes.post('/recoveries/approve', publicLimit('OAUTH_LOGIN'), async (c) => {
  const input = await body(c)
  await approveIdentityRecovery(authCredential(c), text(input.recoveryId), {
    userId: text(input.userId), providerId: text(input.providerId), issuer: text(input.issuer), subject: text(input.subject),
  }, text(input.verificationMethod), text(input.caseReference))
  return c.json({ ok: true })
})

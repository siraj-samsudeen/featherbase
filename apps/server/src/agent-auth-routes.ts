// #1207 (mcp-oauth-connect): the instance is its own OAuth 2.1 sign-in server
// for agents (design D1), at the address the client used (D12). The public
// part (metadata, registration, token) is mounted ahead of the session check;
// the browser's part (request, decision) and Connected apps behind it.
import { Hono, type Context } from 'hono'
import { sql } from './db'
import { config } from './config'
import { AppError } from './errors'
import { assertCanChangeAccess, type SessionUser } from './auth'
import { OAuthError, checkAuthorizeRequest, decide, exchangeCode, isRemembered, registerClient, renew } from './agent-auth'
import { endConnections, listConnections } from './agent-connections'
import { publicLimit } from './pre-auth-rate-limit'
import { who, type Env } from './route-context'
import { externalOrigin } from './session-cookies'

export const MCP_SCOPE = 'mcp'

/** Where an agent turned away from /mcp learns how to sign in (RFC 9728). */
export function mcpChallenge(c: Context): string {
  const origin = externalOrigin(c).origin
  return `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="${MCP_SCOPE}"`
}

export const agentAuthPublicRoutes = new Hono<Env>()

const protectedResource = (c: Context) => {
  const origin = externalOrigin(c).origin
  return c.json({ resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: [MCP_SCOPE], bearer_methods_supported: ['header'] })
}
agentAuthPublicRoutes.get('/.well-known/oauth-protected-resource', protectedResource)
agentAuthPublicRoutes.get('/.well-known/oauth-protected-resource/mcp', protectedResource)

agentAuthPublicRoutes.get('/.well-known/oauth-authorization-server', (c) => {
  const origin = externalOrigin(c).origin
  return c.json({
    issuer: origin,
    authorization_endpoint: `${origin}/featherbase/connect`,
    token_endpoint: `${origin}/api/agent-auth/token`,
    registration_endpoint: `${origin}/api/agent-auth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [MCP_SCOPE],
  })
})

/** A refusal in OAuth's own shape; anything else goes to the usual handler. */
async function oauthAnswer(c: Context, work: () => Promise<unknown>, status: 200 | 201 = 200): Promise<Response> {
  try {
    const answer = await work()
    return c.json(answer, status)
  } catch (error) {
    if (!(error instanceof OAuthError)) throw error
    return c.json({ error: error.error, error_description: error.message }, error.status)
  }
}

agentAuthPublicRoutes.post('/api/agent-auth/register', publicLimit('AGENT_REGISTER'), (c) =>
  oauthAnswer(c, async () => registerClient(await c.req.json().catch(() => null)), 201))

agentAuthPublicRoutes.post('/api/agent-auth/token', publicLimit('AGENT_TOKEN'), async (c) => {
  c.header('Cache-Control', 'no-store')
  const body = await c.req.parseBody()
  const form = Object.fromEntries(Object.entries(body).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  return oauthAnswer(c, () => {
    if (form.grant_type === 'authorization_code') return exchangeCode(form)
    if (form.grant_type === 'refresh_token') return renew(form)
    throw new OAuthError('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token')
  })
})

// ---- The browser's part: behind the session check ---------------------------

export const agentAuthRoutes = new Hono<Env>()

/** Only a person's own browser session connects an agent: never an access
 *  token, so never a service account (they have only tokens). */
function browserPerson(c: Context<Env>): SessionUser {
  const user = c.get('user')
  if (!user.sign_in) throw new AppError('PermissionError', 'Connect an agent from your browser, signed in as yourself')
  return user
}

async function personName(person: string): Promise<string> {
  const [row] = await sql`
    select coalesce(nullif(trim(full_name), ''), '@' || nullif(username, ''), nullif(email, ''), row_id) as name
    from person where row_id = ${person}`
  return row.name as string
}

agentAuthRoutes.get('/api/agent-auth/request', async (c) => {
  const user = browserPerson(c)
  const request = await checkAuthorizeRequest(c.req.query())
  return c.json({
    client_name: request.clientName,
    return_place: request.returnPlace,
    person: await personName(user.row_id),
    remembered: await isRemembered(user.row_id, request),
  })
})

// A state-changing POST on the session cookie: the cookie is SameSite=Lax, so
// a cross-site page's POST carries none; a page on another origin that does
// reach it (same site) is refused by its Origin, as /mcp refuses one.
agentAuthRoutes.post('/api/agent-auth/decision', async (c) => {
  const origin = c.req.header('origin')
  if (origin && origin !== externalOrigin(c).origin && !config.allowedOrigins.includes(origin))
    throw new AppError('PermissionError', `A page on ${origin} may not connect an agent`)
  const user = browserPerson(c)
  const request = await checkAuthorizeRequest(c.req.query())
  const body = (await c.req.json().catch(() => null)) as { allow?: unknown } | null
  if (typeof body?.allow !== 'boolean') throw new AppError('BadRequestError', 'Expected { allow: true | false }')
  // An Allow adds a lasting way in, which a test-mode or preview session may not.
  if (body.allow) assertCanChangeAccess(user)
  return c.json({ redirect: await decide(user.row_id, request, body.allow) })
})

// ---- Connected apps (D11): a person's own connections ------------------------

agentAuthRoutes.get('/api/agent-connections', async (c) => c.json({ connections: await listConnections(who(c)) }))

agentAuthRoutes.delete('/api/agent-connections/:id', async (c) => {
  if (!(await endConnections(who(c), 'disconnected', c.req.param('id'))))
    throw new AppError('NotFoundError', 'No such connection of yours')
  return c.json({ ok: true })
})

// #1207 (mcp-oauth-connect): the instance is its own OAuth 2.1 sign-in server
// for agents (design D1), at the address the client used (D12). The public
// part (metadata, registration, token) is mounted ahead of the session check;
// the browser's part (request, decision) and Connected apps behind it.
import { Hono, type Context } from 'hono'
import type { Env } from './route-context'
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

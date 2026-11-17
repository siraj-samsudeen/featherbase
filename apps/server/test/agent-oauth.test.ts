// #1207 (mcp-oauth-connect): the agent sign-in server below the scenarios in
// test/scenarios/agent-sign-in.test.ts — the metadata documents, the /mcp
// 401 header, each refusal of registration, the authorize request and the
// token endpoint, the renewal grace, and how connection tokens sit beside
// hand-made ones.
import { afterEach, describe, expect, vi } from 'vitest'
import { test } from './pg-test'
import { expectStatus } from './fixtures'
import { postMcp } from './agent-driver'
import { sandboxRequest } from './pg-test-shared'

const ORIGIN = 'http://localhost'
afterEach(() => vi.unstubAllEnvs())

describe('#1207 the metadata documents', () => {
  test.each(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'])(
    '%s names /mcp as the resource and the instance as its sign-in server', async (path) => {
      const res = await expectStatus(await sandboxRequest(`${ORIGIN}${path}`), 200)
      expect(await res.json()).toEqual({
        resource: `${ORIGIN}/mcp`,
        authorization_servers: [ORIGIN],
        scopes_supported: ['mcp'],
        bearer_methods_supported: ['header'],
      })
    })

  test('the sign-in server metadata names the connect page, the token and registration routes', async () => {
    const res = await expectStatus(await sandboxRequest(`${ORIGIN}/.well-known/oauth-authorization-server`), 200)
    expect(await res.json()).toEqual({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/featherbase/connect`,
      token_endpoint: `${ORIGIN}/api/agent-auth/token`,
      registration_endpoint: `${ORIGIN}/api/agent-auth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['mcp'],
    })
  })

  test('the documents follow the address the client used', async () => {
    const res = await sandboxRequest('http://other.localhost:4000/.well-known/oauth-protected-resource')
    expect(await res.json()).toMatchObject({ resource: 'http://other.localhost:4000/mcp', authorization_servers: ['http://other.localhost:4000'] })
  })
})

describe('#1207 /mcp turns a caller without a usable key to the sign-in', () => {
  const challenge = `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp", scope="mcp"`

  test('no key: 401 with the error body and where to sign in', async () => {
    const res = await expectStatus(await postMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), 401)
    expect(res.headers.get('www-authenticate')).toBe(challenge)
    expect(await res.json()).toMatchObject({ error: { type: 'AuthenticationError' } })
  })

  test('an unknown key: 401 with where to sign in', async () => {
    const res = await expectStatus(await postMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: 'Bearer fbt_nothing' }), 401)
    expect(res.headers.get('www-authenticate')).toBe(challenge)
  })
})

const register = (body: unknown) => sandboxRequest(`${ORIGIN}/api/agent-auth/register`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})

describe('#1207 an agent registers itself (RFC 7591, D6)', () => {
  test('a public client is registered with its name and return addresses', async () => {
    const res = await expectStatus(await register({ client_name: 'Claude Code', redirect_uris: ['http://127.0.0.1:5000/callback', 'https://claude.example/cb'] }), 201)
    const client = await res.json() as Record<string, unknown>
    expect(client).toMatchObject({
      client_name: 'Claude Code',
      redirect_uris: ['http://127.0.0.1:5000/callback', 'https://claude.example/cb'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    })
    expect(client.client_id).toMatch(/^cli_/)
    expect(client).not.toHaveProperty('client_secret')
  })

  test.each(['http://localhost:7000/cb', 'http://[::1]:7000/cb'])('a loopback address %s is accepted', async (uri) => {
    await expectStatus(await register({ client_name: 'Agent', redirect_uris: [uri] }), 201)
  })

  test.each([
    ['no return address', { client_name: 'Agent' }, 'invalid_redirect_uri'],
    ['an empty list', { client_name: 'Agent', redirect_uris: [] }, 'invalid_redirect_uri'],
    ['a plain-http website', { client_name: 'Agent', redirect_uris: ['http://evil.example/cb'] }, 'invalid_redirect_uri'],
    ['a fragment', { client_name: 'Agent', redirect_uris: ['https://claude.example/cb#x'] }, 'invalid_redirect_uri'],
    ['not an address', { client_name: 'Agent', redirect_uris: ['not a url'] }, 'invalid_redirect_uri'],
    ['a custom scheme', { client_name: 'Agent', redirect_uris: ['myapp://cb'] }, 'invalid_redirect_uri'],
    ['a client secret method', { client_name: 'Agent', redirect_uris: ['https://claude.example/cb'], token_endpoint_auth_method: 'client_secret_basic' }, 'invalid_client_metadata'],
    ['no name', { redirect_uris: ['https://claude.example/cb'] }, 'invalid_client_metadata'],
    ['a name too long', { client_name: 'x'.repeat(141), redirect_uris: ['https://claude.example/cb'] }, 'invalid_client_metadata'],
    ['not an object', 'nonsense', 'invalid_client_metadata'],
  ])('refused: %s', async (_why, body, error) => {
    const res = await expectStatus(await register(body), 400)
    expect(await res.json()).toMatchObject({ error, error_description: expect.any(String) })
  })

  test('registration is rate-limited per source', async () => {
    vi.stubEnv('PREAUTH_AGENT_REGISTER_MAX', '1')
    await expectStatus(await register({ client_name: 'Agent', redirect_uris: ['https://claude.example/cb'] }), 201)
    await expectStatus(await register({ client_name: 'Agent', redirect_uris: ['https://claude.example/cb'] }), 429)
  })
})

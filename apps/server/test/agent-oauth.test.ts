// #1207 (mcp-oauth-connect): the agent sign-in server below the scenarios in
// test/scenarios/agent-sign-in.test.ts — the metadata documents, the /mcp
// 401 header, each refusal of registration, the authorize request and the
// token endpoint, the renewal grace, and how connection tokens sit beside
// hand-made ones.
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { expectStatus } from './fixtures'
import { postMcp } from './agent-driver'
import { sandboxRequest } from './pg-test-shared'

const ORIGIN = 'http://localhost'

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

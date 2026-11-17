// #1207 (mcp-oauth-connect): the agent sign-in server below the scenarios in
// test/scenarios/agent-sign-in.test.ts — the metadata documents, the /mcp
// 401 header, each refusal of registration, the authorize request and the
// token endpoint, the renewal grace, and how connection tokens sit beside
// hand-made ones.
import { createHash, randomBytes } from 'node:crypto'
import { afterEach, describe, expect, vi } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { expectStatus } from './fixtures'
import { issueToken, postMcp } from './agent-driver'
import { sandboxRequest } from './pg-test-shared'
import { sql } from '../src/db'
import { issueSession, setUserPassword } from '../src/auth'
import { createServiceAccount } from '../src/service-accounts'

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

// ---- The browser's part and the token endpoint, below the SDK -------------

const LOOPBACK = 'http://127.0.0.1:6100/cb'

function pkce() {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

async function registerAgent(redirect = LOOPBACK, name = 'Claude Code'): Promise<string> {
  const res = await expectStatus(await register({ client_name: name, redirect_uris: [redirect] }), 201)
  return ((await res.json()) as { client_id: string }).client_id
}

/** An authorize query; a value of undefined leaves that parameter out. */
function authorizeQuery(clientId: string, challenge: string, over: Record<string, string | undefined> = {}): string {
  const params: Record<string, string | undefined> = {
    response_type: 'code', client_id: clientId, redirect_uri: LOOPBACK, code_challenge: challenge,
    code_challenge_method: 'S256', state: 'st-1', ...over,
  }
  return new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined)).toString()
}

const browser = (person: TestClient): Record<string, string> => ({ cookie: `sid=${person.token}` })

const ask = (query: string, headers: Record<string, string>) =>
  sandboxRequest(`${ORIGIN}/api/agent-auth/request?${query}`, { headers })

const decideOn = (query: string, headers: Record<string, string>, body: unknown) =>
  sandboxRequest(`${ORIGIN}/api/agent-auth/decision?${query}`, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body),
  })

const tokenPost = (form: Record<string, string>) => sandboxRequest(`${ORIGIN}/api/agent-auth/token`, {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString(),
})

/** A person allows a freshly registered agent: its client, verifier and code. */
async function allowed(person: TestClient, redirect = LOOPBACK) {
  const clientId = await registerAgent(redirect)
  const { verifier, challenge } = pkce()
  const decided = await expectStatus(await decideOn(authorizeQuery(clientId, challenge, { redirect_uri: redirect }), browser(person), { allow: true }), 200)
  const back = new URL(((await decided.json()) as { redirect: string }).redirect)
  return { clientId, verifier, redirect, code: back.searchParams.get('code')! }
}

const exchange = (grant: { clientId: string; verifier: string; redirect: string; code: string }, over: Record<string, string> = {}) =>
  tokenPost({ grant_type: 'authorization_code', code: grant.code, redirect_uri: grant.redirect, client_id: grant.clientId, code_verifier: grant.verifier, ...over })

type Tokens = { access_token: string; refresh_token: string; token_type: string; expires_in: number; scope: string }

/** A person's agent, connected: its client and its tokens. */
async function connected(person: TestClient) {
  const grant = await allowed(person)
  const tokens = (await (await expectStatus(await exchange(grant), 200)).json()) as Tokens
  return { clientId: grant.clientId, ...tokens }
}

const renewal = (clientId: string, refreshToken: string) =>
  tokenPost({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId })

/** Whether a short key opens /mcp. */
async function opensMcp(token: string): Promise<boolean> {
  const res = await postMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: `Bearer ${token}` })
  return res.status === 200
}

async function expectOAuthError(res: Response, status: number, error: string) {
  await expectStatus(res, status)
  expect(await res.json()).toMatchObject({ error, error_description: expect.any(String) })
}

describe('#1207 the authorize request the connect page asks about', () => {
  test('a good request answers the agent, where it returns, the person and whether it is remembered', async ({ createUser }) => {
    const user = await createUser()
    await sql`update person set full_name = 'Asha Rao' where row_id = ${user.user!}`
    const clientId = await registerAgent()
    const res = await expectStatus(await ask(authorizeQuery(clientId, pkce().challenge), browser(user)), 200)
    expect(await res.json()).toEqual({ client_name: 'Claude Code', return_place: 'loopback', person: 'Asha Rao', remembered: false })
  })

  test('a loopback agent may return on another port than it registered', async ({ createUser }) => {
    const user = await createUser()
    const clientId = await registerAgent()
    await expectStatus(await ask(authorizeQuery(clientId, pkce().challenge, { redirect_uri: 'http://127.0.0.1:6200/cb' }), browser(user)), 200)
  })

  test.for([
    ['an unknown client', { client_id: 'cli_nobody' }],
    ['no client', { client_id: undefined }],
    ['an address it did not register', { redirect_uri: 'https://evil.example/cb' }],
    ['another loopback path', { redirect_uri: 'http://127.0.0.1:6100/other' }],
    ['another loopback host', { redirect_uri: 'http://localhost:6100/cb' }],
    ['no return address', { redirect_uri: undefined }],
    ['no PKCE', { code_challenge: undefined, code_challenge_method: undefined }],
    ['plain PKCE', { code_challenge_method: 'plain' }],
    ['a malformed challenge', { code_challenge: 'short' }],
    ['response_type token', { response_type: 'token' }],
  ] as [string, Record<string, string | undefined>][])('refused, as an error and never a redirect: %s', async ([, over], { createUser }) => {
    const user = await createUser()
    const clientId = await registerAgent()
    const query = authorizeQuery(clientId, pkce().challenge, over)
    const asked = await expectStatus(await ask(query, browser(user)), 400)
    expect(await asked.json()).toMatchObject({ error: { type: 'BadRequestError' } })
    const decided = await expectStatus(await decideOn(query, browser(user), { allow: true }), 400)
    expect(await decided.json()).not.toHaveProperty('redirect')
  })

  test('a person\'s access token cannot stand in for their browser', async ({ createUser }) => {
    const user = await createUser()
    const token = await issueToken(user)
    const clientId = await registerAgent()
    await expectStatus(await ask(authorizeQuery(clientId, pkce().challenge), { authorization: `Bearer ${token}` }), 403)
  })

  test('a service account is refused', async ({ admin }) => {
    const account = await createServiceAccount('agent-bot', [], 'Administrator')
    const token = await issueToken(admin, 'bot', account.row_id)
    const clientId = await registerAgent()
    const query = authorizeQuery(clientId, pkce().challenge)
    await expectStatus(await ask(query, { authorization: `Bearer ${token}` }), 403)
    await expectStatus(await decideOn(query, { authorization: `Bearer ${token}` }, { allow: true }), 403)
  })
})

describe('#1207 the person\'s decision', () => {
  test('Allow returns the agent\'s address with a code and its state', async ({ createUser }) => {
    const user = await createUser()
    const clientId = await registerAgent()
    const res = await expectStatus(await decideOn(authorizeQuery(clientId, pkce().challenge), browser(user), { allow: true }), 200)
    const back = new URL(((await res.json()) as { redirect: string }).redirect)
    expect(back.origin + back.pathname).toBe(LOOPBACK)
    expect(back.searchParams.get('state')).toBe('st-1')
    expect(back.searchParams.get('code')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  test('only the code\'s hash is stored', async ({ createUser }) => {
    const grant = await allowed(await createUser())
    const rows = await sql`select code_hash from agent_auth_code where client_id = ${grant.clientId}`
    expect(rows).toHaveLength(1)
    expect(rows[0].code_hash).not.toBe(grant.code)
  })

  test('without a state, none is returned', async ({ createUser }) => {
    const user = await createUser()
    const clientId = await registerAgent()
    const res = await decideOn(authorizeQuery(clientId, pkce().challenge, { state: undefined }), browser(user), { allow: false })
    const back = new URL(((await res.json()) as { redirect: string }).redirect)
    expect(back.searchParams.get('error')).toBe('access_denied')
    expect(back.searchParams.has('state')).toBe(false)
  })

  test('a page on another origin cannot decide for the person', async ({ createUser }) => {
    const user = await createUser()
    const clientId = await registerAgent()
    const res = await decideOn(authorizeQuery(clientId, pkce().challenge), { ...browser(user), origin: 'https://evil.example' }, { allow: true })
    await expectStatus(res, 403)
    expect(await sql`select 1 from agent_auth_code where client_id = ${clientId}`).toHaveLength(0)
  })

  test('the instance\'s own page may decide', async ({ createUser }) => {
    const user = await createUser()
    const clientId = await registerAgent()
    await expectStatus(await decideOn(authorizeQuery(clientId, pkce().challenge), { ...browser(user), origin: ORIGIN }, { allow: true }), 200)
  })

  test('the choice must be true or false', async ({ createUser }) => {
    const user = await createUser()
    const clientId = await registerAgent()
    await expectStatus(await decideOn(authorizeQuery(clientId, pkce().challenge), browser(user), { allow: 'yes' }), 400)
  })

  test('a test-mode session cannot Allow', async ({ createUser }) => {
    const user = await createUser()
    const session = await issueSession(user.user!, { testMode: true })
    const clientId = await registerAgent()
    const query = authorizeQuery(clientId, pkce().challenge)
    await expectStatus(await decideOn(query, { cookie: `sid=${session.token}` }, { allow: true }), 403)
    await expectStatus(await decideOn(query, { cookie: `sid=${session.token}` }, { allow: false }), 200)
  })
})

describe('#1207 the token endpoint: a code for a key pair', () => {
  test('a good code answers a Bearer short key for an hour and a renewal key, never cached', async ({ createUser }) => {
    const res = await expectStatus(await exchange(await allowed(await createUser())), 200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const tokens = (await res.json()) as Tokens
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'mcp' })
    expect(tokens.access_token).toMatch(/^fbt_/)
    expect(tokens.refresh_token).toMatch(/^fbr_/)
    expect(await opensMcp(tokens.access_token)).toBe(true)
  })

  test('only the renewal key\'s hash is stored', async ({ createUser }) => {
    const { refresh_token } = await connected(await createUser())
    const [row] = await sql`select count(*)::int as n from agent_refresh_token where token_hash = ${refresh_token}`
    expect(row.n).toBe(0)
  })

  test('the wrong verifier is refused, and burns the code', async ({ createUser }) => {
    const grant = await allowed(await createUser())
    await expectOAuthError(await exchange(grant, { code_verifier: pkce().verifier }), 400, 'invalid_grant')
    await expectOAuthError(await exchange(grant), 400, 'invalid_grant')
  })

  test('a code is used once', async ({ createUser }) => {
    const grant = await allowed(await createUser())
    await expectStatus(await exchange(grant), 200)
    await expectOAuthError(await exchange(grant), 400, 'invalid_grant')
  })

  test('a code older than five minutes is refused', async ({ createUser }) => {
    const grant = await allowed(await createUser())
    await sql`update agent_auth_code set expires_at = now() - interval '1 second' where client_id = ${grant.clientId}`
    await expectOAuthError(await exchange(grant), 400, 'invalid_grant')
  })

  test('a code is refused to another client', async ({ createUser }) => {
    const grant = await allowed(await createUser())
    await expectOAuthError(await exchange(grant, { client_id: await registerAgent() }), 400, 'invalid_grant')
  })

  test('a code is refused with another return address', async ({ createUser }) => {
    const grant = await allowed(await createUser())
    await expectOAuthError(await exchange(grant, { redirect_uri: 'http://127.0.0.1:6200/cb' }), 400, 'invalid_grant')
  })

  test('an unknown client is refused as a client', async ({ createUser }) => {
    const grant = await allowed(await createUser())
    await expectOAuthError(await exchange(grant, { client_id: 'cli_nobody' }), 401, 'invalid_client')
  })

  test('a missing verifier is a malformed request', async ({ createUser }) => {
    const grant = await allowed(await createUser())
    await expectOAuthError(await exchange(grant, { code_verifier: '' }), 400, 'invalid_request')
  })

  test('a person disabled after allowing gets no key', async ({ createUser }) => {
    const user = await createUser()
    const grant = await allowed(user)
    await sql`update person set enabled = false where row_id = ${user.user!}`
    await expectOAuthError(await exchange(grant), 400, 'invalid_grant')
  })

  // Codex round 1 (P2): a code the person allowed before securing the account
  // must not open a connection after it.
  test('a code allowed before a password change gets no key', async ({ createUser }) => {
    const user = await createUser()
    const grant = await allowed(user)
    await setUserPassword(user.user!, 'a-new-password-1207')
    await expectOAuthError(await exchange(grant), 400, 'invalid_grant')
  })

  test('a code allowed before all sessions were ended gets no key', async ({ createUser }) => {
    const user = await createUser()
    const grant = await allowed(user)
    await sql`update person set sessions_ended_at = now() + interval '1 second' where row_id = ${user.user!}`
    await expectOAuthError(await exchange(grant), 400, 'invalid_grant')
  })

  // Codex round 2: a password change, ending connections and dropping codes
  // are one write, so an exchange cannot slip a connection in between them.
  test('a password change that cannot finish ending agent access changes nothing', async ({ createUser }) => {
    const user = await createUser()
    await connected(user)
    const [before] = await sql`select password_hash from person where row_id = ${user.user!}`
    await sql`create function pg_temp.refuse_1207() returns trigger language plpgsql as $$ begin raise exception 'refused for the test'; end $$`
    await sql`create trigger refuse_1207 before delete on featherbase.agent_auth_code for each statement execute function pg_temp.refuse_1207()`
    await expect(setUserPassword(user.user!, 'a-new-password-1207')).rejects.toThrow(/refused for the test/)
    const [after] = await sql`select password_hash from person where row_id = ${user.user!}`
    expect(after.password_hash).toBe(before.password_hash)
    const [live] = await sql`select count(*)::int as n from agent_connection where person = ${user.user!} and ended_at is null`
    expect(live.n).toBe(1)
  })

  test('another grant type is refused', async () => {
    await expectOAuthError(await tokenPost({ grant_type: 'client_credentials' }), 400, 'unsupported_grant_type')
  })

  test('the token endpoint is rate-limited per source', async () => {
    vi.stubEnv('PREAUTH_AGENT_TOKEN_MAX', '1')
    await tokenPost({ grant_type: 'client_credentials' })
    await expectStatus(await tokenPost({ grant_type: 'client_credentials' }), 429)
  })
})

describe('#1207 renewing a short key (D3, D4)', () => {
  test('a renewal answers a new pair and revokes the earlier short key', async ({ createUser }) => {
    const first = await connected(await createUser())
    const res = await expectStatus(await renewal(first.clientId, first.refresh_token), 200)
    const next = (await res.json()) as Tokens
    expect(next.refresh_token).not.toBe(first.refresh_token)
    expect(await opensMcp(next.access_token)).toBe(true)
    expect(await opensMcp(first.access_token)).toBe(false)
  })

  test('a renewal deletes the connection\'s expired short keys', async ({ createUser }) => {
    const first = await connected(await createUser())
    await sql`update access_token set expires_at = now() - interval '1 minute' where agent_connection is not null`
    await expectStatus(await renewal(first.clientId, first.refresh_token), 200)
    expect(await sql`select 1 from access_token where agent_connection is not null`).toHaveLength(1)
  })

  test('within two minutes the same key renews again (the grace)', async ({ createUser }) => {
    const user = await createUser()
    const first = await connected(user)
    await expectStatus(await renewal(first.clientId, first.refresh_token), 200)
    await sql`update agent_refresh_token set used_at = used_at - interval '90 seconds' where used_at is not null`
    const again = (await (await expectStatus(await renewal(first.clientId, first.refresh_token), 200)).json()) as Tokens
    expect(await opensMcp(again.access_token)).toBe(true)
    expect(await user.get<{ connections: unknown[] }>('/api/agent-connections')).toMatchObject({ connections: [expect.anything()] })
  })

  test('a key used more than two minutes ago ends the connection', async ({ createUser }) => {
    const user = await createUser()
    const first = await connected(user)
    const next = (await (await renewal(first.clientId, first.refresh_token)).json()) as Tokens
    await sql`update agent_refresh_token set used_at = used_at - interval '3 minutes' where used_at is not null`
    await expectOAuthError(await renewal(first.clientId, first.refresh_token), 400, 'invalid_grant')
    expect(await opensMcp(next.access_token)).toBe(false)
    await expectOAuthError(await renewal(first.clientId, next.refresh_token), 400, 'invalid_grant')
    const [ended] = await sql`select ended_reason from agent_connection where client_id = ${first.clientId}`
    expect(ended.ended_reason).toBe('renewal key reused')
  })

  test('an unknown key is refused', async ({ createUser }) => {
    const first = await connected(await createUser())
    await expectOAuthError(await renewal(first.clientId, 'fbr_nothing'), 400, 'invalid_grant')
  })

  test('a key is refused to another client', async ({ createUser }) => {
    const first = await connected(await createUser())
    await expectOAuthError(await renewal(await registerAgent(), first.refresh_token), 400, 'invalid_grant')
  })

  test('a missing key is a malformed request', async ({ createUser }) => {
    const first = await connected(await createUser())
    await expectOAuthError(await renewal(first.clientId, ''), 400, 'invalid_request')
  })

  test('a disabled person\'s agent is refused, short key and renewal alike', async ({ createUser }) => {
    const user = await createUser()
    const first = await connected(user)
    await sql`update person set enabled = false where row_id = ${user.user!}`
    expect(await opensMcp(first.access_token)).toBe(false)
    await expectOAuthError(await renewal(first.clientId, first.refresh_token), 400, 'invalid_grant')
  })
})

describe('#1207 connection keys beside hand-made access tokens (D10, D11)', () => {
  test('a connection\'s short keys are not in the access token list', async ({ createUser }) => {
    const user = await createUser()
    await issueToken(user, 'my script')
    await connected(user)
    const { tokens } = await user.get<{ tokens: { label: string }[] }>('/api/access_tokens')
    expect(tokens.map((t) => t.label)).toEqual(['my script'])
  })

  test('a hand-made token belongs to no connection', async ({ createUser }) => {
    const user = await createUser()
    await issueToken(user, 'my script')
    const [row] = await sql`select agent_connection from access_token where person = ${user.user!}`
    expect(row.agent_connection).toBeNull()
  })

  test('a password change ends the connection and leaves hand-made tokens working', async ({ createUser }) => {
    const user = await createUser()
    const handMade = await issueToken(user, 'my script')
    const agent = await connected(user)
    await setUserPassword(user.user!, 'a-new-password-1')
    expect(await opensMcp(agent.access_token)).toBe(false)
    expect(await opensMcp(handMade)).toBe(true)
  })

  test('using a short key stamps its connection as used', async ({ createUser }) => {
    const user = await createUser()
    const agent = await connected(user)
    await sql`update agent_connection set last_used_at = now() - interval '3 days' where person = ${user.user!}`
    await opensMcp(agent.access_token)
    const [row] = await sql`select last_used_at > now() - interval '1 minute' as fresh from agent_connection where person = ${user.user!}`
    expect(row.fresh).toBe(true)
  })
})

describe('#1207 Connected apps', () => {
  test('a person lists only their own live connections', async ({ createUser }) => {
    const user = await createUser()
    const other = await createUser()
    await connected(user)
    await connected(other)
    const { connections } = await user.get<{ connections: { client_name: string; return_place: string }[] }>('/api/agent-connections')
    expect(connections).toEqual([expect.objectContaining({ client_name: 'Claude Code', return_place: 'loopback' })])
  })

  test('another person\'s connection cannot be disconnected', async ({ createUser }) => {
    const user = await createUser()
    const other = await createUser()
    const agent = await connected(other)
    const [{ id }] = await sql`select id from agent_connection where person = ${other.user!}`
    await expectStatus(await user.fetch(`/api/agent-connections/${id as string}`, { method: 'DELETE' }), 404)
    expect(await opensMcp(agent.access_token)).toBe(true)
  })
})

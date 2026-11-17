// #1207 (mcp-oauth-connect): the instance's own OAuth 2.1 sign-in server for
// agents (design D1): self-registered public clients (D6), the authorize
// request a signed-in person allows or denies, codes with PKCE S256, and
// short keys renewed with rotating renewal keys (D2-D5). Only hashes of codes,
// renewal keys and short keys are stored.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { sql, withTransaction } from './db'
import { AppError } from './errors'
import { hashToken, issueAccessToken } from './auth'
import { endConnections, liveConnection } from './agent-connections'

/** A short key lives an hour (D5); the client renews it unseen. */
export const SHORT_KEY_SECONDS = 3600

/** An RFC 6749 / RFC 7591 refusal: `{ error, error_description }`. */
export class OAuthError extends Error {
  constructor(readonly error: string, description: string, readonly status: 400 | 401 = 400) {
    super(description)
  }
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost'])
const isLoopback = (url: URL) => url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)

/** A return address an agent may register (D6): https, or http on the
 *  person's own computer, never with a fragment. */
function returnAddress(uri: unknown): URL | null {
  if (typeof uri !== 'string' || uri.includes('#') || !URL.canParse(uri)) return null
  const url = new URL(uri)
  return url.protocol === 'https:' || isLoopback(url) ? url : null
}

/** Where a code goes back to, as the person is told: 'loopback' for their own
 *  computer, else the website's origin (D8). */
const returnPlaceOf = (url: URL) => (isLoopback(url) ? 'loopback' : url.origin)

/** The address exactly as registered; a loopback one on any port (RFC 8252). */
function registered(requested: string, uris: string[]): boolean {
  if (uris.includes(requested)) return true
  const url = returnAddress(requested)
  if (!url || !isLoopback(url)) return false
  const portless = (u: URL) => { const copy = new URL(u.href); copy.port = ''; return copy.href }
  return uris.some((uri) => isLoopback(new URL(uri)) && portless(new URL(uri)) === portless(url))
}

export async function registerClient(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new OAuthError('invalid_client_metadata', 'Expected the client metadata as a JSON object')
  const meta = body as Record<string, unknown>
  const uris = meta.redirect_uris
  if (!Array.isArray(uris) || !uris.length) throw new OAuthError('invalid_redirect_uri', 'At least one redirect URI is required')
  for (const uri of uris)
    if (!returnAddress(uri))
      throw new OAuthError('invalid_redirect_uri', 'A redirect URI must be https, or http on 127.0.0.1, [::1] or localhost, without a fragment')
  if (meta.token_endpoint_auth_method !== undefined && meta.token_endpoint_auth_method !== 'none')
    throw new OAuthError('invalid_client_metadata', 'Only public clients may register: token_endpoint_auth_method must be "none"')
  const name = typeof meta.client_name === 'string' ? meta.client_name.trim() : ''
  if (!name || [...name].length > 140)
    throw new OAuthError('invalid_client_metadata', 'A client_name of at most 140 characters is required: the person is shown it')
  const [client] = await sql`
    insert into agent_client (id, client_name, redirect_uris)
    values (${'cli_' + randomBytes(12).toString('hex')}, ${name}, ${uris as string[]}::text[])
    returning id, client_name, redirect_uris, floor(extract(epoch from created_at))::int as issued_at`
  return {
    client_id: client.id as string,
    client_id_issued_at: client.issued_at as number,
    client_name: client.client_name as string,
    redirect_uris: client.redirect_uris as string[],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  }
}

/** An authorize request that passed every check. */
export interface AuthorizeRequest {
  clientId: string
  clientName: string
  redirectUri: string
  returnPlace: string
  codeChallenge: string
  state?: string
}

/** The authorize query, checked. A bad client or return address is an error
 *  for the page to show, never a redirect (no open redirect). */
export async function checkAuthorizeRequest(query: Record<string, string | undefined>): Promise<AuthorizeRequest> {
  const refuse = (message: string) => new AppError('BadRequestError', message)
  const [client] = query.client_id ? await sql`select id, client_name, redirect_uris from agent_client where id = ${query.client_id}` : []
  if (!client) throw refuse('This agent is not registered here. Start connecting it again from the agent.')
  if (!query.redirect_uri || !registered(query.redirect_uri, client.redirect_uris as string[]))
    throw refuse('This agent asked to return to an address it did not register.')
  if (query.response_type !== 'code') throw refuse('The agent must ask with response_type=code.')
  if (query.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(query.code_challenge ?? ''))
    throw refuse('The agent must send a PKCE code_challenge with code_challenge_method=S256.')
  return {
    clientId: client.id as string,
    clientName: client.client_name as string,
    redirectUri: query.redirect_uri,
    returnPlace: returnPlaceOf(new URL(query.redirect_uri)),
    codeChallenge: query.code_challenge!,
    state: query.state,
  }
}

/** D8: the person already allowed an agent of this name returning to this
 *  place, and that connection is still live. */
export async function isRemembered(person: string, request: AuthorizeRequest): Promise<boolean> {
  const [hit] = await sql`
    select 1 from agent_connection ac join person p on p.row_id = ac.person
    where ac.person = ${person} and ac.client_name = ${request.clientName} and ac.return_place = ${request.returnPlace}
      and ${liveConnection()}
    limit 1`
  return Boolean(hit)
}

/** The person's Allow or Deny: the address the browser goes back to, with a
 *  code (five minutes, single use) or `error=access_denied`, and the state. */
export async function decide(person: string, request: AuthorizeRequest, allow: boolean): Promise<string> {
  const back = new URL(request.redirectUri)
  if (allow) {
    const code = randomBytes(32).toString('base64url')
    await sql`delete from agent_auth_code where expires_at <= now()`
    await sql`
      insert into agent_auth_code (code_hash, client_id, person, redirect_uri, code_challenge, return_place, expires_at)
      values (${hashToken(code)}, ${request.clientId}, ${person}, ${request.redirectUri}, ${request.codeChallenge},
              ${request.returnPlace}, now() + interval '5 minutes')`
    back.searchParams.set('code', code)
  } else {
    back.searchParams.set('error', 'access_denied')
  }
  if (request.state !== undefined) back.searchParams.set('state', request.state)
  return back.href
}

export interface TokenAnswer {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token: string
  scope: 'mcp'
}

async function knownClient(clientId: string | undefined): Promise<{ id: string }> {
  const [client] = clientId ? await sql`select id from agent_client where id = ${clientId}` : []
  if (!client) throw new OAuthError('invalid_client', 'Unknown client_id', 401)
  return { id: client.id as string }
}

/** PKCE S256: the verifier hashes to the challenge, compared in constant time. */
function verifierMatches(verifier: string, challenge: string): boolean {
  const computed = Buffer.from(createHash('sha256').update(verifier).digest('base64url'))
  const expected = Buffer.from(challenge)
  return computed.length === expected.length && timingSafeEqual(computed, expected)
}

/** A fresh short key and renewal key for a connection (D2, D3). */
async function mintPair(connectionId: string, person: string, clientName: string): Promise<TokenAnswer> {
  const access = await issueAccessToken(person, clientName, new Date(Date.now() + SHORT_KEY_SECONDS * 1000), connectionId)
  const renewal = 'fbr_' + randomBytes(32).toString('base64url')
  await sql`insert into agent_refresh_token (token_hash, connection_id) values (${hashToken(renewal)}, ${connectionId})`
  return { access_token: access.token, token_type: 'Bearer', expires_in: SHORT_KEY_SECONDS, refresh_token: renewal, scope: 'mcp' }
}

const BAD_CODE = 'The sign-in code is invalid, expired or already used'

/** grant_type=authorization_code: the code is burned whatever follows, then
 *  checked; a good one makes the connection. */
export async function exchangeCode(form: Record<string, string>): Promise<TokenAnswer> {
  const { code, redirect_uri, client_id, code_verifier } = form
  if (!code || !redirect_uri || !code_verifier) throw new OAuthError('invalid_request', 'code, redirect_uri, client_id and code_verifier are required')
  const client = await knownClient(client_id)
  // Burned in its own statement, so a refused exchange cannot be retried.
  const [grant] = await sql`
    delete from agent_auth_code where code_hash = ${hashToken(code)}
    returning client_id, person, redirect_uri, code_challenge, return_place, expires_at > now() as fresh`
  if (!grant || !grant.fresh || grant.client_id !== client.id || grant.redirect_uri !== redirect_uri
    || !verifierMatches(code_verifier, grant.code_challenge as string))
    throw new OAuthError('invalid_grant', BAD_CODE)
  const person = grant.person as string
  return withTransaction(async () => {
    const [who] = await sql`
      select p.enabled, c.client_name from person p join agent_client c on c.id = ${client.id} where p.row_id = ${person}`
    if (!who?.enabled) throw new OAuthError('invalid_grant', BAD_CODE)
    const id = 'con_' + randomBytes(12).toString('hex')
    await sql`insert into agent_connection (id, person, client_id, client_name, return_place)
      values (${id}, ${person}, ${client.id}, ${who.client_name as string}, ${grant.return_place as string})`
    return mintPair(id, person, who.client_name as string)
  })
}

const BAD_RENEWAL = 'The renewal key is invalid, or its connection has ended'

/** grant_type=refresh_token (D4): an unused key, or one used under two
 *  minutes ago, renews; a key used earlier ends the connection. */
export async function renew(form: Record<string, string>): Promise<TokenAnswer> {
  const { refresh_token, client_id } = form
  if (!refresh_token) throw new OAuthError('invalid_request', 'refresh_token and client_id are required')
  const client = await knownClient(client_id)
  const renewed = await withTransaction(async () => {
    const hash = hashToken(refresh_token)
    const [key] = await sql`
      select rt.used_at is not null as used, rt.used_at > now() - interval '2 minutes' as in_grace,
        ac.id, ac.client_id, ac.person, ac.client_name, ${liveConnection()} as live
      from agent_refresh_token rt
      join agent_connection ac on ac.id = rt.connection_id
      join person p on p.row_id = ac.person
      where rt.token_hash = ${hash}
      for update of rt, ac`
    if (!key || key.client_id !== client.id || !key.live) return null
    const id = key.id as string
    if (key.used && !key.in_grace) {
      await endConnections(key.person as string, 'renewal key reused', id)
      return null
    }
    await sql`update agent_refresh_token set used_at = coalesce(used_at, now()) where token_hash = ${hash}`
    await sql`delete from access_token where agent_connection = ${id} and expires_at <= now()`
    await sql`update access_token set revoked_at = now() where agent_connection = ${id} and revoked_at is null`
    await sql`update agent_connection set last_used_at = now() where id = ${id}`
    return mintPair(id, key.person as string, key.client_name as string)
  })
  if (!renewed) throw new OAuthError('invalid_grant', BAD_RENEWAL)
  return renewed
}

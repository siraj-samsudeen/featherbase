// An agent that connects WITHOUT a token (mcp-oauth-connect, #1207): the MCP
// SDK's own client with its own OAuth flow (`authProvider`), the way Claude
// Code connects from the instance's agent address alone. The provider keeps
// its registration and tokens in memory; every request (the agent's and the
// browser's) is served in-process by the test app (sandboxRequest), inside the
// test's transaction.
//
// The browser step is played by a signed-in test person: the connect page
// asks `GET /api/agent-auth/request?<authorize query>` what is asking, and
// posts the person's choice to `POST /api/agent-auth/decision`, which answers
// `{ redirect }`: the agent's return address with a `code` or an `error`.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { UnauthorizedError, type OAuthClientProvider, type OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { TestClient } from 'feather-testing-postgres'
import { sandboxRequest } from './pg-test-shared'
import { MCP_URL, type ToolResult } from './agent-driver'

const sandboxFetch = (url: string | URL, init?: RequestInit) => sandboxRequest(String(url), init)

let nextPort = 52000
/** A loopback return address, as a local client picks one: a new port each time. */
export const loopbackRedirect = () => `http://127.0.0.1:${nextPort++}/callback`

/** What the connect page is told about the agent asking (the request route). */
export interface ConsentRequest {
  client_name: string
  return_place: string
  person: string
  remembered: boolean
}

/** One visit of the person's browser to the connect page. */
export interface BrowserVisit {
  /** The request route's status: 401 when the browser is signed out. */
  status: number
  /** What the page shows, when the request was answered. */
  consent?: ConsentRequest
  /** Whether the person was asked to choose (false when the page went straight back). */
  asked: boolean
  /** The address the browser was sent back to, when a decision was made. */
  redirect?: URL
}

/** Allow, Deny, or only look at the page and leave it. */
export type Choice = 'allow' | 'deny' | 'look'

class MemoryProvider implements OAuthClientProvider {
  info: OAuthClientInformationMixed | undefined
  saved: OAuthTokens | undefined
  verifier = ''
  discovery: OAuthDiscoveryState | undefined
  /** Where the SDK last sent the browser; cleared once the browser has been there. */
  pending: URL | undefined
  constructor(readonly redirectUrl: string, readonly clientName: string) {}
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.clientName,
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }
  }
  state() { return 'state-' + Math.random().toString(36).slice(2) }
  clientInformation() { return this.info }
  saveClientInformation(info: OAuthClientInformationMixed) { this.info = info }
  tokens() { return this.saved }
  saveTokens(tokens: OAuthTokens) { this.saved = tokens }
  redirectToAuthorization(url: URL) { this.pending = url }
  saveCodeVerifier(verifier: string) { this.verifier = verifier }
  codeVerifier() { return this.verifier }
  saveDiscoveryState(state: OAuthDiscoveryState) { this.discovery = state }
  discoveryState() { return this.discovery }
  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all' || scope === 'client') this.info = undefined
    if (scope === 'all' || scope === 'tokens') this.saved = undefined
    if (scope === 'all' || scope === 'verifier') this.verifier = ''
    if (scope === 'all' || scope === 'discovery') this.discovery = undefined
  }
}

export interface OAuthAgentOptions {
  /** The name the agent registers under. */
  clientName?: string
  /** Where the agent asks the browser to return; a loopback address by default. */
  redirectUrl?: string
}

/** The browser of a person: signed in (their session cookie) or, with null, signed out. */
const browserHeaders = (person: TestClient | null): Record<string, string> =>
  person?.token ? { cookie: `sid=${person.token}` } : {}

export class OAuthAgent {
  readonly provider: MemoryProvider
  readonly visits: BrowserVisit[] = []
  private client: Client | undefined
  private transport: StreamableHTTPClientTransport | undefined

  constructor(opts: OAuthAgentOptions = {}) {
    this.provider = new MemoryProvider(opts.redirectUrl ?? loopbackRedirect(), opts.clientName ?? 'Claude Code')
  }

  /** Whether the agent holds a working MCP session. */
  get connected() { return this.client !== undefined }
  /** Where the agent wants the browser to go to sign in, if it does. */
  get pendingAuthorization() { return this.provider.pending }
  /** The key the agent renews itself with. */
  get refreshToken() { return this.provider.saved?.refresh_token }
  /** The authorization server's token endpoint, as the agent discovered it. */
  get tokenEndpoint() { return this.provider.discovery?.authorizationServerMetadata?.token_endpoint }

  /**
   * The person gives the agent the instance's agent address: the agent tries
   * /mcp, and when it is turned away it registers and sends the browser off to
   * sign in (`pendingAuthorization`). True when it connected straight away.
   */
  async start(): Promise<boolean> {
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), { authProvider: this.provider, fetch: sandboxFetch })
    const client = new Client({ name: this.provider.clientName, version: '1.0.0' })
    try {
      await client.connect(transport)
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        this.transport = transport
        return false
      }
      throw error
    }
    this.transport = transport
    this.client = client
    return true
  }

  /**
   * The person's browser opens the address the agent sent it to. Signed out,
   * the page is refused (401) and the visit ends there. Signed in, the page
   * shows what is asking; when the Allow is remembered it goes straight back,
   * otherwise the person chooses. On a returned code the agent finishes
   * signing in and connects.
   */
  async browse(person: TestClient | null, choice: Choice): Promise<BrowserVisit> {
    const url = this.provider.pending
    if (!url) throw new Error('The agent has not sent the browser anywhere')
    const query = url.search
    const asked = await sandboxRequest(`http://localhost/api/agent-auth/request${query}`, { headers: browserHeaders(person) })
    const visit: BrowserVisit = { status: asked.status, asked: false }
    this.visits.push(visit)
    if (!asked.ok) return visit
    visit.consent = (await asked.json()) as ConsentRequest
    visit.asked = !visit.consent.remembered
    const decision = visit.consent.remembered ? 'allow' : choice
    if (decision === 'look') return visit
    const decided = await sandboxRequest(`http://localhost/api/agent-auth/decision${query}`, {
      method: 'POST',
      headers: { ...browserHeaders(person), 'content-type': 'application/json' },
      body: JSON.stringify({ allow: decision === 'allow' }),
    })
    if (!decided.ok) throw new Error(`The decision was refused: ${decided.status} ${await decided.text()}`)
    visit.redirect = new URL(((await decided.json()) as { redirect: string }).redirect)
    this.provider.pending = undefined
    const code = visit.redirect.searchParams.get('code')
    if (code) {
      await this.transport!.finishAuth(code)
      if (!(await this.start())) throw new Error('The agent signed in but /mcp still turned it away')
    }
    return visit
  }

  /** A tool's result; an UnauthorizedError when the agent is turned away and must sign in again. */
  async call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    if (!this.client) throw new Error('The agent is not connected')
    return (await this.client.callTool({ name, arguments: args })) as unknown as ToolResult
  }

  /** The agent looks for a customer by name: the rows it found, or how it was refused. */
  async findCustomer(name: string): Promise<{ rows: Record<string, unknown>[] } | { refused: unknown }> {
    try {
      const result = await this.call('query_rows', { table: 'Customer', filters: [['customer_name', '=', name]] })
      if (result.isError) return { refused: result.content.map((c) => c.text).join('\n') }
      return { rows: (result.structuredContent as { rows: Record<string, unknown>[] }).rows }
    } catch (error) {
      return { refused: error }
    }
  }
}

/** The agent, given the address, signs in through `person`'s browser with Allow. */
export async function connectByAddress(person: TestClient, opts: OAuthAgentOptions = {}): Promise<OAuthAgent> {
  const agent = new OAuthAgent(opts)
  if (!(await agent.start())) await agent.browse(person, 'allow')
  if (!agent.connected) throw new Error('The agent did not connect')
  return agent
}

/** A renewal posted the way any client posts one, for a copied key. */
export function renewWith(tokenEndpoint: string, clientId: string, refreshToken: string): Promise<Response> {
  return sandboxRequest(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId }).toString(),
  })
}

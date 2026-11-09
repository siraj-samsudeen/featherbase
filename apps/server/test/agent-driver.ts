// An agent for the tests: the MCP SDK's own client, connected to the app's
// /mcp over the Streamable HTTP transport, its requests served in-process by
// the test app (sandboxRequest), so they run inside the test's transaction.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { TestClient } from 'feather-testing-postgres'
import { sandboxRequest } from './pg-test-shared'

export const MCP_URL = 'http://localhost/mcp'

export interface ToolResult {
  isError?: boolean
  content: { type: string; text: string }[]
  structuredContent?: Record<string, unknown>
}

export interface Agent {
  client: Client
  /** A tool's result, refused or not; the parsed JSON of a success is in `structuredContent`. */
  call(name: string, args?: Record<string, unknown>): Promise<ToolResult>
  /** A tool's structured result, failing the test when the tool refused. */
  ok<T = Record<string, unknown>>(name: string, args?: Record<string, unknown>): Promise<T>
}

/** An access token for `owner` (a person's own client, or an admin issuing one for a service account). */
export async function issueToken(client: TestClient, label = 'my agent', serviceAccount?: string): Promise<string> {
  const issued = await client.post<{ token: string }>('/api/access_tokens', { label, ...(serviceAccount ? { owner: serviceAccount } : {}) })
  return issued.token
}

/** One MCP request posted the way any client would, for checks below the SDK. */
export function postMcp(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return sandboxRequest(MCP_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  })
}

export async function connectAgent(token: string): Promise<Agent> {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: (url, init) => sandboxRequest(String(url), init),
  })
  const client = new Client({ name: 'test-agent', version: '1.0.0' })
  await client.connect(transport)
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as unknown as ToolResult
  return {
    client,
    call,
    ok: async <T>(name: string, args: Record<string, unknown> = {}) => {
      const result = await call(name, args)
      if (result.isError) throw new Error(`${name} refused: ${result.content.map((c) => c.text).join('\n')}`)
      return result.structuredContent as T
    },
  }
}

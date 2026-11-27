// #1377: Featherbase's MCP tools for an app's outbound read that declares
// featherbaseMcp. The same tool server an agent reaches at /mcp (mcp.ts), built
// in memory, no network. Each call is an inner /api request carrying the
// caller's own credential (ADR 0028), so every front-door check applies on every
// call. Only the read-only tools are offered or run.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { FeatherbaseMcpTool, FeatherbaseMcpTools } from 'shared'
import { runAsAgent } from './agent-context'
import type { Credential } from './caller-credential'
import { buildServer, Refusal, type ApiApp, type Envelope } from './mcp'
import type { Api, Json } from './mcp-common'

// The app whose /api routes serve the tools (index.ts sets it).
let mcpApp: ApiApp | undefined
export function serveFeatherbaseMcp(app: ApiApp) {
  mcpApp = app
}

/** The tools for one read, with the caller's credential (a session or an access token): each
 *  call reads exactly what they may read, in every app. The credential stays in this closure,
 *  never in a result or a refusal. label names the caller in history ("via Ask"). */
export function featherbaseMcp(credential: Credential, label: string): FeatherbaseMcpTools & { close(): Promise<void> } {
  // Marked as an agent's call, as /mcp's are: history, and the installed version of every app.
  const mark = { token_id: 'in-memory', token_label: label }
  const api: Api = async (method, path, body) => {
    const res = await runAsAgent(mark, () => mcpApp!.request(path, {
      method,
      headers: { authorization: credential.header(), 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }))
    const json = (await res.json()) as Json
    if (!res.ok) throw new Refusal(json.error as Envelope)
    return json
  }
  // Connected on first use, closed when the read ends.
  let open: Promise<{ client: Client; tools: FeatherbaseMcpTool[]; close(): Promise<void> }> | undefined
  const connect = () => open ??= (async () => {
    // The token id only signs run_import's check, a tool never offered here.
    const server = buildServer(api, '')
    const client = new Client({ name: 'featherbase-app-read', version: '1.0.0' })
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverSide), client.connect(clientSide)])
    const tools = (await client.listTools()).tools
      .filter((tool) => tool.annotations?.readOnlyHint === true)
      .map(({ name, description, inputSchema }) => ({ name, description: description ?? '', inputSchema }))
    return { client, tools, close: async () => { await client.close(); await server.close() } }
  })()
  return {
    tools: async () => (await connect()).tools,
    async call(name, args) {
      const { client, tools } = await connect()
      if (!tools.some((tool) => tool.name === name)) return { ok: false, reason: `There is no tool called ${name}` }
      const answer = await client.callTool({ name, arguments: args })
      const text = (answer.content as { type: string; text?: string }[]).map((part) => part.text ?? '').join('\n')
      return answer.isError ? { ok: false, reason: text } : { ok: true, result: answer.structuredContent ?? text }
    },
    async close() {
      if (open) await (await open).close()
    },
  }
}

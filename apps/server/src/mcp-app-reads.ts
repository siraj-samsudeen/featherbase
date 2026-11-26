// #1377: Featherbase's MCP tools for an app's outbound read that declares
// featherbaseMcp. The same tool server an agent reaches at /mcp (mcp.ts), built
// in memory, no network. Each call runs as the person, with a pass: a 5-minute
// access token the platform issues for them (ADR 0021: only an access token
// opens the tools). Only the read-only tools are offered or run.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { FeatherbaseMcpTool, FeatherbaseMcpTools } from 'shared'
import { issueAccessToken } from './auth'
import { runAsAgent } from './agent-context'
import { buildServer, Refusal, type ApiApp, type Envelope } from './mcp'
import type { Api, Json } from './mcp-common'

// The app whose /api routes serve the tools (index.ts sets it).
let mcpApp: ApiApp | undefined
export function serveFeatherbaseMcp(app: ApiApp) {
  mcpApp = app
}

// A pass is kept only here, in memory, reused for the person's next questions,
// and renewed when under 2 minutes remain. It expires on its own.
const PASS_MS = 5 * 60_000
const RENEW_UNDER_MS = 2 * 60_000
type Pass = { token: string; id: string; label: string; expiresAt: number }
const passes = new Map<string, Promise<Pass>>()

async function passFor(person: string, label: string): Promise<Pass> {
  const key = `${person}\n${label}`
  const held = await passes.get(key)?.catch(() => undefined)
  if (held && held.expiresAt - Date.now() > RENEW_UNDER_MS) return held
  const issued = issueAccessToken(person, label, new Date(Date.now() + PASS_MS))
    .then(({ token, id, label, expires_at }) => ({ token, id, label, expiresAt: Date.parse(expires_at!) }))
  passes.set(key, issued)
  // A refused pass (a disabled person) is not kept.
  issued.catch(() => { if (passes.get(key) === issued) passes.delete(key) })
  return issued
}

/** The tools for one read, as the person: each call reads exactly what they may read,
 *  in every app. label names the pass, as history shows it ("via Feather Ask"). */
export function featherbaseMcp(person: string, label: string): FeatherbaseMcpTools & { close(): Promise<void> } {
  const api: Api = async (method, path, body) => {
    const pass = await passFor(person, label)
    // Marked as an agent's call, as /mcp's are: it speaks the installed version of every app.
    const res = await runAsAgent({ token_id: pass.id, token_label: pass.label }, () => mcpApp!.request(path, {
      method,
      headers: { authorization: `Bearer ${pass.token}`, 'content-type': 'application/json' },
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

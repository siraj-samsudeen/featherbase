// #1083: the Model Context Protocol at /mcp (openspec change mcp-server,
// ADR 0021). An agent connects with one of its person's access tokens and
// gets seven generic tools; each call is served by the existing HTTP API,
// in-process, with that same token (D3), so permissions, Data Scope,
// sensitive columns, the trigger chain, realtime and the rate budget apply
// unchanged. Stateless Streamable HTTP: a fresh server per request (D1).
import type { Context } from 'hono'
import * as z from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { resolveAccessTokenCaller, type AccessTokenCaller } from './auth'
import { runAsAgent } from './agent-context'
import { config } from './config'
import { AppError } from './errors'
import { getMeta } from './meta'
import { LIST_OPERATORS } from './query'
import { registerTableTools } from './mcp-table-tools'
import { ADDS, ALTERS, LAYOUT_TYPES, NESTED, READS, describeColumn, tablePath, type Api, type ColumnMeta, type Json, type RegisterTool } from './mcp-common'

/** The app whose /api routes serve the tools (index.ts passes itself). */
export interface ApiApp {
  request(input: string, init: RequestInit): Response | Promise<Response>
}

/** D7: an agent's page, smaller than the HTTP API's 500 so one never floods its context. */
export const MCP_PAGE_DEFAULT = 20
export const MCP_PAGE_CAP = 100

type Envelope = { type: string; message: string; fields?: Record<string, string> }

/** The inner request was refused: the API's own error, passed on as it is (D6).
 *  It has the envelope's shape, as an AppError (getMeta's) has. */
class Refusal extends Error implements Envelope {
  readonly type: string
  readonly fields?: Record<string, string>
  constructor(envelope: Envelope) {
    super(envelope.message)
    this.type = envelope.type
    this.fields = envelope.fields
  }
}

type TableMetaReply = { name: string; label: string | null; description: string | null; columns: ColumnMeta[]; readable_columns: string[] }

const tableArg = z.string().min(1).describe('The Table\'s name, as list_tables gives it')
const idArg = z.string().min(1).describe('The row\'s id (row_id)')
// #1101: the version the agent read; a change is checked against it, never
// against a version the tool read for it (mcp-update-needs-version D1).
const READ_FIRST = 'Read the row first (get_row or query_rows) and pass the updated_at it gave'
const versionArg = z.string({ error: READ_FIRST }).min(1, READ_FIRST).describe(
  'The row\'s updated_at as get_row or query_rows gave it; refused if someone changed the row since')
const valuesArg = z.record(z.string(), z.unknown()).describe(
  'Column name to value, as describe_table names them. A nested-row column takes a list of objects.')

/** A tool's answer: the JSON as text, and the same object as structured content. */
function reply(value: Json) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: value }
}

/** D6: a refusal in the API's own words, one line per column at fault. */
function refused({ type, message, fields }: Envelope) {
  const lines = [`${type}: ${message}`, ...Object.entries(fields ?? {}).map(([column, why]) => `${column}: ${why}`)]
  const error = { type, message, ...(fields ? { fields } : {}) }
  return { content: [{ type: 'text' as const, text: lines.join('\n') }], structuredContent: { error }, isError: true }
}

const rowPath = (table: string, id: string) => `${tablePath(table)}/${encodeURIComponent(id)}`

/** The columns of a Table's `:meta` reply that the caller may read and that hold a value. */
const readableColumns = (meta: TableMetaReply) =>
  meta.columns.filter((column) => meta.readable_columns.includes(column.column_name) && !LAYOUT_TYPES.has(column.column_type))

function buildServer(api: Api, tokenId: string): McpServer {
  const server = new McpServer({ name: 'featherbase', version: '1.0.0' })
  const tool: RegisterTool = (name, description, inputSchema, annotations, run) => {
    server.registerTool(name, { description, inputSchema, annotations }, (async (args: Parameters<typeof run>[0]) => {
      try {
        return reply(await run(args))
      } catch (error) {
        // A Refusal from the inner request, or an AppError (getMeta's, the
        // tool layer's own): both are envelopes.
        return refused(error as Envelope)
      }
    }) as never)
  }

  const meta = (table: string) => api('GET', `${tablePath(table)}:meta`) as Promise<TableMetaReply>

  tool('list_tables', 'The Tables you can read, with each one\'s label and description. Start here.', {}, READS, async () => {
    const { tables } = (await api('GET', '/api/navigable_tables')) as { tables: string[] }
    const described = []
    for (const name of tables) {
      const table = await getMeta(name)
      described.push({ name, label: table.label || name, description: table.description })
    }
    return { tables: described }
  })

  tool('describe_table',
    'What a Table holds: each column you can read, its type, whether it is required, the choices it allows, '
    + 'the Table it links to, and for a nested-row column its own columns. Read this before adding or changing rows.',
    { table: tableArg }, READS, async ({ table }) => {
      const described = await meta(table)
      const columns = []
      for (const column of readableColumns(described)) {
        const nested = column.column_type === NESTED && column.row_table ? readableColumns(await meta(column.row_table)).map(describeColumn) : undefined
        columns.push({ ...describeColumn(column), ...(nested ? { columns: nested } : {}) })
      }
      return { table: described.name, label: described.label || described.name, description: described.description, columns }
    })

  tool('query_rows',
    `Find rows of a Table. filters: a list of [column, operator, value], all of which must hold; operators: ${LIST_OPERATORS.join(', ')}. `
    + `"like" takes % wildcards; "in" and "not in" take a list. order_by: "column asc" or "column desc". `
    + `At most ${MCP_PAGE_CAP} rows a page (default ${MCP_PAGE_DEFAULT}); "total" says how many match, so page on with offset. `
    + 'Without columns, every column you can read except nested rows, and updated_at, the version update_row and delete_row take. '
    + 'Retired rows are left out unless include_retired.',
    {
      table: tableArg,
      filters: z.array(z.tuple([z.string(), z.enum(LIST_OPERATORS as [string, ...string[]]), z.unknown()])).optional(),
      columns: z.array(z.string()).optional().describe('The columns to return'),
      order_by: z.string().optional(),
      limit: z.number().int().min(1).optional().describe(`Rows a page, at most ${MCP_PAGE_CAP}`),
      offset: z.number().int().min(0).optional(),
      include_retired: z.boolean().optional(),
    },
    READS,
    async ({ table, filters, columns, order_by, limit, offset, include_retired }) => {
      const fields = columns ?? ['row_id', ...readableColumns(await meta(table)).filter((c) => c.column_type !== NESTED).map((c) => c.column_name), 'updated_at']
      const query = new URLSearchParams({
        fields: JSON.stringify(fields),
        filters: JSON.stringify(filters ?? []),
        limit_page_length: String(Math.min(limit ?? MCP_PAGE_DEFAULT, MCP_PAGE_CAP)),
        limit_start: String(offset ?? 0),
        with_retired: String(include_retired === true),
      })
      if (order_by) query.set('order_by', order_by)
      const page = await api('GET', `${tablePath(table)}?${query}`)
      return { rows: page.data, total: page.total, offset: page.limit_start, limit: page.limit_page_length }
    })

  tool('get_row', 'One row by its id, with every value you can read, nested rows included, and its updated_at, '
    + 'the version update_row and delete_row take.', { table: tableArg, id: idArg }, READS,
    ({ table, id }) => api('GET', rowPath(table, id)))

  tool('create_row',
    'Add a row. The Table\'s checks and automations run as when its person saves it in Featherbase. Returns the saved row.',
    { table: tableArg, values: valuesArg }, ADDS,
    ({ table, values }) => api('POST', tablePath(table), values))

  tool('update_row',
    'Change a row: only the columns named in values change. A nested-row list sent replaces the whole list. '
    + 'Pass the row\'s updated_at as you last read it: the change is refused if someone changed the row since, '
    + 'so read it again and decide. Returns the saved row, with its new updated_at.',
    { table: tableArg, id: idArg, values: valuesArg, updated_at: versionArg }, ALTERS,
    ({ table, id, values, updated_at }) => api('PATCH', rowPath(table, id), { ...values, updated_at }))

  tool('delete_row',
    'Delete a row, under the same rules as deleting it in Featherbase. Pass the row\'s updated_at as you last read it; '
    + 'where Featherbase keeps a version check for the row, the delete is refused if someone changed it since.',
    { table: tableArg, id: idArg, updated_at: versionArg }, ALTERS,
    async ({ table, id, updated_at }) => {
      await api('DELETE', `${rowPath(table, id)}?${new URLSearchParams({ updated_at })}`)
      return { deleted: id }
    })

  registerTableTools(tool, api, tokenId)
  return server
}

/** POST /mcp. Only an access token opens it (D2), and each tool call is one
 *  inner /api request with that token, marked as an agent's (D8). */
export function mcpHandler(app: ApiApp) {
  return async (c: Context): Promise<Response> => {
    const origin = c.req.header('origin')
    if (origin && !config.allowedOrigins.includes(origin))
      throw new AppError('PermissionError', `A page on ${origin} may not reach /mcp`)
    const authorization = c.req.header('authorization')
    const caller: AccessTokenCaller = await resolveAccessTokenCaller(authorization)
    const mark = { token_id: caller.token.id, token_label: caller.token.label }
    const api = async (method: string, path: string, body?: Json): Promise<Json> => {
      const res = await runAsAgent(mark, () => app.request(path, {
        method,
        headers: { authorization: authorization!, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }))
      const json = (await res.json()) as Json
      if (!res.ok) throw new Refusal(json.error as Envelope)
      return json
    }
    const server = buildServer(api, caller.token.id)
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await server.connect(transport)
    try {
      return await transport.handleRequest(c.req.raw)
    } finally {
      await server.close()
    }
  }
}

/** GET and DELETE /mcp: no stream to open and no session to end (D1). */
export function mcpMethodNotAllowed(c: Context): Response {
  c.header('Allow', 'POST')
  return c.json({ error: { type: 'MethodNotAllowedError', message: '/mcp takes POST only: it keeps no stream and no session' } }, 405)
}

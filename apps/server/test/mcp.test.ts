// #1083: /mcp, the Model Context Protocol endpoint (design D1-D8 of the
// mcp-server change). The agent-access scenarios are in
// test/scenarios/agent-access.test.ts; these pin what they leave out: the
// mount, the credential rules, paging, the refusal shape and the tool texts.
import { describe, expect } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { grantRole, makeTable, tableRef } from './fixtures'
import { connectAgent, issueToken, MCP_URL, postMcp, type Agent } from './agent-driver'
import { sandboxRequest } from './pg-test-shared'
import { sql } from '../src/db'
import { config } from '../src/config'
import { resetRateLimit } from '../src/rate-limit'
import { LIST_OPERATORS } from '../src/query'

const NOTE = tableRef('Mcp Note')
const ROLE = 'Mcp Note Keeper'
type Row = Record<string, unknown> & { row_id: string; updated_at: string }
type Page = { rows: Row[]; total: number; offset: number; limit: number }

async function notes(admin: TestClient, count = 3) {
  await makeTable(admin, { name: 'Mcp Line', module: 'Custom', kind: 'sub_table', columns: ['item'] })
  await makeTable(admin, {
    name: 'Mcp Note', module: 'Custom', track_changes: true,
    columns: ['title', { column_name: 'body', column_type: 'Text', description: 'The note itself' }, { column_name: 'lines', column_type: 'Sub-table', row_table: 'Mcp Line' },
      { column_name: 'author', column_type: 'Reference', reference_table: 'Person', read_only: true }],
  })
  await grantRole(admin, { role: ROLE, table: ['Mcp Note', 'Mcp Line'], can_read: true, can_write: true, can_create: true, can_delete: true })
  const ids: string[] = []
  for (let i = 1; i <= count; i++) ids.push((await admin.post<Row>(NOTE.url, { title: `note ${i}`, body: `body ${i}` })).row_id)
  return ids
}

async function keeper(createUser: (opts?: { roles?: string[] }) => Promise<TestClient>) {
  const user = await createUser({ roles: [ROLE] })
  const token = await issueToken(user)
  return { user, token, agent: await connectAgent(token) }
}

const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'curl', version: '1' } } }
const text = (result: { content: { text: string }[] }) => result.content.map((c) => c.text).join('\n')

describe('#1083 /mcp: the mount (D1)', () => {
  test('initialize answers with the server and its tools capability, as plain JSON', async ({ admin }) => {
    const res = await postMcp(initialize, { authorization: `Bearer ${await issueToken(admin)}` })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    expect(res.headers.get('mcp-session-id')).toBeNull()
    const body = await res.json() as { result: { serverInfo: { name: string }; capabilities: Record<string, unknown> } }
    expect(body.result.serverInfo.name).toBe('featherbase')
    expect(body.result.capabilities).toHaveProperty('tools')
  })

  test('the seventeen tools are listed: rows, then a Table\'s structure and imports (#1105)', async ({ admin }) => {
    const agent = await connectAgent(await issueToken(admin))
    expect((await agent.client.listTools()).tools.map((t) => t.name).sort())
      .toEqual([
        'add_column', 'change_column', 'check_import', 'create_row', 'create_table', 'delete_row', 'describe_table', 'get_row',
        'list_imports', 'list_tables', 'query_rows', 'remove_column', 'rename_column', 'run_import', 'suggest_table', 'undo_import', 'update_row',
      ])
  })

  for (const method of ['GET', 'DELETE'])
    test(`${method} /mcp is 405: no stream and no session to end`, async ({ admin }) => {
      const res = await sandboxRequest(MCP_URL, { method, headers: { authorization: `Bearer ${await issueToken(admin)}`, accept: 'text/event-stream' } })
      expect(res.status).toBe(405)
      expect(res.headers.get('allow')).toBe('POST')
    })
})

describe('#1083 /mcp: who may connect (D2)', () => {
  test('a signed-in session token is refused: only an access token opens /mcp', async ({ admin }) => {
    const res = await postMcp(initialize, { authorization: `Bearer ${admin.token}` })
    expect(res.status).toBe(401)
    expect((await res.json() as { error: { message: string } }).error.message).toMatch(/access token/)
  })

  test('an unknown access token is refused', async () => {
    const res = await postMcp(initialize, { authorization: `Bearer fbt_${'0'.repeat(43)}` })
    expect(res.status).toBe(401)
  })

  test('a revoked token stops the very next call', async ({ admin, createUser }) => {
    await notes(admin)
    const { user, agent } = await keeper(createUser)
    await agent.ok('list_tables')
    const [{ id }] = await sql`select id from access_token where person = ${user.user}`
    await user.delete(`/api/access_tokens/${id as string}`)
    await expect(agent.call('list_tables')).rejects.toThrow(/401|access token/)
  })

  test('a page on another origin is refused (DNS rebinding)', async ({ admin }) => {
    const res = await postMcp(initialize, { authorization: `Bearer ${await issueToken(admin)}`, origin: 'https://evil.example' })
    expect(res.status).toBe(403)
  })

  test('the instance\'s own origin is let through', async ({ admin }) => {
    const res = await postMcp(initialize, { authorization: `Bearer ${await issueToken(admin)}`, origin: config.allowedOrigins[0]! })
    expect(res.status).toBe(200)
  })
})

describe('#1083 /mcp: tools served by the HTTP API (D3, D4, D7)', () => {
  test('list_tables gives each Table\'s label and description', async ({ admin, createUser }) => {
    await notes(admin)
    await admin.fetch(NOTE.defUrl, { method: 'PUT', body: JSON.stringify({ description: 'Short notes' }) })
    const { agent } = await keeper(createUser)
    const { tables } = await agent.ok<{ tables: { name: string; label: string; description: string | null }[] }>('list_tables')
    expect(tables.find((t) => t.name === 'Mcp Note')).toEqual({ name: 'Mcp Note', label: 'Mcp Note', description: 'Short notes' })
  })

  test('describe_table shows nested-row columns one level down, links and read-only columns', async ({ admin, createUser }) => {
    await notes(admin)
    const { agent } = await keeper(createUser)
    const described = await agent.ok<{ table: string; columns: Record<string, unknown>[] }>('describe_table', { table: 'Mcp Note' })
    expect(described.table).toBe('Mcp Note')
    expect(described.columns.find((c) => c.name === 'lines')).toMatchObject({ type: 'Sub-table', columns: [expect.objectContaining({ name: 'item', type: 'Data' })] })
    expect(described.columns.find((c) => c.name === 'author')).toMatchObject({ type: 'Reference', links_to: 'Person', read_only: true })
    expect(described.columns.find((c) => c.name === 'body')).toMatchObject({ type: 'Text', description: 'The note itself' })
  })

  test('query_rows defaults to 20 rows of every readable column but nested rows', async ({ admin, createUser }) => {
    await notes(admin, 25)
    const { agent } = await keeper(createUser)
    const page = await agent.ok<Page>('query_rows', { table: 'Mcp Note' })
    expect(page).toMatchObject({ total: 25, offset: 0, limit: 20 })
    expect(page.rows).toHaveLength(20)
    expect(page.rows[0]).toMatchObject({ title: expect.any(String), body: expect.any(String), row_id: expect.any(String) })
    expect(page.rows[0]).not.toHaveProperty('lines')
  })

  test('query_rows pages on with offset and returns only the columns asked for', async ({ admin, createUser }) => {
    await notes(admin, 5)
    const { agent } = await keeper(createUser)
    const page = await agent.ok<Page>('query_rows', { table: 'Mcp Note', columns: ['title'], order_by: 'title asc', limit: 2, offset: 2 })
    expect(page).toMatchObject({ total: 5, offset: 2, limit: 2 })
    expect(page.rows).toEqual([{ title: 'note 3' }, { title: 'note 4' }])
  })

  test('query_rows leaves retired rows out unless asked', async ({ admin, createUser }) => {
    const ids = await notes(admin)
    await admin.post(`${NOTE.rowUrl(ids[0]!)}:retire`, { reason: 'old' })
    const { agent } = await keeper(createUser)
    expect((await agent.ok<Page>('query_rows', { table: 'Mcp Note' })).total).toBe(2)
    expect((await agent.ok<Page>('query_rows', { table: 'Mcp Note', include_retired: true })).total).toBe(3)
  })

  test('update_row with a stale updated_at is refused as a conflict', async ({ admin, createUser }) => {
    const [id] = await notes(admin)
    const { agent } = await keeper(createUser)
    const result = await agent.call('update_row', { table: 'Mcp Note', id, values: { body: 'new' }, updated_at: '2000-01-01T00:00:00.000Z' })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/^ConflictError: /)
  })

  test('update_row without updated_at is refused before anything is sent', async ({ admin, createUser }) => {
    const [id] = await notes(admin)
    const { agent } = await keeper(createUser)
    const before = await admin.get<Row>(NOTE.rowUrl(id!))
    const result = await agent.call('update_row', { table: 'Mcp Note', id, values: { body: 'new' } })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/^MCP error -32602: .*Read the row first \(get_row or query_rows\) and pass the updated_at it gave/)
    expect(await admin.get<Row>(NOTE.rowUrl(id!))).toEqual(before)
  })

  test('query_rows gives each row\'s updated_at, the version update_row takes', async ({ admin, createUser }) => {
    const [id] = await notes(admin, 1)
    const { agent } = await keeper(createUser)
    const [row] = (await agent.ok<Page>('query_rows', { table: 'Mcp Note' })).rows
    expect(row!.updated_at).toBe((await admin.get<Row>(NOTE.rowUrl(id!))).updated_at)
  })

  test('delete_row deletes the row read at its updated_at and says which', async ({ admin, createUser }) => {
    const [id] = await notes(admin)
    const { agent } = await keeper(createUser)
    const { updated_at } = await agent.ok<Row>('get_row', { table: 'Mcp Note', id })
    expect(await agent.ok('delete_row', { table: 'Mcp Note', id, updated_at })).toEqual({ deleted: id })
    expect((await admin.fetch(NOTE.rowUrl(id!))).status).toBe(404)
  })

  test('delete_row without updated_at is refused and deletes nothing', async ({ admin, createUser }) => {
    const [id] = await notes(admin)
    const { agent } = await keeper(createUser)
    const result = await agent.call('delete_row', { table: 'Mcp Note', id })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/Read the row first \(get_row or query_rows\)/)
    expect((await admin.fetch(NOTE.rowUrl(id!))).status).toBe(200)
  })

  test('each call spends the owner\'s request budget, and running out is a refusal', async ({ admin, createUser }) => {
    await notes(admin)
    const { user, agent } = await keeper(createUser)
    await sql`update person set api_rate_limit = 1 where row_id = ${user.user}`
    resetRateLimit(user.user!)
    await agent.ok('query_rows', { table: 'Mcp Note', columns: ['title'] })
    const result = await agent.call('query_rows', { table: 'Mcp Note', columns: ['title'] })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/^RateLimitError: /)
  })
})

describe('#1083 /mcp: a refusal the agent can act on (D6)', () => {
  test('a refusal carries the API\'s own error as structured content', async ({ admin, createUser }) => {
    await notes(admin)
    const { agent } = await keeper(createUser)
    const result = await agent.call('get_row', { table: 'Mcp Note', id: 'nope' })
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toEqual({ error: { type: 'NotFoundError', message: expect.any(String) } })
    expect(text(result)).toBe(`NotFoundError: ${(result.structuredContent as { error: { message: string } }).error.message}`)
  })

  test('an unknown Table is refused by name', async ({ admin }) => {
    const agent: Agent = await connectAgent(await issueToken(admin))
    const result = await agent.call('describe_table', { table: 'No Such Table' })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/^NotFoundError: .*No Such Table/)
  })
})

describe('#1083 /mcp: tool descriptions come from the API (tasks 3.8)', () => {
  test('query_rows lists exactly the operators the list API accepts, and the page cap', async ({ admin }) => {
    const agent = await connectAgent(await issueToken(admin))
    const query = (await agent.client.listTools()).tools.find((t) => t.name === 'query_rows')!
    const listed = JSON.stringify(query.inputSchema)
    for (const op of LIST_OPERATORS) expect(listed).toContain(JSON.stringify(op))
    expect(query.description).toContain('100')
  })
})

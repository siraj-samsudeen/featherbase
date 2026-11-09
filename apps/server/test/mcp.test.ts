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

// #1105 (mcp-table-lifecycle): what the agent-access scenarios leave out of
// the structure and import tools.
const SHOP = tableRef('Mcp Shop')
type Shop = { row_id: string; shop_name: string; city: string | null; kind: string | null }
type Described = { table: string; columns: { name: string; type: string; choices?: string[]; links_to?: string }[] }
type Check = { valid: number; inserted: number; updated: number; changed: number; skipped: number; mapping: Record<string, string | null>; failed: { row: number; message: string }[]; check: string; already_there?: { column: string; rows: number }[] }

async function shops(admin: TestClient, names: string[] = ['Anna Stores', 'Bharat Mart']) {
  await makeTable(admin, {
    name: 'Mcp Shop', module: 'Custom', track_changes: true,
    columns: [{ column_name: 'shop_name', column_type: 'Data', reqd: true }, 'city', { column_name: 'kind', column_type: 'Choice', choices: 'Retail\nWholesale' }],
  })
  const ids: Record<string, string> = {}
  for (const name of names) ids[name] = (await admin.post<Shop>(SHOP.url, { shop_name: name, city: 'Chennai' })).row_id
  return ids
}

const shopRows = async (admin: TestClient) =>
  (await admin.get<{ data: Shop[] }>(SHOP.listUrl({ fields: ['row_id', 'shop_name', 'city', 'kind'], order_by: 'shop_name asc', limit_page_length: 500 }))).data

async function imported(agent: Agent, args: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const { check } = await agent.ok<Check>('check_import', args)
  return agent.ok<{ run_id: string; inserted: number; updated: number }>('run_import', { ...args, check, ...extra })
}

describe('#1105 /mcp: what the structure and import tools are marked (D5)', () => {
  test('suggesting, checking and listing imports only read; making a Table or a column adds; the rest alter', async ({ admin }) => {
    const agent = await connectAgent(await issueToken(admin))
    const tools = Object.fromEntries((await agent.client.listTools()).tools.map((t) => [t.name, t.annotations]))
    for (const name of ['suggest_table', 'check_import', 'list_imports']) expect(tools[name]).toMatchObject({ readOnlyHint: true, destructiveHint: false })
    for (const name of ['create_table', 'add_column']) expect(tools[name]).toMatchObject({ readOnlyHint: false, destructiveHint: false })
    for (const name of ['change_column', 'rename_column', 'remove_column', 'run_import', 'undo_import'])
      expect(tools[name]).toMatchObject({ readOnlyHint: false, destructiveHint: true })
  })

  test('run_import is not idempotent: run twice without a key, it adds twice', async ({ admin }) => {
    const agent = await connectAgent(await issueToken(admin))
    const run = (await agent.client.listTools()).tools.find((t) => t.name === 'run_import')!
    expect(run.annotations).toMatchObject({ idempotentHint: false })
  })
})

describe('#1105 /mcp: shaping a Table (D1, D2)', () => {
  test('create_table refuses a column the Table builder refuses, in the route\'s words', async ({ admin }) => {
    const agent = await connectAgent(await issueToken(admin))
    const result = await agent.call('create_table', { table: 'Mcp Bad', columns: [{ name: 'Phone Number', type: 'Data' }] })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/columns\.0\.column_name: column_name must be snake_case/)
  })

  test('change_column sets a Choice column\'s choices', async ({ admin }) => {
    await shops(admin)
    const agent = await connectAgent(await issueToken(admin))
    const after = await agent.ok<Described>('change_column', { table: 'Mcp Shop', column: 'kind', choices: ['Retail', 'Wholesale', 'Online'] })
    expect(after.columns.find((c) => c.name === 'kind')?.choices).toEqual(['Retail', 'Wholesale', 'Online'])
  })

  test('change_column turns a text column into a link and back, keeping its values', async ({ admin }) => {
    await makeTable(admin, { name: 'Mcp Town', module: 'Custom', columns: ['town_name'] })
    const town = (await admin.post<{ row_id: string }>(tableRef('Mcp Town').url, { town_name: 'Chennai' })).row_id
    await shops(admin, [])
    await admin.post(SHOP.url, { shop_name: 'Anna Stores', city: town })
    const agent = await connectAgent(await issueToken(admin))
    const linked = await agent.ok<Described>('change_column', { table: 'Mcp Shop', column: 'city', links_to: 'Mcp Town' })
    expect(linked.columns.find((c) => c.name === 'city')).toMatchObject({ type: 'Reference', links_to: 'Mcp Town' })
    const unlinked = await agent.ok<Described>('change_column', { table: 'Mcp Shop', column: 'city', links_to: null })
    expect(unlinked.columns.find((c) => c.name === 'city')).toMatchObject({ type: 'Data' })
    expect((await shopRows(admin))[0]!.city).toBe(town)
  })

  test('change_column names a column the Table does not have', async ({ admin }) => {
    await shops(admin)
    const agent = await connectAgent(await issueToken(admin))
    const result = await agent.call('change_column', { table: 'Mcp Shop', column: 'region', label: 'Region' })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/^ValidationError: Mcp Shop has no column region/)
  })

  test('rename_column keeps every value under the new name', async ({ admin }) => {
    await shops(admin)
    const agent = await connectAgent(await issueToken(admin))
    await agent.ok('rename_column', { table: 'Mcp Shop', column: 'city', to: 'town' })
    const rows = (await admin.get<{ data: { town: string }[] }>(SHOP.listUrl({ fields: ['town'] }))).data
    expect(rows.map((r) => r.town)).toEqual(['Chennai', 'Chennai'])
  })

  test('remove_column keeps the values: adding the column back brings them back', async ({ admin }) => {
    await shops(admin)
    const agent = await connectAgent(await issueToken(admin))
    const removed = await agent.ok<Described>('remove_column', { table: 'Mcp Shop', column: 'city' })
    expect(removed.columns.map((c) => c.name)).not.toContain('city')
    await agent.ok('add_column', { table: 'Mcp Shop', column: { name: 'city', type: 'Data' } })
    expect((await shopRows(admin)).map((r) => r.city)).toEqual(['Chennai', 'Chennai'])
  })

  test('remove_column names a column the Table does not have, in the route\'s words', async ({ admin }) => {
    await shops(admin)
    const agent = await connectAgent(await issueToken(admin))
    const result = await agent.call('remove_column', { table: 'Mcp Shop', column: 'region' })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/region: not a column of this Table/)
  })
})

describe('#1105 /mcp: reading the file (D3)', () => {
  test('a file of more than 10,000 rows is refused', async ({ admin }) => {
    await shops(admin)
    const agent = await connectAgent(await issueToken(admin))
    const csv = `Shop Name\n${Array.from({ length: 10_001 }, (_, i) => `Shop ${i}`).join('\n')}\n`
    const result = await agent.call('check_import', { table: 'Mcp Shop', csv })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/10001 rows; an import takes at most 10000/)
  })

  test('a file over 3 MB is refused, below the 4 MB the protocol takes', async ({ admin }) => {
    await shops(admin)
    const agent = await connectAgent(await issueToken(admin))
    const result = await agent.call('check_import', { table: 'Mcp Shop', csv: `Shop Name\n${'x'.repeat(3 * 1024 * 1024)}\n` })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/over 3 MB/)
  })

  test('a mapping naming a heading the file lacks is refused, naming it', async ({ admin }) => {
    await shops(admin)
    const agent = await connectAgent(await issueToken(admin))
    const result = await agent.call('check_import', { table: 'Mcp Shop', csv: 'Shop Name\nCauvery Mart\n', columns: { Town: 'city' } })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/Town: not a heading of the file/)
  })

  test('a mapping onto a column the Table lacks is refused, naming the heading', async ({ admin }) => {
    await shops(admin)
    const agent = await connectAgent(await issueToken(admin))
    const result = await agent.call('check_import', { table: 'Mcp Shop', csv: 'Shop Name,Town\nCauvery Mart,Salem\n', columns: { Town: 'region' } })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/Town: Mcp Shop has no column region/)
  })

  test('a heading mapped to null is left out', async ({ admin }) => {
    await shops(admin, [])
    const agent = await connectAgent(await issueToken(admin))
    const report = await imported(agent, { table: 'Mcp Shop', csv: 'Shop Name,City\nCauvery Mart,Salem\n', columns: { City: null } })
    expect(report.inserted).toBe(1)
    expect((await shopRows(admin))[0]).toMatchObject({ shop_name: 'Cauvery Mart', city: null })
  })

  test('a file whose headings match no column is refused', async ({ admin }) => {
    await shops(admin)
    const agent = await connectAgent(await issueToken(admin))
    const result = await agent.call('check_import', { table: 'Mcp Shop', csv: 'Colour\nRed\n' })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/No heading of the file matches a column of Mcp Shop/)
  })

  test('a key repeated in the file fails each of its rows by row number', async ({ admin }) => {
    await shops(admin)
    const agent = await connectAgent(await issueToken(admin))
    const report = await agent.ok<Check>('check_import', {
      table: 'Mcp Shop', csv: 'Shop Name,City\nAnna Stores,Salem\nCauvery Mart,Erode\nAnna Stores,Karur\n', key_column: 'shop_name',
    })
    expect(report.failed.map((f) => [f.row, f.message])).toEqual([
      [2, 'key Anna Stores appears more than once in the file'], [4, 'key Anna Stores appears more than once in the file'],
    ])
    expect(report.valid).toBe(1)
  })

  test('a file of more than 500 rows is sent in parts and lands as one import', async ({ admin }) => {
    await shops(admin, [])
    const agent = await connectAgent(await issueToken(admin))
    const csv = `Shop Name\n${Array.from({ length: 501 }, (_, i) => `Shop ${String(i).padStart(3, '0')}`).join('\n')}\n`
    const { run_id } = await imported(agent, { table: 'Mcp Shop', csv })
    const { imports } = await agent.ok<{ imports: { run_id: string; inserted: number }[] }>('list_imports', { table: 'Mcp Shop' })
    expect(imports).toEqual([expect.objectContaining({ run_id, inserted: 501 })])
  })
})

describe('#1105 /mcp: an import runs as it was checked (D4)', () => {
  test('a check made with another token does not open the run', async ({ admin }) => {
    await shops(admin, [])
    const args = { table: 'Mcp Shop', csv: 'Shop Name\nCauvery Mart\n' }
    const { check } = await (await connectAgent(await issueToken(admin, 'first'))).ok<Check>('check_import', args)
    const result = await (await connectAgent(await issueToken(admin, 'second'))).call('run_import', { ...args, check })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/check_import/)
    expect(await shopRows(admin)).toEqual([])
  })

  test('a column changed since the check means checking again', async ({ admin }) => {
    await shops(admin, [])
    const agent = await connectAgent(await issueToken(admin))
    const args = { table: 'Mcp Shop', csv: 'Shop Name,Kind\nCauvery Mart,Retail\n' }
    const { check } = await agent.ok<Check>('check_import', args)
    await agent.ok('change_column', { table: 'Mcp Shop', column: 'kind', choices: ['Wholesale'] })
    const result = await agent.call('run_import', { ...args, check })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/check_import/)
    expect(await shopRows(admin)).toEqual([])
  })

  test('a run without a check is refused, saying how to get one', async ({ admin }) => {
    await shops(admin, [])
    const agent = await connectAgent(await issueToken(admin))
    const result = await agent.call('run_import', { table: 'Mcp Shop', csv: 'Shop Name\nCauvery Mart\n' })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/check_import/)
  })

  test('check_import says by which column every row is already there', async ({ admin }) => {
    await shops(admin)
    const agent = await connectAgent(await issueToken(admin))
    const report = await agent.ok<Check>('check_import', { table: 'Mcp Shop', csv: 'Shop Name\nAnna Stores\nBharat Mart\n' })
    expect(report.already_there).toEqual([{ column: 'shop_name', rows: 2 }])
  })

  test('add_anyway adds the rows that are already there', async ({ admin }) => {
    await shops(admin)
    const agent = await connectAgent(await issueToken(admin))
    const report = await imported(agent, { table: 'Mcp Shop', csv: 'Shop Name\nAnna Stores\nBharat Mart\n' }, { add_anyway: true })
    expect(report.inserted).toBe(2)
    expect(await shopRows(admin)).toHaveLength(4)
  })

  test('confirm_changes with the number of changed rows lets a large update run', async ({ admin }) => {
    const names = Array.from({ length: 21 }, (_, i) => `Shop ${String(i).padStart(2, '0')}`)
    await shops(admin, names)
    const agent = await connectAgent(await issueToken(admin))
    const args = { table: 'Mcp Shop', csv: `Shop Name,City\n${names.map((n) => `${n},Salem`).join('\n')}\n`, key_column: 'shop_name' }
    const report = await imported(agent, args, { confirm_changes: 21 })
    expect(report.updated).toBe(21)
    expect(new Set((await shopRows(admin)).map((r) => r.city))).toEqual(new Set(['Salem']))
  })

  test('an import the user may not add rows to is refused and writes nothing', async ({ admin, createUser }) => {
    await shops(admin, [])
    await grantRole(admin, { role: 'Mcp Shop Reader', table: 'Mcp Shop', can_read: true })
    const reader = await createUser({ roles: ['Mcp Shop Reader'] })
    const agent = await connectAgent(await issueToken(reader))
    const result = await agent.call('check_import', { table: 'Mcp Shop', csv: 'Shop Name\nCauvery Mart\n' })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/^PermissionError: .*create.*Mcp Shop/i)
    expect(await shopRows(admin)).toEqual([])
  })
})

describe('#1105 /mcp: the imports of a Table (D1)', () => {
  // Newest first is the Import Log's created_at order; inside one test's
  // transaction both runs share a timestamp, so the order is not pinned here.
  test('list_imports gives one entry per import, with its counts', async ({ admin }) => {
    await shops(admin, [])
    const agent = await connectAgent(await issueToken(admin))
    const first = await imported(agent, { table: 'Mcp Shop', csv: 'Shop Name\nCauvery Mart\n', file_name: 'one.csv' })
    const second = await imported(agent, { table: 'Mcp Shop', csv: 'Shop Name\nDhan Stores\nElan Mart\n', file_name: 'two.csv' })
    const { imports } = await agent.ok<{ imports: Record<string, unknown>[] }>('list_imports', { table: 'Mcp Shop' })
    expect(imports).toHaveLength(2)
    expect(imports).toEqual(expect.arrayContaining([
      expect.objectContaining({ run_id: second.run_id, file_name: 'two.csv', inserted: 2, updated: 0, failed: 0, undone_at: null }),
      expect.objectContaining({ run_id: first.run_id, file_name: 'one.csv', inserted: 1 }),
    ]))
  })

  test('undo_import with dry_run says what it would do and changes nothing', async ({ admin }) => {
    await shops(admin, [])
    const agent = await connectAgent(await issueToken(admin))
    const { run_id } = await imported(agent, { table: 'Mcp Shop', csv: 'Shop Name\nCauvery Mart\n' })
    const plan = await agent.ok<{ dry_run: boolean; deleted: number }>('undo_import', { table: 'Mcp Shop', run_id, dry_run: true })
    expect(plan).toMatchObject({ dry_run: true, deleted: 1 })
    expect(await shopRows(admin)).toHaveLength(1)
  })
})

// #772: a MotherDuck source connected by pasting its token, against the local
// stand-in (design D4). Each test names its own source, so they never share a session.
import { afterAll, beforeAll, describe, expect } from 'vitest'
import { rmSync } from 'node:fs'
import { test } from './pg-test'
import { sql } from '../src/db'
import { overrideVariable } from '../src/env'
import { invalidateSources } from '../src/sources/registry'
import { addStandinTable, buildStandin, STANDIN_TOKENS } from './motherduck-standin'

let dir: string
beforeAll(async () => {
  dir = await buildStandin()
  overrideVariable('MOTHERDUCK_STANDIN', dir)
})
afterAll(() => {
  invalidateSources()
  overrideVariable('MOTHERDUCK_STANDIN', undefined)
  rmSync(dir, { recursive: true, force: true })
})

type Client = {
  post: <T = Record<string, unknown>>(p: string, b?: unknown) => Promise<T>
  get: <T = Record<string, unknown>>(p: string) => Promise<T>
  fetch: (p: string, i?: RequestInit) => Promise<Response>
}
const SOURCES = '/api/table/Data%20Source'

async function connect(admin: Client, name: string, databases = ['sales', 'stock'], token = STANDIN_TOKENS.reader) {
  return admin.post<{ name: string }>(`${SOURCES}:motherduck_connect`, { name, token, databases })
}

describe('Connect a MotherDuck warehouse by pasting its token', () => {
  test('a working token names its owner and every database it can read', async ({ admin }) => {
    const report = await admin.post<{ user: string; can_write: boolean; databases: { name: string; owner: string }[] }>(
      `${SOURCES}:motherduck_test`, { token: STANDIN_TOKENS.reader })
    expect(report.user).toBe('reader_user')
    expect(report.can_write).toBe(false)
    expect(report.databases.map((d) => d.name)).toEqual(['sales', 'stock', 'finance', 'people', 'planning'])
    expect(report.databases[0].owner).toBe('This account')
    expect(report.databases[2].owner).toBe('finance-team')
    expect(JSON.stringify(report)).not.toContain(dir)
  })

  test('a token that can also write is flagged', async ({ admin }) => {
    const report = await admin.post<{ can_write: boolean }>(`${SOURCES}:motherduck_test`, { token: STANDIN_TOKENS.writer })
    expect(report.can_write).toBe(true)
  })

  test('a refused token is explained in plain words, and never echoed', async ({ admin }) => {
    const res = await admin.fetch(`${SOURCES}:motherduck_test`, { method: 'POST', body: JSON.stringify({ token: STANDIN_TOKENS.refused }) })
    expect(res.status).toBe(417)
    const text = await res.text()
    expect(text).toMatch(/MotherDuck refused the token/)
    expect(text).not.toContain(STANDIN_TOKENS.refused)
  })

  test('an empty token is refused before MotherDuck is asked', async ({ admin }) => {
    await expect(admin.post(`${SOURCES}:motherduck_test`, { token: '  ' })).rejects.toMatchObject({ status: 417 })
  })
})

describe('Choose which databases a warehouse source reads', () => {
  test('only the chosen databases are kept, with their owners', async ({ admin }) => {
    await connect(admin, 'md-choose')
    const row = await admin.get<{ engine: string; access: string; databases: { name: string }[]; token_last_four: string }>(`${SOURCES}/md-choose`)
    expect(row.engine).toBe('motherduck')
    expect(row.access).toBe('read_only')
    expect(row.databases.map((d) => d.name)).toEqual(['sales', 'stock'])
    expect(row.token_last_four).toBe('4f2a')
  })

  test('saving with no database chosen, or one the token cannot read, is refused', async ({ admin }) => {
    await expect(connect(admin, 'md-none', [])).rejects.toMatchObject({ status: 417 })
    await expect(connect(admin, 'md-unknown', ['sales', 'not-there'])).rejects.toMatchObject({ status: 417 })
    const [left] = await sql`select count(*)::int as n from featherbase.data_source where row_id in ('md-none', 'md-unknown')`
    expect(left.n).toBe(0)
  })

  test('a refused token saves nothing', async ({ admin }) => {
    await expect(connect(admin, 'md-refused', ['sales'], STANDIN_TOKENS.refused)).rejects.toMatchObject({ status: 417 })
    const [left] = await sql`select count(*)::int as n from featherbase.data_source where row_id = 'md-refused'`
    expect(left.n).toBe(0)
  })
})

describe('A pasted token stays secret', () => {
  test('neither a read nor a list returns the token, and the stored form is encrypted', async ({ admin }) => {
    await connect(admin, 'md-secret')
    const row = await admin.get(`${SOURCES}/md-secret`)
    const list = await admin.get(`${SOURCES}?fields=${encodeURIComponent('["row_id","engine","token_last_four","databases"]')}`)
    expect(JSON.stringify(row)).not.toContain(STANDIN_TOKENS.reader)
    expect(JSON.stringify(list)).not.toContain(STANDIN_TOKENS.reader)
    const [stored] = await sql`select token_ciphertext from featherbase.data_source_secret where data_source = 'md-secret'`
    expect(String(stored.token_ciphertext)).not.toContain(STANDIN_TOKENS.reader)
  })

  test('the generic form cannot set the last four or the databases', async ({ admin }) => {
    await connect(admin, 'md-generic')
    await admin.post('/api/save_row', { table: 'Data Source', row: { row_id: 'md-generic', token_last_four: 'zzzz', databases: [] } }).catch(() => undefined)
    const row = await admin.get<{ token_last_four: string; databases: unknown[] }>(`${SOURCES}/md-generic`)
    expect(row.token_last_four).toBe('4f2a')
    expect(row.databases).toHaveLength(2)
  })
})

describe('A warehouse token can be replaced', () => {
  test('a working new token replaces the old one; a refused one changes nothing', async ({ admin }) => {
    await connect(admin, 'md-replace')
    await expect(admin.post(`${SOURCES}/md-replace:replace_token`, { token: STANDIN_TOKENS.refused })).rejects.toMatchObject({ status: 417 })
    expect((await admin.get<{ token_last_four: string }>(`${SOURCES}/md-replace`)).token_last_four).toBe('4f2a')
    await admin.post(`${SOURCES}/md-replace:replace_token`, { token: STANDIN_TOKENS.writer })
    expect((await admin.get<{ token_last_four: string }>(`${SOURCES}/md-replace`)).token_last_four).toBe('77b1')
    const tables = await admin.get<{ schemas: { schema: string }[] }>(`${SOURCES}/md-replace:tables?database=sales`)
    expect(tables.schemas.map((s) => s.schema)).toContain('main')
  })
})

describe('Browse a warehouse table by table', () => {
  test('a database lists its schemas and tables, with sizes', async ({ admin }) => {
    await connect(admin, 'md-browse')
    const listing = await admin.get<{ listed_at: string; schemas: { schema: string; tables: { name: string; rows: number; columns: number }[] }[] }>(
      `${SOURCES}/md-browse:tables?database=sales`)
    expect(listing.schemas.map((s) => s.schema)).toEqual(['history', 'main'])
    const stores = listing.schemas.find((s) => s.schema === 'main')!.tables.find((t) => t.name === 'stores')!
    expect(stores.columns).toBe(4)
    expect(typeof stores.rows).toBe('number')
    expect(listing.listed_at).toBeTruthy()
  })

  test('a preview gives the row and column counts, the first rows and the column names', async ({ admin }) => {
    await connect(admin, 'md-preview')
    const preview = await admin.get<{ rows: number; columns: { name: string; type: string }[]; first_rows: Record<string, unknown>[] }>(
      `${SOURCES}/md-preview:preview?database=sales&schema=main&table=stores`)
    expect(preview.rows).toBe(3)
    expect(preview.columns.map((c) => c.name)).toEqual(['code', 'name', 'city', 'state_code'])
    expect(preview.first_rows[0]).toMatchObject({ code: 'S001', name: 'Harbour Road' })
  })

  test('a database that was not chosen is refused', async ({ admin }) => {
    await connect(admin, 'md-fence')
    await expect(admin.get(`${SOURCES}/md-fence:tables?database=finance`)).rejects.toMatchObject({ status: 403 })
    await expect(admin.get(`${SOURCES}/md-fence:preview?database=finance&schema=main&table=notes`)).rejects.toMatchObject({ status: 403 })
  })

  test('a table that does not exist is a plain not-found', async ({ admin }) => {
    await connect(admin, 'md-missing')
    await expect(admin.get(`${SOURCES}/md-missing:preview?database=sales&schema=main&table=nope`)).rejects.toMatchObject({ status: 404 })
  })
})

describe("A database's table list is kept until refreshed", () => {
  test('the list is kept; a refresh picks up a table added since', async ({ admin }) => {
    await connect(admin, 'md-cache', ['stock'])
    const first = await admin.get<{ listed_at: string; schemas: { tables: { name: string }[] }[] }>(`${SOURCES}/md-cache:tables?database=stock`)
    await addStandinTable(dir, 'stock', 'regions')
    const again = await admin.get<{ listed_at: string; schemas: { tables: { name: string }[] }[] }>(`${SOURCES}/md-cache:tables?database=stock`)
    expect(again.listed_at).toBe(first.listed_at)
    expect(again.schemas.flatMap((s) => s.tables.map((t) => t.name))).not.toContain('regions')
    const refreshed = await admin.post<{ schemas: { tables: { name: string }[] }[] }>(`${SOURCES}/md-cache:refresh_tables`, { database: 'stock' })
    expect(refreshed.schemas.flatMap((s) => s.tables.map((t) => t.name))).toContain('regions')
  })
})

describe('Only a System Manager reaches a warehouse source', () => {
  test('every action is refused to anyone else', async ({ admin, createUser }) => {
    await connect(admin, 'md-guard')
    const user = await createUser({ roles: [] })
    await expect(user.post(`${SOURCES}:motherduck_test`, { token: STANDIN_TOKENS.reader })).rejects.toMatchObject({ status: 403 })
    await expect(user.post(`${SOURCES}:motherduck_connect`, { name: 'md-rogue', token: STANDIN_TOKENS.reader, databases: ['sales'] })).rejects.toMatchObject({ status: 403 })
    await expect(user.get(`${SOURCES}/md-guard:tables?database=sales`)).rejects.toMatchObject({ status: 403 })
    await expect(user.get(`${SOURCES}/md-guard:preview?database=sales&schema=main&table=stores`)).rejects.toMatchObject({ status: 403 })
    await expect(user.post(`${SOURCES}/md-guard:refresh_tables`, { database: 'sales' })).rejects.toMatchObject({ status: 403 })
    await expect(user.post(`${SOURCES}/md-guard:replace_token`, { token: STANDIN_TOKENS.writer })).rejects.toMatchObject({ status: 403 })
  })
})

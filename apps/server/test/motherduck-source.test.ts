// #772, #969: a MotherDuck source, read with the instance's one token, against the local
// stand-in (design D4). Each test names its own source, so they never share a session.
import { afterAll, beforeAll, beforeEach, describe, expect } from 'vitest'
import { readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename } from 'node:path'
import { test } from './pg-test'
import { sql } from '../src/db'
import { overrideVariable } from '../src/env'
import { invalidateMeta } from '../src/meta'
import { getSource, invalidateSources, testSource } from '../src/sources/registry'
import { duckdbDriver, run, stream } from '../src/sources/duckdb-driver'
import { readMotherDuck } from '../src/sources/motherduck'
import { addStandinTable, buildStandin, changeStandin, STANDIN_TOKENS } from './motherduck-standin'
import { expectRefused, expectStatus } from './fixtures'

let dir: string
beforeAll(async () => {
  dir = await buildStandin()
  overrideVariable('MOTHERDUCK_STANDIN', dir)
  overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.reader)
})
beforeEach(() => overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.reader))
afterAll(() => {
  invalidateSources()
  overrideVariable('MOTHERDUCK_STANDIN', undefined)
  overrideVariable('MOTHERDUCK_TOKEN', undefined)
  rmSync(dir, { recursive: true, force: true })
})

type Client = {
  post: <T = Record<string, unknown>>(p: string, b?: unknown) => Promise<T>
  get: <T = Record<string, unknown>>(p: string) => Promise<T>
  fetch: (p: string, i?: RequestInit) => Promise<Response>
}
const SOURCES = '/api/table/Data%20Source'

async function connect(admin: Client, name: string, databases = ['sales', 'stock']) {
  return admin.post<{ name: string }>(`${SOURCES}:motherduck_connect`, { name, databases })
}

describe("Connect a MotherDuck warehouse with the instance's token", () => {
  test('the token names its owner and every database it can read', async ({ admin }) => {
    const report = await admin.get<{ user: string; databases: { name: string; owner: string }[] }>(`${SOURCES}:motherduck_databases`)
    expect(report.user).toBe('reader_user')
    expect(report.databases.map((d) => d.name)).toEqual(['sales', 'stock', 'finance', 'people', 'planning'])
    expect(report.databases[0].owner).toBe('This account')
    expect(report.databases[2].owner).toBe('finance-team')
    expect(JSON.stringify(report)).not.toContain(dir)
    expect(JSON.stringify(report)).not.toContain(STANDIN_TOKENS.reader)
  })

  test('a refused token is explained in plain words, and never echoed', async ({ admin }) => {
    overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.refused)
    const res = await admin.fetch(`${SOURCES}:motherduck_databases`)
    await expectStatus(res, 417)
    const text = await res.text()
    expect(text).toMatch(/MotherDuck refused this server's token/)
    expect(text).not.toContain(STANDIN_TOKENS.refused)
  })

  test('an instance with no token says so before MotherDuck is asked', async ({ admin }) => {
    overrideVariable('MOTHERDUCK_TOKEN', undefined)
    const res = await admin.fetch(`${SOURCES}:motherduck_databases`)
    await expectStatus(res, 417)
    expect(await res.text()).toMatch(/MOTHERDUCK_TOKEN is not set/)
    overrideVariable('MOTHERDUCK_TOKEN', '   ')
    await expectStatus(await admin.fetch(`${SOURCES}:motherduck_databases`), 417)
  })
})

describe('Choose which databases a warehouse source reads', () => {
  test('only the chosen databases are kept, with their owners', async ({ admin }) => {
    await connect(admin, 'md-choose')
    const row = await admin.get<{ engine: string; access: string; databases: { name: string }[]; url_env: string | null }>(`${SOURCES}/md-choose`)
    expect(row.engine).toBe('motherduck')
    expect(row.access).toBe('read_only')
    expect(row.databases.map((d) => d.name)).toEqual(['sales', 'stock'])
    expect(row.url_env).toBeNull()
  })

  test('saving with no database chosen, or one the token cannot read, is refused', async ({ admin }) => {
    await expectRefused(connect(admin, 'md-none', []), 417)
    await expectRefused(connect(admin, 'md-unknown', ['sales', 'not-there']), 417)
    const [left] = await sql`select count(*)::int as n from featherbase.data_source where row_id in ('md-none', 'md-unknown')`
    expect(left.n).toBe(0)
  })

  test('a refused token saves nothing', async ({ admin }) => {
    overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.refused)
    await expectRefused(connect(admin, 'md-refused', ['sales']), 417)
    const [left] = await sql`select count(*)::int as n from featherbase.data_source where row_id = 'md-refused'`
    expect(left.n).toBe(0)
  })
})

describe("The instance's token stays secret", () => {
  test('neither a read nor a list returns it, and nothing about a source stores it', async ({ admin }) => {
    await connect(admin, 'md-secret')
    const row = await admin.get(`${SOURCES}/md-secret`)
    const list = await admin.get(`${SOURCES}?fields=${encodeURIComponent('["row_id","engine","databases"]')}`)
    expect(JSON.stringify(row)).not.toContain(STANDIN_TOKENS.reader)
    expect(JSON.stringify(list)).not.toContain(STANDIN_TOKENS.reader)
    const [stored] = await sql`select to_jsonb(d) as row from featherbase.data_source d where row_id = 'md-secret'`
    expect(JSON.stringify(stored.row)).not.toContain(STANDIN_TOKENS.reader)
    expect(Object.keys(stored.row as object)).not.toContain('token_last_four')
    expect(Object.keys(stored.row as object)).not.toContain('read_scaling_token')
  })
})

describe('What a MotherDuck source saves', () => {
  test('its databases must be a list of named databases', async ({ admin }) => {
    const res = await admin.fetch(SOURCES, { method: 'POST', body: JSON.stringify({ row_id: 'md-bad-list', engine: 'motherduck', databases: [{ address: 'md:gold' }] }) })
    await expectStatus(res, 417)
    expect(await res.text()).toMatch(/Name each database/)
  })

  test('it names no variable: the instance has one token', async ({ admin }) => {
    const res = await admin.fetch(SOURCES, { method: 'POST', body: JSON.stringify({ row_id: 'md-var', engine: 'motherduck', url_env: 'MD_OTHER_TOKEN' }) })
    await expectStatus(res, 417)
    expect(await res.text()).toMatch(/names no variable/)
  })
})

describe('A MotherDuck warehouse is only ever read', () => {
  test('a token with write rights still opens every database read-only, and a write is refused', async ({ admin }) => {
    overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.writer)
    await connect(admin, 'md-ro', ['sales'])
    const cfg = await getSource('md-ro')
    const [row] = await run(cfg, "select readonly from duckdb_databases() where database_name = 'sales'", [])
    expect(row.readonly).toBe(true)
    await expect(run(cfg, "update sales.main.stores set name = 'Changed' where code = 'S001'", [])).rejects.toThrow(/read-only|read only/i)
    await expect(run(cfg, 'create table sales.main.written (a integer)', [])).rejects.toThrow(/read-only|read only/i)
  })

  test("an app's dataset query reads, and one that would change the warehouse is refused, with a token that can write", async ({ admin }) => {
    await changeStandin(dir, 'stock', ['create sequence if not exists stock_probe'])
    overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.writer)
    await connect(admin, 'md-dataset', ['sales', 'stock'])
    const cfg = await getSource('md-dataset')
    const column = [{ name: 'code', type: 'text' }]
    expect(await duckdbDriver.query!(cfg, 'select code from sales.main.stores', column)).toHaveLength(3)
    await expect(duckdbDriver.query!(cfg, "select nextval('stock.main.stock_probe') as code", column)).rejects.toThrow(/read-only|read only/i)
  })

  test("the platform's own fixed reads hold only the databases they name, read-only", async () => {
    overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.writer)
    expect(await readMotherDuck('select count(*)::int from sales.main.stores', 'test', ['sales'])).toEqual([[3]])
    await expect(readMotherDuck("update sales.main.stores set name = 'Changed'", 'test', ['sales'])).rejects.toThrow(/read-only|read only/i)
    await expect(readMotherDuck('select * from stock.main.items', 'test', ['sales'])).rejects.toThrow(/stock/)
    overrideVariable('MOTHERDUCK_TOKEN', undefined)
    await expect(readMotherDuck('select 1', 'run the leaver check', ['sales'])).rejects.toThrow('MOTHERDUCK_TOKEN is not set (required to run the leaver check)')
  })

  test('a connected table refuses a change, even if the stored row says read and write', async ({ admin }) => {
    overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.writer)
    await connect(admin, 'md-bound', ['sales'])
    await admin.post(`${SOURCES}/md-bound:reflect`, { schema: 'sales.main', tables: ['stores'] })
    await sql`update featherbase.data_source set access = 'read_write' where row_id = 'md-bound'`
    invalidateSources('md-bound')
    invalidateMeta()
    expect((await getSource('md-bound')).access).toBe('read_only')
    const [bound] = await sql`select name from featherbase.table_def where data_source = 'md-bound'`
    const path = `/api/table/${encodeURIComponent(String(bound.name))}`
    for (const [url, init] of [
      [`${path}/S001`, { method: 'PATCH', body: JSON.stringify({ name: 'Changed' }) }],
      [path, { method: 'POST', body: JSON.stringify({ code: 'S999', name: 'New' }) }],
      [`${path}/S001`, { method: 'DELETE' }],
    ] as const) {
      const res = await admin.fetch(url, init)
      await expectStatus(res, 403)
      expect(await res.text()).toMatch(/read-only/)
    }
    const [row] = await run(await getSource('md-bound'), "select name from sales.main.stores where code = 'S001'", [])
    expect(row.name).toBe('Harbour Road')
  })
})

describe('A session follows the instance token', () => {
  test('concurrent first public previews open only one source session', async ({ admin }) => {
    await connect(admin, 'md-concurrent-open', ['sales'])
    const folders = () => readdirSync(tmpdir()).filter(n => n.startsWith(`fb-md-session-${basename(dir)}-`))
    const before = new Set(folders())
    const previews = await Promise.all(Array.from({ length: 8 }, () => admin.get<{ rows: number }>(`${SOURCES}/md-concurrent-open:preview?database=sales&schema=main&table=stores`)))
    expect(previews.map(p => p.rows)).toEqual(Array(8).fill(3))
    expect(folders().filter(n => !before.has(n))).toHaveLength(1)
  })

  test('a new token keeps an active source reader alive until it finishes', async ({ admin }) => {
    await changeStandin(dir, 'sales', ['create table session_rows as select i as id from range(4100) t(i)'])
    await connect(admin, 'md-active-reader', ['sales'])
    const folders = () => readdirSync(tmpdir()).filter(n => n.startsWith(`fb-md-session-${basename(dir)}-`))
    const before = new Set(folders())
    const reader = stream(await getSource('md-active-reader'), 'select id from sales.main.session_rows order by id')
    try {
      const first = await reader.next()
      expect(first.done).toBe(false)
      overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.second)
      await admin.get(`${SOURCES}/md-active-reader:preview?database=sales&schema=main&table=stores`)
      expect(folders().filter(n => !before.has(n))).toHaveLength(2)
      let count = first.value!.length
      for await (const chunk of reader) count += chunk.length
      expect(count).toBe(4100)
      await expect.poll(() => folders().filter(n => !before.has(n)).length).toBe(1)
    } finally { await reader.return(undefined) }
  })

  test('the next session uses a new token; a refused one is reported, naming no token', async ({ admin }) => {
    await connect(admin, 'md-replace')
    overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.refused)
    const res = await admin.fetch(`${SOURCES}/md-replace:refresh_tables`, { method: 'POST', body: JSON.stringify({ database: 'sales' }) })
    await expectStatus(res, 417)
    expect(await res.text()).not.toContain(STANDIN_TOKENS.refused)
    overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.second)
    const tables = await admin.post<{ schemas: { schema: string }[] }>(`${SOURCES}/md-replace:refresh_tables`, { database: 'sales' })
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
    await expectRefused(admin.get(`${SOURCES}/md-fence:tables?database=finance`), 403)
    await expectRefused(admin.get(`${SOURCES}/md-fence:preview?database=finance&schema=main&table=notes`), 403)
  })

  test('a table that does not exist is a plain not-found', async ({ admin }) => {
    await connect(admin, 'md-missing')
    await expectRefused(admin.get(`${SOURCES}/md-missing:preview?database=sales&schema=main&table=nope`), 404)
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
    await expectRefused(user.get(`${SOURCES}:motherduck_databases`), 403)
    await expectRefused(user.post(`${SOURCES}:motherduck_connect`, { name: 'md-rogue', databases: ['sales'] }), 403)
    await expectRefused(user.get(`${SOURCES}/md-guard:tables?database=sales`), 403)
    await expectRefused(user.get(`${SOURCES}/md-guard:preview?database=sales&schema=main&table=stores`), 403)
    await expectRefused(user.post(`${SOURCES}/md-guard:refresh_tables`, { database: 'sales' }), 403)
  })
})

describe('Requests a warehouse source refuses', () => {
  test('a missing name or database list, and an action on another table, are refused plainly', async ({ admin }) => {
    await expectRefused(admin.post(`${SOURCES}:motherduck_connect`, { databases: ['sales'] }), 417)
    await expectRefused(admin.post(`${SOURCES}:motherduck_connect`, { name: 'md-no-list' }), 417)
    await expectRefused(admin.get('/api/table/Role:motherduck_databases'), 404)
  })

  test('a preview with no schema is a plain not-found', async ({ admin }) => {
    await connect(admin, 'md-no-schema')
    await expectRefused(admin.get(`${SOURCES}/md-no-schema:preview?database=sales&table=stores`), 404)
    await expectRefused(admin.get(`${SOURCES}/md-no-schema:preview?database=sales&schema=main`), 404)
  })

  test('a source of another engine has no warehouse actions', async ({ admin }) => {
    await admin.post(SOURCES, { row_id: 'md-plain-pg', engine: 'postgres', url_env: 'MD_PLAIN_UNSET_URL', access: 'read_only' })
    await expectRefused(admin.get(`${SOURCES}/md-plain-pg:tables?database=sales`), 417)
  })

  test('a MotherDuck source with no databases says so, and its connection test fails', async ({ admin }) => {
    await admin.post(SOURCES, { row_id: 'md-empty', engine: 'motherduck', access: 'read_only' })
    const tested = await testSource('md-empty')
    expect(tested.ok).toBe(false)
    expect(tested.error).toMatch(/reads no database yet/)
  })

  test('a MotherDuck source on an instance with no token says which variable is missing', async ({ admin }) => {
    await admin.post(SOURCES, { row_id: 'md-tokenless', engine: 'motherduck', access: 'read_only', databases: [{ name: 'sales' }] })
    overrideVariable('MOTHERDUCK_TOKEN', undefined)
    const res = await admin.fetch(`${SOURCES}/md-tokenless:tables?database=sales`)
    await expectStatus(res, 417)
    expect(await res.text()).toMatch(/MOTHERDUCK_TOKEN is not set/)
  })

  test('a MotherDuck source cannot be made writable', async ({ admin }) => {
    const res = await admin.fetch(SOURCES, { method: 'POST', body: JSON.stringify({ row_id: 'md-rw', engine: 'motherduck', access: 'read_write' }) })
    await expectStatus(res, 417)
    expect(await res.text()).toMatch(/MotherDuck sources are read-only/)
  })

  test('a token MotherDuck has since revoked is reported as refused', async ({ admin }) => {
    await connect(admin, 'md-revoked')
    overrideVariable('MOTHERDUCK_TOKEN', STANDIN_TOKENS.refused)
    const res = await admin.fetch(`${SOURCES}/md-revoked:tables?database=sales`)
    await expectStatus(res, 417)
    const text = await res.text()
    expect(text).toMatch(/MotherDuck refused this server's token/)
    expect(text).not.toContain(STANDIN_TOKENS.refused)
  })

  test('a database the token cannot read is reported each time, and never stays half-open', async ({ admin }) => {
    await connect(admin, 'md-gone')
    await sql`update featherbase.data_source set databases = ${sql.json([{ name: 'archive' }])} where row_id = 'md-gone'`
    invalidateSources('md-gone')
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await admin.fetch(`${SOURCES}/md-gone:tables?database=archive`)
      await expectStatus(res, 417)
      const text = await res.text()
      expect(text).toMatch(/token cannot read the database archive/)
      expect(text).not.toContain(STANDIN_TOKENS.reader)
    }
  })

  test('an address kept on an older row is ignored: what the token can read decides', async ({ admin }) => {
    await connect(admin, 'md-old-address', ['sales'])
    await sql`update featherbase.data_source set databases = ${sql.json([{ name: 'sales', address: `${dir}/finance.duckdb`, owner: 'This account' }])} where row_id = 'md-old-address'`
    invalidateSources('md-old-address')
    expect((await admin.get<{ rows: number }>(`${SOURCES}/md-old-address:preview?database=sales&schema=main&table=stores`)).rows).toBe(3)
  })
})

describe('An account with no database of its own', () => {
  // #969: a service account that owns nothing reaches the warehouse only through
  // shares, by their listed address. Queries still name the databases directly.
  test('a dataset query naming "gold" and "marts" reads them through their shares, read-only', async () => {
    const bare = await buildStandin([])
    await changeStandin(bare, 'gold', ['create schema masters', "create table masters.store (code varchar)", "insert into masters.store values ('S001')"])
    await changeStandin(bare, 'marts', ['create schema sales', "create table sales.target_vs_actual_daily (code varchar, target integer)", "insert into sales.target_vs_actual_daily values ('S001', 7)"])
    const { DuckDBInstance } = await import('@duckdb/node-api')
    const listing = await DuckDBInstance.create(`${bare}/md_information_schema.duckdb`)
    const conn = await listing.connect()
    await conn.run(`insert into shared_with_me values ('gold', '${bare}/gold.duckdb', 'warehouse-owner'), ('marts', '${bare}/marts.duckdb', 'warehouse-owner')`)
    conn.closeSync()
    listing.closeSync()
    overrideVariable('MOTHERDUCK_STANDIN', bare)
    const cfg = { name: 'md-shares-only', engine: 'motherduck', url_env: null, root_path: null, default_schema: 'gold.main', access: 'read_only', pool_max: 5, statement_timeout_ms: 10000, allowlist: null, databases: [{ name: 'gold' }, { name: 'marts' }] } as const
    try {
      const rows = await duckdbDriver.query!({ ...cfg, databases: [...cfg.databases] },
        'select s.code, t.target from "gold"."masters"."store" s join "marts"."sales"."target_vs_actual_daily" t on t.code = s.code',
        [{ name: 'code', type: 'text' }, { name: 'target', type: 'integer' }])
      expect(rows).toEqual([{ code: 'S001', target: 7 }])
      const attached = await run({ ...cfg, databases: [...cfg.databases] }, "select database_name, readonly from duckdb_databases() where database_name in ('gold', 'marts') order by 1", [])
      expect(attached).toEqual([{ database_name: 'gold', readonly: true }, { database_name: 'marts', readonly: true }])
    } finally {
      duckdbDriver.dispose(cfg.name)
      overrideVariable('MOTHERDUCK_STANDIN', dir)
      rmSync(bare, { recursive: true, force: true })
    }
  })

  test('lists only the databases shared with it', async ({ admin }) => {
    const bare = await buildStandin([])
    overrideVariable('MOTHERDUCK_STANDIN', bare)
    try {
      const report = await admin.get<{ databases: { name: string }[] }>(`${SOURCES}:motherduck_databases`)
      expect(report.databases.map((d) => d.name)).toEqual(['finance', 'people', 'planning'])
    } finally {
      overrideVariable('MOTHERDUCK_STANDIN', dir)
      rmSync(bare, { recursive: true, force: true })
    }
  })
})

describe('Review fixes (#772 security review)', () => {
  test('a database name two owners share is refused, not guessed', async ({ admin }) => {
    const twin = await buildStandin()
    const { DuckDBInstance } = await import('@duckdb/node-api')
    const instance = await DuckDBInstance.create(`${twin}/md_information_schema.duckdb`)
    const conn = await instance.connect()
    await conn.run(`insert into shared_with_me values ('stock', '${twin}/finance.duckdb', 'someone-else')`)
    conn.closeSync()
    instance.closeSync()
    overrideVariable('MOTHERDUCK_STANDIN', twin)
    try {
      const res = await admin.fetch(`${SOURCES}:motherduck_connect`, { method: 'POST', body: JSON.stringify({ name: 'md-twin', databases: ['stock'] }) })
      await expectStatus(res, 417)
      expect(await res.text()).toMatch(/Two databases the token can read are called stock/)
    } finally {
      overrideVariable('MOTHERDUCK_STANDIN', dir)
      rmSync(twin, { recursive: true, force: true })
    }
  })

  test("a query's error never carries the token", async ({ admin }) => {
    await connect(admin, 'md-broken')
    const res = await admin.fetch(`${SOURCES}/md-broken:preview?database=sales&schema=main&table=broken_view`)
    expect(res.status).toBeGreaterThanOrEqual(400)
    const text = await res.text()
    expect(text).toMatch(/gone_soon/)
    expect(text).not.toContain(STANDIN_TOKENS.reader)
  })
})

// M3: the duckdb driver — read-only browsing of an analytical store. The
// fixture is a local .duckdb file (same driver code path as MotherDuck's
// md: URLs, minus the network); the live MotherDuck warehouse is exercised
// manually, not from the suite.
import { afterAll, beforeAll, describe, expect, vi } from 'vitest'
import { DuckDBInstance } from '@duckdb/node-api'
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from './pg-test'
import { getSource, invalidateSources } from '../src/sources/registry'
import { duckdbDriver, run } from '../src/sources/duckdb-driver'
import type { Binding, SourceFilter } from '../src/sources/types'
import { expectStatus } from './fixtures'

const DUCK_URL_ENV = 'DUCK_FIXTURE_URL'
let dir: string

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'fb-duck-'))
  const file = path.join(dir, 'warehouse.duckdb')
  process.env[DUCK_URL_ENV] = file
  const { DuckDBInstance } = await import('@duckdb/node-api')
  const inst = await DuckDBInstance.create(file)
  const conn = await inst.connect()
  await conn.run(`create table daily_sales (
    store varchar, business_date date, qty bigint, amount decimal(12,2))`)
  await conn.run(`insert into daily_sales values
    ('KKL', '2026-07-01', 10, 1000.50),
    ('KKL', '2026-07-02', 12, 1200.00),
    ('TVM', '2026-07-01', 7, 700.25)`)
  await conn.run(`create table kitchen (
    id integer, ratio double, price decimal(8,2), flag boolean, born date,
    seen timestamp, payload json, label varchar, at_time time)`)
  await conn.run(`create table nullable_groups (id integer primary key, qty integer)`)
  await conn.run(`insert into nullable_groups values (1, null), (2, null), (3, null), (4, 7), (5, 7), (6, 12)`)
  await conn.run(`create table tied_rows (id integer primary key, label varchar)`)
  await conn.run(`insert into tied_rows values (3, 'same'), (1, 'same'), (2, 'same')`)
  // #625: a sequence an app's dataset query must not advance.
  await conn.run(`create sequence probe`)
  conn.closeSync()
  inst.closeSync()
})

afterAll(() => {
  invalidateSources()
  rmSync(dir, { recursive: true, force: true })
})

async function makeDuckSource(admin: {
  post: <T = Record<string, unknown>>(p: string, b?: unknown) => Promise<T>
  fetch: (p: string, i?: RequestInit) => Promise<Response>
}): Promise<string> {
  invalidateSources()
  await admin.post('/api/table/Data%20Source', {
    row_id: 'duck-fixture',
    engine: 'duckdb',
    url_env: DUCK_URL_ENV,
    access: 'read_only',
  })
  const res = await admin.fetch('/api/table/Data%20Source/duck-fixture:reflect', {
    method: 'POST',
    body: JSON.stringify({ schema: 'warehouse.main', tables: ['daily_sales'] }),
  })
  await expectStatus(res, 200)
  const body = (await res.json()) as { created: { name: string }[]; skipped: { reason: string }[] }
  expect(body.created).toHaveLength(1)
  return body.created[0].name
}

describe('M3: duckdb read-only source', () => {
  test('a failed superseded connection preserves the working replacement', async ({ admin }) => {
    await makeDuckSource(admin)
    const cfg = await getSource('duck-fixture')
    invalidateSources('duck-fixture')
    const originalUrl = process.env[DUCK_URL_ENV]
    const replacement = path.join(dir, 'replacement.duckdb')
    copyFileSync(path.join(dir, 'warehouse.duckdb'), replacement)
    let entered!: () => void
    let release!: () => void
    const opening = new Promise<void>(resolve => { entered = resolve })
    const released = new Promise<void>(resolve => { release = resolve })
    const create = DuckDBInstance.create
    let acceptOpens = true
    const sdk = vi.spyOn(DuckDBInstance, 'create').mockImplementationOnce(async () => {
      entered()
      await released
      return Promise.reject('Superseded connection refused')
    }).mockImplementation((...args) => {
      if (!acceptOpens) throw new Error('New connections unavailable')
      return create.apply(DuckDBInstance, args)
    })
    const old = run(cfg, 'select count(*)::int as n from daily_sales', [])
    const refused = expect(old).rejects.toMatchObject({ type: 'DataSourceError', message: expect.stringContaining('Superseded connection refused') })
    try {
      await opening
      process.env[DUCK_URL_ENV] = replacement
      expect(await run(cfg, 'select sum(qty)::int as n from daily_sales', [])).toEqual([{ n: 29 }])
      acceptOpens = false
      release()
      await refused
      // The external service no longer accepts new sessions. An already
      // established replacement must still serve reads after the old failure.
      expect(await run(cfg, 'select sum(qty)::int as n from daily_sales', [])).toEqual([{ n: 29 }])
    } finally {
      release()
      await Promise.allSettled([old, refused])
      sdk.mockRestore()
      process.env[DUCK_URL_ENV] = originalUrl
      invalidateSources('duck-fixture')
    }
  })

  test('introspects and reflects a warehouse table (no declared pk → first column)', async ({
    admin,
  }) => {
    const name = await makeDuckSource(admin)
    const meta = (await admin.get(`/api/table/${encodeURIComponent(name)}:meta`)) as Record<
      string,
      unknown
    >
    expect(meta.data_source).toBe('duck-fixture')
    expect(meta.external_pk).toBe('store')
    expect(meta.source_access).toBe('read_only')
    expect(meta.source_engine).toBe('duckdb')
  })

  test('lists with filters, sorting and count pushed down', async ({ admin }) => {
    const name = await makeDuckSource(admin)
    const enc = encodeURIComponent(name)
    const list = (await admin.get(
      `/api/table/${enc}?fields=${encodeURIComponent('["row_id","business_date","qty","amount"]')}&filters=${encodeURIComponent('[["row_id","=","KKL"]]')}&order_by=business_date asc`,
    )) as { data: Record<string, unknown>[]; total: number }
    expect(list.total).toBe(2)
    expect(list.data.map((r) => r.qty)).toEqual(['10', '12'])
    expect(list.data[0].amount).toBe('1000.50')

    const count = (await admin.get(
      `/api/table/${enc}:count?filters=${encodeURIComponent('[["qty",">","8"]]')}`,
    )) as { count: number }
    expect(count.count).toBe(2)

    const doc = (await admin.get(`/api/table/${enc}/TVM`)) as Record<string, unknown>
    expect(doc.qty).toBe('7')
    expect(doc.submission_status).toBe('draft')
  })

  test('every write path is rejected — the driver has no write capability', async ({ admin }) => {
    const name = await makeDuckSource(admin)
    const enc = encodeURIComponent(name)
    await expect(admin.post(`/api/table/${enc}`, { store: 'NEW' })).rejects.toMatchObject({
      status: 403,
    })
    const del = await admin.fetch(`/api/table/${enc}/KKL`, { method: 'DELETE' })
    await expectStatus(del, 403)
  })
})

describe('Read and write through a connected table: a warehouse', () => {
  test('rows can be counted by a column, read straight from the warehouse', async ({ admin }) => {
    const name = await makeDuckSource(admin)
    const res = await admin.post<{ data: { label: string; value: number }[] }>('/api/dashboard/chart', {
      table: name,
      group_by: 'business_date',
      filters: [],
    })
    expect(res.data.map((d) => [d.label.slice(0, 10), Number(d.value)])).toEqual(
      expect.arrayContaining([['2026-07-01', 2], ['2026-07-02', 1]]),
    )
  })
})

// #625: an app's dataset query runs on a warehouse, limited to what a read may
// see, on the same file and the same read-only connection the Admin browses with.
describe('An app dataset query on a warehouse', () => {
  const cfg = { name: 'duck-fixture', engine: 'duckdb' as const, url_env: DUCK_URL_ENV, root_path: null, default_schema: null,
    access: 'read_only' as const, pool_max: 1, statement_timeout_ms: 10000, allowlist: null, databases: [] }
  const columns = [{ name: 'store', type: 'text' }, { name: 'business_date', type: 'date' }, { name: 'amount', type: 'money' }]
  const kklOnSecond = () => duckdbDriver.query!(cfg, 'select store, business_date, amount from daily_sales', columns, {
    any: [[{ column: 'store', values: ['KKL'] }], [{ column: 'store', values: ['NOWHERE'] }]],
    all: [{ column: 'business_date', values: ['2026-07-02'] }],
  })
  const KKL_ON_SECOND = [{ store: 'KKL', business_date: '2026-07-02', amount: '1200.00' }]

  test('a missing URL declaration is a configuration error, not a warehouse outage', async () => {
    await expect(duckdbDriver.query!({ ...cfg, name: 'duck-missing-configuration', url_env: null }, 'select 1 as store', [{ name: 'store', type: 'integer' }]))
      .rejects.toMatchObject({ type: 'ValidationError', message: 'Data source duck-missing-configuration has no url_env configured' })
  })

  test('a failed file open does not poison later reads after its configured path is corrected', async () => {
    const recovering = { ...cfg, name: 'duck-file-recovery', url_env: 'DUCK_FILE_RECOVERY_URL' }
    process.env.DUCK_FILE_RECOVERY_URL = path.join(dir, 'not-created.duckdb')
    try {
      await expect(duckdbDriver.query!(recovering, 'select store, business_date, amount from daily_sales', columns))
        .rejects.toMatchObject({ type: 'DataSourceError', message: expect.stringContaining('duck-file-recovery') })
      process.env.DUCK_FILE_RECOVERY_URL = process.env[DUCK_URL_ENV]
      const rows = await duckdbDriver.query!(recovering, 'select store, business_date, amount from daily_sales order by business_date, store', columns)
      expect(rows).toEqual([
        { store: 'KKL', business_date: '2026-07-01', amount: '1000.50' },
        { store: 'TVM', business_date: '2026-07-01', amount: '700.25' },
        ...KKL_ON_SECOND,
      ])
    } finally {
      duckdbDriver.dispose(recovering.name)
      delete process.env.DUCK_FILE_RECOVERY_URL
    }
  })

  test('runs the declared query limited to the given places and filters', async () => {
    invalidateSources()
    expect(await kklOnSecond()).toEqual(KKL_ON_SECOND)
  })

  test('runs on a file the Admin has just browsed', async ({ admin }) => {
    const name = await makeDuckSource(admin)
    expect((await admin.get<{ total: number }>(`/api/table/${encodeURIComponent(name)}`)).total).toBe(3)
    expect(await kklOnSecond()).toEqual(KKL_ON_SECOND)
  })

  test('leaves the file browsable afterwards', async ({ admin }) => {
    const name = await makeDuckSource(admin)
    invalidateSources()
    expect(await kklOnSecond()).toEqual(KKL_ON_SECOND)
    expect((await admin.get<{ total: number }>(`/api/table/${encodeURIComponent(name)}`)).total).toBe(3)
    const ok = await admin.post<{ ok: boolean }>('/api/table/Data%20Source/duck-fixture:test_connection', {})
    expect(ok.ok).toBe(true)
  })

  // Wrapping a query in a select does not stop it writing: nextval advances a sequence.
  test('a query that would change the warehouse is refused', async () => {
    await expect(duckdbDriver.query!(cfg, "select nextval('probe') as store", [{ name: 'store', type: 'integer' }]))
      .rejects.toThrow(/read-only|read only/i)
  })

  // #969: the only way to MotherDuck is a MotherDuck source, whose session
  // attaches read-only. A DuckDB file source never dials a MotherDuck address.
  test.each(['md:never_dialled', 'MD:never_dialled', ' md:', 'motherduck:never_dialled'])('a DuckDB source refuses the MotherDuck address %s', async (address) => {
    process.env.DUCK_MD_URL = address
    await expect(duckdbDriver.test({ ...cfg, name: 'duck-md', url_env: 'DUCK_MD_URL' })).rejects.toThrow(/holds a MotherDuck address/)
    await expect(duckdbDriver.query!({ ...cfg, name: 'duck-md', url_env: 'DUCK_MD_URL' }, 'select 1 as store', [{ name: 'store', type: 'integer' }]))
      .rejects.toThrow(/holds a MotherDuck address/)
  })
})

// #1123: a duckdb source that names databases reads <name>.duckdb from a folder.
describe('A warehouse folder of several databases', () => {
  let folder: string
  const URL_ENV = 'DUCK_FOLDER_URL'
  const used: string[] = []
  const source = (name: string, databases: string[]) => {
    used.push(name)
    return { name, engine: 'duckdb' as const, url_env: URL_ENV, root_path: null, default_schema: null,
      access: 'read_only' as const, pool_max: 1, statement_timeout_ms: 10000, allowlist: null, databases: databases.map((d) => ({ name: d })) }
  }

  beforeAll(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'fb-duck-folder-'))
    copyFileSync(path.join(dir, 'warehouse.duckdb'), path.join(folder, 'first.duckdb'))
    copyFileSync(path.join(dir, 'warehouse.duckdb'), path.join(folder, 'second.duckdb'))
    process.env[URL_ENV] = folder
  })
  afterAll(() => {
    for (const name of used) duckdbDriver.dispose(name)
    delete process.env[URL_ENV]
    rmSync(folder, { recursive: true, force: true })
  })

  test.each(['gold"; drop', '../first', 'first.duckdb', ''])('a database name %j that is not a plain identifier is refused', async (bad) => {
    await expect(duckdbDriver.test(source('duck-folder-bad-name', [bad])))
      .rejects.toMatchObject({ type: 'ValidationError', message: expect.stringContaining('letters, digits and underscores') })
  })

  test('a dataset query that would change an attached database is refused', async () => {
    await expect(duckdbDriver.query!(source('duck-folder-write', ['first']), `select nextval('"first"."main"."probe"') as store`, [{ name: 'store', type: 'integer' }]))
      .rejects.toThrow(/read-only|read only/i)
  })

  test('naming another database opens it on the next read', async () => {
    await run(source('duck-folder-grows', ['first']), 'select count(*) from "first"."main"."daily_sales"', [])
    const [row] = await run(source('duck-folder-grows', ['first', 'second']), 'select count(*)::int as n from "second"."main"."daily_sales"', [])
    expect(row.n).toBe(3)
  })

  test('a database file that cannot be opened is reported without the folder path', async () => {
    writeFileSync(path.join(folder, 'broken.duckdb'), 'not a database')
    const failure = await duckdbDriver.test(source('duck-folder-broken', ['broken'])).catch((err: Error) => err)
    expect(failure).toMatchObject({ type: 'DataSourceError', message: expect.stringContaining(`$${URL_ENV}`) })
    expect((failure as Error).message).not.toContain(folder)
  })
})

describe('Connect a data source: a warehouse', () => {
  test('testing the connection reports success, and failure when the file is missing', async ({ admin }) => {
    await makeDuckSource(admin)
    const ok = await admin.post<{ ok: boolean }>('/api/table/Data%20Source/duck-fixture:test_connection', {})
    expect(ok.ok).toBe(true)

    process.env.DUCK_MISSING_URL = path.join(dir, 'nowhere', 'missing.duckdb')
    await admin.post('/api/table/Data%20Source', {
      row_id: 'duck-missing',
      engine: 'duckdb',
      url_env: 'DUCK_MISSING_URL',
      access: 'read_only',
    })
    const bad = await admin.post<{ ok: boolean; error?: string }>('/api/table/Data%20Source/duck-missing:test_connection', {})
    expect(bad.ok).toBe(false)
    expect(bad.error).not.toContain(process.env.DUCK_MISSING_URL)
  })
})

describe('Browsing a warehouse before connecting a table', () => {
  const introspect = async (
    admin: { get: (p: string) => Promise<unknown> },
    query: string,
  ) =>
    (await admin.get(`/api/table/Data%20Source/duck-fixture:introspect${query}`)) as {
      tables: { schema: string; table: string; columns: { name: string; column_type: string }[] }[]
    }

  test('a database name alone lists every schema in it; no name lists every database', async ({ admin }) => {
    await makeDuckSource(admin)
    const byCatalog = await introspect(admin, '?schema=warehouse')
    expect(byCatalog.tables.map((t) => `${t.schema}.${t.table}`).sort()).toEqual([
      'warehouse.main.daily_sales',
      'warehouse.main.kitchen',
      'warehouse.main.nullable_groups',
      'warehouse.main.tied_rows',
    ])
    const everything = await introspect(admin, '')
    expect(everything.tables.map((t) => t.table)).toEqual(expect.arrayContaining(['daily_sales', 'kitchen', 'nullable_groups']))
  })

  test('warehouse column types map to the closest Featherbase type', async ({ admin }) => {
    await makeDuckSource(admin)
    const { tables } = await introspect(admin, '?schema=warehouse.main')
    const kitchen = tables.find((t) => t.table === 'kitchen')!
    expect(Object.fromEntries(kitchen.columns.map((c) => [c.name, c.column_type]))).toEqual({
      id: 'Int',
      ratio: 'Float',
      price: 'Float',
      flag: 'Check',
      born: 'Date',
      seen: 'Datetime',
      payload: 'JSON',
      label: 'Data',
      at_time: 'Text',
    })
  })
})

describe('Filtering rows read from a warehouse', () => {
  const nullableBinding: Binding = {
    source: {
      name: 'duck-fixture', engine: 'duckdb', url_env: DUCK_URL_ENV, root_path: null,
      default_schema: null, access: 'read_only', pool_max: 1,
      statement_timeout_ms: 10000, allowlist: null, databases: [],
    },
    schema: 'warehouse.main', table: 'nullable_groups', pk: 'id', modified: null,
    columns: [{ column_name: 'qty', source_column: 'qty', column_type: 'Int' }],
  }

  test('rows tied on the sort value page in key order', async () => {
    const tied: Binding = { ...nullableBinding, table: 'tied_rows' }
    const ids: unknown[] = []
    for (const offset of [0, 1, 2]) {
      const { rows } = await duckdbDriver.getList(tied, {
        filters: [], columns: ['label'], order: { column: 'label', dir: 'asc' }, limit: 1, offset,
      })
      ids.push(...rows.map((r) => r.id))
    }
    expect(ids).toEqual([1, 2, 3])
  })

  test('refuses internal relationship filters without returning warehouse rows', async () => {
    const filters: SourceFilter[] = [{ column: 'qty', op: 'related', value: { binding: nullableBinding, filters: [] } }]
    const refusal = { type: 'ValidationError', message: 'Related filters are not supported by this source engine' }
    await expect(duckdbDriver.getList(nullableBinding, {
      filters, columns: ['qty'], order: { column: 'id', dir: 'asc' }, limit: 10, offset: 0,
    })).rejects.toMatchObject(refusal)
    await expect(duckdbDriver.count(nullableBinding, filters)).rejects.toMatchObject(refusal)
    expect(await duckdbDriver.count(nullableBinding, [])).toBe(6)
  })

  test('group counts retain the rows whose grouping value is NULL', async () => {
    expect(await duckdbDriver.groupCount(nullableBinding, 'qty', [])).toEqual([
      { label: '', value: 3 }, { label: '7', value: 2 }, { label: '12', value: 1 },
    ])
  })

  test('non-list membership inputs use the empty-set semantics', async () => {
    expect(await duckdbDriver.count(nullableBinding, [{ column: 'qty', op: 'in', value: [7] }])).toBe(2)
    expect(await duckdbDriver.count(nullableBinding, [{ column: 'qty', op: 'in_or_null', value: [7] }])).toBe(5)
    for (const value of [null, '7']) {
      expect(await duckdbDriver.count(nullableBinding, [{ column: 'qty', op: 'in', value }])).toBe(0)
      expect(await duckdbDriver.count(nullableBinding, [{ column: 'qty', op: 'not in', value }])).toBe(6)
      expect(await duckdbDriver.count(nullableBinding, [{ column: 'qty', op: 'in_or_null', value }])).toBe(3)
    }
    expect(await duckdbDriver.groupCount(nullableBinding, 'qty', [])).toEqual([
      { label: '', value: 3 }, { label: '7', value: 2 }, { label: '12', value: 1 },
    ])
  })

  test('a missing warehouse key returns no document', async () => {
    expect(await duckdbDriver.getDoc(nullableBinding, '4')).toEqual({ id: 4, qty: 7 })
    expect(await duckdbDriver.getDoc(nullableBinding, '99')).toBeNull()
    expect(await duckdbDriver.getDoc(nullableBinding, '1')).toEqual({ id: 1, qty: null })
  })

  const stores = async (admin: {
    get: (p: string) => Promise<unknown>
  }, name: string, filters: unknown[]) => {
    const res = (await admin.get(
      `/api/table/${encodeURIComponent(name)}?fields=${encodeURIComponent('["row_id","qty"]')}&order_by=qty asc&filters=${encodeURIComponent(JSON.stringify(filters))}`,
    )) as { data: { row_id: string; qty: string }[] }
    return res.data.map((r) => `${r.row_id}:${r.qty}`)
  }

  test('exclusion, comparison, pattern and list filters narrow the rows', async ({ admin }) => {
    const name = await makeDuckSource(admin)
    expect(await stores(admin, name, [['qty', '!=', '10']])).toEqual(['TVM:7', 'KKL:12'])
    expect(await stores(admin, name, [['qty', '<', '10']])).toEqual(['TVM:7'])
    expect(await stores(admin, name, [['row_id', 'like', 'k%']])).toEqual(['KKL:10', 'KKL:12'])
    expect(await stores(admin, name, [['row_id', 'not like', 'k%']])).toEqual(['TVM:7'])
    expect(await stores(admin, name, [['qty', 'in', ['7', '12']]])).toEqual(['TVM:7', 'KKL:12'])
    expect(await stores(admin, name, [['qty', 'not in', ['7', '12']]])).toEqual(['KKL:10'])
    // An empty list: nothing is "in" it, everything is "not in" it.
    expect(await stores(admin, name, [['qty', 'in', []]])).toEqual([])
    expect(await stores(admin, name, [['qty', 'not in', []]])).toHaveLength(3)
  })

  test('a Data Scope filter lets unset values through as well as the allowed ones', async ({ admin }) => {
    await makeDuckSource(admin)
    const bind: Binding = {
      source: {
        name: 'duck-fixture',
        engine: 'duckdb',
        url_env: DUCK_URL_ENV,
        root_path: null,
        default_schema: null,
        access: 'read_only',
        pool_max: 5,
        statement_timeout_ms: 10000,
        allowlist: null,
        databases: [],
      },
      schema: 'warehouse.main',
      table: 'daily_sales',
      pk: 'store',
      modified: null,
      columns: [{ column_name: 'store', source_column: 'store', column_type: 'Data' }],
    }
    // No store is unset, so only the allowed values match — and an empty
    // allowed list matches nothing.
    expect(await duckdbDriver.count(bind, [{ column: 'store', op: 'in_or_null', value: ['KKL'] }])).toBe(2)
    expect(await duckdbDriver.count(bind, [{ column: 'store', op: 'in_or_null', value: [] }])).toBe(0)
  })

  test('the warehouse driver refuses every write, whatever the source says', () => {
    const bind = {} as Binding
    expect(() => duckdbDriver.insert(bind, {}, null)).toThrow('sources are read-only')
    expect(() => duckdbDriver.update(bind, 'x', {}, null)).toThrow('sources are read-only')
    expect(() => duckdbDriver.remove(bind, 'x', null)).toThrow('sources are read-only')
  })
})

describe('A warehouse data source without its connection variable', () => {
  test('testing the connection names the unset variable', async ({ admin }) => {
    invalidateSources()
    await admin.post('/api/table/Data%20Source', {
      row_id: 'duck-unset',
      engine: 'duckdb',
      url_env: 'DUCK_NEVER_SET_URL',
      access: 'read_only',
    })
    const bad = await admin.post<{ ok: boolean; error?: string }>('/api/table/Data%20Source/duck-unset:test_connection', {})
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('DUCK_NEVER_SET_URL')
  })
})

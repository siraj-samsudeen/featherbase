// M3: the duckdb driver — read-only browsing of an analytical store. The
// fixture is a local .duckdb file (same driver code path as MotherDuck's
// md: URLs, minus the network); the live MotherDuck warehouse is exercised
// manually, not from the suite.
import { afterAll, beforeAll, describe, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from './pg-test'
import { invalidateSources } from '../src/sources/registry'
import { duckdbDriver } from '../src/sources/duckdb-driver'
import type { Binding } from '../src/sources/types'

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
  expect(res.status).toBe(200)
  const body = (await res.json()) as { created: { name: string }[]; skipped: { reason: string }[] }
  expect(body.created).toHaveLength(1)
  return body.created[0].name
}

describe('M3: duckdb read-only source', () => {
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
    expect(doc.status).toBe('draft')
  })

  test('every write path is rejected — the driver has no write capability', async ({ admin }) => {
    const name = await makeDuckSource(admin)
    const enc = encodeURIComponent(name)
    await expect(admin.post(`/api/table/${enc}`, { store: 'NEW' })).rejects.toMatchObject({
      status: 403,
    })
    const del = await admin.fetch(`/api/table/${enc}/KKL`, { method: 'DELETE' })
    expect(del.status).toBe(403)
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
// see. The same where shape as the postgres driver's, in DuckDB's dialect.
describe('An app dataset query on a warehouse', () => {
  test('runs the declared query limited to the given places and filters', async () => {
    const cfg = { name: 'duck-dataset', engine: 'duckdb' as const, url_env: DUCK_URL_ENV, root_path: null, default_schema: null,
      access: 'read_only' as const, pool_max: 1, statement_timeout_ms: 10000, allowlist: null }
    const rows = await duckdbDriver.query!(cfg, 'select store, business_date, amount from daily_sales', {
      any: [[{ column: 'store', values: ['KKL'] }], [{ column: 'store', values: ['NOWHERE'] }]],
      all: [{ column: 'business_date', values: ['2026-07-02'] }],
    })
    expect(rows).toEqual([{ store: 'KKL', business_date: '2026-07-02', amount: '1200.00' }])
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
    ])
    const everything = await introspect(admin, '')
    expect(everything.tables.map((t) => t.table)).toEqual(expect.arrayContaining(['daily_sales', 'kitchen']))
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

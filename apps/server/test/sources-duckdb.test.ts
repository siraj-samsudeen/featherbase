// M3: the duckdb driver — read-only browsing of an analytical store. The
// fixture is a local .duckdb file (same driver code path as MotherDuck's
// md: URLs, minus the network); the live MotherDuck warehouse is exercised
// manually, not from the suite.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from './pg-test'
import { invalidateSources } from '../src/sources/registry'
import { ensureGrpcCaRoots, resetGrpcCaRootsForTest } from '../src/sources/duckdb-driver'

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

// #194: the MotherDuck extension's gRPC core reads trust roots from a PEM on
// disk, and a slim base image ships none — the failure surfaces as UNAVAILABLE
// (a network-shaped error) rather than as a certificate problem, which is what
// made #113 look like a Railway outage for three weeks. The driver fills that
// gap from Node's own roots, and must leave a working host alone.
describe('#194: gRPC trust roots when the image ships no CA bundle', () => {
  const ENV = 'GRPC_DEFAULT_SSL_ROOTS_FILE_PATH'
  let saved: string | undefined

  beforeEach(() => {
    saved = process.env[ENV]
    delete process.env[ENV]
    resetGrpcCaRootsForTest()
  })

  afterEach(() => {
    if (saved === undefined) delete process.env[ENV]
    else process.env[ENV] = saved
    resetGrpcCaRootsForTest()
  })

  it('materialises Node roots when no system bundle exists', () => {
    const file = ensureGrpcCaRoots([])
    expect(file).toBeTruthy()
    expect(process.env[ENV]).toBe(file)
    const pem = readFileSync(file!, 'utf8')
    expect(pem).toContain('BEGIN CERTIFICATE')
    // Node ships a real root set; a bundle with one cert would mean we wrote
    // something degenerate and called it a trust store.
    expect(pem.match(/BEGIN CERTIFICATE/g)!.length).toBeGreaterThan(50)
  })

  it('leaves a host that already has a system bundle untouched', () => {
    // The fixture .duckdb file stands in for "a path that exists".
    expect(ensureGrpcCaRoots([path.join(dir, 'warehouse.duckdb')])).toBeNull()
    expect(process.env[ENV]).toBeUndefined()
  })

  it('never overrides an operator-set roots path', () => {
    process.env[ENV] = '/operator/chosen/roots.pem'
    expect(ensureGrpcCaRoots([])).toBeNull()
    expect(process.env[ENV]).toBe('/operator/chosen/roots.pem')
  })
})

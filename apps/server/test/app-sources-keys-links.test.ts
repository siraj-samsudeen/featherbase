// #876: an app declares, for tables whose source declares no keys or links
// (a warehouse copy), the column that identifies a row and what each column
// links to. A declaration agrees with the source or refuses the install.
// Postgres fixture tables in the sibling external database; a local .duckdb
// file stands in for MotherDuck (same driver path, minus the network).
import { afterAll, beforeAll, beforeEach, describe, expect } from 'vitest'
import postgres from 'postgres'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from './pg-test'
import { EXTERNAL_DATABASE_URL } from './external-database'
import { sql } from '../src/db'
import { invalidateSources } from '../src/sources/registry'

const PG_ENV = 'KEYLINK_FIXTURE_URL'
const DUCK_ENV = 'KEYLINK_DUCK_URL'
process.env[PG_ENV] = EXTERNAL_DATABASE_URL

let cli: ReturnType<typeof postgres>
let dir: string

beforeAll(async () => {
  cli = postgres(EXTERNAL_DATABASE_URL, { max: 2 })
  await cli.unsafe(`drop schema if exists keylink cascade`)
  await cli.unsafe(`create schema keylink`)
  // Keyed and linked the way a database would, but declaring neither.
  await cli.unsafe(`create table keylink.pallet (title text, number bigint)`)
  await cli.unsafe(`create table keylink.crate (contents text, number bigint, pallet_id bigint, password text)`)
  await cli.unsafe(`create table keylink.pair (a bigint, b bigint, note text, primary key (a, b))`)
  await cli.unsafe(`create table keylink.shelf (id bigint primary key, label text)`)
  await cli.unsafe(`create table keylink.bin (code text primary key, shelf_id bigint references keylink.shelf(id))`)
  await cli.unsafe(`insert into keylink.pallet values ('P-1', 1)`)
  await cli.unsafe(`insert into keylink.crate values ('Mangoes', 7, 1, null)`)

  dir = mkdtempSync(path.join(tmpdir(), 'fb-keylink-'))
  const file = path.join(dir, 'warehouse.duckdb')
  process.env[DUCK_ENV] = file
  const { DuckDBInstance } = await import('@duckdb/node-api')
  const inst = await DuckDBInstance.create(file)
  const conn = await inst.connect()
  // The first column is not the key: without a declaration, store rows would
  // be addressed by their (repeating) city.
  await conn.run(`create table store (city varchar, id integer, name varchar)`)
  await conn.run(`create table section (store_id integer, id integer, name varchar)`)
  await conn.run(`insert into store values ('Kochi', 1, 'Main Road'), ('Kochi', 2, 'Beach Road')`)
  await conn.run(`insert into section values (2, 10, 'Sarees')`)
  conn.closeSync()
  inst.closeSync()
})

beforeEach(() => invalidateSources())

afterAll(async () => {
  invalidateSources()
  await cli.unsafe(`drop schema if exists keylink cascade`)
  await cli.end({ timeout: 2 })
  rmSync(dir, { recursive: true, force: true })
})

const pgApp = (name: string, tables: unknown[], extra: Record<string, unknown> = {}) => ({
  name,
  sources: [{
    name: `${name}-src`, engine: 'postgres', url_env: PG_ENV, default_schema: 'keylink',
    access: 'read_only', ...extra,
    reflect: { schema: 'keylink', module: 'Keylink', tables },
  }],
})

type Column = { column_name: string; column_type: string; reference_table?: string | null }
type Meta = { columns: Column[] }
const column = (meta: Meta, name: string) => meta.columns.find((c) => c.column_name === name)

async function refusal(admin: { fetch: (p: string, i?: RequestInit) => Promise<Response> }, manifest: { name: string }) {
  const res = await admin.fetch('/api/install_app', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ manifest }),
  })
  const body = await res.text()
  expect(res.status, body).toBe(417)
  expect(await sql`select name from table_def where data_source = ${`${manifest.name}-src`}`).toEqual([])
  expect(await sql`select 1 from installed_app where name = ${manifest.name}`).toEqual([])
  return body
}

describe('an app declares a table\'s key and its links', () => {
  test.for([
    ['the linking table first', ['crate', 'pallet']],
    ['the linked table first', ['pallet', 'crate']],
  ] as const)('a declared link becomes a link with %s', async ([, order], { admin }) => {
    const entries = {
      crate: { table: 'crate', name: 'Keylink Crate', key: 'number', links: { pallet_id: 'pallet' } },
      pallet: { table: 'pallet', name: 'Keylink Pallet', key: 'number' },
    }
    await admin.post('/api/install_app', { manifest: pgApp('keylink-a', order.map((t) => entries[t])) })
    const crate = (await admin.get('/api/table/Keylink%20Crate:meta')) as Meta
    expect(column(crate, 'pallet_id')).toMatchObject({ column_type: 'Reference', reference_table: 'Keylink Pallet' })
    const [def] = await sql`select external_pk from table_def where name = 'Keylink Crate'`
    expect(def.external_pk).toBe('number')
    const row = (await admin.get('/api/table/Keylink%20Crate/7')) as Record<string, unknown>
    expect(row.contents).toBe('Mangoes')
    await admin.post('/api/uninstall_app', { name: 'keylink-a' })
  })

  test('a key and a link that agree with the source are accepted', async ({ admin }) => {
    await admin.post('/api/install_app', {
      manifest: pgApp('keylink-b', [
        { table: 'shelf', name: 'Keylink Shelf', key: 'id' },
        { table: 'bin', name: 'Keylink Bin', key: 'code', links: { shelf_id: 'shelf' } },
      ]),
    })
    const bin = (await admin.get('/api/table/Keylink%20Bin:meta')) as Meta
    expect(column(bin, 'shelf_id')).toMatchObject({ column_type: 'Reference', reference_table: 'Keylink Shelf' })
    await admin.post('/api/uninstall_app', { name: 'keylink-b' })
  })

  test.for([
    [[{ table: 'shelf', key: 'label' }], 'shelf is already identified by its id, not label'],
    [[{ table: 'pair', key: 'a' }], 'pair is identified by several columns together, so a alone cannot be its key'],
    [[{ table: 'crate', key: 'numbr' }], 'crate has no column numbr for its key'],
    [[{ table: 'crate', key: 'number', leave_out_columns: ['number'] }], 'crate leaves out number, so it cannot be its key'],
    [[{ table: 'crate', key: 'number', links: { number: 'pallet' } }], "crate's number is its key, so it cannot link"],
    [[{ table: 'crate', key: 'number', links: { password: 'pallet' } }], "crate's password is not a connected column, so it cannot link"],
    [[{ table: 'crate', key: 'number', links: { pallet_ref: 'pallet' } }], 'crate has no column pallet_ref to link'],
    [[{ table: 'crate', key: 'number', links: { pallet_id: 'trolley' } }], 'the source has no table trolley it may read'],
    // The pallet is not connected by this install, so it has no key to link to.
    [[{ table: 'crate', key: 'number', links: { pallet_id: 'pallet' } }], 'which has no key to link to'],
    [[{ table: 'shelf' }, { table: 'bin', links: { shelf_id: 'bin' } }], "bin's shelf_id already links to shelf.id, not bin"],
  ] as [unknown[], string][])('%o refuses the whole install', async ([tables, message], { admin }) => {
    expect(await refusal(admin, pgApp('keylink-bad', tables))).toContain(message)
  })

  // Refused in the same words as a missing table: the refusal never reveals
  // that a table the data source may not read exists.
  test('a link to a table outside the allow-list reads as a missing table', async ({ admin }) => {
    const body = await refusal(admin, pgApp('keylink-bad',
      [{ table: 'crate', key: 'number', links: { pallet_id: 'pallet' } }],
      { table_allowlist: 'keylink.crate' }))
    expect(body).toContain('the source has no table pallet it may read')
  })

  test('a key is declared only on a read-only data source', async ({ admin }) => {
    const body = await refusal(admin, pgApp('keylink-bad', [{ table: 'crate', key: 'number' }], { access: 'read_write' }))
    expect(body).toContain("crate's key can be declared only on a read-only data source")
  })

  test('on a warehouse source, the declared key replaces the first-column fallback and links form', async ({ admin }) => {
    await admin.post('/api/install_app', {
      manifest: {
        name: 'keylink-duck',
        sources: [{
          name: 'keylink-duck-src', engine: 'duckdb', url_env: DUCK_ENV, access: 'read_only',
          reflect: {
            schema: 'warehouse.main', module: 'Keylink',
            tables: [
              { table: 'section', name: 'Keylink Section', key: 'id', links: { store_id: 'store' } },
              { table: 'store', name: 'Keylink Store', key: 'id' },
            ],
          },
        }],
      },
    })
    const [def] = await sql`select external_pk from table_def where name = 'Keylink Store'`
    expect(def.external_pk).toBe('id')
    const store = (await admin.get('/api/table/Keylink%20Store/2')) as Record<string, unknown>
    expect(store.name).toBe('Beach Road')
    const section = (await admin.get('/api/table/Keylink%20Section:meta')) as Meta
    expect(column(section, 'store_id')).toMatchObject({ column_type: 'Reference', reference_table: 'Keylink Store' })
    await admin.post('/api/uninstall_app', { name: 'keylink-duck' })
  })
})

// The live and warehouse StyleHR apps describe their thirteen tables the same
// way; only the data source differs. Edit one, copy it across.
test('the two StyleHR apps connect their tables with identical settings', () => {
  const read = (app: string) =>
    JSON.parse(readFileSync(new URL(`../../../client-apps/jeyarama/${app}/app.json`, import.meta.url), 'utf8'))
  const live = read('stylehr')
  const warehouse = read('stylehr-warehouse')
  expect(warehouse.sources[0].reflect.tables).toEqual(live.sources[0].reflect.tables)
  expect(warehouse.sources[0].reflect.tables).toHaveLength(13)
})

// #742: a filter on a Yes/No column matches by yes or no, however it arrives,
// on a normal Table and on a connected one. The connected stores are created
// outside the sandbox, as in sources-postgres.test.ts and sources-duckdb.test.ts.
// A CSV folder has no case here: it reflects every column as text, so it never
// holds a Yes/No column.
import { afterAll, beforeAll, describe, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import postgres from 'postgres'
import type { TestClient } from 'feather-testing-postgres'
import { test } from './pg-test'
import { EXTERNAL_DATABASE_URL } from './external-database'
import { invalidateSources } from '../src/sources/registry'

const T = 'Yes No Section'
const ACTIVE = ['First', 'Ground']
const INACTIVE = ['Second']
const PG_ENV = 'YES_NO_PG_URL'
const DUCK_ENV = 'YES_NO_DUCK_URL'

let dir: string
let cli: ReturnType<typeof postgres>

beforeAll(async () => {
  process.env[PG_ENV] = EXTERNAL_DATABASE_URL
  cli = postgres(EXTERNAL_DATABASE_URL, { max: 1 })
  await cli.unsafe(`drop schema if exists yes_no_fixture cascade`)
  await cli.unsafe(`create schema yes_no_fixture`)
  await cli.unsafe(`create table yes_no_fixture.section (id integer primary key, title text, active boolean);
    insert into yes_no_fixture.section values (1, 'Ground', true), (2, 'First', true), (3, 'Second', false)`)

  dir = mkdtempSync(path.join(tmpdir(), 'fb-yes-no-'))
  const file = path.join(dir, 'warehouse.duckdb')
  process.env[DUCK_ENV] = file
  const { DuckDBInstance } = await import('@duckdb/node-api')
  const inst = await DuckDBInstance.create(file)
  const conn = await inst.connect()
  await conn.run(`create table section (id integer, title varchar, active boolean)`)
  await conn.run(`insert into section values (1, 'Ground', true), (2, 'First', true), (3, 'Second', false)`)
  conn.closeSync()
  inst.closeSync()
})

afterAll(async () => {
  invalidateSources()
  await cli.unsafe(`drop schema if exists yes_no_fixture cascade`)
  await cli.end({ timeout: 5 })
  rmSync(dir, { recursive: true, force: true })
})

async function normalTable(admin: TestClient): Promise<string> {
  await admin.post('/api/table_def', {
    name: T,
    columns: [
      { column_name: 'title', column_type: 'Data' },
      { column_name: 'active', column_type: 'Check' },
    ],
  })
  for (const [title, active] of [['Ground', true], ['First', true], ['Second', false]])
    await admin.post('/api/save_row', { table: T, row: { title, active } })
  return T
}

async function connectedTable(
  admin: TestClient,
  source: { row_id: string; engine: string; url_env: string; schema: string },
): Promise<string> {
  invalidateSources()
  await admin.post('/api/table/Data%20Source', {
    row_id: source.row_id,
    engine: source.engine,
    url_env: source.url_env,
    access: 'read_only',
  })
  const res = await admin.fetch(`/api/table/Data%20Source/${source.row_id}:reflect`, {
    method: 'POST',
    body: JSON.stringify({ schema: source.schema, tables: ['section'] }),
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { created: { name: string }[] }
  return body.created[0].name
}

async function titles(admin: TestClient, table: string, filters: unknown[]): Promise<string[]> {
  const params = new URLSearchParams({
    filters: JSON.stringify(filters),
    fields: JSON.stringify(['row_id', 'title']),
  })
  const body = await admin.get<{ data: { title: string }[] }>(
    `/api/table/${encodeURIComponent(table)}?${params}`,
  )
  return body.data.map((r) => r.title).sort()
}

describe('Filtering a yes or no column finds its rows', () => {
  test('A link saying Active is "true" finds the active rows', async ({ admin }) => {
    const table = await normalTable(admin)
    expect(await titles(admin, table, [['active', '=', 'true']])).toEqual(ACTIVE)
  })

  test('true, false, yes and no find the right rows in any capitals, with = and !=', async ({ admin }) => {
    const table = await normalTable(admin)
    for (const word of ['true', 'TRUE', 'yes', 'Yes', 'YES']) {
      expect(await titles(admin, table, [['active', '=', word]])).toEqual(ACTIVE)
      expect(await titles(admin, table, [['active', '!=', word]])).toEqual(INACTIVE)
    }
    for (const word of ['false', 'False', 'no', 'No', 'NO']) {
      expect(await titles(admin, table, [['active', '=', word]])).toEqual(INACTIVE)
      expect(await titles(admin, table, [['active', '!=', word]])).toEqual(ACTIVE)
    }
  })

  test('A link saying Active is "maybe" finds no rows, with = and with !=', async ({ admin }) => {
    const table = await normalTable(admin)
    expect(await titles(admin, table, [['active', '=', 'maybe']])).toEqual([])
    expect(await titles(admin, table, [['active', '!=', 'maybe']])).toEqual([])
    expect(await titles(admin, table, [['active', '=', 1]])).toEqual([])
    // Words the database would read by itself, but the rule doesn't.
    expect(await titles(admin, table, [['active', '=', 'on']])).toEqual([])
  })

  test('A real true, a real false and an empty value still work', async ({ admin }) => {
    const table = await normalTable(admin)
    expect(await titles(admin, table, [['active', '=', true]])).toEqual(ACTIVE)
    expect(await titles(admin, table, [['active', '=', false]])).toEqual(INACTIVE)
    expect(await titles(admin, table, [['active', '=', null]])).toEqual([])
  })

  test('The Yes/No check covers only = and !=; the other operators behave as they did', async ({ admin }) => {
    const table = await normalTable(admin)
    expect(await titles(admin, table, [['active', 'like', '%true%']])).toEqual(ACTIVE)
    expect(await titles(admin, table, [['active', '>', false]])).toEqual(ACTIVE)
  })

  test('A filter on another kind of column is left as it is', async ({ admin }) => {
    const table = await normalTable(admin)
    expect(await titles(admin, table, [['title', '=', 'Yes']])).toEqual([])
    expect(await titles(admin, table, [['title', '=', 'Ground']])).toEqual(['Ground'])
    expect(await titles(admin, table, [['row_id', '=', 'no-such-row']])).toEqual([])
  })

  test('A connected Table reads Yes/No values as a normal Table does', async ({ admin }) => {
    const table = await connectedTable(admin, {
      row_id: 'yes-no-pg', engine: 'postgres', url_env: PG_ENV, schema: 'yes_no_fixture',
    })
    expect(await titles(admin, table, [['active', '=', 'Yes']])).toEqual(ACTIVE)
    expect(await titles(admin, table, [['active', '!=', 'yes']])).toEqual(INACTIVE)
    expect(await titles(admin, table, [['active', '=', 'FALSE']])).toEqual(INACTIVE)
    expect(await titles(admin, table, [['active', '=', true]])).toEqual(ACTIVE)
    expect(await titles(admin, table, [['active', '=', 'maybe']])).toEqual([])
    expect(await titles(admin, table, [['active', '!=', 'maybe']])).toEqual([])
    expect(await titles(admin, table, [['title', '=', 'Ground']])).toEqual(['Ground'])
  })

  test('A warehouse Table finds its rows for Yes and no rows for "maybe"', async ({ admin }) => {
    const table = await connectedTable(admin, {
      row_id: 'yes-no-duck', engine: 'duckdb', url_env: DUCK_ENV, schema: 'warehouse.main',
    })
    expect(await titles(admin, table, [['active', '=', 'Yes']])).toEqual(ACTIVE)
    expect(await titles(admin, table, [['active', '=', 'no']])).toEqual(INACTIVE)
    expect(await titles(admin, table, [['active', '=', 'maybe']])).toEqual([])
    expect(await titles(admin, table, [['active', '!=', 'maybe']])).toEqual([])
    const count = await admin.get<{ count: number }>(
      `/api/table/${encodeURIComponent(table)}:count?filters=${encodeURIComponent('[["active","=","maybe"]]')}`,
    )
    expect(count.count).toBe(0)
  })
})

// Gaps around the Postgres source driver and the shared source plumbing:
// column-type mapping, every filter operator, writes to tables with nothing
// but defaults, reflection name handling, connection-variable resolution and
// Data Source validation. The foreign schema lives outside the sandbox
// transaction (like sources-postgres.test.ts); control-side rows roll back.
import { afterAll, beforeAll, describe, expect } from 'vitest'
import postgres from 'postgres'
import { test } from './pg-test'
import { EXTERNAL_DATABASE_URL } from './external-database'
import { invalidateSources, assertAllowed, resolveUrl } from '../src/sources/registry'
import { postgresDriver } from '../src/sources/postgres-driver'
import { fkKey, singleColumnFks } from '../src/sources/fk'
import type { Binding, SourceConfig } from '../src/sources/types'

const URL_ENV = 'EXT_EXTRA_URL'
process.env[URL_ENV] = EXTERNAL_DATABASE_URL

let cli: ReturnType<typeof postgres>

beforeAll(async () => {
  cli = postgres(EXTERNAL_DATABASE_URL, { max: 2, onnotice: () => {} })
  await cli.unsafe(`drop schema if exists ext_extra cascade`)
  await cli.unsafe(`create schema ext_extra`)
  await cli.unsafe(`
    create table ext_extra.kitchen (
      id serial primary key,
      price numeric(8,2),
      ratio double precision,
      flag boolean,
      born date,
      meta jsonb,
      code varchar(20),
      story varchar(300),
      initial char(1)
    )`)
  await cli.unsafe(`create table ext_extra."2024" (id serial primary key, note text)`)
  await cli.unsafe(`create table ext_extra.gadget (id serial primary key, note text)`)
  await cli.unsafe(`create table ext_extra.plain (id serial primary key, note text, qty int)`)
  await cli.unsafe(`insert into ext_extra.plain (note, qty) values ('alpha', 1), ('beta', 2), ('gamma', 3)`)
})

afterAll(async () => {
  invalidateSources()
  await cli.unsafe(`drop schema if exists ext_extra cascade`)
  await cli.end({ timeout: 2 })
})

type Admin = {
  get: (p: string) => Promise<unknown>
  post: <T = Record<string, unknown>>(p: string, b?: unknown) => Promise<T>
  fetch: (p: string, i?: RequestInit) => Promise<Response>
}

async function makeSource(admin: Admin): Promise<void> {
  invalidateSources()
  await admin.post('/api/table/Data%20Source', {
    row_id: 'ext-extra',
    engine: 'postgres',
    url_env: URL_ENV,
    default_schema: 'ext_extra',
    access: 'read_write',
  })
}

async function reflect(admin: Admin, table: string): Promise<string> {
  const res = await admin.post<{ created: { name: string }[]; skipped: { reason: string }[] }>(
    '/api/table/Data%20Source/ext-extra:reflect',
    { schema: 'ext_extra', tables: [table] },
  )
  expect(res.skipped).toEqual([])
  return res.created[0].name
}

describe('Connecting Postgres tables: names and column types', () => {
  test('database column types map to the closest Featherbase type', async ({ admin }) => {
    await makeSource(admin)
    const res = (await admin.get(
      '/api/table/Data%20Source/ext-extra:introspect?schema=ext_extra',
    )) as { tables: { table: string; columns: { name: string; column_type: string }[] }[] }
    const kitchen = res.tables.find((t) => t.table === 'kitchen')!
    expect(Object.fromEntries(kitchen.columns.map((c) => [c.name, c.column_type]))).toEqual({
      id: 'Int',
      price: 'Float',
      ratio: 'Float',
      flag: 'Check',
      born: 'Date',
      meta: 'JSON',
      code: 'Data',
      story: 'Text',
      initial: 'Data',
    })
  })

  test('a table named only with digits still gets a legal Table name', async ({ admin }) => {
    await makeSource(admin)
    const res = (await admin.get(
      '/api/table/Data%20Source/ext-extra:introspect?schema=ext_extra',
    )) as { tables: { table: string; proposed_name: string }[] }
    expect(res.tables.find((t) => t.table === '2024')!.proposed_name).toBe('Ext 2024')
  })

  test('a table whose proposed name is taken by another Table is skipped, naming the clash', async ({ admin }) => {
    await makeSource(admin)
    await admin.post('/api/table_def', {
      name: 'Ext Gadget',
      columns: [{ column_name: 'title', column_type: 'Data' }],
    })
    const res = await admin.post<{ created: unknown[]; skipped: { table: string; reason: string }[] }>(
      '/api/table/Data%20Source/ext-extra:reflect',
      { schema: 'ext_extra', tables: ['gadget'] },
    )
    expect(res.created).toEqual([])
    expect(res.skipped).toEqual([{ table: 'gadget', reason: 'Table Ext Gadget already exists' }])
  })
})

describe('Filtering rows read from Postgres', () => {
  const notes = async (admin: Admin, name: string, filters: unknown[]) => {
    const res = (await admin.get(
      `/api/table/${encodeURIComponent(name)}?fields=${encodeURIComponent('["note"]')}&order_by=qty asc&filters=${encodeURIComponent(JSON.stringify(filters))}`,
    )) as { data: { note: string }[] }
    return res.data.map((r) => r.note)
  }

  test('exclusion, comparison, pattern and list filters narrow the rows', async ({ admin }) => {
    await makeSource(admin)
    const name = await reflect(admin, 'plain')
    expect(await notes(admin, name, [['qty', '!=', '2']])).toEqual(['alpha', 'gamma'])
    expect(await notes(admin, name, [['qty', '>', '1']])).toEqual(['beta', 'gamma'])
    expect(await notes(admin, name, [['qty', '<=', '2']])).toEqual(['alpha', 'beta'])
    expect(await notes(admin, name, [['note', 'like', 'AL%']])).toEqual(['alpha'])
    expect(await notes(admin, name, [['note', 'not like', 'AL%']])).toEqual(['beta', 'gamma'])
    expect(await notes(admin, name, [['qty', 'in', ['1', '3']]])).toEqual(['alpha', 'gamma'])
    expect(await notes(admin, name, [['qty', 'not in', ['1', '3']]])).toEqual(['beta'])
    // An empty list: nothing is "in" it, everything is "not in" it.
    expect(await notes(admin, name, [['qty', 'in', []]])).toEqual([])
    expect(await notes(admin, name, [['qty', 'not in', []]])).toHaveLength(3)
  })

  test('a Data Scope filter lets unset values through as well as the allowed ones', async () => {
    const bind: Binding = {
      source: {
        name: 'ext-extra',
        engine: 'postgres',
        url_env: URL_ENV,
        root_path: null,
        default_schema: 'ext_extra',
        access: 'read_only',
        pool_max: 2,
        statement_timeout_ms: 10000,
        allowlist: null,
      },
      schema: 'ext_extra',
      table: 'plain',
      pk: 'id',
      modified: null,
      columns: [{ column_name: 'qty', source_column: 'qty', column_type: 'Int' }],
    }
    await cli.unsafe(`insert into ext_extra.plain (note, qty) values ('unset', null)`)
    try {
      expect(await postgresDriver.count(bind, [{ column: 'qty', op: 'in_or_null', value: [1, 2] }])).toBe(3)
      expect(await postgresDriver.count(bind, [{ column: 'qty', op: 'in_or_null', value: [] }])).toBe(1)
    } finally {
      await cli.unsafe(`delete from ext_extra.plain where note = 'unset'`)
      postgresDriver.dispose('ext-extra')
    }
  })
})

describe('Writing to a Postgres table that has only defaults', () => {
  test('creating a row with no values lets the database fill everything in', async ({ admin }) => {
    await makeSource(admin)
    const name = await reflect(admin, 'plain')
    const created = await admin.post<Record<string, unknown>>(`/api/table/${encodeURIComponent(name)}`, {})
    expect(created.note).toBeNull()
    const [{ n }] = await cli`select count(*)::int as n from ext_extra.plain where id = ${Number(created.row_id)}`
    expect(n).toBe(1)
    await cli.unsafe(`delete from ext_extra.plain where id = ${Number(created.row_id)}`)
  })

  test('saving a row with no changes returns it as it is, and a missing row is not found', async ({ admin }) => {
    await makeSource(admin)
    const name = await reflect(admin, 'plain')
    const enc = encodeURIComponent(name)
    const [first] = await cli`select id from ext_extra.plain where note = 'alpha'`
    const saved = await admin.fetch(`/api/table/${enc}/${first.id}`, { method: 'PATCH', body: JSON.stringify({}) })
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({ row_id: String(first.id), note: 'alpha' })
    const missing = await admin.fetch(`/api/table/${enc}/999999`, { method: 'PATCH', body: JSON.stringify({}) })
    expect(missing.status).toBe(404)
  })
})

describe('Connection variables and the table allowlist', () => {
  const cfg = (over: Partial<SourceConfig>): SourceConfig => ({
    name: 'probe',
    engine: 'postgres',
    url_env: URL_ENV,
    root_path: null,
    default_schema: null,
    access: 'read_only',
    pool_max: 2,
    statement_timeout_ms: 10000,
    allowlist: null,
    ...over,
  })

  test('the connection string comes from the named variable, and a missing one is named in the error', () => {
    expect(resolveUrl(cfg({}))).toBe(EXTERNAL_DATABASE_URL)
    expect(() => resolveUrl(cfg({ url_env: null }))).toThrow('has no url_env configured')
    expect(() => resolveUrl(cfg({ url_env: 'EXT_EXTRA_NEVER_SET' }))).toThrow(
      'Environment variable EXT_EXTRA_NEVER_SET is not set (required by data source probe)',
    )
  })

  test('only allowlisted tables pass; a source with no allowlist allows all', () => {
    expect(() => assertAllowed(cfg({}), 'any', 'thing')).not.toThrow()
    const limited = cfg({ allowlist: ['ext_extra.plain', 'loose'] })
    expect(() => assertAllowed(limited, 'ext_extra', 'plain')).not.toThrow()
    expect(() => assertAllowed(limited, '', 'loose')).not.toThrow()
    expect(() => assertAllowed(limited, 'ext_extra', 'kitchen')).toThrow(
      'Table ext_extra.kitchen is not in the allowlist of data source probe',
    )
  })
})

describe('Foreign keys read from information_schema', () => {
  const row = (constraint: string, table: string, column: string, refTable: string, refColumn: string) => ({
    constraint_schema: 's',
    constraint_name: constraint,
    table_schema: 's',
    table_name: table,
    column_name: column,
    referenced_table_schema: 's',
    referenced_table_name: refTable,
    referenced_column_name: refColumn,
  })

  test('a single-column key becomes an edge; a composite key is dropped', () => {
    const edges = singleColumnFks([
      row('fk_a', 'child', 'parent_id', 'parent', 'id'),
      row('fk_c', 'pair', 'x', 'target', 'x'),
      row('fk_c', 'pair', 'y', 'target', 'y'),
    ])
    expect([...edges.keys()]).toEqual([fkKey('s', 'child', 'parent_id')])
    expect(edges.get(fkKey('s', 'child', 'parent_id'))).toEqual({ schema: 's', table: 'parent', column: 'id' })
  })

  test('a column under two constraints keeps the first one', () => {
    const edges = singleColumnFks([
      row('fk_1', 'child', 'owner_id', 'people', 'id'),
      row('fk_2', 'child', 'owner_id', 'companies', 'id'),
    ])
    expect(edges.size).toBe(1)
    expect(edges.get(fkKey('s', 'child', 'owner_id'))!.table).toBe('people')
  })

  test('the same constraint name on two tables stays two separate keys', () => {
    const edges = singleColumnFks([
      row('fk_ref', 'claim', 'vehicle_id', 'vehicle', 'id'),
      row('fk_ref', 'inspection', 'vehicle_id', 'vehicle', 'id'),
    ])
    expect(edges.size).toBe(2)
  })
})

describe('Saving a Data Source', () => {
  test('a folder source must name its folder', async ({ admin }) => {
    await expect(
      admin.post('/api/table/Data%20Source', { row_id: 'no-folder', engine: 'csv-folder' }),
    ).rejects.toMatchObject({ status: 417, fields: { root_path: expect.stringContaining('required') } })
  })

  test('a database source must name its connection variable', async ({ admin }) => {
    await expect(
      admin.post('/api/table/Data%20Source', { row_id: 'no-var', engine: 'postgres' }),
    ).rejects.toMatchObject({ status: 417, fields: { url_env: expect.stringContaining('environment variable') } })
  })

  test('the platform\'s own database cannot be a source', async ({ admin }) => {
    await expect(
      admin.post('/api/table/Data%20Source', { row_id: 'self', engine: 'postgres', url_env: 'DATABASE_URL' }),
    ).rejects.toMatchObject({ status: 403 })
  })

  test('a source name must be lowercase words joined by hyphens', async ({ admin }) => {
    await expect(
      admin.post('/api/table/Data%20Source', { row_id: 'Bad Name', engine: 'postgres', url_env: URL_ENV }),
    ).rejects.toMatchObject({ status: 417, fields: { name: expect.stringContaining('lowercase') } })
  })
})

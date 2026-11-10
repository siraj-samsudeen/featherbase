// Gaps around the Postgres source driver and the shared source plumbing:
// column-type mapping, every filter operator, writes to tables with nothing
// but defaults, reflection name handling, connection-variable resolution and
// Data Source validation. The foreign schema lives outside the sandbox
// transaction (like sources-postgres.test.ts); control-side rows roll back.
import { afterAll, beforeAll, describe, expect } from 'vitest'
import postgres from 'postgres'
import { test } from './pg-test'
import { EXTERNAL_DATABASE_URL } from './external-database'
import { allowlistQualificationGuidance, assertAllowed, getSource, invalidateSources, resolveUrl } from '../src/sources/registry'
import { postgresDriver } from '../src/sources/postgres-driver'
import { fkKey, singleColumnFks } from '../src/sources/fk'
import { sql } from '../src/db'
import type { Binding, SourceConfig } from '../src/sources/types'
import { expectRefused, expectStatus } from './fixtures'
import { registerController, unregisterController } from '../src/controllers'

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
      initial char(1),
      small smallint,
      single real,
      local_time timestamp without time zone,
      raw_json json,
      unlimited varchar
    )`)
  await cli.unsafe(`create table ext_extra."2024" (id serial primary key, note text)`)
  await cli.unsafe(`create table ext_extra.gadget (id serial primary key, note text)`)
  await cli.unsafe(`create table ext_extra.plain (id serial primary key, note text, qty int)`)
  await cli.unsafe(`insert into ext_extra.plain (note, qty) values ('alpha', 1), ('beta', 2), ('gamma', 3)`)
  // Both constraints are legal: the column must satisfy both parents.
  // Catalog order (constraint OID) must retain the first edge, not the last.
  await cli.unsafe(`create table ext_extra.dual_owner (
    id serial primary key,
    owner_id int,
    constraint first_owner foreign key (owner_id) references ext_extra.plain(id)
  )`)
  await cli.unsafe(`alter table ext_extra.dual_owner add constraint second_owner
    foreign key (owner_id) references ext_extra.gadget(id)`)
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
  test('a real source column with two foreign keys keeps the first catalog edge', async ({ admin }) => {
    await makeSource(admin)
    const parent = await reflect(admin, 'plain')
    await reflect(admin, 'gadget')
    const intro = await admin.get('/api/table/Data%20Source/ext-extra:introspect?schema=ext_extra') as {
      tables: { table: string; columns: { name: string; references: unknown; reference_table: string | null }[] }[]
    }
    expect(intro.tables.find((t) => t.table === 'dual_owner')!.columns.find((c) => c.name === 'owner_id')).toMatchObject({
      references: { schema: 'ext_extra', table: 'plain', column: 'id' },
      reference_table: parent,
    })
    const name = await reflect(admin, 'dual_owner')
    const meta = await admin.get(`/api/table/${encodeURIComponent(name)}:meta`) as {
      columns: { column_name: string; column_type: string; reference_table: string | null }[]
    }
    expect(meta.columns.find((c) => c.column_name === 'owner_id')).toMatchObject({
      column_type: 'Reference', reference_table: parent,
    })
  })

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
      story: 'Data',
      initial: 'Data',
      small: 'Int',
      single: 'Float',
      local_time: 'Datetime',
      raw_json: 'JSON',
      unlimited: 'Text',
    })
  })

  test('a table named only with digits still gets a legal Table name', async ({ admin }) => {
    await makeSource(admin)
    const res = (await admin.get(
      '/api/table/Data%20Source/ext-extra:introspect?schema=ext_extra',
    )) as { tables: { table: string; proposed_name: string }[] }
    expect(res.tables.find((t) => t.table === '2024')!.proposed_name).toBe('Ext 2024')
  })

  test.for([
    ['has no letters or digits, the proposed name starts with Src', '__', 'Src Shelf'],
    ['starts with a dot, the proposed name starts with the source\'s name', '.ledger', 'Ext Shelf'],
  ])('when the schema name %s', async ([, schema, proposed], { admin }) => {
    await cli.unsafe(`create schema "${schema}"; create table "${schema}".shelf (id serial primary key)`)
    try {
      await makeSource(admin)
      const res = await admin.get(`/api/table/Data%20Source/ext-extra:introspect?schema=${encodeURIComponent(schema)}`) as
        { tables: { table: string; proposed_name: string }[] }
      expect(res.tables.find((t) => t.table === 'shelf')!.proposed_name).toBe(proposed)
    } finally {
      await cli.unsafe(`drop schema "${schema}" cascade`)
    }
  })

  test('a numeric reflection prefix is made into a legal Table name and binds the original relation', async ({ admin }) => {
    await makeSource(admin)
    const result = await admin.post<{ created: { table: string; name: string }[]; skipped: unknown[] }>(
      '/api/table/Data%20Source/ext-extra:reflect',
      { schema: 'ext_extra', tables: ['2024'], prefix: '2024' },
    )
    expect(result).toEqual({ created: [{ table: '2024', name: 'T 2024 2024' }], skipped: [] })
    const meta = await admin.get('/api/table/T%202024%202024:meta')
    expect(meta).toMatchObject({ external_schema: 'ext_extra', external_table: '2024', external_pk: 'id' })
    const rows = await admin.get('/api/table/T%202024%202024')
    expect(rows).toMatchObject({ data: [], total: 0 })
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

  test('malformed filters and sort expressions return validation errors without changing source rows', async ({ admin }) => {
    await makeSource(admin)
    const name = await reflect(admin, 'plain')
    const path = `/api/table/${encodeURIComponent(name)}`
    const before = await cli`select * from ext_extra.plain order by id`
    for (const [filters, message] of [
      [[['qty', '=']], 'Each filter must be [field, operator, value]'],
      [[['qty', 'between', [1, 3]]], 'Unknown filter operator between'],
    ] as const) {
      const res = await admin.fetch(`${path}?filters=${encodeURIComponent(JSON.stringify(filters))}`)
      await expectStatus(res, 417)
      expect(await res.json()).toEqual({ error: { type: 'ValidationError', message } })
    }
    const invalid = await admin.fetch(`${path}?order_by=${encodeURIComponent('qty desc, id')}`)
    await expectStatus(invalid, 417)
    expect(await invalid.json()).toEqual({ error: { type: 'ValidationError', message: 'Invalid order_by qty desc, id' } })
    const unknown = await admin.fetch(`${path}?order_by=missing`)
    await expectStatus(unknown, 417)
    expect(await unknown.json()).toEqual({ error: {
      type: 'ValidationError', message: 'Unknown order_by field', fields: { missing: 'Unknown field missing' },
    } })
    // A directionless order is ascending, not the Table's default descending order.
    const ordered = await admin.get(`${path}?fields=${encodeURIComponent('["note"]')}&order_by=qty`) as { data: { note: string }[] }
    expect(ordered.data.map((row) => row.note)).toEqual(['alpha', 'beta', 'gamma'])
    expect(await cli`select * from ext_extra.plain order by id`).toEqual(before)
  })

  test('non-list membership values follow empty-list semantics on the exported driver', async () => {
    const bind: Binding = {
      source: {
        name: 'ext-extra-membership', engine: 'postgres', url_env: URL_ENV, root_path: null,
        default_schema: 'ext_extra', access: 'read_only', pool_max: 2,
        statement_timeout_ms: 10000, allowlist: null, databases: [],
      },
      schema: 'ext_extra', table: 'plain', pk: 'id', modified: null, columns: [],
    }
    try {
      expect(await postgresDriver.count(bind, [{ column: 'qty', op: 'in', value: null }])).toBe(0)
      expect(await postgresDriver.count(bind, [{ column: 'qty', op: 'not in', value: null }])).toBe(3)
      expect(await postgresDriver.count(bind, [{ column: 'qty', op: 'in_or_null', value: null }])).toBe(0)
    } finally {
      postgresDriver.dispose(bind.source.name)
    }
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
        databases: [],
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
    await expectStatus(saved, 200)
    expect(await saved.json()).toMatchObject({ row_id: String(first.id), note: 'alpha' })
    const missing = await admin.fetch(`/api/table/${enc}/999999`, { method: 'PATCH', body: JSON.stringify({}) })
    await expectStatus(missing, 404)
  })

  test('a save that leaves a timestamp out does not rewrite it', async ({ admin }) => {
    await makeSource(admin)
    const name = await reflect(admin, 'kitchen')
    const [row] = await cli`insert into ext_extra.kitchen (code, local_time) values ('k-time', '2026-01-02 03:04:05') returning id`
    try {
      const saved = await admin.fetch(`/api/table/${encodeURIComponent(name)}/${row.id}`, { method: 'PATCH', body: JSON.stringify({ code: 'k-time-2' }) })
      await expectStatus(saved, 200)
      const [after] = await cli`select code, local_time::text as local_time from ext_extra.kitchen where id = ${row.id}`
      expect(after).toEqual({ code: 'k-time-2', local_time: '2026-01-02 03:04:05' })
    } finally {
      await cli`delete from ext_extra.kitchen where id = ${row.id}`
    }
  })

  test('a value a hook drops from the row is still written as sent', async ({ admin }) => {
    await makeSource(admin)
    const name = await reflect(admin, 'plain')
    const controller = { table: name, hooks: { before_save: ({ row }: { row: Record<string, unknown> }) => { delete row.note } } }
    registerController(controller)
    const [first] = await cli`select id from ext_extra.plain where note = 'beta'`
    try {
      const saved = await admin.fetch(`/api/table/${encodeURIComponent(name)}/${first.id}`, { method: 'PATCH', body: JSON.stringify({ note: 'beta-2' }) })
      await expectStatus(saved, 200)
      expect((await cli`select note from ext_extra.plain where id = ${first.id}`)[0].note).toBe('beta-2')
    } finally {
      unregisterController(controller)
      await cli`update ext_extra.plain set note = 'beta' where id = ${first.id}`
    }
  })

  test('group counts retain the rows whose grouping value is NULL', async () => {
    const bind: Binding = {
      source: {
        name: 'ext-extra-null-groups', engine: 'postgres', url_env: URL_ENV, root_path: null,
        default_schema: null, access: 'read_only', pool_max: 2,
        statement_timeout_ms: 10000, allowlist: null, databases: [],
      },
      schema: 'ext_extra', table: 'nullable_groups', pk: 'id', modified: null, columns: [],
    }
    await cli.unsafe(`create table ext_extra.nullable_groups (id integer primary key, qty integer)`)
    try {
      await cli.unsafe(`insert into ext_extra.nullable_groups values (1, null), (2, null), (3, null), (4, 7), (5, 7), (6, 12)`)
      expect(await postgresDriver.groupCount(bind, 'qty', [])).toEqual([
        { label: '', value: 3 }, { label: '7', value: 2 }, { label: '12', value: 1 },
      ])
    } finally {
      postgresDriver.dispose(bind.source.name)
      await cli.unsafe(`drop table ext_extra.nullable_groups`)
    }
  })

  test('updates return only existing source rows', async () => {
    const bind: Binding = {
      source: {
        name: 'ext-extra-missing-update', engine: 'postgres', url_env: URL_ENV, root_path: null,
        default_schema: null, access: 'read_write', pool_max: 2,
        statement_timeout_ms: 10000, allowlist: null, databases: [],
      },
      schema: 'ext_extra', table: 'missing_update', pk: 'id', modified: null, columns: [],
    }
    await cli.unsafe(`create table ext_extra.missing_update (id integer primary key, note text)`)
    try {
      await cli.unsafe(`insert into ext_extra.missing_update values (3, 'kept')`)
      expect(await postgresDriver.update(bind, '3', {}, null)).toEqual({ id: 3, note: 'kept' })
      expect(await postgresDriver.update(bind, '10', {}, null)).toBe('missing')
      expect(await postgresDriver.update(bind, '11', { note: 'must not be inserted' }, null)).toBe('missing')
      expect(await cli`select * from ext_extra.missing_update`).toEqual([{ id: 3, note: 'kept' }])
      expect(await postgresDriver.update(bind, '3', { note: 'changed' }, null)).toEqual({ id: 3, note: 'changed' })
      expect(await cli`select * from ext_extra.missing_update`).toEqual([{ id: 3, note: 'changed' }])
    } finally {
      postgresDriver.dispose(bind.source.name)
      await cli.unsafe(`drop table ext_extra.missing_update`)
    }
  })

  test('the driver distinguishes a stale delete from a missing row and permits a delete without a revision', async () => {
    const bind: Binding = {
      source: {
        name: 'ext-extra-delete', engine: 'postgres', url_env: URL_ENV, root_path: null,
        default_schema: null, access: 'read_write', pool_max: 2,
        statement_timeout_ms: 10000, allowlist: null, databases: [],
      },
      schema: 'ext_extra', table: 'revision_delete', pk: 'id', modified: 'changed_at',
      columns: [{ column_name: 'note', source_column: 'note', column_type: 'Text' }],
    }
    await cli.unsafe(`create table ext_extra.revision_delete (id int primary key, note text, changed_at timestamptz)`)
    try {
      await cli.unsafe(`insert into ext_extra.revision_delete values (1, 'kept', '2000-01-02T00:00:00Z')`)
      const before = await cli`select * from ext_extra.revision_delete`
      expect(await postgresDriver.remove(bind, '1', '2000-01-01T00:00:00Z')).toBe('conflict')
      expect(await cli`select * from ext_extra.revision_delete`).toEqual(before)
      expect(await postgresDriver.remove(bind, '999', '2000-01-01T00:00:00Z')).toBe('missing')
      expect(await cli`select * from ext_extra.revision_delete`).toEqual(before)
      expect(await postgresDriver.remove(bind, '1', null)).toBeUndefined()
      expect(await cli`select * from ext_extra.revision_delete`).toEqual([])
      expect(await postgresDriver.remove(bind, '1', null)).toBe('missing')
    } finally {
      postgresDriver.dispose(bind.source.name)
      await cli.unsafe(`drop table ext_extra.revision_delete`)
    }
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
    databases: [],
    ...over,
  })

  test('the connection string comes from the named variable, and a missing one is named in the error', () => {
    expect(resolveUrl(cfg({}))).toBe(EXTERNAL_DATABASE_URL)
    expect(() => resolveUrl(cfg({ url_env: null }))).toThrow('has no url_env configured')
    expect(() => resolveUrl(cfg({ url_env: 'EXT_EXTRA_NEVER_SET' }))).toThrow(
      'Environment variable EXT_EXTRA_NEVER_SET is not set (required by data source probe)',
    )
  })

  test('the public Postgres driver rejects a configuration without a connection variable', async () => {
    // SourceConfig permits null for folder engines; the Postgres driver
    // must reject it itself, even without the Data Source HTTP validator.
    await expect(postgresDriver.test(cfg({ name: 'pg-missing-url', url_env: null }))).rejects.toMatchObject({
      type: 'ValidationError',
      message: 'Data source pg-missing-url has no url_env configured',
    })
  })

  test('unscoped driver introspection discovers real tables and their default, nullable and length metadata', async () => {
    const source = cfg({ name: 'pg-unscoped-introspection' })
    try {
      const tables = await postgresDriver.introspect(source)
      const kitchen = tables.find((table) => table.schema === 'ext_extra' && table.table === 'kitchen')!
      expect(kitchen.pk).toBe('id')
      expect(kitchen.columns.find((column) => column.name === 'id')).toMatchObject({
        data_type: 'integer', nullable: false, has_default: true, is_pk: true, max_length: null,
      })
      expect(kitchen.columns.find((column) => column.name === 'code')).toMatchObject({
        data_type: 'character varying', nullable: true, has_default: false, is_pk: false, max_length: 20,
      })
      expect(kitchen.columns.find((column) => column.name === 'unlimited')).toMatchObject({
        data_type: 'character varying', column_type: 'Text', max_length: null,
      })
      expect(tables.some((table) => ['pg_catalog', 'information_schema'].includes(table.schema))).toBe(false)
    } finally {
      postgresDriver.dispose(source.name)
    }
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

  test('an allowlist of only separators restricts nothing and needs no qualifying', () => {
    expect(allowlistQualificationGuidance('postgres', ' ,\n, ')).toBeNull()
  })

  test('a source with no pool size or statement timeout set takes the defaults', async () => {
    await sql`insert into data_source ${sql({ row_id: 'ext-defaults', engine: 'postgres', url_env: URL_ENV, pool_max: null, statement_timeout_ms: null })}`
    invalidateSources()
    expect(await getSource('ext-defaults')).toMatchObject({ pool_max: 5, statement_timeout_ms: 10000 })
  })

  test('a source whose pool size and statement timeout are zero takes the defaults', async () => {
    await sql`insert into data_source ${sql({ row_id: 'ext-zeroes', engine: 'postgres', url_env: URL_ENV, pool_max: 0, statement_timeout_ms: 0 })}`
    invalidateSources()
    expect(await getSource('ext-zeroes')).toMatchObject({ pool_max: 5, statement_timeout_ms: 10000 })
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
  test('an incomplete restriction edit preserves the saved source until corrected', async ({ admin }) => {
    const saved = await admin.post<Record<string, unknown>>('/api/save_row', {
      table: 'Data Source',
      row: {
        row_id: 'allowlist-edit', engine: 'postgres', url_env: URL_ENV,
        default_schema: 'ext_extra', access: 'read_only', table_allowlist: 'ext_extra.plain',
      },
    })
    const res = await admin.fetch('/api/save_row', {
      method: 'POST',
      body: JSON.stringify({
        table: 'Data Source',
        row: { ...saved, table_allowlist: 'ext_extra.gadget,plain', access: 'read_write' },
      }),
    })
    await expectStatus(res, 417)
    expect(await res.json()).toMatchObject({ error: {
      type: 'ValidationError',
      fields: { table_allowlist: expect.stringContaining('schema.table') },
    } })
    expect(await admin.get('/api/table/Data%20Source/allowlist-edit')).toMatchObject({
      table_allowlist: 'ext_extra.plain', access: 'read_only', updated_at: saved.updated_at,
    })

    await admin.post('/api/save_row', {
      table: 'Data Source',
      row: { ...saved, table_allowlist: 'ext_extra.gadget,ext_extra.plain', access: 'read_write' },
    })
    expect(await admin.get('/api/table/Data%20Source/allowlist-edit')).toMatchObject({
      table_allowlist: 'ext_extra.gadget,ext_extra.plain', access: 'read_write',
    })
  })

  test('invalid binding requests report each missing source column and persist no Table', async ({ admin }) => {
    await makeSource(admin)
    const res = await admin.fetch('/api/table_def', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Missing Source Columns', data_source: 'ext-extra', external_schema: 'ext_extra',
        external_table: 'plain', external_pk: 'missing_id', external_modified: 'missing_revision',
        columns: [{ column_name: 'note', column_type: 'Data', source_column: 'missing_note' }],
      }),
    })
    await expectStatus(res, 417)
    expect(await res.json()).toEqual({ error: {
      type: 'ValidationError', message: 'Invalid binding for Missing Source Columns', fields: {
        external_pk: 'Column missing_id does not exist on the source relation',
        external_modified: 'Column missing_revision does not exist on the source relation',
        note: 'Source column missing_note does not exist on the source relation',
      },
    } })
    expect(await sql`select name from table_def where name = 'Missing Source Columns'`).toEqual([])
    expect(await cli`select note, qty from ext_extra.plain order by qty`).toEqual([
      { note: 'alpha', qty: 1 }, { note: 'beta', qty: 2 }, { note: 'gamma', qty: 3 },
    ])
  })

  test('a binding that names no schema and a relation the source lacks names the relation alone', async ({ admin }) => {
    await makeSource(admin)
    await expectRefused(admin.post('/api/table_def', {
      name: 'No Such Relation', data_source: 'ext-extra', external_table: 'nowhere', external_pk: 'id',
      columns: [{ column_name: 'note', column_type: 'Data' }],
    }), 417, 'Unknown source relation')
    expect(await sql`select name from table_def where name = 'No Such Relation'`).toEqual([])
  })

  test('a binding that names no schema reads the source default schema', async ({ admin }) => {
    await makeSource(admin)
    await admin.post('/api/table_def', {
      name: 'Plain No Schema', data_source: 'ext-extra', external_table: 'plain', external_pk: 'id',
      columns: [{ column_name: 'note', column_type: 'Data' }],
    })
    const { data } = (await admin.get(`/api/table/Plain%20No%20Schema?fields=${encodeURIComponent('["note"]')}&order_by=note asc`)) as { data: { note: string }[] }
    expect(data.map((r) => r.note)).toEqual(['alpha', 'beta', 'gamma'])
  })

  test('reflection without requested tables is rejected without creating bindings', async ({ admin }) => {
    await makeSource(admin)
    for (const tables of [undefined, []]) {
      const res = await admin.fetch('/api/table/Data%20Source/ext-extra:reflect', {
        method: 'POST', body: JSON.stringify({ schema: 'ext_extra', tables }),
      })
      await expectStatus(res, 417)
      expect(await res.json()).toEqual({ error: {
        type: 'ValidationError', message: 'Pass tables: the source table names to reflect',
      } })
    }
    expect(await sql`select name from table_def where data_source = 'ext-extra'`).toEqual([])
  })

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

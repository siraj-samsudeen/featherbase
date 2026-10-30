// External MySQL data sources — registry, introspection, reflection, reads,
// writes, conflicts, read-only enforcement. Mirrors sources-postgres.test.ts.
//
// The "foreign database" is a MySQL database (ext_mysql) created OUTSIDE the
// sandbox by a direct mysql2 client; the driver reaches it through its own
// pool. Everything control-side happens inside the sandbox per test.
//
// Needs a running MySQL and MYSQL_TEST_URL (e.g. mysql://root@127.0.0.1:3306
// — no database path; the suite creates/drops ext_mysql itself). Without the
// variable the whole file skips: CI and checkouts without MySQL stay green.
import { afterAll, beforeAll, describe, expect, vi } from 'vitest'
import mysql from 'mysql2/promise'
import { test, patchDoc } from './pg-test'
import { invalidateSources } from '../src/sources/registry'
import { mysqlDriver } from '../src/sources/mysql-driver'
import type { Binding } from '../src/sources/types'

// mysql2's promise wrappers; their typings leave the classes out.
type QueryProto = { prototype: { query: (...args: unknown[]) => Promise<unknown> } }
const { PromisePool, PromiseConnection } = mysql as unknown as Record<'PromisePool' | 'PromiseConnection', QueryProto>

const MYSQL_URL = process.env.MYSQL_TEST_URL
const EXT_URL_ENV = 'EXT_MYSQL_URL'
if (MYSQL_URL) process.env[EXT_URL_ENV] = `${MYSQL_URL.replace(/\/$/, '')}/ext_mysql`

// Direct, unsandboxed client that plays the CLI owning the foreign database.
let cli: mysql.Connection

beforeAll(async () => {
  if (!MYSQL_URL) return
  cli = await mysql.createConnection({ uri: MYSQL_URL, timezone: 'Z', multipleStatements: true })
  await cli.query(`drop database if exists ext_mysql`)
  await cli.query(`create database ext_mysql`)
  await cli.query(`
    create table ext_mysql.tenant (
      id int auto_increment primary key,
      slug varchar(100) not null unique,
      plan varchar(50),
      active tinyint(1) not null default 1,
      internal_notes text,
      password varchar(128),
      updated_at datetime(3) not null default current_timestamp(3)
    )`)
  await cli.query(`
    create table ext_mysql.tenant_tag (
      tenant_id int not null,
      tag varchar(50) not null,
      primary key (tenant_id, tag)
    )`)
  await cli.query(`
    insert into ext_mysql.tenant (slug, plan, internal_notes)
    values ('acme', 'pro', 'cli-only'), ('globex', 'free', null)`)
  // Django-style FK trio (the VMS shape): accident points at vehicle and
  // driver, plus at garage — which the tests deliberately never reflect.
  await cli.query(`
    create table ext_mysql.vehicle (
      id int auto_increment primary key,
      reg_no varchar(50) not null,
      updated_at datetime(3) not null default current_timestamp(3)
    )`)
  await cli.query(`
    create table ext_mysql.driver (
      id int auto_increment primary key,
      full_name varchar(100) not null,
      updated_at datetime(3) not null default current_timestamp(3)
    )`)
  await cli.query(`
    create table ext_mysql.garage (
      id int auto_increment primary key,
      city varchar(50)
    )`)
  await cli.query(`
    create table ext_mysql.accident (
      id int auto_increment primary key,
      severity varchar(20),
      vehicle_id int not null,
      driver_id int,
      garage_id int,
      updated_at datetime(3) not null default current_timestamp(3),
      foreign key (vehicle_id) references vehicle(id),
      foreign key (driver_id) references driver(id),
      foreign key (garage_id) references garage(id)
    )`)
  await cli.query(`insert into ext_mysql.vehicle (reg_no) values ('KA-01-1234'), ('KA-02-9999')`)
  await cli.query(`insert into ext_mysql.driver (full_name) values ('Asha Rao')`)
  await cli.query(`insert into ext_mysql.garage (city) values ('Mysuru')`)
  await cli.query(`
    insert into ext_mysql.accident (severity, vehicle_id, driver_id, garage_id)
    values ('minor', 1, 1, 1), ('major', 1, null, null)`)
  // One column of every MySQL type the driver maps.
  await cli.query(`
    create table ext_mysql.kitchen (
      id int auto_increment primary key,
      flag tinyint(1),
      small tinyint,
      big bigint,
      price decimal(8,2),
      ratio float,
      precise_ratio double,
      born date,
      seen datetime,
      stamped timestamp null,
      meta json,
      kind enum('a','b'),
      picks set('x','y'),
      code varchar(20),
      story varchar(300),
      body text,
      yr year,
      initial char(1),
      raw blob
    )`)
  await cli.query(`
    create table ext_mysql.plain (
      id int auto_increment primary key,
      note varchar(50),
      qty int
    )`)
  await cli.query(`insert into ext_mysql.plain (note, qty) values ('alpha', 1), ('beta', 2), ('gamma', 3)`)
  // A text primary key with a default: an insert that gives no key succeeds
  // but LAST_INSERT_ID() stays 0, so the row cannot be addressed afterwards.
  await cli.query(`
    create table ext_mysql.nokey (
      code varchar(20) not null default 'dflt' primary key,
      label varchar(50)
    )`)
  // A trigger rewrites the key on insert, so the row is not where the driver
  // looks for it when it reads the insert back.
  await cli.query(`
    create table ext_mysql.shifty (
      code varchar(20) not null primary key,
      label varchar(50)
    )`)
  await cli.query(`
    create trigger ext_mysql.shifty_prefix before insert on ext_mysql.shifty
    for each row set new.code = concat('x-', new.code)`)
  // An older schema: a key in a character set that can't hold every id.
  await cli.query(`
    create table ext_mysql.legacy (
      code varchar(10) character set latin1 primary key,
      v int
    )`)
  // Other rows point at a badge through its code, not its id.
  await cli.query(`
    create table ext_mysql.badge (
      id int auto_increment primary key,
      code varchar(20) not null unique
    )`)
  await cli.query(`
    create table ext_mysql.badge_holder (
      id int auto_increment primary key,
      badge_code varchar(20),
      foreign key (badge_code) references badge(code)
    )`)
  await cli.query(`insert into ext_mysql.badge (code) values ('B1')`)
  await cli.query(`insert into ext_mysql.badge_holder (badge_code) values ('B1')`)
  // The insert id belongs to `seq`, not to the key: a new row without a
  // key must not be read back through it.
  await cli.query(`
    create table ext_mysql.sequenced (
      code varchar(40) primary key default (uuid()),
      seq int auto_increment unique,
      note varchar(20)
    )`)
  // #154: every way the database refuses a write for a constraint. Its
  // `status` column is renamed on reflection (status is a Featherbase field),
  // so a refusal must be translated from the source column to the field.
  await cli.query(`
    create table ext_mysql.gauge (
      id int auto_increment primary key,
      status varchar(20),
      level int,
      vehicle_id int,
      constraint gauge_level_range check (level between 0 and 10),
      foreign key (vehicle_id) references vehicle(id)
    )`)
  // A revision stored to the microsecond, while a loaded row echoes it to
  // the millisecond: the conflict check must compare whole milliseconds.
  await cli.query(`
    create table ext_mysql.revisioned (
      id int auto_increment primary key,
      note varchar(50),
      changed_at datetime(6) not null
    )`)
})

afterAll(async () => {
  if (!MYSQL_URL) return
  invalidateSources()
  await cli.query(`drop database if exists ext_mysql`)
  await cli.end()
})

async function makeSource(
  admin: { fetch: (p: string, i?: RequestInit) => Promise<Response> },
  overrides: Record<string, unknown> = {},
) {
  invalidateSources()
  const res = await admin.fetch('/api/table/Data%20Source', {
    method: 'POST',
    body: JSON.stringify({
      row_id: 'ext-mysql',
      engine: 'mysql',
      url_env: EXT_URL_ENV,
      default_schema: 'ext_mysql',
      access: 'read_write',
      ...overrides,
    }),
  })
  expect(res.status).toBe(201)
}

async function reflectTenant(admin: {
  fetch: (p: string, i?: RequestInit) => Promise<Response>
}): Promise<string> {
  const res = await admin.fetch('/api/table/Data%20Source/ext-mysql:reflect', {
    method: 'POST',
    body: JSON.stringify({ schema: 'ext_mysql', tables: ['tenant'] }),
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { created: { name: string }[]; skipped: unknown[] }
  expect(body.created).toHaveLength(1)
  return body.created[0].name
}

describe.skipIf(!MYSQL_URL)('mysql: Data Source registry', () => {
  test('accepts the mysql engine and stamps ok on test_connection', async ({ admin }) => {
    await makeSource(admin)
    const ok = await admin.post<{ ok: boolean }>(
      '/api/table/Data%20Source/ext-mysql:test_connection',
      {},
    )
    expect(ok.ok).toBe(true)
  })

  test('an unreachable server fails without echoing the URL or password', async ({ admin }) => {
    process.env.EXT_MYSQL_DEAD_URL = 'mysql://nobody:hunter2@127.0.0.1:59998/nope'
    await makeSource(admin, { row_id: 'ext-mysql-dead', url_env: 'EXT_MYSQL_DEAD_URL' })
    const bad = await admin.post<{ ok: boolean; error: string }>(
      '/api/table/Data%20Source/ext-mysql-dead:test_connection',
      {},
    )
    expect(bad.ok).toBe(false)
    expect(bad.error).not.toContain('mysql://')
    expect(bad.error).not.toContain('hunter2')
  })
})

describe.skipIf(!MYSQL_URL)('mysql: introspection and reflection', () => {
  test('lists tables with pk detection; composite pk is not bindable; tinyint(1) is Check', async ({
    admin,
  }) => {
    await makeSource(admin)
    const res = (await admin.get(
      '/api/table/Data%20Source/ext-mysql:introspect?schema=ext_mysql',
    )) as {
      tables: {
        table: string
        pk: string | null
        bindable: boolean
        reason?: string
        columns: { name: string; column_type: string }[]
      }[]
    }
    const tenant = res.tables.find((t) => t.table === 'tenant')!
    expect(tenant.pk).toBe('id')
    expect(tenant.bindable).toBe(true)
    expect(tenant.columns.find((c) => c.name === 'active')!.column_type).toBe('Check')
    expect(tenant.columns.find((c) => c.name === 'updated_at')!.column_type).toBe('Datetime')
    const tag = res.tables.find((t) => t.table === 'tenant_tag')!
    expect(tag.bindable).toBe(false)
    expect(tag.reason).toMatch(/single-column primary key/)
  })

  test('reflect creates a bound Table mapping updated_at as the modified column', async ({
    admin,
  }) => {
    await makeSource(admin)
    const name = await reflectTenant(admin)
    const meta = (await admin.get(`/api/table/${encodeURIComponent(name)}:meta`)) as Record<
      string,
      unknown
    >
    expect(meta.data_source).toBe('ext-mysql')
    expect(meta.external_pk).toBe('id')
    expect(meta.external_modified).toBe('updated_at')
    expect(meta.source_access).toBe('read_write')
    const colNames = (meta.columns as { column_name: string }[]).map((c) => c.column_name)
    // `password` exists on the source but is credential-named — never
    // reflected (the VMS finding behind migration 0076).
    expect(colNames).toEqual(['slug', 'plan', 'active', 'internal_notes'])
  })
})

// Reflect the given source tables, asserting all were created; returns the
// created Admin names keyed by source table name.
async function reflect(
  admin: { fetch: (p: string, i?: RequestInit) => Promise<Response> },
  tables: string[],
): Promise<Record<string, string>> {
  const res = await admin.fetch('/api/table/Data%20Source/ext-mysql:reflect', {
    method: 'POST',
    body: JSON.stringify({ schema: 'ext_mysql', tables }),
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as {
    created: { table: string; name: string }[]
    skipped: { table: string; reason: string }[]
  }
  expect(body.skipped).toEqual([])
  return Object.fromEntries(body.created.map((c) => [c.table, c.name]))
}

interface MetaColumn {
  column_name: string
  column_type: string
  reference_table: string | null
}

async function metaColumns(
  admin: { get: (p: string) => Promise<unknown> },
  name: string,
): Promise<Map<string, MetaColumn>> {
  const meta = (await admin.get(`/api/table/${encodeURIComponent(name)}:meta`)) as {
    columns: MetaColumn[]
  }
  return new Map(meta.columns.map((c) => [c.column_name, c]))
}

describe.skipIf(!MYSQL_URL)('mysql: foreign keys reflect as References', () => {
  test('introspect reports the FK edge on each referencing column', async ({ admin }) => {
    await makeSource(admin)
    const res = (await admin.get(
      '/api/table/Data%20Source/ext-mysql:introspect?schema=ext_mysql',
    )) as {
      tables: {
        table: string
        columns: {
          name: string
          references?: { schema: string; table: string; column: string } | null
        }[]
      }[]
    }
    const accident = res.tables.find((t) => t.table === 'accident')!
    expect(accident.columns.find((c) => c.name === 'vehicle_id')!.references).toEqual({
      schema: 'ext_mysql',
      table: 'vehicle',
      column: 'id',
    })
    expect(accident.columns.find((c) => c.name === 'driver_id')!.references).toEqual({
      schema: 'ext_mysql',
      table: 'driver',
      column: 'id',
    })
    expect(accident.columns.find((c) => c.name === 'severity')!.references ?? null).toBeNull()
    // tenant_tag's composite PRIMARY key is not a foreign key edge.
    const tag = res.tables.find((t) => t.table === 'tenant_tag')!
    expect(tag.columns.find((c) => c.name === 'tenant_id')!.references ?? null).toBeNull()
  })

  test('parent-first: reflecting vehicle+driver then accident emits Reference columns', async ({
    admin,
  }) => {
    await makeSource(admin)
    const names = await reflect(admin, ['vehicle', 'driver', 'accident'])
    const cols = await metaColumns(admin, names.accident)
    expect(cols.get('vehicle_id')).toMatchObject({
      column_type: 'Reference',
      reference_table: names.vehicle,
    })
    expect(cols.get('driver_id')).toMatchObject({
      column_type: 'Reference',
      reference_table: names.driver,
    })
    // garage is NOT reflected — its FK column stays a plain Int.
    expect(cols.get('garage_id')).toMatchObject({ column_type: 'Int', reference_table: null })
  })

  test('child-first: reflecting the parent later upgrades the recorded FK columns', async ({
    admin,
  }) => {
    await makeSource(admin)
    const first = await reflect(admin, ['accident'])
    // Before the parents exist the FK columns can only be plain Ints.
    let cols = await metaColumns(admin, first.accident)
    expect(cols.get('vehicle_id')).toMatchObject({ column_type: 'Int', reference_table: null })
    // Reflecting the parents converges the graph — no re-reflection call.
    const parents = await reflect(admin, ['vehicle', 'driver'])
    cols = await metaColumns(admin, first.accident)
    expect(cols.get('vehicle_id')).toMatchObject({
      column_type: 'Reference',
      reference_table: parents.vehicle,
    })
    expect(cols.get('driver_id')).toMatchObject({
      column_type: 'Reference',
      reference_table: parents.driver,
    })
    expect(cols.get('garage_id')).toMatchObject({ column_type: 'Int', reference_table: null })
  })

  test('the relation graph is walkable: forward reference values and backlink connections', async ({
    admin,
  }) => {
    await makeSource(admin)
    const names = await reflect(admin, ['vehicle', 'driver', 'accident'])
    // Forward: the accident row carries the vehicle pk as its Reference value.
    const accident = (await admin.get(
      `/api/table/${encodeURIComponent(names.accident)}/1`,
    )) as Record<string, unknown>
    expect(String(accident.vehicle_id)).toBe('1')
    const vehicle = (await admin.get(
      `/api/table/${encodeURIComponent(names.vehicle)}/${String(accident.vehicle_id)}`,
    )) as Record<string, unknown>
    expect(vehicle.reg_no).toBe('KA-01-1234')
    // Backlink: vehicle 1 is hit by both seeded accidents.
    const cnx = (await admin.get(
      `/api/table/${encodeURIComponent(names.vehicle)}/1:connections`,
    )) as { connections: { table: string; column: string; count: number }[] }
    expect(cnx.connections).toContainEqual(
      expect.objectContaining({ table: names.accident, column: 'vehicle_id', count: 2 }),
    )
  })
})

describe.skipIf(!MYSQL_URL)('mysql: reading bound rows', () => {
  test('list with filter/sort/paging pushdown, count, getDoc', async ({ admin }) => {
    await makeSource(admin)
    await reflectTenant(admin)
    const list = (await admin.get(
      `/api/table/Ext%20Tenant?fields=${encodeURIComponent('["row_id","slug","plan"]')}&order_by=slug asc`,
    )) as { data: Record<string, unknown>[]; total: number }
    expect(list.total).toBe(2)
    expect(list.data.map((r) => r.slug)).toEqual(['acme', 'globex'])

    const filtered = (await admin.get(
      `/api/table/Ext%20Tenant?fields=${encodeURIComponent('["row_id","slug"]')}&filters=${encodeURIComponent('[["plan","=","pro"]]')}`,
    )) as { data: Record<string, unknown>[]; total: number }
    expect(filtered.total).toBe(1)
    expect(filtered.data[0].slug).toBe('acme')

    const count = (await admin.get(
      `/api/table/Ext%20Tenant:count?filters=${encodeURIComponent('[["slug","like","%me%"]]')}`,
    )) as { count: number }
    expect(count.count).toBe(1)

    const name = String(filtered.data[0].row_id)
    const doc = (await admin.get(`/api/table/Ext%20Tenant/${name}`)) as Record<string, unknown>
    expect(doc.slug).toBe('acme')
    expect(Date.parse(doc.updated_at as string)).not.toBeNaN()
    expect(doc.status).toBe('draft')
  })
})

describe.skipIf(!MYSQL_URL)('mysql: writing bound rows', () => {
  test('create takes the name from AUTO_INCREMENT (no RETURNING on MySQL)', async ({ admin }) => {
    await makeSource(admin)
    await reflectTenant(admin)
    const created = await admin.post<Record<string, unknown>>('/api/table/Ext%20Tenant', {
      slug: 'initech',
      plan: 'pro',
    })
    expect(String(created.row_id)).toMatch(/^\d+$/)
    expect(created.plan).toBe('pro')
    const [rows] = await cli.query(`select plan from ext_mysql.tenant where slug = 'initech'`)
    expect((rows as { plan: string }[])[0].plan).toBe('pro')
  })

  test('update writes only payload fields — CLI-owned columns survive', async ({ admin }) => {
    await makeSource(admin)
    await reflectTenant(admin)
    const list = (await admin.get(
      `/api/table/Ext%20Tenant?fields=${encodeURIComponent('["row_id","slug","updated_at"]')}&filters=${encodeURIComponent('[["slug","=","acme"]]')}`,
    )) as { data: Record<string, unknown>[] }
    const { row_id: name, updated_at } = list.data[0]
    const updated = await patchDoc<Record<string, unknown>>(
      admin,
      `/api/table/Ext%20Tenant/${String(name)}`,
      { plan: 'enterprise', updated_at },
    )
    expect(updated.plan).toBe('enterprise')
    const [rows] = await cli.query(
      `select plan, internal_notes from ext_mysql.tenant where slug = 'acme'`,
    )
    const row = (rows as { plan: string; internal_notes: string }[])[0]
    expect(row.plan).toBe('enterprise')
    expect(row.internal_notes).toBe('cli-only')
  })

  test('a concurrent CLI write conflicts on the next save (modified mode)', async ({ admin }) => {
    await makeSource(admin)
    await reflectTenant(admin)
    const list = (await admin.get(
      `/api/table/Ext%20Tenant?fields=${encodeURIComponent('["row_id","updated_at"]')}&filters=${encodeURIComponent('[["slug","=","globex"]]')}`,
    )) as { data: Record<string, unknown>[] }
    const { row_id: name, updated_at } = list.data[0]
    // Land the CLI write in a different millisecond than the loaded echo.
    await new Promise((r) => setTimeout(r, 5))
    await cli.query(
      `update ext_mysql.tenant set plan = 'pro', updated_at = now(3) where slug = 'globex'`,
    )
    await expect(
      patchDoc(admin, `/api/table/Ext%20Tenant/${String(name)}`, {
        plan: 'free',
        updated_at,
      }),
    ).rejects.toMatchObject({ status: 409 })
  })

  test('unique violations come back as field-wise errors (ER_DUP_ENTRY mapping)', async ({
    admin,
  }) => {
    await makeSource(admin)
    await reflectTenant(admin)
    await expect(
      admin.post('/api/table/Ext%20Tenant', { slug: 'acme' }),
    ).rejects.toMatchObject({ status: 417, fields: { slug: expect.stringContaining('unique') } })
  })

  test('delete removes the row on the source', async ({ admin }) => {
    await makeSource(admin)
    await reflectTenant(admin)
    await admin.post('/api/table/Ext%20Tenant', { slug: 'doomed' })
    const list = (await admin.get(
      `/api/table/Ext%20Tenant?filters=${encodeURIComponent('[["slug","=","doomed"]]')}`,
    )) as { data: { row_id: string }[] }
    const loaded = (await admin.get(
      `/api/table/Ext%20Tenant/${list.data[0].row_id}`,
    )) as Record<string, unknown>
    const res = await admin.fetch(
      `/api/table/Ext%20Tenant/${list.data[0].row_id}?updated_at=${encodeURIComponent(String(loaded.updated_at))}`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(200)
    const [rows] = await cli.query(`select 1 from ext_mysql.tenant where slug = 'doomed'`)
    expect(rows as unknown[]).toHaveLength(0)
  })
})

describe.skipIf(!MYSQL_URL)('mysql: read-only sources', () => {
  test('read_only rejects writes but keeps reads working', async ({ admin }) => {
    await makeSource(admin)
    await reflectTenant(admin)
    const src = (await admin.get('/api/table/Data%20Source/ext-mysql')) as Record<string, unknown>
    await patchDoc(admin, '/api/table/Data%20Source/ext-mysql', {
      access: 'read_only',
      updated_at: src.updated_at,
    })
    const list = (await admin.get('/api/table/Ext%20Tenant')) as { total: number }
    expect(list.total).toBeGreaterThanOrEqual(2)
    await expect(
      admin.post('/api/table/Ext%20Tenant', { slug: 'nope' }),
    ).rejects.toMatchObject({ status: 403 })
    const meta = (await admin.get('/api/table/Ext%20Tenant:meta')) as Record<string, unknown>
    expect(meta.source_access).toBe('read_only')
  })
})

// ---------------------------------------------------------------------------
// Parity with sources-postgres.test.ts (and the postgres-driver paths its
// tests reach): column-type mapping, every filter operator, defaults-only
// writes, conflicts, failure naming, allowlist, and the mysql-only
// dialect paths (errno mapping, read-back after insert, TLS URL options).
// ---------------------------------------------------------------------------
const bindFor = (table: string, pk: string, modified: string | null = null): Binding => ({
  source: {
    name: 'ext-mysql-direct',
    engine: 'mysql',
    url_env: EXT_URL_ENV,
    root_path: null,
    default_schema: 'ext_mysql',
    access: 'read_write',
    pool_max: 2,
    statement_timeout_ms: 10000,
    allowlist: null,
  },
  schema: 'ext_mysql',
  table,
  pk,
  modified,
  columns: [],
})

const reflectOne = async (
  admin: { post: <T = Record<string, unknown>>(p: string, b?: unknown) => Promise<T> },
  table: string,
): Promise<string> => {
  const res = await admin.post<{ created: { name: string }[]; skipped: { reason: string }[] }>(
    '/api/table/Data%20Source/ext-mysql:reflect',
    { schema: 'ext_mysql', tables: [table] },
  )
  expect(res.skipped).toEqual([])
  return res.created[0].name
}

describe.skipIf(!MYSQL_URL)('mysql: column types and browsing', () => {
  afterAll(() => mysqlDriver.dispose('ext-mysql-direct'))

  test('database column types map to the closest Featherbase type', async ({ admin }) => {
    await makeSource(admin)
    const res = (await admin.get(
      '/api/table/Data%20Source/ext-mysql:introspect?schema=ext_mysql',
    )) as { tables: { table: string; columns: { name: string; column_type: string }[] }[] }
    const kitchen = res.tables.find((t) => t.table === 'kitchen')!
    expect(Object.fromEntries(kitchen.columns.map((c) => [c.name, c.column_type]))).toEqual({
      id: 'Int',
      flag: 'Check',
      small: 'Int',
      big: 'Int',
      price: 'Float',
      ratio: 'Float',
      precise_ratio: 'Float',
      born: 'Date',
      seen: 'Datetime',
      stamped: 'Datetime',
      meta: 'JSON',
      kind: 'Data',
      picks: 'Data',
      code: 'Data',
      story: 'Text',
      body: 'Text',
      yr: 'Int',
      initial: 'Data',
      raw: 'Text',
    })
  })

  test('with no default schema, introspection covers every user database', async ({ admin }) => {
    await makeSource(admin, { default_schema: undefined })
    const res = (await admin.get('/api/table/Data%20Source/ext-mysql:introspect')) as {
      tables: { schema: string; table: string }[]
    }
    expect(res.tables).toContainEqual(expect.objectContaining({ schema: 'ext_mysql', table: 'tenant' }))
    expect(res.tables.some((t) => ['mysql', 'sys', 'information_schema', 'performance_schema'].includes(t.schema))).toBe(false)
  })

  test('pages come back in the requested order with the full total', async () => {
    const { rows, total } = await mysqlDriver.getList(bindFor('plain', 'id'), {
      filters: [{ column: 'qty', op: '>=', value: 1 }],
      columns: ['note'],
      order: { column: 'qty', dir: 'desc' },
      limit: 2,
      offset: 1,
    })
    expect(rows.map((r) => r.note)).toEqual(['beta', 'alpha'])
    expect(total).toBe(3)
  })
})

describe.skipIf(!MYSQL_URL)('mysql: filtering rows', () => {
  afterAll(() => mysqlDriver.dispose('ext-mysql-direct'))

  const notes = async (
    admin: { get: (p: string) => Promise<unknown> },
    name: string,
    filters: unknown[],
  ) => {
    const res = (await admin.get(
      `/api/table/${encodeURIComponent(name)}?fields=${encodeURIComponent('["note"]')}&order_by=qty asc&filters=${encodeURIComponent(JSON.stringify(filters))}`,
    )) as { data: { note: string }[] }
    return res.data.map((r) => r.note)
  }

  test('exclusion, comparison, pattern and list filters narrow the rows', async ({ admin }) => {
    await makeSource(admin)
    const name = await reflectOne(admin, 'plain')
    expect(await notes(admin, name, [['qty', '!=', '2']])).toEqual(['alpha', 'gamma'])
    expect(await notes(admin, name, [['qty', '>', '1']])).toEqual(['beta', 'gamma'])
    expect(await notes(admin, name, [['qty', '<', '3']])).toEqual(['alpha', 'beta'])
    expect(await notes(admin, name, [['qty', '<=', '2']])).toEqual(['alpha', 'beta'])
    expect(await notes(admin, name, [['qty', '>=', '2']])).toEqual(['beta', 'gamma'])
    expect(await notes(admin, name, [['note', 'like', 'AL%']])).toEqual(['alpha'])
    expect(await notes(admin, name, [['note', 'not like', 'AL%']])).toEqual(['beta', 'gamma'])
    expect(await notes(admin, name, [['qty', 'in', ['1', '3']]])).toEqual(['alpha', 'gamma'])
    expect(await notes(admin, name, [['qty', 'not in', ['1', '3']]])).toEqual(['beta'])
    // An empty list: nothing is "in" it, everything is "not in" it.
    expect(await notes(admin, name, [['qty', 'in', []]])).toEqual([])
    expect(await notes(admin, name, [['qty', 'not in', []]])).toHaveLength(3)
  })

  test('a Data Scope filter lets unset values through as well as the allowed ones', async () => {
    await cli.query(`insert into ext_mysql.plain (note, qty) values ('unset-scope', null)`)
    try {
      const bind = bindFor('plain', 'id')
      expect(await mysqlDriver.count(bind, [{ column: 'qty', op: 'in_or_null', value: [1, 2] }])).toBe(3)
      expect(await mysqlDriver.count(bind, [{ column: 'qty', op: 'in_or_null', value: [] }])).toBe(1)
    } finally {
      await cli.query(`delete from ext_mysql.plain where note = 'unset-scope'`)
    }
  })

  test('rows can be counted by a column, read straight from the source', async ({ admin }) => {
    await makeSource(admin)
    await reflectTenant(admin)
    const res = await admin.post<{ data: { label: string; value: number }[] }>('/api/dashboard/chart', {
      table: 'Ext Tenant',
      group_by: 'plan',
      filters: [['slug', 'in', ['acme', 'globex']]],
    })
    const [direct] = await cli.query(
      `select plan as label, count(*) as n from ext_mysql.tenant where slug in ('acme', 'globex') group by plan`,
    )
    expect(Object.fromEntries(res.data.map((d) => [d.label, Number(d.value)]))).toEqual(
      Object.fromEntries((direct as { label: string; n: number }[]).map((d) => [d.label, Number(d.n)])),
    )
  })
})

describe.skipIf(!MYSQL_URL)('mysql: writing rows in more shapes', () => {
  afterAll(() => mysqlDriver.dispose('ext-mysql-direct'))

  test('creating a row with no values lets the database fill everything in', async ({ admin }) => {
    await makeSource(admin)
    const name = await reflectOne(admin, 'plain')
    const created = await admin.post<Record<string, unknown>>(`/api/table/${encodeURIComponent(name)}`, {})
    try {
      expect(created.note).toBeNull()
      expect(String(created.row_id)).toMatch(/^\d+$/)
    } finally {
      await cli.query(`delete from ext_mysql.plain where id = ?`, [Number(created.row_id)])
    }
  })

  test('saving changes to a table with no last-changed time overwrites what is there', async ({ admin }) => {
    await makeSource(admin)
    const name = await reflectOne(admin, 'plain')
    const [rows] = await cli.query(`select id from ext_mysql.plain where note = 'beta'`)
    const id = (rows as { id: number }[])[0].id
    const res = await admin.fetch(`/api/table/${encodeURIComponent(name)}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ qty: 20 }),
    })
    expect(res.status).toBe(200)
    const [after] = await cli.query(`select qty from ext_mysql.plain where id = ?`, [id])
    expect((after as { qty: number }[])[0].qty).toBe(20)
    await cli.query(`update ext_mysql.plain set qty = 2 where id = ?`, [id])
  })

  test('saving a row with no changes returns it as it is, and a missing row is not found', async ({ admin }) => {
    await makeSource(admin)
    const name = await reflectOne(admin, 'plain')
    const enc = encodeURIComponent(name)
    const [rows] = await cli.query(`select id from ext_mysql.plain where note = 'alpha'`)
    const id = (rows as { id: number }[])[0].id
    const saved = await admin.fetch(`/api/table/${enc}/${id}`, { method: 'PATCH', body: JSON.stringify({}) })
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({ row_id: String(id), note: 'alpha' })
    const missing = await admin.fetch(`/api/table/${enc}/999999`, { method: 'PATCH', body: JSON.stringify({}) })
    expect(missing.status).toBe(404)
  })

  test('an update or delete of a row that is gone reports it missing', async () => {
    const bind = bindFor('plain', 'id')
    expect(await mysqlDriver.update(bind, '999999', { note: 'x' }, null)).toBe('missing')
    expect(await mysqlDriver.remove(bind, '999999', null)).toBe('missing')
  })

  test('a stale revision conflicts on update and on delete, and the row stays', async () => {
    const bind = bindFor('tenant', 'id', 'updated_at')
    const [rows] = await cli.query(`select id from ext_mysql.tenant where slug = 'acme'`)
    const id = String((rows as { id: number }[])[0].id)
    const stale = '2000-01-01T00:00:00.000Z'
    expect(await mysqlDriver.update(bind, id, { plan: 'stale-write' }, stale)).toBe('conflict')
    expect(await mysqlDriver.remove(bind, id, stale)).toBe('conflict')
    const [after] = await cli.query(`select plan from ext_mysql.tenant where id = ?`, [id])
    expect((after as { plan: string }[])[0].plan).not.toBe('stale-write')
  })

  test('a delete without a revision removes the row', async () => {
    const bind = bindFor('plain', 'id')
    const row = await mysqlDriver.insert(bind, { note: 'short-lived', qty: 9 }, null)
    expect(await mysqlDriver.remove(bind, String(row.id), null)).toBeUndefined()
    expect(await mysqlDriver.getDoc(bind, String(row.id))).toBeNull()
  })

  test('an insert that gives no key to a table that cannot generate one says the row cannot be addressed', async () => {
    try {
      await expect(mysqlDriver.insert(bindFor('nokey', 'code'), { label: 'orphan' }, null)).rejects.toMatchObject({
        type: 'DataSourceError',
        message: expect.stringContaining('cannot address it'),
      })
      // #155: the row it could not address is not left behind at the source.
      const [left] = await cli.query(`select count(*) as n from ext_mysql.nokey`)
      expect(Number((left as { n: number }[])[0].n)).toBe(0)
    } finally {
      await cli.query(`delete from ext_mysql.nokey`)
    }
  })

  test('a new row is never read back through an auto-numbered column that is not its key', async () => {
    await cli.query(`insert into ext_mysql.sequenced (code, seq, note) values ('101', 100, 'someone else')`)
    try {
      await expect(mysqlDriver.insert(bindFor('sequenced', 'code'), { note: 'mine' }, null)).rejects.toMatchObject({
        type: 'DataSourceError',
        message: expect.stringContaining('cannot address it'),
      })
      const [rows] = await cli.query(`select note from ext_mysql.sequenced`)
      expect((rows as { note: string }[]).map((r) => r.note)).toEqual(['someone else'])
    } finally {
      await cli.query(`delete from ext_mysql.sequenced`)
    }
  })

  test('saving one row leaves other rows free for other writers', async () => {
    const bind = bindFor('plain', 'id')
    const [a] = await cli.query(`insert into ext_mysql.plain (note, qty) values ('mine', 1), ('theirs', 1)`)
    const mine = (a as { insertId: number }).insertId
    try {
      // While the save holds its own row, another writer edits a DIFFERENT
      // row, giving up after a second if the save has locked that one too.
      const saved = await withWriterAfter(
        /^update /,
        `set session innodb_lock_wait_timeout = 1;
         update ext_mysql.plain set qty = 2 where id = ${mine + 1}`,
        () => mysqlDriver.update(bind, String(mine), { note: 'mine, saved' }, null),
        // Longer than the other writer's lock wait, so a lock on its row shows.
        1500,
      )
      expect(saved).toMatchObject({ note: 'mine, saved' })
      const [theirs] = await cli.query(`select qty from ext_mysql.plain where id = ?`, [mine + 1])
      expect((theirs as { qty: number }[])[0].qty).toBe(2)
    } finally {
      await cli.query(`set session innodb_lock_wait_timeout = 50`)
      await cli.query(`delete from ext_mysql.plain where id in (?, ?)`, [mine, mine + 1])
    }
  })

  test('a key that only looks like a number finds no row', async () => {
    expect(await mysqlDriver.getDoc(bindFor('plain', 'id'), '1abc')).toBeNull()
  })

  test('a key the table could never hold finds no row', async () => {
    const legacy = bindFor('legacy', 'code')
    expect(await mysqlDriver.getDoc(legacy, '😀')).toBeNull()
    expect(await mysqlDriver.update(legacy, '😀', { v: 1 }, null)).toBe('missing')
    expect(await mysqlDriver.remove(legacy, '😀', null)).toBe('missing')
  })

  test('an insert with an explicit key reads that row back', async () => {
    try {
      const row = await mysqlDriver.insert(bindFor('nokey', 'code'), { label: 'given' }, 'K1')
      expect(row).toMatchObject({ code: 'K1', label: 'given' })
    } finally {
      await cli.query(`delete from ext_mysql.nokey`)
    }
  })

  test('an insert whose row cannot be found again is reported', async () => {
    try {
      await expect(mysqlDriver.insert(bindFor('shifty', 'code'), { label: 'moved' }, 'k1')).rejects.toMatchObject({
        type: 'DataSourceError',
        message: expect.stringContaining('inserted row k1 not found on re-read'),
      })
      const [left] = await cli.query(`select count(*) as n from ext_mysql.shifty`)
      expect(Number((left as { n: number }[])[0].n)).toBe(0)
    } finally {
      await cli.query(`delete from ext_mysql.shifty`)
    }
  })

  test('an update whose trigger moves its key rolls back instead of losing the saved row', async () => {
    await cli.query("create table ext_mysql.moving_key (id int primary key, note text)")
    await cli.query("insert into ext_mysql.moving_key values (1, 'original')")
    await cli.query('create trigger ext_mysql.move_key before update on ext_mysql.moving_key for each row set NEW.id = OLD.id + 1')
    try {
      await expect(mysqlDriver.update(bindFor('moving_key', 'id'), '1', { note: 'changed' }, null)).rejects.toMatchObject({
        type: 'DataSourceError', message: expect.stringContaining('updated row 1 not found on re-read'),
      })
      const [rows] = await cli.query('select id, note from ext_mysql.moving_key')
      expect(rows).toEqual([{ id: 1, note: 'original' }])
    } finally {
      await cli.query('drop table ext_mysql.moving_key')
    }
  })

  test('a read or write that cannot acquire a connection reports the source without leaking its password', async () => {
    process.env.EXT_MYSQL_WRITE_DEAD_URL = 'mysql://nobody:private-password@127.0.0.1:59998/nope'
    const bind = bindFor('plain', 'id')
    bind.source = { ...bind.source, name: 'dead-writer', url_env: 'EXT_MYSQL_WRITE_DEAD_URL' }
    try {
      for (const operation of [() => mysqlDriver.getDoc(bind, '1'), () => mysqlDriver.update(bind, '1', { note: 'changed' }, null)]) {
        const failure = await operation().catch(error => error)
        expect(failure).toMatchObject({ type: 'DataSourceError', message: expect.stringContaining('dead-writer') })
        expect(failure.message).not.toContain('private-password')
      }
    } finally {
      await mysqlDriver.dispose('dead-writer')
      delete process.env.EXT_MYSQL_WRITE_DEAD_URL
    }
  })

  // #155: run `concurrent` (another writer, through the unsandboxed CLI
  // connection) right after the driver's own statement matching `after`, and
  // give it a moment to land before the driver carries on. A driver that
  // re-reads its row outside the statement's transaction then sees the other
  // writer's change; one that holds its row until it has read it back makes
  // the other writer wait instead.
  async function withWriterAfter<T>(after: RegExp, concurrent: string, work: () => Promise<T>, patience = 300) {
    let other: Promise<unknown> | null = null
    const spies = [PromisePool.prototype, PromiseConnection.prototype].map((proto) => {
      const original = proto.query
      return vi.spyOn(proto, 'query').mockImplementation(async function (this: unknown, ...args: unknown[]) {
        const result = await original.apply(this, args)
        if (this !== cli && !other && after.test(String(args[0]))) {
          other = cli.query(concurrent)
          await Promise.race([other.catch(() => {}), new Promise((r) => setTimeout(r, patience))])
        }
        return result
      } as never)
    })
    try {
      const outcome = await work()
      expect(other, `no statement matched ${after}`).not.toBeNull()
      await other
      return outcome
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  }

  test('a generated key removed by concurrent DDL refuses the insert and leaves no orphan', async () => {
    await cli.query('create table ext_mysql.changed_key (id int primary key auto_increment, note text)')
    try {
      await withWriterAfter(
        /select extra as extra from information_schema.columns/,
        'alter table ext_mysql.changed_key modify id int not null default 42',
        () => expect(mysqlDriver.insert(bindFor('changed_key', 'id'), { note: 'unaddressable' }, null))
          .rejects.toMatchObject({ type: 'DataSourceError', message: expect.stringContaining('database gave it no number') }),
      )
      const [rows] = await cli.query('select * from ext_mysql.changed_key')
      expect(rows).toEqual([])
    } finally {
      await cli.query('drop table ext_mysql.changed_key')
    }
  })

  test('a save returns the row it wrote, even when another writer changes it straight after', async () => {
    const bind = bindFor('plain', 'id')
    const [ins] = await cli.query(`insert into ext_mysql.plain (note, qty) values ('raced', 1)`)
    const id = (ins as { insertId: number }).insertId
    try {
      const saved = await withWriterAfter(/^update /, `update ext_mysql.plain set note = 'other writer' where id = ${id}`, () =>
        mysqlDriver.update(bind, String(id), { note: 'mine' }, null),
      )
      expect(saved).toMatchObject({ id, note: 'mine' })
      // The other writer still lands — after the save, not inside it.
      const [after] = await cli.query(`select note from ext_mysql.plain where id = ?`, [id])
      expect((after as { note: string }[])[0].note).toBe('other writer')
    } finally {
      await cli.query(`delete from ext_mysql.plain where id = ?`, [id])
    }
  })

  test('a save is not reported missing when another writer deletes the row straight after', async () => {
    const bind = bindFor('plain', 'id')
    const [ins] = await cli.query(`insert into ext_mysql.plain (note, qty) values ('raced', 1)`)
    const id = (ins as { insertId: number }).insertId
    try {
      const saved = await withWriterAfter(/^update /, `delete from ext_mysql.plain where id = ${id}`, () =>
        mysqlDriver.update(bind, String(id), { note: 'mine' }, null),
      )
      expect(saved).toMatchObject({ id, note: 'mine' })
    } finally {
      await cli.query(`delete from ext_mysql.plain where id = ?`, [id])
    }
  })

  test('a new row comes back as inserted, even when another writer changes it straight after', async () => {
    const bind = bindFor('plain', 'id')
    const created = await withWriterAfter(
      /^insert /,
      `update ext_mysql.plain set note = 'other writer' where note = 'brand new'`,
      () => mysqlDriver.insert(bind, { note: 'brand new', qty: 4 }, null),
    )
    try {
      expect(created).toMatchObject({ note: 'brand new', qty: 4 })
    } finally {
      await cli.query(`delete from ext_mysql.plain where id = ?`, [created.id])
    }
  })

  test('the conflict check compares whole milliseconds, as the Postgres driver does', async () => {
    const bind = bindFor('revisioned', 'id', 'changed_at')
    const [ins] = await cli.query(
      `insert into ext_mysql.revisioned (note, changed_at) values ('loaded', '2026-01-01 00:00:00.123456')`,
    )
    const id = String((ins as { insertId: number }).insertId)
    try {
      const loaded = await mysqlDriver.getDoc(bind, id)
      const echo = (loaded!.changed_at as Date).toISOString()
      expect(echo).toBe('2026-01-01T00:00:00.123Z')
      // Another writer stamps the row 0.3ms away, in the millisecond before.
      await cli.query(
        `update ext_mysql.revisioned set note = 'other writer', changed_at = '2026-01-01 00:00:00.122700' where id = ?`,
        [id],
      )
      expect(await mysqlDriver.update(bind, id, { note: 'stale save' }, echo)).toBe('conflict')
      expect(await mysqlDriver.remove(bind, id, echo)).toBe('conflict')
      // The echo of what is there now, in the same millisecond, is accepted.
      const saved = await mysqlDriver.update(bind, id, { note: 'fresh save' }, '2026-01-01T00:00:00.122Z')
      expect(saved).toMatchObject({ note: 'fresh save' })
    } finally {
      await cli.query(`delete from ext_mysql.revisioned where id = ?`, [id])
    }
  })

  test('constraint errors from MySQL arrive shaped like the Postgres ones', async () => {
    const plain = bindFor('plain', 'id')
    // 1406: data too long for the column.
    await expect(mysqlDriver.insert(plain, { note: 'x'.repeat(60) }, null)).rejects.toMatchObject({ code: '22001' })
    // 1264: value out of range.
    await expect(mysqlDriver.insert(plain, { qty: '99999999999' }, null)).rejects.toMatchObject({ code: '22003' })
    // 1366: incorrect value for the column type.
    await expect(mysqlDriver.insert(plain, { qty: 'abc' }, null)).rejects.toMatchObject({ code: '22003' })
    // 1062 on the PRIMARY key names no column to blame.
    const nokey = bindFor('nokey', 'code')
    try {
      await mysqlDriver.insert(nokey, { label: 'first' }, 'DUP')
      const dup = await mysqlDriver.insert(nokey, { label: 'second' }, 'DUP').catch((e) => e)
      expect(dup).toMatchObject({ code: '23505' })
      expect(dup.detail).toBeUndefined()
    } finally {
      await cli.query(`delete from ext_mysql.nokey`)
    }
  })

  test('read_only also rejects updates and deletes', async ({ admin }) => {
    await makeSource(admin)
    await reflectTenant(admin)
    const src = (await admin.get('/api/table/Data%20Source/ext-mysql')) as Record<string, unknown>
    await patchDoc(admin, '/api/table/Data%20Source/ext-mysql', {
      access: 'read_only',
      updated_at: src.updated_at,
    })
    const list = (await admin.get('/api/table/Ext%20Tenant')) as { data: { row_id: string }[] }
    const id = list.data[0].row_id
    const patch = await admin.fetch(`/api/table/Ext%20Tenant/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ plan: 'nope' }),
    })
    expect(patch.status).toBe(403)
    const del = await admin.fetch(`/api/table/Ext%20Tenant/${id}`, { method: 'DELETE' })
    expect(del.status).toBe(403)
  })
})

describe.skipIf(!MYSQL_URL)('mysql: refused saves (#154)', () => {
  // A refusal must reach the user as a plain error on the field; the
  // database's own text goes to the server log only.
  const RAW = /cannot be null|doesn't have a default|foreign key constraint|is violated|for column|ext_mysql/i

  async function refusal(res: Response) {
    const body = (await res.json()) as { error: { type: string; message: string; fields?: Record<string, string> } }
    expect(body.error.message).not.toMatch(RAW)
    for (const text of Object.values(body.error.fields ?? {})) expect(text).not.toMatch(RAW)
    return { status: res.status, ...body.error }
  }

  async function gaugeTable(admin: Parameters<typeof makeSource>[0] & Parameters<typeof reflectOne>[0]) {
    await makeSource(admin)
    const name = await reflectOne(admin, 'gauge')
    return `/api/table/${encodeURIComponent(name)}`
  }

  const post = (admin: Parameters<typeof makeSource>[0], path: string, body: unknown) =>
    admin.fetch(path, { method: 'POST', body: JSON.stringify(body) })

  test('a value the database requires comes back as a required field', async ({ admin }) => {
    const path = await gaugeTable(admin)
    // The database starts requiring it after the table was connected.
    await cli.query(`alter table ext_mysql.gauge modify status varchar(20) not null`)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const omitted = await refusal(await post(admin, path, { level: 1 }))
      expect(omitted).toMatchObject({ status: 417, type: 'ValidationError', fields: { status_1: 'Required' } })
      const blank = await refusal(await post(admin, path, { level: 1, status_1: null }))
      expect(blank).toMatchObject({ status: 417, fields: { status_1: 'Required' } })
      // The server log keeps what the database said.
      expect(warn.mock.calls.flat().join(' ')).toMatch(/status/)
    } finally {
      warn.mockRestore()
      await cli.query(`alter table ext_mysql.gauge modify status varchar(20) null`)
      await cli.query(`delete from ext_mysql.gauge`)
    }
  })

  test('a link to a row the database does not have comes back on that field', async ({ admin }) => {
    const path = await gaugeTable(admin)
    try {
      const res = await refusal(await post(admin, path, { status_1: 'ok', vehicle_id: 999 }))
      expect(res).toMatchObject({ status: 417, type: 'ValidationError', fields: { vehicle_id: expect.any(String) } })
    } finally {
      await cli.query(`delete from ext_mysql.gauge`)
    }
  })

  test('a value that breaks one of the database rules is refused in plain words', async ({ admin }) => {
    const path = await gaugeTable(admin)
    try {
      const res = await refusal(await post(admin, path, { status_1: 'ok', level: 50 }))
      expect(res).toMatchObject({ status: 417, type: 'ValidationError' })
      expect(res.message).toContain('gauge_level_range')
    } finally {
      await cli.query(`delete from ext_mysql.gauge`)
    }
  })

  test('a value too long or of the wrong kind comes back on its field', async ({ admin }) => {
    const path = await gaugeTable(admin)
    try {
      const long = await refusal(await post(admin, path, { status_1: 'x'.repeat(30) }))
      expect(long).toMatchObject({ status: 417, fields: { status_1: expect.any(String) } })
      const big = await refusal(await post(admin, path, { status_1: 'ok', level: 99999999999 }))
      expect(big).toMatchObject({ status: 417, fields: { level: expect.any(String) } })
    } finally {
      await cli.query(`delete from ext_mysql.gauge`)
    }
  })

  test('deleting a row other rows at the database still point at is refused in plain words', async ({ admin }) => {
    await makeSource(admin)
    const name = await reflectOne(admin, 'vehicle')
    const path = `/api/table/${encodeURIComponent(name)}/1`
    const loaded = (await admin.get(path)) as Record<string, unknown>
    const res = await refusal(
      await admin.fetch(`${path}?updated_at=${encodeURIComponent(String(loaded.updated_at))}`, { method: 'DELETE' }),
    )
    expect(res).toMatchObject({ status: 417, type: 'ValidationError' })
    expect(res.message).toMatch(/still point/)
    const [rows] = await cli.query(`select 1 from ext_mysql.vehicle where id = 1`)
    expect(rows as unknown[]).toHaveLength(1)
  })

  test('changing the key of a row other rows still point at is refused in plain words', async ({ admin }) => {
    await makeSource(admin)
    const name = await reflectOne(admin, 'vehicle')
    const err = await mysqlDriver.update(bindFor('vehicle', 'id'), '1', { id: 77 }, null).catch((e) => e)
    expect(err).toMatchObject({ code: '23503', detail: expect.stringContaining('still referenced') })
    const { explainRefusal } = await import('../src/sources/dispatch')
    const { getMeta } = await import('../src/meta')
    const meta = await getMeta(name)
    let thrown: unknown
    try {
      explainRefusal(meta, bindFor('vehicle', 'id'), err)
    } catch (e) {
      thrown = e
    }
    expect(thrown).toMatchObject({ type: 'ValidationError', message: expect.stringMatching(/still point/) })
    expect((thrown as { fields?: unknown }).fields).toBeUndefined()
  })

  test('changing a value other rows point at is refused on that field', async ({ admin }) => {
    await makeSource(admin)
    const name = await reflectOne(admin, 'badge')
    const bind = { ...bindFor('badge', 'id'), columns: [{ column_name: 'code', source_column: 'code', column_type: 'Data' }] }
    const [rows] = await cli.query(`select id from ext_mysql.badge where code = 'B1'`)
    const err = await mysqlDriver.update(bind, String((rows as { id: number }[])[0].id), { code: 'B2' }, null).catch((e) => e)
    expect(err).toMatchObject({ code: '23503', column_name: 'code' })
    const { explainRefusal } = await import('../src/sources/dispatch')
    const { getMeta } = await import('../src/meta')
    let thrown: unknown
    try {
      explainRefusal(await getMeta(name), bind, err)
    } catch (e) {
      thrown = e
    }
    expect(thrown).toMatchObject({ type: 'ValidationError', fields: { code: expect.stringMatching(/still point/) } })
  })

  test('each refusal arrives from the driver in the shared shape', async () => {
    const gauge = bindFor('gauge', 'id')
    const shape = (values: Record<string, unknown>) => mysqlDriver.insert(gauge, values, null).catch((e) => e)
    try {
      await cli.query(`alter table ext_mysql.gauge modify status varchar(20) not null`)
      expect(await shape({ level: 1 })).toMatchObject({ code: '23502', column_name: 'status' })
      expect(await shape({ status: null })).toMatchObject({ code: '23502', column_name: 'status' })
      await cli.query(`alter table ext_mysql.gauge modify status varchar(20) null`)
      expect(await shape({ vehicle_id: 999 })).toMatchObject({ code: '23503', column_name: 'vehicle_id' })
      expect(await shape({ level: 50 })).toMatchObject({ code: '23514', constraint_name: 'gauge_level_range' })
      expect(await shape({ status: 'x'.repeat(30) })).toMatchObject({ code: '22001', column_name: 'status' })
      expect(await shape({ level: 'abc' })).toMatchObject({ code: '22003', column_name: 'level' })
      const stillUsed = await mysqlDriver.remove(bindFor('vehicle', 'id'), '1', null).catch((e) => e)
      expect(stillUsed).toMatchObject({ code: '23503' })
    } finally {
      await cli.query(`alter table ext_mysql.gauge modify status varchar(20) null`)
      await cli.query(`delete from ext_mysql.gauge`)
      await mysqlDriver.dispose('ext-mysql-direct')
    }
  })
})

describe.skipIf(!MYSQL_URL)('mysql: connection settings and failures', () => {
  test('a connected table says the source cannot be reached while other tables keep working', async ({ admin }) => {
    await makeSource(admin)
    await reflectTenant(admin)
    process.env.EXT_MYSQL_DEAD_URL = 'mysql://nobody:nothing@127.0.0.1:59998/nope'
    const src = (await admin.get('/api/table/Data%20Source/ext-mysql')) as Record<string, unknown>
    await patchDoc(admin, '/api/table/Data%20Source/ext-mysql', {
      url_env: 'EXT_MYSQL_DEAD_URL',
      updated_at: src.updated_at,
    })
    const down = await admin.fetch('/api/table/Ext%20Tenant')
    expect(down.status).toBe(502)
    const body = (await down.json()) as { error: { type: string; message: string } }
    expect(body.error.type).toBe('DataSourceError')
    expect(body.error.message).toContain('ext-mysql')
    expect(body.error.message).not.toContain('nothing@')
    expect((await admin.fetch('/api/table/Role')).status).toBe(200)
  })

  test('testing the connection names an unset variable, and a value that is not a mysql URL', async ({ admin }) => {
    await makeSource(admin, { row_id: 'ext-mysql-unset', url_env: 'EXT_MYSQL_NEVER_SET' })
    const unset = await admin.post<{ ok: boolean; error: string }>(
      '/api/table/Data%20Source/ext-mysql-unset:test_connection',
      {},
    )
    expect(unset.ok).toBe(false)
    expect(unset.error).toContain('EXT_MYSQL_NEVER_SET')

    process.env.EXT_MYSQL_BAD_URL = 'not a url'
    await makeSource(admin, { row_id: 'ext-mysql-bad', url_env: 'EXT_MYSQL_BAD_URL' })
    const bad = await admin.post<{ ok: boolean; error: string }>(
      '/api/table/Data%20Source/ext-mysql-bad:test_connection',
      {},
    )
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('is not a valid mysql:// URL')
  })

  test('encrypted connections: required and preferred modes connect, verifying modes refuse a self-signed server', async ({ admin }) => {
    const base = `${MYSQL_URL!.replace(/\/$/, '')}/ext_mysql`
    const attempts: [string, boolean][] = [
      ['sslmode=REQUIRED', true],
      ['sslmode=PREFERRED', true],
      ['ssl=true', true],
      ['ssl=1', true],
      ['sslmode=VERIFY_CA', false],
      ['ssl-mode=VERIFY_IDENTITY', false],
    ]
    for (const [i, [query, expectOk]] of attempts.entries()) {
      const env = `EXT_MYSQL_TLS_${i}_URL`
      process.env[env] = `${base}?${query}`
      await makeSource(admin, { row_id: `ext-mysql-tls-${i}`, url_env: env })
      const res = await admin.post<{ ok: boolean }>(
        `/api/table/Data%20Source/ext-mysql-tls-${i}:test_connection`,
        {},
      )
      expect([query, res.ok]).toEqual([query, expectOk])
    }
  })

  test('a data source with a list of allowed tables connects only those', async ({ admin }) => {
    await makeSource(admin, { table_allowlist: 'ext_mysql.tenant\next_mysql.vehicle' })
    const reflect = (tables: string[]) =>
      admin.fetch('/api/table/Data%20Source/ext-mysql:reflect', {
        method: 'POST',
        body: JSON.stringify({ schema: 'ext_mysql', tables }),
      })
    const refused = await reflect(['plain'])
    expect(refused.status).toBe(403)
    expect(((await refused.json()) as { error: { message: string } }).error.message).toContain('not in the allowlist')
    const allowed = await reflect(['tenant'])
    expect(allowed.status).toBe(200)
    expect(((await allowed.json()) as { created: { name: string }[] }).created.map((c) => c.name)).toEqual(['Ext Tenant'])
  })
})

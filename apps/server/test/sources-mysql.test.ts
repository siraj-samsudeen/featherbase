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
import { afterAll, beforeAll, describe, expect } from 'vitest'
import mysql from 'mysql2/promise'
import { test, patchDoc } from './pg-test'
import { invalidateSources } from '../src/sources/registry'

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
      name: 'ext-mysql',
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
    await makeSource(admin, { name: 'ext-mysql-dead', url_env: 'EXT_MYSQL_DEAD_URL' })
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
    expect(colNames).toEqual(['slug', 'plan', 'active', 'internal_notes'])
  })
})

// Reflect the given source tables, asserting all were created; returns the
// created Desk names keyed by source table name.
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
      `/api/table/Ext%20Tenant?fields=${encodeURIComponent('["name","slug","plan"]')}&order_by=slug asc`,
    )) as { data: Record<string, unknown>[]; total: number }
    expect(list.total).toBe(2)
    expect(list.data.map((r) => r.slug)).toEqual(['acme', 'globex'])

    const filtered = (await admin.get(
      `/api/table/Ext%20Tenant?fields=${encodeURIComponent('["name","slug"]')}&filters=${encodeURIComponent('[["plan","=","pro"]]')}`,
    )) as { data: Record<string, unknown>[]; total: number }
    expect(filtered.total).toBe(1)
    expect(filtered.data[0].slug).toBe('acme')

    const count = (await admin.get(
      `/api/table/Ext%20Tenant:count?filters=${encodeURIComponent('[["slug","like","%me%"]]')}`,
    )) as { count: number }
    expect(count.count).toBe(1)

    const name = String(filtered.data[0].name)
    const doc = (await admin.get(`/api/table/Ext%20Tenant/${name}`)) as Record<string, unknown>
    expect(doc.slug).toBe('acme')
    expect(doc.updated_at).toBeTruthy()
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
    expect(String(created.name)).toMatch(/^\d+$/)
    expect(created.plan).toBe('pro')
    const [rows] = await cli.query(`select plan from ext_mysql.tenant where slug = 'initech'`)
    expect((rows as { plan: string }[])[0].plan).toBe('pro')
  })

  test('update writes only payload fields — CLI-owned columns survive', async ({ admin }) => {
    await makeSource(admin)
    await reflectTenant(admin)
    const list = (await admin.get(
      `/api/table/Ext%20Tenant?fields=${encodeURIComponent('["name","slug","updated_at"]')}&filters=${encodeURIComponent('[["slug","=","acme"]]')}`,
    )) as { data: Record<string, unknown>[] }
    const { name, updated_at } = list.data[0]
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
      `/api/table/Ext%20Tenant?fields=${encodeURIComponent('["name","updated_at"]')}&filters=${encodeURIComponent('[["slug","=","globex"]]')}`,
    )) as { data: Record<string, unknown>[] }
    const { name, updated_at } = list.data[0]
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
    )) as { data: { name: string }[] }
    const loaded = (await admin.get(
      `/api/table/Ext%20Tenant/${list.data[0].name}`,
    )) as Record<string, unknown>
    const res = await admin.fetch(
      `/api/table/Ext%20Tenant/${list.data[0].name}?updated_at=${encodeURIComponent(String(loaded.updated_at))}`,
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

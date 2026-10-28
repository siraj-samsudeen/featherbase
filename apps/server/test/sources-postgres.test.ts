// EDS (spec 0001): external Postgres data sources — registry, introspection,
// reflection, reads, writes, conflicts, read-only enforcement.
//
// The "foreign database" is a schema (ext_fixture) created OUTSIDE the
// sandbox transaction by a direct client, mimicking a CLI-owned store: the
// driver reaches it through its own pool, so it must be committed and is
// cleaned up in afterAll. Everything control-side (the Data Source row, the
// bound table_def) happens inside the sandbox and rolls back per test.
import { afterAll, beforeAll, describe, expect, vi } from 'vitest'
import postgres from 'postgres'
import { test, patchDoc } from './pg-test'
import { EXTERNAL_DATABASE_URL } from './external-database'
import { sql } from '../src/db'
import { invalidateSources } from '../src/sources/registry'
import type { ReflectionCandidate } from '../src/sources/reflect'

const EXT_URL_ENV = 'EXT_FIXTURE_URL'
process.env[EXT_URL_ENV] = EXTERNAL_DATABASE_URL

// Direct, unsandboxed client that plays the CLI owning the foreign schema.
let cli: ReturnType<typeof postgres>

beforeAll(async () => {
  cli = postgres(EXTERNAL_DATABASE_URL, { max: 2 })
  await cli.unsafe(`drop schema if exists ext_fixture cascade`)
  await cli.unsafe(`create schema ext_fixture`)
  await cli.unsafe(`create table ext_fixture.business (code integer primary key, name text);
    insert into ext_fixture.business values (1, 'Zulu'), (9, 'Alpha')`)
  await cli.unsafe(`
    create table ext_fixture.tenant (
      id uuid primary key default gen_random_uuid(),
      slug text not null unique,
      plan text,
      internal_notes text,
      updated_at timestamptz not null default now()
    )`)
  await cli.unsafe(`
    create table ext_fixture.tenant_tag (
      tenant_id uuid not null,
      tag text not null,
      primary key (tenant_id, tag)
    )`)
  await cli.unsafe(`
    insert into ext_fixture.tenant (slug, plan, internal_notes)
    values ('acme', 'pro', 'cli-only'), ('globex', 'free', null)`)
  // FK pair + one FK at a table the tests never reflect (garage).
  await cli.unsafe(`
    create table ext_fixture.vehicle (
      id serial primary key,
      reg_no text not null,
      updated_at timestamptz not null default now()
    )`)
  await cli.unsafe(`
    create table ext_fixture.garage (id serial primary key, city text)`)
  await cli.unsafe(`
    create table ext_fixture.accident (
      id serial primary key,
      severity text,
      vehicle_id int not null references ext_fixture.vehicle(id),
      garage_id int references ext_fixture.garage(id),
      updated_at timestamptz not null default now()
    )`)
  // Two tables sharing one constraint NAME (legal in Postgres — constraint
  // names are unique per table, not per schema). The hand-written
  // "fk_ref" on both must not cross-multiply in the catalog query.
  await cli.unsafe(`
    create table ext_fixture.claim (
      id serial primary key,
      vehicle_id int,
      constraint fk_ref foreign key (vehicle_id) references ext_fixture.vehicle(id)
    )`)
  await cli.unsafe(`
    create table ext_fixture.inspection (
      id serial primary key,
      vehicle_id int,
      constraint fk_ref foreign key (vehicle_id) references ext_fixture.vehicle(id)
    )`)
  // #154: refusals the database makes itself. `status` is renamed on
  // reflection (status is a Featherbase field).
  await cli.unsafe(`
    create table ext_fixture.gauge (
      id serial primary key,
      status text,
      business_code int references ext_fixture.business(code)
    )`)
})

afterAll(async () => {
  invalidateSources()
  await cli.unsafe(`drop schema if exists ext_fixture cascade`)
  await cli.end({ timeout: 2 })
})

async function makeSource(
  admin: { fetch: (p: string, i?: RequestInit) => Promise<Response> },
  overrides: Record<string, unknown> = {},
) {
  invalidateSources()
  const res = await admin.fetch('/api/table/Data%20Source', {
    method: 'POST',
    body: JSON.stringify({
      row_id: 'ext-fixture',
      engine: 'postgres',
      url_env: EXT_URL_ENV,
      default_schema: 'ext_fixture',
      access: 'read_write',
      ...overrides,
    }),
  })
  expect(res.status).toBe(201)
}

async function reflectTenant(admin: {
  fetch: (p: string, i?: RequestInit) => Promise<Response>
}): Promise<string> {
  const res = await admin.fetch('/api/table/Data%20Source/ext-fixture:reflect', {
    method: 'POST',
    body: JSON.stringify({ schema: 'ext_fixture', tables: ['tenant'] }),
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { created: { name: string }[]; skipped: unknown[] }
  expect(body.created).toHaveLength(1)
  return body.created[0].name
}

describe('EDS-1: Data Source registry', () => {
  test('validates engine, url_env shape, and IV1 names', async ({ admin }) => {
    await expect(
      admin.post('/api/table/Data%20Source', {
        row_id: 'Bad Name',
        engine: 'postgres',
        url_env: EXT_URL_ENV,
      }),
    ).rejects.toMatchObject({ status: 417 })
    await expect(
      admin.post('/api/table/Data%20Source', {
        row_id: 'pasted-secret',
        engine: 'postgres',
        url_env: 'postgres://user:pwd@host/db',
      }),
    ).rejects.toMatchObject({ status: 417 })
  })

  test('test_connection stamps ok, and names a missing env var without echoing secrets', async ({
    admin,
  }) => {
    await makeSource(admin)
    const ok = await admin.post<{ ok: boolean }>(
      '/api/table/Data%20Source/ext-fixture:test_connection',
      {},
    )
    expect(ok.ok).toBe(true)

    await makeSource(admin, { row_id: 'ext-unset', url_env: 'EXT_UNSET_URL' })
    const bad = await admin.post<{ ok: boolean; error: string }>(
      '/api/table/Data%20Source/ext-unset:test_connection',
      {},
    )
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('EXT_UNSET_URL')
    expect(bad.error).not.toContain('postgres://')
  })
})

describe('EDS-2/EDS-3: introspection and reflection', () => {
  test('#176 fresh no-revision reflection sorts on row_id, not the business name', async ({ admin }) => {
    await makeSource(admin)
    const reflected = await admin.post<{ created: { name: string }[] }>('/api/table/Data%20Source/ext-fixture:reflect', { schema: 'ext_fixture', tables: ['business'] })
    const name = reflected.created[0].name
    const meta = await admin.get<{ sort_column: string; external_pk: string }>(`/api/table/${encodeURIComponent(name)}:meta`)
    expect(meta).toMatchObject({ sort_column: 'row_id', external_pk: 'code' })
    const rows = await admin.get<{ data: { row_id: string; name: string }[] }>(`/api/table/${encodeURIComponent(name)}?fields=${encodeURIComponent('["row_id","name"]')}&order_by=${meta.sort_column}%20desc`)
    expect(rows.data.map((r) => [r.row_id, r.name])).toEqual([['9', 'Alpha'], ['1', 'Zulu']])
    // Reflection is additive/idempotent; it must not overwrite an operator's sort.
    await sql`update table_def set sort_column = 'name' where name = ${name}`
    await admin.post('/api/table/Data%20Source/ext-fixture:reflect', { schema: 'ext_fixture', tables: ['business'] })
    expect((await sql`select sort_column from table_def where name = ${name}`)[0].sort_column).toBe('name')
  })

  test('lists tables with pk detection; composite pk is not bindable', async ({ admin }) => {
    await makeSource(admin)
    const res = (await admin.get(
      '/api/table/Data%20Source/ext-fixture:introspect?schema=ext_fixture',
    )) as {
      tables: { table: string; pk: string | null; bindable: boolean; reason?: string }[]
    }
    const tenant = res.tables.find((t) => t.table === 'tenant')!
    expect(tenant.pk).toBe('id')
    expect(tenant.bindable).toBe(true)
    const tag = res.tables.find((t) => t.table === 'tenant_tag')!
    expect(tag.bindable).toBe(false)
    expect(tag.reason).toMatch(/single-column primary key/)
  })

  test('reflect creates a bound Table with NO physical table and no RLS (BV1)', async ({
    admin,
  }) => {
    await makeSource(admin)
    const name = await reflectTenant(admin)
    expect(name).toBe('Ext Tenant')
    const meta = (await admin.get(`/api/table/${encodeURIComponent(name)}:meta`)) as Record<
      string,
      unknown
    >
    expect(meta.data_source).toBe('ext-fixture')
    expect(meta.external_pk).toBe('id')
    expect(meta.external_modified).toBe('updated_at')
    expect(meta.source_access).toBe('read_write')
    // The pk and modified columns surface as name/updated_at, not columns.
    const colNames = (meta.columns as { column_name: string }[]).map((c) => c.column_name)
    expect(colNames).toEqual(['slug', 'plan', 'internal_notes'])
    // No local physical table was created.
    const [tbl] = await sql`
      select 1 from information_schema.tables where table_name = 'ext_tenant'`
    expect(tbl).toBeUndefined()
  })
})

describe('EDS-5: reading bound rows', () => {
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
      `/api/table/Ext%20Tenant:count?filters=${encodeURIComponent('[["plan","=","pro"]]')}`,
    )) as { count: number }
    expect(count.count).toBe(1)

    const name = String(filtered.data[0].row_id)
    const doc = (await admin.get(`/api/table/Ext%20Tenant/${name}`)) as Record<string, unknown>
    expect(doc.slug).toBe('acme')
    expect(Date.parse(doc.updated_at as string)).not.toBeNaN()
    expect(doc.status).toBe('draft')
  })

  test('unknown filter/selected fields are rejected before touching the source', async ({
    admin,
  }) => {
    await makeSource(admin)
    await reflectTenant(admin)
    await expect(
      admin.get(
        `/api/table/Ext%20Tenant?filters=${encodeURIComponent('[["internal_secret","=","x"]]')}`,
      ),
    ).rejects.toMatchObject({ status: 417 })
  })
})

describe('EDS-6/EDS-8: writing bound rows', () => {
  test('create takes the name from the source default (RETURNING)', async ({ admin }) => {
    await makeSource(admin)
    await reflectTenant(admin)
    const created = await admin.post<Record<string, unknown>>('/api/table/Ext%20Tenant', {
      slug: 'initech',
      plan: 'pro',
    })
    expect(String(created.row_id)).toMatch(/^[0-9a-f-]{36}$/)
    const [row] = await cli`select slug, plan from ext_fixture.tenant where slug = 'initech'`
    expect(row.plan).toBe('pro')
  })

  test('update writes only payload fields — CLI-owned columns survive (BV2)', async ({
    admin,
  }) => {
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
    const [row] = await cli`
      select plan, internal_notes from ext_fixture.tenant where slug = 'acme'`
    expect(row.plan).toBe('enterprise')
    expect(row.internal_notes).toBe('cli-only') // untouched
  })

  test('a concurrent CLI write conflicts on the next save (modified mode)', async ({ admin }) => {
    await makeSource(admin)
    await reflectTenant(admin)
    const list = (await admin.get(
      `/api/table/Ext%20Tenant?fields=${encodeURIComponent('["row_id","updated_at"]')}&filters=${encodeURIComponent('[["slug","=","globex"]]')}`,
    )) as { data: Record<string, unknown>[] }
    const { row_id: name, updated_at } = list.data[0]
    // The CLI writes directly, bumping updated_at.
    await cli`update ext_fixture.tenant set plan = 'pro', updated_at = now() where slug = 'globex'`
    await expect(
      patchDoc(admin, `/api/table/Ext%20Tenant/${String(name)}`, {
        plan: 'free',
        updated_at,
      }),
    ).rejects.toMatchObject({ status: 409 })
  })

  test('unique violations come back as field-wise errors', async ({ admin }) => {
    await makeSource(admin)
    await reflectTenant(admin)
    await expect(
      admin.post('/api/table/Ext%20Tenant', { slug: 'acme' }),
    ).rejects.toMatchObject({ status: 417, fields: { slug: expect.stringContaining('unique') } })
  })

  test('a missing required value or a broken link comes back on its field, without the database text (#154)', async ({ admin }) => {
    await makeSource(admin)
    const res = await admin.post<{ created: { name: string }[] }>('/api/table/Data%20Source/ext-fixture:reflect', {
      schema: 'ext_fixture',
      tables: ['gauge'],
    })
    const path = `/api/table/${encodeURIComponent(res.created[0].name)}`
    // The database starts requiring it after the table was connected.
    await cli.unsafe(`alter table ext_fixture.gauge alter column status set not null`)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const required = await admin.fetch(path, { method: 'POST', body: JSON.stringify({ business_code: 1 }) })
      expect(required.status).toBe(417)
      const r = (await required.json()) as { error: { message: string; fields?: Record<string, string> } }
      expect(r.error.fields).toEqual({ status_1: 'Required' })
      expect(r.error.message).not.toMatch(/violates|null value/)
      const broken = await admin.fetch(path, { method: 'POST', body: JSON.stringify({ status_1: 'ok', business_code: 999 }) })
      expect(broken.status).toBe(417)
      const b = (await broken.json()) as { error: { message: string; fields?: Record<string, string> } }
      expect(b.error.fields).toEqual({ business_code: expect.any(String) })
      expect(b.error.message).not.toMatch(/violates|foreign key/)
    } finally {
      warn.mockRestore()
      await cli.unsafe(`alter table ext_fixture.gauge alter column status drop not null`)
    }
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
    const rows = await cli`select 1 from ext_fixture.tenant where slug = 'doomed'`
    expect(rows).toHaveLength(0)
  })

  // SPEC: A row with comments, history, attachments or shares can't be
  // deleted (row-deletion), #321. A connected row's comments live here.
  test('delete is refused while the connected row has comments', async ({ admin }) => {
    await makeSource(admin)
    await reflectTenant(admin)
    const made = (await admin.post('/api/table/Ext%20Tenant', { slug: 'kept-commented' })) as { row_id: string }
    const id = String(made.row_id)
    await sql`insert into featherbase.comment (row_id, ref_table, ref_name, content) values ('ext-c', 'Ext Tenant', ${id}, 'note')`
    const loaded = (await admin.get(`/api/table/Ext%20Tenant/${id}`)) as Record<string, unknown>
    const res = await admin.fetch(`/api/table/Ext%20Tenant/${id}?updated_at=${encodeURIComponent(String(loaded.updated_at))}`, { method: 'DELETE' })
    expect(res.status).toBe(417)
    expect(await cli`select 1 from ext_fixture.tenant where slug = 'kept-commented'`).toHaveLength(1)
  })

  test('rename is rejected — the pk belongs to the source', async ({ admin }) => {
    await makeSource(admin)
    await reflectTenant(admin)
    const list = (await admin.get('/api/table/Ext%20Tenant')) as { data: { row_id: string }[] }
    await expect(
      admin.post(`/api/table/Ext%20Tenant/${list.data[0].row_id}:rename`, { new_name: 'x' }),
    ).rejects.toMatchObject({ status: 417 })
  })
})

describe('EDS-7: read-only sources', () => {
  test('read_only rejects create/update/delete but keeps reads working (S3: no restart)', async ({
    admin,
  }) => {
    await makeSource(admin)
    await reflectTenant(admin)
    // Flip to read_only through the normal save path — the controller
    // invalidates caches, so it applies immediately.
    const src = (await admin.get('/api/table/Data%20Source/ext-fixture')) as Record<
      string,
      unknown
    >
    await patchDoc(admin, '/api/table/Data%20Source/ext-fixture', {
      access: 'read_only',
      updated_at: src.updated_at,
    })

    // Foreign rows accumulate across tests (the fixture is outside the
    // sandbox) — assert reads work, not an exact count.
    const list = (await admin.get('/api/table/Ext%20Tenant')) as { total: number }
    expect(list.total).toBeGreaterThanOrEqual(2)
    await expect(
      admin.post('/api/table/Ext%20Tenant', { slug: 'nope' }),
    ).rejects.toMatchObject({ status: 403 })
    const meta = (await admin.get('/api/table/Ext%20Tenant:meta')) as Record<string, unknown>
    expect(meta.source_access).toBe('read_only')
  })
})

describe('EDS-11: source failure', () => {
  test('an unreachable source is a DataSourceError, never an empty list', async ({ admin }) => {
    process.env.EXT_DEAD_URL = 'postgres://nobody:nothing@127.0.0.1:59999/nope'
    await makeSource(admin, { row_id: 'ext-dead', url_env: 'EXT_DEAD_URL' })
    const res = await admin.fetch('/api/table/Data%20Source/ext-dead:reflect', {
      method: 'POST',
      body: JSON.stringify({ schema: 'whatever', tables: ['x'] }),
    })
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: { type: string; message: string } }
    expect(body.error.type).toBe('DataSourceError')
    expect(body.error.message).toContain('ext-dead')
  })
})

describe('EDS-2: foreign keys reflect as References', () => {
  test('FK edges surface on introspect and converge in child-first order', async ({ admin }) => {
    await makeSource(admin)
    const intro = (await admin.get(
      '/api/table/Data%20Source/ext-fixture:introspect?schema=ext_fixture',
    )) as {
      tables: {
        table: string
        columns: {
          name: string
          references?: { schema: string; table: string; column: string } | null
        }[]
      }[]
    }
    const accident = intro.tables.find((t) => t.table === 'accident')!
    expect(accident.columns.find((c) => c.name === 'vehicle_id')!.references).toEqual({
      schema: 'ext_fixture',
      table: 'vehicle',
      column: 'id',
    })

    // Child first: plain Int until the parent arrives, then upgraded in place.
    const reflectRes = await admin.fetch('/api/table/Data%20Source/ext-fixture:reflect', {
      method: 'POST',
      body: JSON.stringify({ schema: 'ext_fixture', tables: ['accident'] }),
    })
    expect(reflectRes.status).toBe(200)
    const created = ((await reflectRes.json()) as { created: { name: string }[] }).created[0].name
    const colsOf = async () => {
      const meta = (await admin.get(`/api/table/${encodeURIComponent(created)}:meta`)) as {
        columns: { column_name: string; column_type: string; reference_table: string | null }[]
      }
      return new Map(meta.columns.map((c) => [c.column_name, c]))
    }
    expect((await colsOf()).get('vehicle_id')).toMatchObject({
      column_type: 'Int',
      reference_table: null,
    })
    const parentRes = await admin.fetch('/api/table/Data%20Source/ext-fixture:reflect', {
      method: 'POST',
      body: JSON.stringify({ schema: 'ext_fixture', tables: ['vehicle'] }),
    })
    expect(parentRes.status).toBe(200)
    const vehicleName = ((await parentRes.json()) as { created: { name: string }[] }).created[0]
      .name
    const cols = await colsOf()
    expect(cols.get('vehicle_id')).toMatchObject({
      column_type: 'Reference',
      reference_table: vehicleName,
    })
    // garage is never reflected — its FK column stays Int.
    expect(cols.get('garage_id')).toMatchObject({ column_type: 'Int', reference_table: null })
  })

  test('a doubly-bound relation resolves to a deterministic Reference target', async ({
    admin,
  }) => {
    await makeSource(admin)
    // Bind the vehicle relation TWICE by hand (legal via EDS-3); the
    // earliest-created binding must win as the Reference target — names
    // chosen so the created_at tie-break (name asc) agrees.
    for (const name of ['Alpha Vehicle', 'Zeta Vehicle']) {
      await admin.post('/api/table_def', {
        name,
        data_source: 'ext-fixture',
        external_schema: 'ext_fixture',
        external_table: 'vehicle',
        external_pk: 'id',
        columns: [{ column_name: 'reg_no', column_type: 'Data' }],
      })
    }
    const preview = await admin.get('/api/table/Data%20Source/ext-fixture:introspect?schema=ext_fixture') as { tables: ReflectionCandidate[] }
    const columns = preview.tables.find((t) => t.table === 'accident')!.columns
    expect(columns.find((c) => c.name === 'vehicle_id')).toMatchObject({
      column_type: 'Int', reference_table: 'Alpha Vehicle',
    })
    expect(columns.find((c) => c.name === 'garage_id')).toMatchObject({
      column_type: 'Int', reference_table: null,
    })
    expect(columns.find((c) => c.name === 'id')!.reference_table).toBeNull()
    const res = await admin.fetch('/api/table/Data%20Source/ext-fixture:reflect', {
      method: 'POST',
      body: JSON.stringify({ schema: 'ext_fixture', tables: ['accident'] }),
    })
    expect(res.status).toBe(200)
    const created = ((await res.json()) as { created: { name: string }[] }).created[0].name
    const meta = (await admin.get(`/api/table/${encodeURIComponent(created)}:meta`)) as {
      columns: { column_name: string; column_type: string; reference_table: string | null }[]
    }
    expect(meta.columns.find((c) => c.column_name === 'vehicle_id')).toMatchObject({
      column_type: 'Reference',
      reference_table: 'Alpha Vehicle',
    })
  })

  test('Reference preview does not substitute a later matching key for the first binding', async ({ admin }) => {
    await makeSource(admin)
    for (const [name, key] of [['Alpha Alternate', 'reg_no'], ['Zeta Primary', 'id']]) {
      await admin.post('/api/table_def', {
        name, data_source: 'ext-fixture', external_schema: 'ext_fixture',
        external_table: 'vehicle', external_pk: key,
        columns: [{ column_name: 'reg_no', column_type: 'Data' }],
      })
    }
    const preview = await admin.get('/api/table/Data%20Source/ext-fixture:introspect?schema=ext_fixture') as { tables: ReflectionCandidate[] }
    const column = preview.tables.find((t) => t.table === 'accident')!.columns.find((c) => c.name === 'vehicle_id')!
    expect(column).toMatchObject({
      column_type: 'Int', reference_table: null,
      references: { schema: 'ext_fixture', table: 'vehicle', column: 'id' },
    })
  })

  test('two tables sharing a constraint name both keep their FK edge', async ({ admin }) => {
    await makeSource(admin)
    const intro = (await admin.get(
      '/api/table/Data%20Source/ext-fixture:introspect?schema=ext_fixture',
    )) as {
      tables: {
        table: string
        columns: {
          name: string
          references?: { schema: string; table: string; column: string } | null
        }[]
      }[]
    }
    for (const tableName of ['claim', 'inspection']) {
      const t = intro.tables.find((x) => x.table === tableName)!
      expect(t.columns.find((c) => c.name === 'vehicle_id')!.references).toEqual({
        schema: 'ext_fixture',
        table: 'vehicle',
        column: 'id',
      })
    }
    const res = await admin.fetch('/api/table/Data%20Source/ext-fixture:reflect', {
      method: 'POST',
      body: JSON.stringify({ schema: 'ext_fixture', tables: ['vehicle', 'claim', 'inspection'] }),
    })
    expect(res.status).toBe(200)
    const created = ((await res.json()) as { created: { table: string; name: string }[] }).created
    const vehicleName = created.find((c) => c.table === 'vehicle')!.name
    for (const t of ['claim', 'inspection']) {
      const name = created.find((c) => c.table === t)!.name
      const meta = (await admin.get(`/api/table/${encodeURIComponent(name)}:meta`)) as {
        columns: { column_name: string; column_type: string; reference_table: string | null }[]
      }
      expect(meta.columns.find((c) => c.column_name === 'vehicle_id')).toMatchObject({
        column_type: 'Reference',
        reference_table: vehicleName,
      })
    }
  })
})

describe('Turn a data source table into a Featherbase table', () => {
  const catalog = () => cli`
    select c.table_name, c.column_name, c.data_type
      from information_schema.columns c where c.table_schema = 'ext_fixture'
     order by 1, 2, 3`
  const indexes = () => cli`select indexname, indexdef from pg_indexes where schemaname = 'ext_fixture' order by 1`
  const relations = () => cli`select relname, relkind from pg_class where relnamespace = 'ext_fixture'::regnamespace order by 1`

  test('turning a table on leaves the database it came from exactly as it was', async ({ admin }) => {
    await makeSource(admin)
    const before = [await catalog(), await indexes(), await relations()]
    await reflectTenant(admin)
    await admin.get('/api/table/Ext%20Tenant')
    expect([await catalog(), await indexes(), await relations()]).toEqual(before)
  })

  test('a column left out when connecting is never read or written', async ({ admin }) => {
    await makeSource(admin)
    // Hand-written binding that maps only `plan`; `internal_notes` and `slug` are left out.
    await admin.post('/api/table_def', {
      name: 'Ext Tenant Plans',
      data_source: 'ext-fixture',
      external_schema: 'ext_fixture',
      external_table: 'tenant',
      external_pk: 'id',
      external_modified: 'updated_at',
      columns: [{ column_name: 'plan', column_type: 'Data' }],
    })
    const enc = encodeURIComponent('Ext Tenant Plans')
    const list = (await admin.get(
      `/api/table/${enc}?filters=${encodeURIComponent('[["plan","=","pro"]]')}`,
    )) as { data: Record<string, unknown>[] }
    expect(list.data.length).toBeGreaterThan(0)
    for (const row of list.data) {
      expect(row).not.toHaveProperty('internal_notes')
      expect(row).not.toHaveProperty('slug')
    }
    // Saving the mapped field leaves the left-out one as the source has it.
    const acme = (await admin.get(`/api/table/${enc}/${String(list.data[0].row_id)}`)) as Record<string, unknown>
    const [{ internal_notes: notesBefore }] = await cli`
      select internal_notes from ext_fixture.tenant where id = ${String(acme.row_id)}`
    await patchDoc(admin, `/api/table/${enc}/${String(acme.row_id)}`, {
      plan: 'platinum',
      updated_at: acme.updated_at,
    })
    const [after] = await cli`
      select plan, internal_notes from ext_fixture.tenant where id = ${String(acme.row_id)}`
    expect(after).toEqual({ plan: 'platinum', internal_notes: notesBefore })
    // Reaching for the left-out column is refused rather than silently written.
    const fresh = (await admin.get(`/api/table/${enc}/${String(acme.row_id)}`)) as Record<string, unknown>
    const res = await admin.fetch(`/api/table/${enc}/${String(acme.row_id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ internal_notes: 'overwritten', updated_at: fresh.updated_at }),
    })
    const [still] = await cli`select internal_notes from ext_fixture.tenant where id = ${String(acme.row_id)}`
    expect(still.internal_notes).toBe(notesBefore)
    expect(res.status).toBe(417)
    // The fixture lives outside the sandbox: put the plan back for other tests.
    await cli`update ext_fixture.tenant set plan = 'pro' where id = ${String(acme.row_id)} and plan = 'platinum'`
  })

  test('rows in a connected table cannot be submitted or cancelled', async ({ admin }) => {
    await makeSource(admin)
    await reflectTenant(admin)
    const list = (await admin.get('/api/table/Ext%20Tenant')) as { data: { row_id: string }[] }
    const id = encodeURIComponent(list.data[0].row_id)
    for (const action of ['submit', 'cancel']) {
      const res = await admin.fetch(`/api/table/Ext%20Tenant/${id}:${action}`, { method: 'POST', body: '{}' })
      expect(res.status, action).toBeGreaterThanOrEqual(400)
      expect(res.status, action).toBeLessThan(500)
    }
  })
})

describe('Connect a data source', () => {
  test('a data source that still has connected tables cannot be removed until they are gone', async ({ admin }) => {
    await makeSource(admin)
    await reflectTenant(admin)
    await expect(admin.delete('/api/table/Data%20Source/ext-fixture')).rejects.toMatchObject({
      status: 417,
      message: expect.stringContaining('still has bound Tables (e.g. Ext Tenant)'),
    })
    await admin.delete('/api/table_def/Ext%20Tenant')
    await admin.delete('/api/table/Data%20Source/ext-fixture')
    expect((await admin.fetch('/api/table/Data%20Source/ext-fixture')).status).toBe(404)
  })

  test('a warehouse data source cannot be set up as writable', async ({ admin }) => {
    await expect(
      admin.post('/api/table/Data%20Source', {
        row_id: 'duck-rw',
        engine: 'duckdb',
        url_env: 'EXT_FIXTURE_URL',
        access: 'read_write',
      }),
    ).rejects.toMatchObject({ status: 417, fields: { access: expect.stringContaining('read_only') } })
  })
})

describe('A data source outage doesn\'t take down anything else', () => {
  test('a connected table says the source cannot be reached while other tables keep working', async ({ admin }) => {
    await makeSource(admin)
    await reflectTenant(admin)
    expect(((await admin.get('/api/table/Ext%20Tenant')) as { total: number }).total).toBeGreaterThan(0)

    // The source stops answering.
    process.env.EXT_DEAD_URL = 'postgres://nobody:nothing@127.0.0.1:59999/nope'
    const src = (await admin.get('/api/table/Data%20Source/ext-fixture')) as Record<string, unknown>
    await patchDoc(admin, '/api/table/Data%20Source/ext-fixture', {
      url_env: 'EXT_DEAD_URL',
      updated_at: src.updated_at,
    })

    const down = await admin.fetch('/api/table/Ext%20Tenant')
    expect(down.status).toBe(502)
    const body = (await down.json()) as { error: { type: string; message: string } }
    expect(body.error.type).toBe('DataSourceError')
    expect(body.error.message).toContain('ext-fixture')

    // Everything else is untouched.
    expect((await admin.fetch('/api/table/Role')).status).toBe(200)
    expect((await admin.fetch('/api/table/Person')).status).toBe(200)
  })
})

describe('Concurrent edits are caught when the source can tell', () => {
  test('without a last-changed time on the source, a later save overwrites what is there', async ({ admin }) => {
    await makeSource(admin)
    const reflected = await admin.post<{ created: { name: string }[] }>(
      '/api/table/Data%20Source/ext-fixture:reflect',
      { schema: 'ext_fixture', tables: ['business'] },
    )
    const enc = encodeURIComponent(reflected.created[0].name)
    const meta = (await admin.get(`/api/table/${enc}:meta`)) as { external_modified?: string | null }
    expect(meta.external_modified ?? null).toBeNull()

    const loaded = (await admin.get(`/api/table/${enc}/1`)) as Record<string, unknown>
    // Someone else changes the row at the source after it was loaded.
    await cli`update ext_fixture.business set name = 'Changed elsewhere' where code = 1`
    const res = await admin.fetch(`/api/table/${enc}/1`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Mine', ...(loaded.updated_at ? { updated_at: loaded.updated_at } : {}) }),
    })
    expect(res.status).toBe(200)
    const [row] = await cli`select name from ext_fixture.business where code = 1`
    expect(row.name).toBe('Mine')
    await cli`update ext_fixture.business set name = 'Zulu' where code = 1`
  })
})

describe('Read and write through a connected table: a Postgres database', () => {
  test('rows can be counted by a column, read straight from the source', async ({ admin }) => {
    await makeSource(admin)
    await reflectTenant(admin)
    const res = await admin.post<{ data: { label: string; value: number }[] }>('/api/dashboard/chart', {
      table: 'Ext Tenant',
      group_by: 'plan',
      filters: [['slug', 'in', ['acme', 'globex']]],
    })
    const direct = await cli`
      select plan as label, count(*)::int as n from ext_fixture.tenant
      where slug in ('acme', 'globex') group by plan`
    expect(Object.fromEntries(res.data.map((d) => [d.label, Number(d.value)]))).toEqual(
      Object.fromEntries(direct.map((d) => [d.label, d.n])),
    )
  })
})

describe('Connect a data source: limiting which tables can be connected', () => {
  test('a data source with a list of allowed tables connects only those', async ({ admin }) => {
    await makeSource(admin, { table_allowlist: 'ext_fixture.tenant\next_fixture.vehicle' })
    const reflect = (tables: string[]) =>
      admin.fetch('/api/table/Data%20Source/ext-fixture:reflect', {
        method: 'POST',
        body: JSON.stringify({ schema: 'ext_fixture', tables }),
      })
    // A table outside the list is refused, and nothing is connected.
    const refused = await reflect(['business'])
    expect(refused.status).toBe(403)
    expect(((await refused.json()) as { error: { message: string } }).error.message).toContain('not in the allowlist')
    expect(await sql`select 1 from table_def where data_source = 'ext-fixture'`).toHaveLength(0)
    // One on the list connects.
    const allowed = await reflect(['tenant'])
    expect(allowed.status).toBe(200)
    expect(((await allowed.json()) as { created: { name: string }[] }).created.map((c) => c.name)).toEqual(['Ext Tenant'])
    // A hand-written binding to a table outside the list is refused too.
    await expect(
      admin.post('/api/table_def', {
        name: 'Ext Business By Hand',
        data_source: 'ext-fixture',
        external_schema: 'ext_fixture',
        external_table: 'business',
        external_pk: 'code',
        columns: [{ column_name: 'name', column_type: 'Data' }],
      }),
    ).rejects.toMatchObject({ status: 403 })
  })

  test('asking for several tables when a later one is not allowed connects none of them', async ({ admin }) => {
    await makeSource(admin, { table_allowlist: 'ext_fixture.tenant\next_fixture.vehicle' })
    const refused = await admin.fetch('/api/table/Data%20Source/ext-fixture:reflect', {
      method: 'POST',
      body: JSON.stringify({ schema: 'ext_fixture', tables: ['tenant', 'vehicle', 'business'] }),
    })
    expect(refused.status).toBe(403)
    expect(((await refused.json()) as { error: { message: string } }).error.message).toContain('ext_fixture.business')
    expect(await sql`select name from table_def where data_source = 'ext-fixture'`).toHaveLength(0)
  })

  test('skipped tables come back in the order they were asked for', async ({ admin }) => {
    await makeSource(admin)
    await reflectTenant(admin)
    const res = await admin.post<{ skipped: { table: string; reason: string }[] }>(
      '/api/table/Data%20Source/ext-fixture:reflect',
      { schema: 'ext_fixture', tables: ['tenant', 'nope'] },
    )
    expect(res.skipped.map((s) => [s.table, s.reason])).toEqual([
      ['tenant', 'Already reflected as Ext Tenant'],
      ['nope', 'Not found on the source'],
    ])
  })
})

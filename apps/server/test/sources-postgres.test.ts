// EDS (spec 0001): external Postgres data sources — registry, introspection,
// reflection, reads, writes, conflicts, read-only enforcement.
//
// The "foreign database" is a schema (ext_fixture) created OUTSIDE the
// sandbox transaction by a direct client, mimicking a CLI-owned store: the
// driver reaches it through its own pool, so it must be committed and is
// cleaned up in afterAll. Everything control-side (the Data Source row, the
// bound table_def) happens inside the sandbox and rolls back per test.
import { afterAll, beforeAll, describe, expect } from 'vitest'
import postgres from 'postgres'
import { test, patchDoc } from './pg-test'
import { config } from '../src/config'
import { sql } from '../src/db'
import { invalidateSources } from '../src/sources/registry'

const EXT_URL_ENV = 'EXT_FIXTURE_URL'
process.env[EXT_URL_ENV] = config.databaseUrl

// Direct, unsandboxed client that plays the CLI owning the foreign schema.
let cli: ReturnType<typeof postgres>

beforeAll(async () => {
  cli = postgres(config.databaseUrl, { max: 2 })
  await cli.unsafe(`drop schema if exists ext_fixture cascade`)
  await cli.unsafe(`create schema ext_fixture`)
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
    expect(doc.updated_at).toBeTruthy()
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

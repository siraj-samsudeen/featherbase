// A source-bound deployment is reproducible from a manifest: the app
// declares WHICH sources to connect and WHICH relations to reflect, install
// materializes both, uninstall removes exactly what it created.
//
// Verified against LOCAL fixture schemas — never the real Railway/MotherDuck
// stores. A developer machine carries the production credentials in
// apps/server/.env, so a test that "just checks it parses" by installing the
// real manifest would dial production; that mistake was made once already.
import { afterAll, beforeAll, beforeEach, describe, expect } from 'vitest'
import postgres from 'postgres'
import { test } from './pg-test'
import { config } from '../src/config'
import { sql } from '../src/db'
import { invalidateSources } from '../src/sources/registry'

const ENV_VAR = 'APPSRC_FIXTURE_URL'
process.env[ENV_VAR] = config.databaseUrl

let cli: ReturnType<typeof postgres>

beforeAll(async () => {
  cli = postgres(config.databaseUrl, { max: 2 })
  await cli.unsafe(`drop schema if exists appsrc cascade`)
  await cli.unsafe(`create schema appsrc`)
  await cli.unsafe(`
    create table appsrc.lease (
      extractor text primary key,
      holder text,
      updated_at timestamptz not null default now()
    )`)
  await cli.unsafe(`
    create table appsrc.run (
      run_id text primary key,
      phase text,
      updated_at timestamptz not null default now()
    )`)
})

beforeEach(async () => {
  await cli.unsafe(`truncate appsrc.lease, appsrc.run`)
  await cli.unsafe(`insert into appsrc.lease (extractor, holder) values ('sap', 'box-1')`)
  await cli.unsafe(`insert into appsrc.run (run_id, phase) values ('R-1', 'done')`)
})

afterAll(async () => {
  invalidateSources()
  await cli.unsafe(`drop schema if exists appsrc cascade`)
  await cli.end({ timeout: 2 })
})

const MANIFEST = {
  row_id: 'appsrc-demo',
  sources: [
    {
      row_id: 'appsrc-fixture',
      engine: 'postgres' as const,
      url_env: ENV_VAR,
      default_schema: 'appsrc',
      access: 'read_only' as const,
      reflect: {
        schema: 'appsrc',
        prefix: 'Demo',
        module: 'Demo Sources',
        tables: ['appsrc.lease', 'appsrc.run'],
      },
    },
  ],
}

describe('app manifests can declare Data Sources and reflections', () => {
  test('install materializes the source and its reflected Tables', async ({ admin }) => {
    invalidateSources()
    const res = await admin.post<{ tables: string[]; sources: string[] }>('/api/install_app', {
      manifest: MANIFEST,
    })
    expect(res.sources).toEqual(['appsrc-fixture'])
    expect(res.tables.sort()).toEqual(['Demo Lease', 'Demo Run'])

    // The bound Tables actually read from the fixture schema.
    const meta = (await admin.get('/api/table/Demo%20Lease:meta')) as Record<string, unknown>
    expect(meta.data_source).toBe('appsrc-fixture')
    expect(meta.external_table).toBe('lease')
    expect(meta.source_writable).toBe(false) // read_only source
    const list = (await admin.get(
      `/api/table/Demo%20Lease?fields=${encodeURIComponent('["name","holder"]')}`,
    )) as { data: { row_id: string; holder: string }[]; total: number }
    expect(list.total).toBe(1)
    expect(list.data[0]).toMatchObject({ row_id: 'sap', holder: 'box-1' })
  })

  test('uninstall removes the reflected Tables and the source it created', async ({ admin }) => {
    invalidateSources()
    await admin.post('/api/install_app', { manifest: MANIFEST })
    await admin.post('/api/uninstall_app', { row_id: 'appsrc-demo' })

    const tables = await sql`
      select name from table_def where name in ('Demo Lease', 'Demo Run')`
    expect(tables).toHaveLength(0)
    const [src] = await sql`select 1 from data_source where row_id = 'appsrc-fixture'`
    expect(src).toBeUndefined()
    // The foreign schema is untouched — uninstall never issues DDL upstream.
    const rows = await cli`select extractor from appsrc.lease`
    expect(rows).toHaveLength(1)
  })

  test('a pre-existing source is ADOPTED, not recreated, and survives uninstall', async ({
    admin,
  }) => {
    invalidateSources()
    // The operator created the source by hand first.
    await admin.post('/api/table/Data%20Source', {
      row_id: 'appsrc-fixture',
      engine: 'postgres',
      url_env: ENV_VAR,
      default_schema: 'appsrc',
      access: 'read_only',
    })
    const res = await admin.post<{ sources: string[] }>('/api/install_app', { manifest: MANIFEST })
    expect(res.sources).toEqual([]) // adopted, so not recorded
    await admin.post('/api/uninstall_app', { row_id: 'appsrc-demo' })
    const [src] = await sql`select 1 from data_source where row_id = 'appsrc-fixture'`
    expect(src).toBeTruthy() // predated the app — never removed
  })

  test('a relation the source does not have fails the install loudly', async ({ admin }) => {
    invalidateSources()
    await expect(
      admin.post('/api/install_app', {
        manifest: {
          ...MANIFEST,
          row_id: 'appsrc-bad',
          sources: [
            {
              ...MANIFEST.sources[0],
              reflect: { ...MANIFEST.sources[0].reflect, tables: ['appsrc.nope'] },
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ status: 417 })
  })

  test('a manifest may not carry a connection string, only an env var name', async ({ admin }) => {
    await expect(
      admin.post('/api/install_app', {
        manifest: {
          row_id: 'appsrc-secret',
          sources: [
            {
              row_id: 'appsrc-secret-src',
              engine: 'postgres',
              url_env: 'postgres://user:pw@host/db',
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ status: 417 })
  })
})

// NOTE: the Rama instance manifest deliberately does NOT live in this repo —
// it is Rama-specific config and lives beside the pipelines it points at, in
// rama_dw/featherbase/manifest.json. What belongs here is the MECHANISM, and
// the guard below is the rule that manifest depends on: a manifest may never
// carry a credential, only the NAME of an environment variable.
describe('a manifest never carries a credential', () => {
  test('every source shape that looks like a connection string is refused', async ({ admin }) => {
    for (const url_env of [
      'postgres://user:pw@host/db',
      'md:?motherduck_token=abc',
      '/var/secrets/token',
    ]) {
      await expect(
        admin.post('/api/install_app', {
          manifest: {
            row_id: `appsrc-secret-${url_env.length}`,
            sources: [{ row_id: 'appsrc-secret-src', engine: 'postgres', url_env }],
          },
        }),
      ).rejects.toMatchObject({ status: 417 })
    }
  })
})

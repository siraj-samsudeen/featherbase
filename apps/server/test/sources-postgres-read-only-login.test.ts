// A Postgres Data Source reached through a read-only login that owns none of
// the tables, as a vendor's database usually grants. information_schema's
// constraint views list only tables the login owns, so keys must come from
// pg_constraint or every table reads as having no primary key.
//
// Commits for real: the schema and the probe role live outside the sandbox
// (the driver connects through its own pool), and are dropped in afterAll.
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect } from 'vitest'
import postgres from 'postgres'
import { test } from './pg-test'
import { EXTERNAL_DATABASE_URL } from './external-database'
import { invalidateSources } from '../src/sources/registry'
import type { ReflectionCandidate } from '../src/sources/reflect'

const SCHEMA = 'ext_read_only_login'
const URL_ENV = 'EXT_READ_ONLY_LOGIN_URL'
// Roles are cluster-wide and test databases share a cluster: unique per run.
const READER = `ext_reader_${randomBytes(6).toString('hex')}`
const READER_PASSWORD = randomBytes(24).toString('hex')

let owner: ReturnType<typeof postgres>

beforeAll(async () => {
  owner = postgres(EXTERNAL_DATABASE_URL, { max: 1, onnotice: () => {} })
  await owner.unsafe(`drop schema if exists ${SCHEMA} cascade`)
  await owner.unsafe(`create schema ${SCHEMA};
    create table ${SCHEMA}.shop (id bigint primary key, name text);
    insert into ${SCHEMA}.shop values (1, 'North')`)
  await owner.unsafe(`create role ${READER} login password '${READER_PASSWORD}';
    grant usage on schema ${SCHEMA} to ${READER};
    grant select on all tables in schema ${SCHEMA} to ${READER}`)
  const url = new URL(EXTERNAL_DATABASE_URL)
  url.username = READER
  url.password = READER_PASSWORD
  process.env[URL_ENV] = url.toString()
})

afterAll(async () => {
  invalidateSources()
  delete process.env[URL_ENV]
  await owner.unsafe(`drop schema if exists ${SCHEMA} cascade`)
  await owner.unsafe(`drop role if exists ${READER}`)
  await owner.end({ timeout: 2 })
})

describe('a read-only login that owns no tables', () => {
  test('sees each primary key and can connect the table', async ({ admin }) => {
    invalidateSources()
    await admin.post('/api/table/Data%20Source', {
      row_id: 'read-only-login', engine: 'postgres', url_env: URL_ENV,
      default_schema: SCHEMA, access: 'read_only',
    })
    const preview = await admin.get<{ tables: ReflectionCandidate[] }>(
      `/api/table/Data%20Source/read-only-login:introspect?schema=${SCHEMA}`,
    )
    expect(preview.tables.find((t) => t.table === 'shop')).toMatchObject({ pk: 'id', bindable: true })
    const reflected = await admin.post<{ created: { name: string }[] }>(
      '/api/table/Data%20Source/read-only-login:reflect', { schema: SCHEMA, tables: ['shop'] },
    )
    expect(reflected.created).toHaveLength(1)
    expect(await admin.get(`/api/table/${encodeURIComponent(reflected.created[0].name)}?fields=${encodeURIComponent('["row_id","name"]')}`))
      .toMatchObject({ data: [{ row_id: '1', name: 'North' }] })
  })
})

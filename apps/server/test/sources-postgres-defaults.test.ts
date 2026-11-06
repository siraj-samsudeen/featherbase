// Connecting a table gives it sensible defaults (#796): a title column picked
// by name, a list of the title and a few data columns (never the key or the
// created/updated bookkeeping), and a foreign key to a table not connected
// yet kept on the column so the form can say so.
//
// Commits for real: the foreign schema lives outside the sandbox (the driver
// connects through its own pool), and is dropped in afterAll.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { test } from './pg-test'
import { EXTERNAL_DATABASE_URL } from './external-database'
import { invalidateSources } from '../src/sources/registry'
import { connectDefaults } from '../src/sources/reflect'

const SCHEMA = 'ext_defaults'
const URL_ENV = 'EXT_DEFAULTS_URL'
process.env[URL_ENV] = EXTERNAL_DATABASE_URL

let cli: ReturnType<typeof postgres>

beforeAll(async () => {
  cli = postgres(EXTERNAL_DATABASE_URL, { max: 1, onnotice: () => {} })
  await cli.unsafe(`drop schema if exists ${SCHEMA} cascade`)
  await cli.unsafe(`create schema ${SCHEMA};
    create table ${SCHEMA}.rack (
      id bigint primary key, created_on timestamptz default now(), updated_by_id bigint,
      code text, label text, name text, aisle text, size text, colour text);
    create table ${SCHEMA}.crate (id bigint primary key, rack_id bigint references ${SCHEMA}.rack(id), weight int);
    insert into ${SCHEMA}.rack (id, code, label, name) values (1, 'R-1', 'Upper', 'Rack one');
    insert into ${SCHEMA}.crate values (5, 1, 12)`)
})

afterAll(async () => {
  invalidateSources()
  await cli.unsafe(`drop schema if exists ${SCHEMA} cascade`)
  await cli.end({ timeout: 2 })
})

type Meta = {
  title_column: string | null
  columns: { column_name: string; in_list_view: boolean; column_type: string; source_fk_schema?: string | null; source_fk_table?: string | null }[]
}

async function connect(admin: { post: <T>(p: string, b: unknown) => Promise<T> }, tables: string[]) {
  invalidateSources()
  await admin.post('/api/table/Data%20Source', {
    row_id: 'defaults', engine: 'postgres', url_env: URL_ENV, default_schema: SCHEMA, access: 'read_only',
  })
  await admin.post('/api/table/Data%20Source/defaults:reflect', {
    schema: SCHEMA, tables, names: { rack: 'Rack', crate: 'Crate' },
  })
}

describe('the defaults a connected table gets', () => {
  it('picks the title by preference, not source order, and lists it with four more data columns', () => {
    const names = ['created_on', 'updated_by_id', 'code', 'label', 'name', 'aisle', 'size', 'colour']
    const { title, listed } = connectDefaults(names)
    expect(names[title!]).toBe('name')
    expect([...listed].sort().map((i) => names[i])).toEqual(['code', 'label', 'name', 'aisle', 'size'])
  })

  it('leaves the title unset when no column names a row', () => {
    expect(connectDefaults(['weight', 'Created_At', 'deleted_by']).title).toBeUndefined()
    expect([...connectDefaults(['weight', 'Created_At', 'deleted_by']).listed]).toEqual([0])
  })

  test('a connected table reads by its name column and lists what a row is about', async ({ admin }) => {
    await connect(admin, ['rack'])
    const meta = await admin.get<Meta>('/api/table/Rack:meta')
    expect(meta.title_column).toBe('name')
    expect(meta.columns.filter((c) => c.in_list_view).map((c) => c.column_name))
      .toEqual(['code', 'label', 'name', 'aisle', 'size'])
  })

  test('a foreign key to a table not connected yet is kept on the column, unlinked', async ({ admin }) => {
    await connect(admin, ['crate'])
    const meta = await admin.get<Meta>('/api/table/Crate:meta')
    expect(meta.title_column).toBeNull()
    expect(meta.columns.find((c) => c.column_name === 'rack_id'))
      .toMatchObject({ column_type: 'Int', source_fk_schema: SCHEMA, source_fk_table: 'rack' })
  })
})

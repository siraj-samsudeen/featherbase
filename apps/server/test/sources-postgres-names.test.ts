// Connected tables read as names a person uses: the builder picks each
// Table's name on reflection, a foreign key's label names what it points at,
// and a link to a connected row shows that row's title, not its id.
//
// Commits for real: the foreign schema lives outside the sandbox (the driver
// connects through its own pool), and is dropped in afterAll.
import { afterAll, beforeAll, describe, expect } from 'vitest'
import postgres from 'postgres'
import { test } from './pg-test'
import { EXTERNAL_DATABASE_URL } from './external-database'
import { invalidateSources } from '../src/sources/registry'

const SCHEMA = 'ext_names'
const URL_ENV = 'EXT_NAMES_URL'
process.env[URL_ENV] = EXTERNAL_DATABASE_URL

let cli: ReturnType<typeof postgres>

beforeAll(async () => {
  cli = postgres(EXTERNAL_DATABASE_URL, { max: 1, onnotice: () => {} })
  await cli.unsafe(`drop schema if exists ${SCHEMA} cascade`)
  await cli.unsafe(`create schema ${SCHEMA};
    create table ${SCHEMA}.app_shelf (id bigint primary key, label text);
    create table ${SCHEMA}.app_shelfbin (code text primary key, shelf_id bigint references ${SCHEMA}.app_shelf(id));
    insert into ${SCHEMA}.app_shelf values (7, 'Top');
    insert into ${SCHEMA}.app_shelfbin values ('b1', 7)`)
})

afterAll(async () => {
  invalidateSources()
  await cli.unsafe(`drop schema if exists ${SCHEMA} cascade`)
  await cli.end({ timeout: 2 })
})

async function reflectBoth(admin: { post: <T>(p: string, b: unknown) => Promise<T> }) {
  invalidateSources()
  await admin.post('/api/table/Data%20Source', {
    row_id: 'names', engine: 'postgres', url_env: URL_ENV, default_schema: SCHEMA, access: 'read_only',
  })
  return admin.post<{ created: { name: string }[] }>('/api/table/Data%20Source/names:reflect', {
    schema: SCHEMA, tables: ['app_shelf', 'app_shelfbin'], names: { app_shelf: 'Shelf', app_shelfbin: 'Bin' },
  })
}

describe('connected tables read as names', () => {
  test('each Table takes the name the builder chose', async ({ admin }) => {
    expect((await reflectBoth(admin)).created.map((c) => c.name)).toEqual(['Shelf', 'Bin'])
  })

  test("a foreign key's label names what it points at", async ({ admin }) => {
    await reflectBoth(admin)
    const meta = await admin.get<{ columns: { column_name: string; label: string; column_type: string }[] }>(
      '/api/table/Bin:meta',
    )
    expect(meta.columns.find((c) => c.column_name === 'shelf_id')).toMatchObject({ column_type: 'Reference', label: 'Shelf' })
  })

  test('a link to a connected row reads as its title', async ({ admin }) => {
    await reflectBoth(admin)
    expect(await admin.post('/api/row_titles', { rows: [{ table: 'Shelf', row_id: '7' }, { table: 'Shelf', row_id: '404' }] }))
      .toEqual({ titles: [{ table: 'Shelf', row_id: '7', title: 'Top' }] })
  })
})

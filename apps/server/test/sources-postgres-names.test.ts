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
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'
import { grantRole, makeTable } from './fixtures'

const SCHEMA = 'ext_names'
const URL_ENV = 'EXT_NAMES_URL'
process.env[URL_ENV] = EXTERNAL_DATABASE_URL

let cli: ReturnType<typeof postgres>

beforeAll(async () => {
  cli = postgres(EXTERNAL_DATABASE_URL, { max: 1, onnotice: () => {} })
  await cli.unsafe(`drop schema if exists ${SCHEMA} cascade`)
  await cli.unsafe(`create schema ${SCHEMA};
    create table ${SCHEMA}.app_shelf (id bigint primary key, label text, private_note text);
    create table ${SCHEMA}.app_shelfbin (code text primary key, shelf_id bigint references ${SCHEMA}.app_shelf(id));
    create table ${SCHEMA}.app_shelftag (code text primary key, id bigint references ${SCHEMA}.app_shelf(id));
    insert into ${SCHEMA}.app_shelf values (7, 'Top', 'Private shelf note');
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

  test.for(['label', 'private_note'] as const)('a basic reader gets a readable connected title with title_column %s', async (title_column, { admin, createUser }) => {
    await reflectBoth(admin)
    await makeTable(admin, {
      name: 'Scoped Shelf', data_source: 'names', external_schema: SCHEMA,
      external_table: 'app_shelf', external_pk: 'id', title_column,
      columns: [
        { column_name: 'private_note', column_type: 'Data', tier: 'restricted' },
        'label',
      ],
    })
    await grantRole(admin, { role: 'Shelf Reader', table: 'Scoped Shelf', can_read: true })
    const reader = await createUser({ roles: ['Shelf Reader'] })
    const rows = [{ table: 'Scoped Shelf', row_id: '7' }]
    expect(await reader.post('/api/row_titles', { rows }))
      .toEqual({ titles: [{ table: 'Scoped Shelf', row_id: '7', title: 'Top' }] })
    expect(await admin.post('/api/row_titles', { rows }))
      .toEqual({ titles: [{ table: 'Scoped Shelf', row_id: '7', title: title_column === 'label' ? 'Top' : 'Private shelf note' }] })
  })

  test('a blank or unusable choice keeps the proposed name, and a schema-qualified choice is honoured', async ({ admin }) => {
    invalidateSources()
    await admin.post('/api/table/Data%20Source', {
      row_id: 'names', engine: 'postgres', url_env: URL_ENV, default_schema: SCHEMA, access: 'read_only',
    })
    const reflected = await admin.post<{ created: { name: string; source_table: string }[] }>(
      '/api/table/Data%20Source/names:reflect',
      { schema: SCHEMA, tables: ['app_shelf', `${SCHEMA}.app_shelfbin`], names: { app_shelf: '  ', app_shelfbin: 'Bin', other: 3 } },
    )
    expect(reflected.created.map((c) => c.name)).toEqual(['Ext App Shelf', 'Bin'])
    const ignored = await admin.post<{ created: { name: string }[] }>('/api/table/Data%20Source/names:reflect', {
      schema: SCHEMA, tables: ['app_shelftag'], names: ['Tag'],
    })
    expect(ignored.created.map((c) => c.name)).toEqual(['Ext App Shelftag'])
  })

  test('a foreign key that is the row\'s own id keeps its label', async ({ admin }) => {
    invalidateSources()
    await admin.post('/api/table/Data%20Source', {
      row_id: 'names', engine: 'postgres', url_env: URL_ENV, default_schema: SCHEMA, access: 'read_only',
    })
    await admin.post('/api/table/Data%20Source/names:reflect', {
      schema: SCHEMA, tables: ['app_shelf', 'app_shelftag'], names: { app_shelf: 'Shelf', app_shelftag: 'Tag' },
    })
    const meta = await admin.get<{ columns: { column_name: string; label: string }[] }>('/api/table/Tag:meta')
    expect(meta.columns.find((c) => c.column_name === 'id')?.label).toBe('ID')
  })

  // #1020: Bin's one value is a link, and a link's value is another row's key.
  test('a row whose only value is a link reads as its Table and its own key', async ({ admin }) => {
    await reflectBoth(admin)
    expect(await admin.post('/api/row_titles', { rows: [{ table: 'Bin', row_id: 'b1' }] }))
      .toEqual({ titles: [{ table: 'Bin', row_id: 'b1', title: 'Bin · b1' }] })
  })

  test.for([['label', 'Top'], ['retired_column', 'Top']] as const)(
    "a connected row's title column %s is used only when it is read",
    async ([titleColumn, title], { admin }) => {
      await reflectBoth(admin)
      await sql`insert into metadata_override (row_id, table_name, property, value)
        values ('shelf-title', 'Shelf', 'title_column', ${titleColumn})`
      invalidateMeta('Shelf')
      expect(await admin.post('/api/row_titles', { rows: [{ table: 'Shelf', row_id: '7' }] }))
        .toEqual({ titles: [{ table: 'Shelf', row_id: '7', title }] })
    },
  )

  test('a missing connected row has no title', async ({ admin }) => {
    await reflectBoth(admin)
    expect(await admin.post('/api/row_titles', { rows: [{ table: 'Shelf', row_id: '404' }] })).toEqual({ titles: [] })
  })

  test('the titles of a source that cannot be reached are left out', async ({ admin }) => {
    await reflectBoth(admin)
    process.env[URL_ENV] = 'postgres://nobody:nothing@127.0.0.1:1/none'
    invalidateSources()
    try {
      expect(await admin.post('/api/row_titles', { rows: [{ table: 'Shelf', row_id: '7' }] })).toEqual({ titles: [] })
    } finally {
      process.env[URL_ENV] = EXTERNAL_DATABASE_URL
      invalidateSources()
    }
  })
})

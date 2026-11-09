import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { expectStatus } from './fixtures'

const DT = 'Ddl Test Task'
const CHILD = 'Ddl Test Row'

test('#251 refuses a mismatched body name before replacing either definition', async ({ admin }) => {
  const names = ['Rename Source', 'Rename Target']
  const definitions = []
  for (const name of names) {
    await admin.post('/api/table_def', { name, columns: [
      { column_name: 'title', column_type: 'Data' },
      { column_name: 'amount', column_type: 'Int' },
    ] })
    await admin.post('/api/save_row', { table: name, row: { title: name, amount: 17 } })
    definitions.push(await admin.get(`/api/table/${encodeURIComponent(name)}:meta`))
  }
  const before = await sql`select * from featherbase.rename_source union all select * from featherbase.rename_target order by title`
  const response = await admin.fetch('/api/table_def/Rename%20Source', {
    method: 'PUT', body: JSON.stringify({ name: names[1], columns: [{ column_name: 'title', column_type: 'Data' }] }),
  })
  await expectStatus(response, 417)
  expect(await response.json()).toMatchObject({ error: { type: 'ValidationError' } })
  for (const [i, name] of names.entries())
    expect(await admin.get(`/api/table/${encodeURIComponent(name)}:meta`)).toEqual(definitions[i])
  expect(await sql`select * from featherbase.rename_source union all select * from featherbase.rename_target order by title`).toEqual(before)
  for (const name of [undefined, names[0]]) {
    const response = await admin.fetch('/api/table_def/Rename%20Source', {
      method: 'PUT', body: JSON.stringify({ name, columns: [
        { column_name: 'title', column_type: 'Data' }, { column_name: 'amount', column_type: 'Int' },
      ] }),
    })
    await expectStatus(response, 200)
  }
})

async function columns(table: string): Promise<Record<string, string>> {
  const rows = await sql`
    select column_name, data_type from information_schema.columns
    where table_schema = 'featherbase' and table_name = ${table}`
  return Object.fromEntries(rows.map((r) => [r.column_name, r.data_type]))
}

describe('META-003: Table save generates its physical table', () => {
  test('creates <name> with standard + column columns of correct types', async ({ admin }) => {
    const res = await admin.fetch('/api/table_def', {
      method: 'POST',
      body: JSON.stringify({
        name: DT,
        columns: [
          { column_name: 'title', column_type: 'Data', reqd: true },
          { column_name: 'qty', column_type: 'Int' },
          { column_name: 'rate', column_type: 'Currency' },
          { column_name: 'due', column_type: 'Date' },
          { column_name: 'done', column_type: 'Check' },
          { column_name: 'meta_info', column_type: 'JSON' },
          { column_name: 'sec', column_type: 'Section Break' },
          { column_name: 'code', column_type: 'Data', unique: true },
        ],
      }),
    })
    await expectStatus(res, 201)

    const cols = await columns('ddl_test_task')
    expect(cols).toMatchObject({
      row_id: 'character varying',
      created_by: 'character varying',
      created_at: 'timestamp with time zone',
      updated_at: 'timestamp with time zone',
      updated_by: 'character varying',
      submission_status: 'text',
      position: 'integer',
      title: 'character varying',
      qty: 'bigint',
      rate: 'numeric',
      due: 'date',
      done: 'boolean',
      meta_info: 'jsonb',
      code: 'character varying',
    })
    expect(cols.sec).toBeUndefined()

    await sql.unsafe(
      `insert into featherbase.ddl_test_task (row_id, code) values ('a', 'X'), ('b', 'X')`,
    ).then(
      () => {
        throw new Error('unique constraint not enforced')
      },
      (e) => expect(String(e)).toMatch(/unique/i),
    )
  })

  test('child Tables (kind: sub_table) get parent linkage columns and index', async ({ admin }) => {
    const res = await admin.fetch('/api/table_def', {
      method: 'POST',
      body: JSON.stringify({
        name: CHILD,
        kind: 'sub_table',
        columns: [{ column_name: 'item', column_type: 'Data' }],
      }),
    })
    await expectStatus(res, 201)
    const cols = await columns('ddl_test_row')
    expect(cols).toMatchObject({
      parent: 'character varying',
      parenttype: 'character varying',
      parentfield: 'character varying',
      item: 'character varying',
    })
  })

  // #137: a physical table with no table_def row used to reach DDL and come
  // back as a raw Postgres `relation "ddl_ghost" already exists` — a 500 for
  // what is really a naming conflict. createTable now asks the database for
  // the name first and refuses with a 409. The 500 this once asserted was the
  // symptom the #137 review set out to remove, so the expectation moves with
  // the behaviour; the transactional guarantee it also covered is kept alive
  // by the test below, which fails DDL a way the name check cannot see.
  test('refuses a name already taken by a raw table, before any DDL', async ({ admin }) => {
    await sql.unsafe(`create table if not exists featherbase.ddl_ghost (row_id text)`)
    const res = await admin.fetch('/api/table_def', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Ddl Ghost',
        columns: [{ column_name: 'x', column_type: 'Data' }],
      }),
    })
    await expectStatus(res, 409)
    const [row] = await sql`select 1 from table_def where name = 'Ddl Ghost'`
    expect(row).toBeUndefined()
  })

  // #906: "Site" was refused because a builder's Table once shared `public`
  // with the host registry `public.site`. Tables now live in the platform
  // schema, so "Site" is featherbase.site and the registry is left alone.
  test('builds a Table named Site beside the host registry', async ({ admin }) => {
    const registry = () => sql`select * from public.site order by 1`
    const before = await registry()
    const res = await admin.fetch('/api/table_def', {
      method: 'POST',
      body: JSON.stringify({ name: 'Site', columns: [{ column_name: 'site_name', column_type: 'Data' }] }),
    })
    await expectStatus(res, 201)
    await admin.post('/api/save_row', { table: 'Site', row: { site_name: 'Riverside' } })
    expect(await sql`select site_name from featherbase.site`).toEqual([{ site_name: 'Riverside' }])
    expect(await registry()).toEqual(before)
  })

  test('rolls back metadata when DDL fails (transactional)', async ({ admin }) => {
    // A composite type occupies the same pg_class namespace as a table, so
    // `create table ddl_ghost2` still fails — but it is NOT an
    // information_schema.tables row, so the name check above lets this
    // through and the failure happens where we want it: inside the DDL, after
    // the table_def row has been written. Metadata must not survive it.
    await sql.unsafe(`create type featherbase.ddl_ghost2 as (a int)`)
    const res = await admin.fetch('/api/table_def', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Ddl Ghost2',
        columns: [{ column_name: 'x', column_type: 'Data' }],
      }),
    })
    await expectStatus(res, 500)
    const [row] = await sql`select 1 from table_def where name = 'Ddl Ghost2'`
    expect(row).toBeUndefined()
  })
})

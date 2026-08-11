import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'

const DT = 'Ddl Test Task'
const CHILD = 'Ddl Test Row'

async function columns(table: string): Promise<Record<string, string>> {
  const rows = await sql`
    select column_name, data_type from information_schema.columns
    where table_name = ${table}`
  return Object.fromEntries(rows.map((r) => [r.column_name, r.data_type]))
}

describe('META-003: Table save generates its physical table', () => {
  test('creates <name> with standard + column columns of correct types', async ({ admin }) => {
    const res = await admin.fetch('/api/doctype', {
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
    expect(res.status).toBe(201)

    const cols = await columns('ddl_test_task')
    expect(cols).toMatchObject({
      name: 'character varying',
      created_by: 'character varying',
      created_at: 'timestamp with time zone',
      updated_at: 'timestamp with time zone',
      updated_by: 'character varying',
      status: 'text',
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
      `insert into ddl_test_task (name, code) values ('a', 'X'), ('b', 'X')`,
    ).then(
      () => {
        throw new Error('unique constraint not enforced')
      },
      (e) => expect(String(e)).toMatch(/unique/i),
    )
  })

  test('child Tables (kind: sub_table) get parent linkage columns and index', async ({ admin }) => {
    const res = await admin.fetch('/api/doctype', {
      method: 'POST',
      body: JSON.stringify({
        name: CHILD,
        kind: 'sub_table',
        columns: [{ column_name: 'item', column_type: 'Data' }],
      }),
    })
    expect(res.status).toBe(201)
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
    await sql.unsafe(`create table if not exists ddl_ghost (name text)`)
    const res = await admin.fetch('/api/doctype', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Ddl Ghost',
        columns: [{ column_name: 'x', column_type: 'Data' }],
      }),
    })
    expect(res.status).toBe(409)
    const [row] = await sql`select 1 from table_def where name = 'Ddl Ghost'`
    expect(row).toBeUndefined()
  })

  test('rolls back metadata when DDL fails (transactional)', async ({ admin }) => {
    // A composite type occupies the same pg_class namespace as a table, so
    // `create table ddl_ghost2` still fails — but it is NOT an
    // information_schema.tables row, so the name check above lets this
    // through and the failure happens where we want it: inside the DDL, after
    // the table_def row has been written. Metadata must not survive it.
    await sql.unsafe(`create type ddl_ghost2 as (a int)`)
    const res = await admin.fetch('/api/doctype', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Ddl Ghost2',
        columns: [{ column_name: 'x', column_type: 'Data' }],
      }),
    })
    expect(res.status).toBe(500)
    const [row] = await sql`select 1 from table_def where name = 'Ddl Ghost2'`
    expect(row).toBeUndefined()
  })
})

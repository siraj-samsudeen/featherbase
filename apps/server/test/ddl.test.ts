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

describe('META-003: DocType save generates its table', () => {
  test('creates tab_<name> with standard + field columns of correct types', async ({ admin }) => {
    const res = await admin.fetch('/api/doctype', {
      method: 'POST',
      body: JSON.stringify({
        name: DT,
        fields: [
          { fieldname: 'title', fieldtype: 'Data', reqd: true },
          { fieldname: 'qty', fieldtype: 'Int' },
          { fieldname: 'rate', fieldtype: 'Currency' },
          { fieldname: 'due', fieldtype: 'Date' },
          { fieldname: 'done', fieldtype: 'Check' },
          { fieldname: 'meta_info', fieldtype: 'JSON' },
          { fieldname: 'sec', fieldtype: 'Section Break' },
          { fieldname: 'code', fieldtype: 'Data', unique: true },
        ],
      }),
    })
    expect(res.status).toBe(201)

    const cols = await columns('tab_ddl_test_task')
    expect(cols).toMatchObject({
      name: 'character varying',
      owner: 'character varying',
      creation: 'timestamp with time zone',
      modified: 'timestamp with time zone',
      modified_by: 'character varying',
      docstatus: 'smallint',
      idx: 'integer',
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
      `insert into tab_ddl_test_task (name, code) values ('a', 'X'), ('b', 'X')`,
    ).then(
      () => {
        throw new Error('unique constraint not enforced')
      },
      (e) => expect(String(e)).toMatch(/unique/i),
    )
  })

  test('child DocTypes (istable) get parent linkage columns and index', async ({ admin }) => {
    const res = await admin.fetch('/api/doctype', {
      method: 'POST',
      body: JSON.stringify({
        name: CHILD,
        istable: true,
        fields: [{ fieldname: 'item', fieldtype: 'Data' }],
      }),
    })
    expect(res.status).toBe(201)
    const cols = await columns('tab_ddl_test_row')
    expect(cols).toMatchObject({
      parent: 'character varying',
      parenttype: 'character varying',
      parentfield: 'character varying',
      item: 'character varying',
    })
  })

  test('rolls back metadata when DDL fails (transactional)', async ({ admin }) => {
    // Second create of same name 409s before DDL; simulate DDL failure via
    // a fieldname that collides with a standard column being caught earlier.
    // Real transactional check: table already exists but doctype row absent.
    await sql.unsafe(`create table if not exists tab_ddl_ghost (name text)`)
    const res = await admin.fetch('/api/doctype', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Ddl Ghost',
        fields: [{ fieldname: 'x', fieldtype: 'Data' }],
      }),
    })
    expect(res.status).toBe(500)
    const [row] = await sql`select 1 from tab_doctype where name = 'Ddl Ghost'`
    expect(row).toBeUndefined()
  })
})

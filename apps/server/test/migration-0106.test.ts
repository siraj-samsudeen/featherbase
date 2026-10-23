// Migration 0106 (#408, person-resolution task 2.1): the `employee_code` and
// `stylehr_username` Custom Fields on Person are dropped — their Custom Field
// records, their column_def rows and the columns. Sales-target scoping reads
// the person's current employee-code identifier rows instead.
import { readFileSync } from 'node:fs'
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { applyCustomField } from '../src/custom-fields'
import { invalidateMeta } from '../src/meta'
import { makePerson } from './fixtures'

const MIGRATION = readFileSync(new URL('../migrations/0106_drop_person_code_custom_fields.sql', import.meta.url), 'utf8')
const FIELDS = ['employee_code', 'stylehr_username']

async function personColumns(): Promise<string[]> {
  const rows = await sql`select column_name from information_schema.columns where table_schema = 'featherbase' and table_name = 'person'`
  return rows.map((r) => String(r.column_name))
}

describe('0106: the Person code Custom Fields are gone', () => {
  test('drops the records, the column_def rows and the columns; every other Person field stays', async ({ admin }) => {
    for (const column_name of FIELDS) {
      await sql`insert into custom_field (row_id, dt, column_name, label, column_type) values (${`Person-${column_name}`}, 'Person', ${column_name}, ${column_name}, 'Data')`
      await applyCustomField({ dt: 'Person', column_name, label: column_name, column_type: 'Data' })
    }
    const p = await makePerson({ full_name: 'Code Holder' })
    await sql`update person set employee_code = 'RR-0101', stylehr_username = 'RR-0101' where row_id = ${p}`
    expect(await personColumns()).toEqual(expect.arrayContaining(FIELDS))

    await sql.unsafe(MIGRATION)
    invalidateMeta()

    expect(await personColumns()).not.toEqual(expect.arrayContaining([FIELDS[0]]))
    expect(await personColumns()).not.toEqual(expect.arrayContaining([FIELDS[1]]))
    expect(await sql`select 1 from custom_field where dt = 'Person' and column_name in ('employee_code', 'stylehr_username')`).toHaveLength(0)
    expect(await sql`select 1 from column_def where parent = 'Person' and column_name in ('employee_code', 'stylehr_username')`).toHaveLength(0)
    const meta = await admin.get<{ columns: { column_name: string }[] }>('/api/table/Person:meta')
    expect(meta.columns.map((c) => c.column_name)).not.toContain('employee_code')
    expect((await admin.get<{ full_name: string }>(`/api/table/Person/${p}`)).full_name).toBe('Code Holder')
  })

  test('is a no-op on an instance that never had them (prod)', async () => {
    const before = await personColumns()
    await sql.unsafe(MIGRATION)
    expect(await personColumns()).toEqual(before)
  })
})

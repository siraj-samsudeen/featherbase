// Migration 0111 (#451): Query Reports are gone. The Report Type choice keeps
// Report Builder and Script Report, and the query text column goes with its
// column_def. A database still holding a Query Report stops the migration.
import { readFileSync } from 'node:fs'
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { invalidateMeta } from '../src/meta'

const MIGRATION = readFileSync(new URL('../migrations/0111_remove_query_reports.sql', import.meta.url), 'utf8')

// Put back what 0026/0030 left on a database migrated before #451.
async function restoreQueryReports() {
  await sql`alter table report add column if not exists query text`
  await sql`update column_def set choices = ${'Report Builder\nQuery Report\nScript Report'}
    where parent = 'Report' and column_name = 'report_type'`
  const [{ position }] = await sql`select coalesce(max(position), 0)::int + 1 as position from column_def where parent = 'Report'`
  await sql`insert into column_def ${sql({
    parent: 'Report', position, column_name: 'query', label: 'Query', column_type: 'Long Text',
    reqd: false, unique: false, read_only: false, hidden: false, in_list_view: false, tier: 'basic',
  })}`
  invalidateMeta()
}

async function reportShape() {
  const [choice] = await sql`select choices from column_def where parent = 'Report' and column_name = 'report_type'`
  const columns = await sql`select column_name from information_schema.columns
    where table_schema = 'featherbase' and table_name = 'report' and column_name = 'query'`
  const defs = await sql`select 1 from column_def where parent = 'Report' and column_name = 'query'`
  return { choices: choice.choices, queryColumn: columns.length, queryDef: defs.length }
}

describe('0111: Query Reports are removed', () => {
  test('a fresh database has no Query Report choice and no query column', async () => {
    expect(await reportShape()).toEqual({ choices: 'Report Builder\nScript Report', queryColumn: 0, queryDef: 0 })
  })

  test('an upgraded database loses the choice, the column and its column_def; other reports stay', async ({ admin }) => {
    await restoreQueryReports()
    await sql`insert into report (row_id, ref_table, report_type, query) values ('Kept builder', 'Person', 'Report Builder', null)`
    await sql.unsafe(MIGRATION)
    invalidateMeta()
    expect(await reportShape()).toEqual({ choices: 'Report Builder\nScript Report', queryColumn: 0, queryDef: 0 })
    expect(await admin.get('/api/table/Report/Kept%20builder')).toMatchObject({ report_type: 'Report Builder' })
  })

  test('a remaining Query Report stops the migration, naming it', async () => {
    await restoreQueryReports()
    await sql`insert into report (row_id, ref_table, report_type, query) values ('Old SQL', 'Person', 'Query Report', 'select 1')`
    await expect(sql.unsafe(MIGRATION)).rejects.toThrow(/still has Old SQL/)
  })
})

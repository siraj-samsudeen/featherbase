// Migration 0126 (#446): a row's history, comments, shares, assignments,
// notifications and workflow steps are found by the row's Table and id
// through an index, not by scanning the whole store.
import { readFileSync } from 'node:fs'
import { expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'

const MIGRATION = readFileSync(new URL('../migrations/0126_row_history_index.sql', import.meta.url), 'utf8')
const INDEXES = [
  ['version', 'version_ref_idx', 'ref_table, ref_name'],
  ['comment', 'comment_ref_idx', 'ref_table, ref_name'],
  ['share', 'share_ref_idx', 'share_table, share_name'],
  ['todo', 'todo_ref_idx', 'ref_table, reference_name'],
  ['notification_log', 'notification_log_ref_idx', 'ref_table, ref_name'],
  ['workflow_action', 'workflow_action_ref_idx', 'ref_table, ref_name'],
] as const

async function plan(query: string): Promise<string> {
  const rows = await sql.unsafe(`explain ${query}`)
  return rows.map((r) => String(r['QUERY PLAN'])).join('\n')
}

test('the timeline and share lookups use an index on the row, and the migration converges', async () => {
  // A migrated database already has them; drop them to watch 0126 add them back.
  for (const [, index] of INDEXES) await sql.unsafe(`drop index if exists featherbase.${index}`)
  await sql.unsafe('set local search_path = featherbase, pg_temp')
  await sql.unsafe(MIGRATION)
  await sql.unsafe(MIGRATION)
  for (const [relation, index, columns] of INDEXES) {
    const [row] = await sql`select indexdef from pg_indexes where schemaname = 'featherbase' and indexname = ${index}`
    expect(row?.indexdef).toBe(`CREATE INDEX ${index} ON featherbase.${relation} USING btree (${columns})`)
  }
  // The stores are tiny in a test database, so the planner would scan them
  // anyway; with scans priced out, the plan shows the index is usable.
  await sql.unsafe('set local enable_seqscan = off')
  expect(await plan(`select data from version where ref_table = 'Customer' and ref_name = 'Acme' order by created_at`))
    .toContain('version_ref_idx')
  expect(await plan(`select content from comment where ref_table = 'Customer' and ref_name = 'Acme' order by created_at`))
    .toContain('comment_ref_idx')
  expect(await plan(`select 1 from share where share_table = 'Customer' and share_name = 'Acme'`))
    .toContain('share_ref_idx')
})

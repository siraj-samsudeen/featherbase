// #206 (issue #197): one file-import is one BATCH.
//
// The owner dropped a 17-sheet workbook and, by accident, created eleven
// Tables. "I did not have an easy way to see these tables came from where and
// delete them all in one." The Import Log already recorded every part of
// every run, but nothing tied the runs of ONE file-import together: `run_id`
// is per target (it is what a revert addresses), and `file_name` is a label
// that repeats every time the same file is imported again.
//
// `batch_id` is the missing identity — minted once when a file is read,
// carried by every part of every target in that import. Existing rows get
// null, which reads as "before batches" rather than as one giant batch.
import { sql } from '../src/db'
import { tableName } from '../src/table-engine'
import { invalidateMeta } from '../src/meta'

export async function up() {
  const [log] = await sql`select 1 from table_def where name = 'Import Log'`
  if (!log) return // 0056 not applied — a fresh install gets the shape there

  const [have] =
    await sql`select 1 from column_def where parent = 'Import Log' and column_name = 'batch_id'`
  if (have) return

  const [{ maxidx }] =
    await sql`select coalesce(max(position), 0)::int as maxidx from column_def where parent = 'Import Log'`

  await sql`insert into column_def ${sql({
    parent: 'Import Log',
    position: (maxidx as number) + 1,
    column_name: 'batch_id',
    label: 'Batch',
    column_type: 'Data',
    choices: null,
    reqd: false,
    unique: false,
    read_only: false,
    hidden: false,
    in_list_view: false,
    tier: 'basic',
  })}`
  await sql.unsafe(
    `alter table "${tableName('Import Log')}" add column if not exists "batch_id" varchar(140)`,
  )
  // Grouping a batch is a lookup by this column over the whole log, which
  // grows a row per part per target — an eleven-sheet import is eleven-plus
  // rows on its own.
  await sql.unsafe(
    `create index if not exists "${tableName('Import Log')}_batch_idx" on "${tableName(
      'Import Log',
    )}" ("batch_id")`,
  )
  invalidateMeta('Import Log')
}

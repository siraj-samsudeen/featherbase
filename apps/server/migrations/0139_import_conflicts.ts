// #626: conflict evidence belongs to the platform, never to user rows.
import { sql } from '../src/db'
import { createTable } from '../src/table-engine'
import { invalidateMeta } from '../src/meta'
export async function up() {
  const [existing] = await sql`select 1 from table_def where name = 'Import Conflict'`
  if (!existing) await createTable({ name: 'Import Conflict', module: 'Core', system: true,
    columns: [
      { column_name: 'ref_table', column_type: 'Data' },
      { column_name: 'ref_name', column_type: 'Data' },
      { column_name: 'field', column_type: 'Data' },
      { column_name: 'kept', column_type: 'JSON' },
      { column_name: 'incoming', column_type: 'JSON' },
      { column_name: 'editor', column_type: 'Data' },
      { column_name: 'edited_at', column_type: 'Datetime' },
      { column_name: 'run_id', column_type: 'Data' },
      { column_name: 'closed', column_type: 'Check' },
    ],
  })
  await sql`update table_def set system_written = true, track_changes = false where name = 'Import Conflict'`
  await sql`create index if not exists import_conflict_target_idx on featherbase.import_conflict (ref_table, ref_name, field) where closed is not true`
  const [source] = await sql`select 1 from table_def where name = 'Import Source'`
  if (!source) await createTable({ name: 'Import Source', module: 'Core', system: true, columns: [
    { column_name: 'ref_table', column_type: 'Data' },
    { column_name: 'ref_name', column_type: 'Data' },
    { column_name: 'values', column_type: 'JSON' },
    { column_name: 'run_id', column_type: 'Data' },
  ] })
  await sql`update table_def set system_written = true, track_changes = false where name = 'Import Source'`
  await sql`create index if not exists import_source_target_idx on featherbase.import_source (ref_table, ref_name, created_at desc)`
  invalidateMeta('Import Source')
  invalidateMeta('Import Conflict')
}

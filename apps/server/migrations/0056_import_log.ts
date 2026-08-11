// IMP-011: every bulk import (:import collection action) records what it did
// — which file/sheet, into which Table, how many rows landed or failed — so
// "what did that import just create?" is answerable from the Desk instead of
// archaeology over created_at timestamps.
import { sql } from '../src/db'
import { createTable } from '../src/doctype-engine'

export async function up() {
  // #74: createTable now writes table_def.system on insert. Fresh installs
  // carry the column from 0002; databases already past 0002 get it in 0058 —
  // but a database parked BEFORE this migration would run createTable here
  // without the column and fail. Guard for that window.
  await sql`alter table table_def add column if not exists system boolean not null default false`

  const [exists] = await sql`select 1 from table_def where name = 'Import Log'`
  if (exists) return
  await createTable({
    name: 'Import Log',
    module: 'Core',
    columns: [
      { column_name: 'ref_table', column_type: 'Reference', reference_table: 'Table', reqd: true, in_list_view: true },
      { column_name: 'file_name', column_type: 'Data', in_list_view: true },
      { column_name: 'sheet_name', column_type: 'Data', in_list_view: true },
      { column_name: 'table_created', column_type: 'Check', in_list_view: true },
      { column_name: 'inserted', column_type: 'Int', in_list_view: true },
      // UPS-R1 (spec 0004): upsert runs count updates separately. Existing
      // databases converge in 0069.
      { column_name: 'updated', column_type: 'Int', in_list_view: true },
      { column_name: 'failed', column_type: 'Int', in_list_view: true },
      { column_name: 'error_summary', column_type: 'Text' },
      // UPS-R5: the run's match key and empty-cell choice, stored per Table
      // so the wizard can pre-fill them as a VISIBLE suggestion next time.
      { column_name: 'key_column', column_type: 'Data' },
      { column_name: 'empty_cells', column_type: 'Choice', choices: 'keep\nclear' },
      // A large import arrives in chunks; part/parts tie the rows of one
      // sheet back together (1/3, 2/3, ...).
      { column_name: 'part', column_type: 'Int' },
      { column_name: 'parts', column_type: 'Int' },
      // RVT-R1 (spec 0005): the run identity its parts share, the rows this
      // part wrote, and when the run was reverted. Existing databases
      // converge in 0073.
      { column_name: 'run_id', column_type: 'Data' },
      { column_name: 'touched', column_type: 'JSON', hidden: true },
      { column_name: 'reverted_at', column_type: 'Datetime', in_list_view: true },
    ],
  })
}

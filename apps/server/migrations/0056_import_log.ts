// IMP-011: every bulk import (:import collection action) records what it did
// — which file/sheet, into which Table, how many rows landed or failed — so
// "what did that import just create?" is answerable from the Desk instead of
// archaeology over created_at timestamps.
import { sql } from '../src/db'
import { createTable } from '../src/doctype-engine'

export async function up() {
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
      { column_name: 'failed', column_type: 'Int', in_list_view: true },
      { column_name: 'error_summary', column_type: 'Text' },
      // A large import arrives in chunks; part/parts tie the rows of one
      // sheet back together (1/3, 2/3, ...).
      { column_name: 'part', column_type: 'Int' },
      { column_name: 'parts', column_type: 'Int' },
    ],
  })
}

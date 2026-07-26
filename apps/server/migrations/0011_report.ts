// RPT-002: a saved report is a Report row — Table + the view
// configuration (columns, group_by, filters) as JSON.
import { sql } from '../src/db'
import { createTable } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from table_def where name = 'Report'`
  if (exists) return
  await createTable({
    name: 'Report',
    module: 'Core',
    id_pattern: 'prompt',
    columns: [
      { column_name: 'ref_table', column_type: 'Reference', reference_table: 'Table', reqd: true, in_list_view: true },
      { column_name: 'config', column_type: 'JSON' },
    ],
  })
}

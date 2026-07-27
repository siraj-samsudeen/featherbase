// PRN-002: Print Format — a per-Table template with {{ field }}
// interpolation. `is_default` marks the format chosen when none is named.
import { sql } from '../src/db'
import { createTable } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from table_def where name = 'Print Format'`
  if (exists) return
  await createTable({
    name: 'Print Format',
    module: 'Core',
    id_pattern: 'prompt',
    columns: [
      { column_name: 'ref_table', column_type: 'Reference', reference_table: 'Table', reqd: true, in_list_view: true },
      { column_name: 'is_default', column_type: 'Check', default_value: '0', in_list_view: true },
      { column_name: 'template', column_type: 'Text' },
    ],
  })
}

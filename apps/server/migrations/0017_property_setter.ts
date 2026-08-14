// CUST-002: Property Setters override a row or column property (label,
// hidden, reqd, …) without editing the base definition. They are applied as
// an overlay when metadata loads, so the base column_def rows stay untouched.
import { sql } from '../src/db'
import { createTable } from '../src/table-engine'

export async function up() {
  const [exists] = await sql`select 1 from table_def where name = 'Property Setter'`
  if (exists) return
  await createTable({
    name: 'Property Setter',
    module: 'Core',
    id_pattern: 'prompt',
    columns: [
      { column_name: 'doc_type', column_type: 'Reference', reference_table: 'Table', reqd: true, in_list_view: true },
      // Empty field_name = a Table-level property.
      { column_name: 'field_name', column_type: 'Data', in_list_view: true },
      { column_name: 'property', column_type: 'Data', reqd: true, in_list_view: true },
      { column_name: 'value', column_type: 'Data', in_list_view: true },
    ],
  })
}

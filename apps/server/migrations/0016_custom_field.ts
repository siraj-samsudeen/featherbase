// CUST-001: Custom Fields — fields added to an existing Table, stored
// SEPARATELY from the base definition (in custom_field) so they survive
// a re-seed of core fixtures. Each custom field also materializes a column_def
// row (marked custom) and a real column on the target table.
import { sql } from '../src/db'
import { createTable } from '../src/table-engine'

export async function up() {
  // Mark generated columns as custom so a base re-seed can tell them apart.
  await sql`alter table column_def add column if not exists custom boolean not null default false`

  const [exists] = await sql`select 1 from table_def where name = 'Custom Field'`
  if (exists) return
  await createTable({
    name: 'Custom Field',
    module: 'Core',
    id_pattern: 'prompt',
    columns: [
      { column_name: 'dt', column_type: 'Reference', reference_table: 'Table', reqd: true, in_list_view: true },
      { column_name: 'column_name', column_type: 'Data', reqd: true, in_list_view: true },
      { column_name: 'label', column_type: 'Data', in_list_view: true },
      { column_name: 'column_type', column_type: 'Data', default_value: 'Data', in_list_view: true },
      { column_name: 'reference_table', column_type: 'Data' },
      { column_name: 'choices', column_type: 'Text' },
      { column_name: 'row_table', column_type: 'Data' },
      { column_name: 'reqd', column_type: 'Check', default_value: '0' },
      { column_name: 'in_list_view', column_type: 'Check', default_value: '0' },
    ],
  })
}

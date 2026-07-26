// EML-004: Email Rules (Frappe "Notification") — fire an email on a
// lifecycle event for documents of a DocType matching an optional condition.
import { sql } from '../src/db'
import { createTable } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from table_def where name = 'Email Rule'`
  if (exists) return
  await createTable({
    name: 'Email Rule',
    module: 'Core',
    id_pattern: 'prompt',
    columns: [
      { column_name: 'ref_table', column_type: 'Reference', reference_table: 'Table', reqd: true, in_list_view: true },
      { column_name: 'event', column_type: 'Choice', choices: 'on_create\non_save\non_submit\non_cancel', reqd: true, in_list_view: true },
      // Optional single-field equality condition; blank field = always fire.
      { column_name: 'condition_field', column_type: 'Data' },
      { column_name: 'condition_value', column_type: 'Data' },
      { column_name: 'recipient', column_type: 'Data', reqd: true, in_list_view: true },
      { column_name: 'subject', column_type: 'Data' },
      { column_name: 'message', column_type: 'Text' },
      { column_name: 'enabled', column_type: 'Check', default_value: '1', in_list_view: true },
    ],
  })
}

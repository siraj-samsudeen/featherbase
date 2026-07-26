// WEB-002: Web Forms — a public form mapped to a DocType that creates a
// document on (optionally anonymous) submit.
import { sql } from '../src/db'
import { createTable } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from table_def where name = 'Web Form'`
  if (exists) return
  await createTable({
    name: 'Web Form',
    module: 'Website',
    id_pattern: 'prompt',
    columns: [
      { column_name: 'title', column_type: 'Data', reqd: true, in_list_view: true },
      { column_name: 'route', column_type: 'Data', reqd: true, unique: true, in_list_view: true },
      { column_name: 'document_type', column_type: 'Reference', reference_table: 'Table', reqd: true, in_list_view: true },
      // JSON array of fieldnames from document_type to expose on the form.
      { column_name: 'web_fields', column_type: 'JSON' },
      { column_name: 'published', column_type: 'Check', default_value: '0', in_list_view: true },
      { column_name: 'success_message', column_type: 'Data', default_value: 'Thank you — your submission was received.' },
    ],
  })
}

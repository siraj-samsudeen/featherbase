// SET-001: Single DocTypes (issingle) — settings documents with exactly one
// instance and no generated table. Their field values live in an EAV store
// (single_value), keyed by (doctype, field), like Frappe's `tabSingles`.
import { sql } from '../src/db'
import { createTable } from '../src/doctype-engine'

export async function up() {
  await sql`create table if not exists single_value (
    doctype varchar(140) not null,
    field   varchar(140) not null,
    value   text,
    primary key (doctype, field)
  )`

  const [exists] = await sql`select 1 from table_def where name = 'System Settings'`
  if (exists) return
  await createTable({
    name: 'System Settings',
    module: 'Core',
    kind: 'settings',
    columns: [
      { column_name: 'app_name', column_type: 'Data', default_value: 'Frappe Clone', in_list_view: true },
      { column_name: 'time_zone', column_type: 'Data', default_value: 'UTC' },
      { column_name: 'date_format', column_type: 'Choice', choices: 'yyyy-mm-dd\ndd-mm-yyyy\nmm-dd-yyyy', default_value: 'yyyy-mm-dd' },
      { column_name: 'session_hours', column_type: 'Int', default_value: '8' },
      { column_name: 'allow_signup', column_type: 'Check', default_value: '0' },
    ],
  })
}

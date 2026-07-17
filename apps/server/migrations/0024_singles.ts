// SET-001: Single DocTypes (issingle) — settings documents with exactly one
// instance and no generated table. Their field values live in an EAV store
// (single_value), keyed by (doctype, field), like Frappe's `tabSingles`.
import { sql } from '../src/db'
import { createDocType } from '../src/doctype-engine'

export async function up() {
  await sql`create table if not exists single_value (
    doctype varchar(140) not null,
    field   varchar(140) not null,
    value   text,
    primary key (doctype, field)
  )`

  const [exists] = await sql`select 1 from tab_doctype where name = 'System Settings'`
  if (exists) return
  await createDocType({
    name: 'System Settings',
    module: 'Core',
    issingle: true,
    fields: [
      { fieldname: 'app_name', fieldtype: 'Data', default_value: 'Frappe Clone', in_list_view: true },
      { fieldname: 'time_zone', fieldtype: 'Data', default_value: 'UTC' },
      { fieldname: 'date_format', fieldtype: 'Select', options: 'yyyy-mm-dd\ndd-mm-yyyy\nmm-dd-yyyy', default_value: 'yyyy-mm-dd' },
      { fieldname: 'session_hours', fieldtype: 'Int', default_value: '8' },
      { fieldname: 'allow_signup', fieldtype: 'Check', default_value: '0' },
    ],
  })
}

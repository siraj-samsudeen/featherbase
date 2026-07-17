// WEB-002: Web Forms — a public form mapped to a DocType that creates a
// document on (optionally anonymous) submit.
import { sql } from '../src/db'
import { createDocType } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from tab_doctype where name = 'Web Form'`
  if (exists) return
  await createDocType({
    name: 'Web Form',
    module: 'Website',
    autoname: 'prompt',
    fields: [
      { fieldname: 'title', fieldtype: 'Data', reqd: true, in_list_view: true },
      { fieldname: 'route', fieldtype: 'Data', reqd: true, unique: true, in_list_view: true },
      { fieldname: 'document_type', fieldtype: 'Link', options: 'DocType', reqd: true, in_list_view: true },
      // JSON array of fieldnames from document_type to expose on the form.
      { fieldname: 'web_fields', fieldtype: 'JSON' },
      { fieldname: 'published', fieldtype: 'Check', default_value: '0', in_list_view: true },
      { fieldname: 'success_message', fieldtype: 'Data', default_value: 'Thank you — your submission was received.' },
    ],
  })
}

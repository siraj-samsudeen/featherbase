// PRN-002: Print Format — a per-DocType template with {{ field }}
// interpolation. `is_default` marks the format chosen when none is named.
import { sql } from '../src/db'
import { createDocType } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from tab_doctype where name = 'Print Format'`
  if (exists) return
  await createDocType({
    name: 'Print Format',
    module: 'Core',
    autoname: 'prompt',
    fields: [
      { fieldname: 'doc_type', fieldtype: 'Link', options: 'DocType', reqd: true, in_list_view: true },
      { fieldname: 'is_default', fieldtype: 'Check', default_value: '0', in_list_view: true },
      { fieldname: 'template', fieldtype: 'Text' },
    ],
  })
}

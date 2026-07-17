// CUST-002: Property Setters override a field or DocType property (label,
// hidden, reqd, …) without editing the base definition. They are applied as
// an overlay when metadata loads, so the base docfield rows stay untouched.
import { sql } from '../src/db'
import { createDocType } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from tab_doctype where name = 'Property Setter'`
  if (exists) return
  await createDocType({
    name: 'Property Setter',
    module: 'Core',
    autoname: 'prompt',
    fields: [
      { fieldname: 'doc_type', fieldtype: 'Link', options: 'DocType', reqd: true, in_list_view: true },
      // Empty field_name = a DocType-level property.
      { fieldname: 'field_name', fieldtype: 'Data', in_list_view: true },
      { fieldname: 'property', fieldtype: 'Data', reqd: true, in_list_view: true },
      { fieldname: 'value', fieldtype: 'Data', in_list_view: true },
    ],
  })
}

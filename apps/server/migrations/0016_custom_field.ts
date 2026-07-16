// CUST-001: Custom Fields — fields added to an existing DocType, stored
// SEPARATELY from the base definition (in tab_custom_field) so they survive
// a re-seed of core fixtures. Each custom field also materializes a docfield
// row (marked custom) and a real column on the target table.
import { sql } from '../src/db'
import { createDocType } from '../src/doctype-engine'

export async function up() {
  // Mark generated docfields as custom so a base re-seed can tell them apart.
  await sql`alter table tab_docfield add column if not exists custom boolean not null default false`

  const [exists] = await sql`select 1 from tab_doctype where name = 'Custom Field'`
  if (exists) return
  await createDocType({
    name: 'Custom Field',
    module: 'Core',
    autoname: 'prompt',
    fields: [
      { fieldname: 'dt', fieldtype: 'Link', options: 'DocType', reqd: true, in_list_view: true },
      { fieldname: 'fieldname', fieldtype: 'Data', reqd: true, in_list_view: true },
      { fieldname: 'label', fieldtype: 'Data', in_list_view: true },
      { fieldname: 'fieldtype', fieldtype: 'Data', default_value: 'Data', in_list_view: true },
      { fieldname: 'options', fieldtype: 'Text' },
      { fieldname: 'reqd', fieldtype: 'Check', default_value: '0' },
      { fieldname: 'in_list_view', fieldtype: 'Check', default_value: '0' },
    ],
  })
}

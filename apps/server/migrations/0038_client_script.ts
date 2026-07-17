// CUST-003: Client Scripts — user JS that hooks into form events in the Desk
// (onload, field change, before save). Runs in the browser.
import { sql } from '../src/db'
import { createDocType } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from tab_doctype where name = 'Client Script'`
  if (exists) return
  await createDocType({
    name: 'Client Script',
    module: 'Core',
    autoname: 'prompt',
    fields: [
      { fieldname: 'reference_doctype', fieldtype: 'Link', options: 'DocType', reqd: true, in_list_view: true },
      { fieldname: 'script', fieldtype: 'Long Text', reqd: true },
      { fieldname: 'enabled', fieldtype: 'Check', default_value: '1', in_list_view: true },
    ],
  })
}

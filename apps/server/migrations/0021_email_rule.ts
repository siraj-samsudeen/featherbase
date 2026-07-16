// EML-004: Email Rules (Frappe "Notification") — fire an email on a
// lifecycle event for documents of a DocType matching an optional condition.
import { sql } from '../src/db'
import { createDocType } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from tab_doctype where name = 'Email Rule'`
  if (exists) return
  await createDocType({
    name: 'Email Rule',
    module: 'Core',
    autoname: 'prompt',
    fields: [
      { fieldname: 'document_type', fieldtype: 'Link', options: 'DocType', reqd: true, in_list_view: true },
      { fieldname: 'event', fieldtype: 'Select', options: 'on_create\non_save\non_submit\non_cancel', reqd: true, in_list_view: true },
      // Optional single-field equality condition; blank field = always fire.
      { fieldname: 'condition_field', fieldtype: 'Data' },
      { fieldname: 'condition_value', fieldtype: 'Data' },
      { fieldname: 'recipient', fieldtype: 'Data', reqd: true, in_list_view: true },
      { fieldname: 'subject', fieldtype: 'Data' },
      { fieldname: 'message', fieldtype: 'Text' },
      { fieldname: 'enabled', fieldtype: 'Check', default_value: '1', in_list_view: true },
    ],
  })
}

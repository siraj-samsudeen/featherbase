// CUST-004: Server Scripts — sandboxed user scripts that run on document
// lifecycle events (and, optionally, as callable API methods).
import { sql } from '../src/db'
import { createDocType } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from tab_doctype where name = 'Server Script'`
  if (exists) return
  await createDocType({
    name: 'Server Script',
    module: 'Core',
    autoname: 'prompt',
    fields: [
      { fieldname: 'script_type', fieldtype: 'Select', options: 'Document Event\nAPI', reqd: true, in_list_view: true },
      { fieldname: 'reference_doctype', fieldtype: 'Link', options: 'DocType', in_list_view: true },
      { fieldname: 'event', fieldtype: 'Select', options: 'validate\nbefore_save\nafter_save' },
      { fieldname: 'api_method', fieldtype: 'Data' },
      { fieldname: 'script', fieldtype: 'Long Text', reqd: true },
      { fieldname: 'enabled', fieldtype: 'Check', default_value: '1', in_list_view: true },
    ],
  })
}

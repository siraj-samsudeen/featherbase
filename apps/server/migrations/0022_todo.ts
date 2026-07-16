// EML-006 / UI-017: assignments. Assigning a document to a user creates a
// ToDo (their task list) and notifies them.
import { sql } from '../src/db'
import { createDocType } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from tab_doctype where name = 'ToDo'`
  if (exists) return
  await createDocType({
    name: 'ToDo',
    module: 'Core',
    fields: [
      { fieldname: 'allocated_to', fieldtype: 'Link', options: 'User', reqd: true, in_list_view: true },
      { fieldname: 'reference_doctype', fieldtype: 'Link', options: 'DocType', in_list_view: true },
      { fieldname: 'reference_name', fieldtype: 'Data', in_list_view: true },
      { fieldname: 'description', fieldtype: 'Text' },
      { fieldname: 'status', fieldtype: 'Select', options: 'Open\nClosed', default_value: 'Open', in_list_view: true },
      { fieldname: 'priority', fieldtype: 'Select', options: 'Low\nMedium\nHigh', default_value: 'Medium' },
    ],
  })
}

// Assignment Rules: metadata-driven auto-assignment. A rule names a DocType,
// an optional condition over the new document, and a pool of users; matching
// creations are assigned round-robin across the pool (ToDo + notification).
// assign_to_field optionally stamps the picked user into a field on the
// document itself (e.g. a Ticket's `agent`).
import { sql } from '../src/db'
import { createDocType } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from tab_doctype where name = 'Assignment Rule'`
  if (exists) return

  // Child: the round-robin user pool, in idx order.
  await createDocType({
    name: 'Assignment Rule User',
    module: 'Core',
    istable: true,
    fields: [{ fieldname: 'user', fieldtype: 'Link', options: 'User', reqd: true, in_list_view: true }],
  })

  await createDocType({
    name: 'Assignment Rule',
    module: 'Core',
    autoname: 'prompt',
    fields: [
      { fieldname: 'document_type', fieldtype: 'Link', options: 'DocType', reqd: true, in_list_view: true },
      { fieldname: 'description', label: 'Assignment Description', fieldtype: 'Data' },
      { fieldname: 'assign_condition', label: 'Assign Condition', fieldtype: 'Text' },
      { fieldname: 'assign_to_field', label: 'Assign To Field', fieldtype: 'Data' },
      { fieldname: 'disabled', fieldtype: 'Check', default_value: '0', in_list_view: true },
      { fieldname: 'last_user', fieldtype: 'Data', read_only: true, hidden: true },
      { fieldname: 'users', fieldtype: 'Table', options: 'Assignment Rule User' },
    ],
  })
}

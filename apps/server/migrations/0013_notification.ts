// UI-018: Notification Log — one row per user notification (e.g. an
// @mention in a comment). Kept generic so assignments (UI-017) and
// workflow can reuse it.
import { sql } from '../src/db'
import { createDocType } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from tab_doctype where name = 'Notification Log'`
  if (exists) return
  await createDocType({
    name: 'Notification Log',
    module: 'Core',
    fields: [
      { fieldname: 'for_user', fieldtype: 'Link', options: 'User', reqd: true, in_list_view: true },
      { fieldname: 'subject', fieldtype: 'Data', in_list_view: true },
      { fieldname: 'ref_doctype', fieldtype: 'Link', options: 'DocType' },
      { fieldname: 'ref_name', fieldtype: 'Data' },
      { fieldname: 'read', fieldtype: 'Check', default_value: '0', in_list_view: true },
    ],
  })
}

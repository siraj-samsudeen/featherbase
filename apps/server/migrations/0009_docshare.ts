// PERM-008: DocShare grants a single user access to one specific document,
// independent of roles.
import { sql } from '../src/db'
import { createDocType } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from tab_doctype where name = 'DocShare'`
  if (exists) return
  await createDocType({
    name: 'DocShare',
    module: 'Core',
    fields: [
      { fieldname: 'share_doctype', fieldtype: 'Link', options: 'DocType', reqd: true, in_list_view: true },
      { fieldname: 'share_name', fieldtype: 'Data', reqd: true, in_list_view: true },
      { fieldname: 'user', fieldtype: 'Link', options: 'User', reqd: true, in_list_view: true },
      { fieldname: 'read', fieldtype: 'Check', default_value: '1' },
      { fieldname: 'write', fieldtype: 'Check', default_value: '0' },
      { fieldname: 'share', fieldtype: 'Check', default_value: '0' },
    ],
  })
}

// PERM-005: User Permission rows restrict a user to documents linked to
// specific values (e.g. only Company A), including the target docs themselves.
import { sql } from '../src/db'
import { createDocType } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from tab_doctype where name = 'User Permission'`
  if (exists) return
  await createDocType({
    name: 'User Permission',
    module: 'Core',
    fields: [
      { fieldname: 'user', fieldtype: 'Link', options: 'User', reqd: true, in_list_view: true },
      { fieldname: 'allow', fieldtype: 'Link', options: 'DocType', reqd: true, in_list_view: true },
      { fieldname: 'for_value', fieldtype: 'Data', reqd: true, in_list_view: true },
    ],
  })
}

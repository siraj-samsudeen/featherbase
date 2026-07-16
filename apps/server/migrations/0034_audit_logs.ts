// PLAT-007: audit logs. Activity Log records authentication events (logins);
// Access Log records data-access events (exports, prints). Both carry the user
// and a timestamp (creation).
import { sql } from '../src/db'
import { createDocType } from '../src/doctype-engine'

export async function up() {
  const [a] = await sql`select 1 from tab_doctype where name = 'Activity Log'`
  if (!a)
    await createDocType({
      name: 'Activity Log',
      module: 'Core',
      fields: [
        { fieldname: 'user', fieldtype: 'Data', in_list_view: true },
        { fieldname: 'operation', fieldtype: 'Data', in_list_view: true }, // login | logout
        { fieldname: 'full_name', fieldtype: 'Data' },
        { fieldname: 'ip_address', fieldtype: 'Data' },
      ],
    })

  const [b] = await sql`select 1 from tab_doctype where name = 'Access Log'`
  if (!b)
    await createDocType({
      name: 'Access Log',
      module: 'Core',
      fields: [
        { fieldname: 'user', fieldtype: 'Data', in_list_view: true },
        { fieldname: 'operation', fieldtype: 'Data', in_list_view: true }, // export | print
        { fieldname: 'reference_doctype', fieldtype: 'Data', in_list_view: true },
        { fieldname: 'reference_name', fieldtype: 'Data' },
        { fieldname: 'method', fieldtype: 'Data' }, // csv | xlsx | pdf
      ],
    })
}

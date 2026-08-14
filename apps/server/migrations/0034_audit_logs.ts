// PLAT-007: audit logs. Activity Log records authentication events (logins);
// Access Log records data-access events (exports, prints). Both carry the user
// and a timestamp (creation).
import { sql } from '../src/db'
import { createTable } from '../src/table-engine'

export async function up() {
  const [a] = await sql`select 1 from table_def where name = 'Activity Log'`
  if (!a)
    await createTable({
      name: 'Activity Log',
      module: 'Core',
      columns: [
        { column_name: 'user', column_type: 'Data', in_list_view: true },
        { column_name: 'operation', column_type: 'Data', in_list_view: true }, // login | logout
        { column_name: 'full_name', column_type: 'Data' },
        { column_name: 'ip_address', column_type: 'Data' },
      ],
    })

  const [b] = await sql`select 1 from table_def where name = 'Access Log'`
  if (!b)
    await createTable({
      name: 'Access Log',
      module: 'Core',
      columns: [
        { column_name: 'user', column_type: 'Data', in_list_view: true },
        { column_name: 'operation', column_type: 'Data', in_list_view: true }, // export | print
        { column_name: 'ref_table', column_type: 'Data', in_list_view: true },
        { column_name: 'reference_name', column_type: 'Data' },
        { column_name: 'method', column_type: 'Data' }, // csv | xlsx | pdf
      ],
    })
}

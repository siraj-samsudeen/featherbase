// PERM-005: Data Scope rows restrict a user to documents linked to
// specific values (e.g. only Company A), including the target docs themselves.
import { sql } from '../src/db'
import { createTable } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from table_def where name = 'Data Scope'`
  if (exists) return
  await createTable({
    name: 'Data Scope',
    module: 'Core',
    columns: [
      { column_name: 'user', column_type: 'Reference', reference_table: 'User', reqd: true, in_list_view: true },
      { column_name: 'allow', column_type: 'Reference', reference_table: 'Table', reqd: true, in_list_view: true },
      { column_name: 'for_value', column_type: 'Data', reqd: true, in_list_view: true },
    ],
  })
}

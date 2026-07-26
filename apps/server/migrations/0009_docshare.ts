// PERM-008: Share grants a single user access to one specific document,
// independent of roles.
import { sql } from '../src/db'
import { createTable } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from table_def where name = 'Share'`
  if (exists) return
  await createTable({
    name: 'Share',
    module: 'Core',
    columns: [
      { column_name: 'share_table', column_type: 'Reference', reference_table: 'Table', reqd: true, in_list_view: true },
      { column_name: 'share_name', column_type: 'Data', reqd: true, in_list_view: true },
      { column_name: 'user', column_type: 'Reference', reference_table: 'User', reqd: true, in_list_view: true },
      { column_name: 'read', column_type: 'Check', default_value: '1' },
      { column_name: 'write', column_type: 'Check', default_value: '0' },
      { column_name: 'share', column_type: 'Check', default_value: '0' },
    ],
  })
}

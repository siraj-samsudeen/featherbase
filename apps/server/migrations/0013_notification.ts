// UI-018: Notification Log — one row per user notification (e.g. an
// @mention in a comment). Kept generic so assignments (UI-017) and
// workflow can reuse it.
import { sql } from '../src/db'
import { createTable } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from table_def where name = 'Notification Log'`
  if (exists) return
  await createTable({
    name: 'Notification Log',
    module: 'Core',
    columns: [
      { column_name: 'for_user', column_type: 'Reference', reference_table: 'User', reqd: true, in_list_view: true },
      { column_name: 'subject', column_type: 'Data', in_list_view: true },
      { column_name: 'ref_doctype', column_type: 'Reference', reference_table: 'Table' },
      { column_name: 'ref_name', column_type: 'Data' },
      { column_name: 'read', column_type: 'Check', default_value: '0', in_list_view: true },
    ],
  })
}

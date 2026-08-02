// #101 Phase 6: saved views — a recurring filter habit made into a named,
// clickable, shareable artifact. Rows are owned by their creator
// (created_by); `shared` opens a view to everyone. Like user_event, the
// table carries no role permissions: all access flows through the
// owner-scoped /api/saved_views endpoints, so the generic list/form
// surfaces never expose one user's views to another.
import { sql } from '../src/db'
import { createTable } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from table_def where name = 'Saved View'`
  if (exists) return
  await createTable({
    name: 'Saved View',
    module: 'Core',
    system: true,
    columns: [
      { column_name: 'ref_table', column_type: 'Data', reqd: true, in_list_view: true },
      { column_name: 'label', column_type: 'Data', reqd: true, in_list_view: true },
      { column_name: 'filters', column_type: 'JSON', reqd: true },
      { column_name: 'shared', column_type: 'Check', default_value: '0', in_list_view: true },
    ],
  })
  await sql.unsafe(
    `create index if not exists saved_view_table on saved_view (ref_table, created_by)`,
  )
}

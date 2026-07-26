// Assignment Rules: metadata-driven auto-assignment. A rule names a Table,
// an optional condition over the new document, and a pool of users; matching
// creations are assigned round-robin across the pool (ToDo + notification).
// assign_to_field optionally stamps the picked user into a field on the
// document itself (e.g. a Ticket's `agent`).
import { sql } from '../src/db'
import { createTable } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from table_def where name = 'Assignment Rule'`
  if (exists) return

  // Child: the round-robin user pool, in position order.
  await createTable({
    name: 'Assignment Rule User',
    module: 'Core',
    kind: 'sub_table',
    columns: [{ column_name: 'user', column_type: 'Reference', reference_table: 'User', reqd: true, in_list_view: true }],
  })

  await createTable({
    name: 'Assignment Rule',
    module: 'Core',
    id_pattern: 'prompt',
    columns: [
      { column_name: 'ref_table', column_type: 'Reference', reference_table: 'Table', reqd: true, in_list_view: true },
      { column_name: 'description', label: 'Assignment Description', column_type: 'Data' },
      { column_name: 'assign_condition', label: 'Assign Condition', column_type: 'Text' },
      { column_name: 'assign_to_field', label: 'Assign To Field', column_type: 'Data' },
      { column_name: 'disabled', column_type: 'Check', default_value: '0', in_list_view: true },
      { column_name: 'last_user', column_type: 'Data', read_only: true, hidden: true },
      { column_name: 'users', column_type: 'Sub-table', row_table: 'Assignment Rule User' },
    ],
  })
}

// Service Level Agreements: per-priority response/resolution windows for a
// Table. On insert, documents of that type get response_by / resolution_by
// deadlines stamped (the Table declares those Datetime fields — no code);
// the recurring check_sla job escalates documents past their resolution
// deadline (sla_status -> Overdue + email to the escalation role).
import { sql } from '../src/db'
import { createTable } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from table_def where name = 'Service Level Agreement'`
  if (exists) return

  // Child: one row per priority value with its windows (in hours).
  await createTable({
    name: 'SLA Priority',
    module: 'Core',
    kind: 'sub_table',
    columns: [
      { column_name: 'priority', column_type: 'Data', reqd: true, in_list_view: true },
      { column_name: 'response_hours', column_type: 'Float', in_list_view: true },
      { column_name: 'resolution_hours', column_type: 'Float', in_list_view: true },
    ],
  })

  await createTable({
    name: 'Service Level Agreement',
    module: 'Core',
    id_pattern: 'prompt',
    columns: [
      { column_name: 'document_type', column_type: 'Reference', reference_table: 'Table', reqd: true, in_list_view: true },
      { column_name: 'enabled', column_type: 'Check', default_value: '1', in_list_view: true },
      { column_name: 'priority_field', column_type: 'Data', default_value: 'priority' },
      // Newline-separated state values that count as "done" — documents in one
      // of these states are never escalated.
      { column_name: 'fulfilled_states', label: 'Fulfilled States', column_type: 'Text' },
      { column_name: 'escalation_role', column_type: 'Reference', reference_table: 'Role' },
      { column_name: 'priorities', column_type: 'Sub-table', row_table: 'SLA Priority' },
    ],
  })
}

// WF-001: workflow definitions. A Workflow ties a set of states (each with a
// resulting doc status) and transitions (each gated by a role) to a Table.
// Documents carry a `workflow_state` field; Workflow Action logs the audit
// trail (who/when) for every applied transition.
import { sql } from '../src/db'
import { createTable } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from table_def where name = 'Workflow'`
  if (exists) return

  // Child: the states of a workflow, each mapping to a doc status.
  await createTable({
    name: 'Workflow Document State',
    module: 'Core',
    kind: 'sub_table',
    columns: [
      { column_name: 'state', column_type: 'Data', reqd: true, in_list_view: true },
      { column_name: 'doc_status', column_type: 'Choice', choices: '0\n1\n2', default_value: '0', in_list_view: true },
    ],
  })

  // Child: the transitions, each gated by a role.
  await createTable({
    name: 'Workflow Transition',
    module: 'Core',
    kind: 'sub_table',
    columns: [
      { column_name: 'state', column_type: 'Data', reqd: true, in_list_view: true },
      { column_name: 'action', column_type: 'Data', reqd: true, in_list_view: true },
      { column_name: 'next_state', column_type: 'Data', reqd: true, in_list_view: true },
      { column_name: 'allowed', column_type: 'Reference', reference_table: 'Role', reqd: true, in_list_view: true },
    ],
  })

  await createTable({
    name: 'Workflow',
    module: 'Core',
    id_pattern: 'prompt',
    columns: [
      { column_name: 'ref_table', column_type: 'Reference', reference_table: 'Table', reqd: true, in_list_view: true },
      { column_name: 'is_active', column_type: 'Check', default_value: '1', in_list_view: true },
      { column_name: 'states', column_type: 'Sub-table', row_table: 'Workflow Document State' },
      { column_name: 'transitions', column_type: 'Sub-table', row_table: 'Workflow Transition' },
    ],
  })

  // Audit trail: one row per applied transition.
  await createTable({
    name: 'Workflow Action',
    module: 'Core',
    columns: [
      { column_name: 'ref_table', column_type: 'Reference', reference_table: 'Table', in_list_view: true },
      { column_name: 'ref_name', column_type: 'Data', in_list_view: true },
      { column_name: 'action', column_type: 'Data', in_list_view: true },
      { column_name: 'from_state', column_type: 'Data' },
      { column_name: 'to_state', column_type: 'Data', in_list_view: true },
      { column_name: 'actor', column_type: 'Data', in_list_view: true },
    ],
  })
}

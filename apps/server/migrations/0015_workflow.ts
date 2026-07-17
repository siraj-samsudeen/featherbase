// WF-001: workflow definitions. A Workflow ties a set of states (each with a
// resulting doc status) and transitions (each gated by a role) to a DocType.
// Documents carry a `workflow_state` field; Workflow Action logs the audit
// trail (who/when) for every applied transition.
import { sql } from '../src/db'
import { createDocType } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from tab_doctype where name = 'Workflow'`
  if (exists) return

  // Child: the states of a workflow, each mapping to a doc status.
  await createDocType({
    name: 'Workflow Document State',
    module: 'Core',
    istable: true,
    fields: [
      { fieldname: 'state', fieldtype: 'Data', reqd: true, in_list_view: true },
      { fieldname: 'doc_status', fieldtype: 'Select', options: '0\n1\n2', default_value: '0', in_list_view: true },
    ],
  })

  // Child: the transitions, each gated by a role.
  await createDocType({
    name: 'Workflow Transition',
    module: 'Core',
    istable: true,
    fields: [
      { fieldname: 'state', fieldtype: 'Data', reqd: true, in_list_view: true },
      { fieldname: 'action', fieldtype: 'Data', reqd: true, in_list_view: true },
      { fieldname: 'next_state', fieldtype: 'Data', reqd: true, in_list_view: true },
      { fieldname: 'allowed', fieldtype: 'Link', options: 'Role', reqd: true, in_list_view: true },
    ],
  })

  await createDocType({
    name: 'Workflow',
    module: 'Core',
    autoname: 'prompt',
    fields: [
      { fieldname: 'document_type', fieldtype: 'Link', options: 'DocType', reqd: true, in_list_view: true },
      { fieldname: 'is_active', fieldtype: 'Check', default_value: '1', in_list_view: true },
      { fieldname: 'states', fieldtype: 'Table', options: 'Workflow Document State' },
      { fieldname: 'transitions', fieldtype: 'Table', options: 'Workflow Transition' },
    ],
  })

  // Audit trail: one row per applied transition.
  await createDocType({
    name: 'Workflow Action',
    module: 'Core',
    fields: [
      { fieldname: 'ref_doctype', fieldtype: 'Link', options: 'DocType', in_list_view: true },
      { fieldname: 'ref_name', fieldtype: 'Data', in_list_view: true },
      { fieldname: 'action', fieldtype: 'Data', in_list_view: true },
      { fieldname: 'from_state', fieldtype: 'Data' },
      { fieldname: 'to_state', fieldtype: 'Data', in_list_view: true },
      { fieldname: 'actor', fieldtype: 'Data', in_list_view: true },
    ],
  })
}

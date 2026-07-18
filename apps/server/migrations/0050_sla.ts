// Service Level Agreements: per-priority response/resolution windows for a
// DocType. On insert, documents of that type get response_by / resolution_by
// deadlines stamped (the DocType declares those Datetime fields — no code);
// the recurring check_sla job escalates documents past their resolution
// deadline (sla_status -> Overdue + email to the escalation role).
import { sql } from '../src/db'
import { createDocType } from '../src/doctype-engine'

export async function up() {
  const [exists] = await sql`select 1 from tab_doctype where name = 'Service Level Agreement'`
  if (exists) return

  // Child: one row per priority value with its windows (in hours).
  await createDocType({
    name: 'SLA Priority',
    module: 'Core',
    istable: true,
    fields: [
      { fieldname: 'priority', fieldtype: 'Data', reqd: true, in_list_view: true },
      { fieldname: 'response_hours', fieldtype: 'Float', in_list_view: true },
      { fieldname: 'resolution_hours', fieldtype: 'Float', in_list_view: true },
    ],
  })

  await createDocType({
    name: 'Service Level Agreement',
    module: 'Core',
    autoname: 'prompt',
    fields: [
      { fieldname: 'document_type', fieldtype: 'Link', options: 'DocType', reqd: true, in_list_view: true },
      { fieldname: 'enabled', fieldtype: 'Check', default_value: '1', in_list_view: true },
      { fieldname: 'priority_field', fieldtype: 'Data', default_value: 'priority' },
      // Newline-separated state values that count as "done" — documents in one
      // of these states are never escalated.
      { fieldname: 'fulfilled_states', label: 'Fulfilled States', fieldtype: 'Text' },
      { fieldname: 'escalation_role', fieldtype: 'Link', options: 'Role' },
      { fieldname: 'priorities', fieldtype: 'Table', options: 'SLA Priority' },
    ],
  })
}

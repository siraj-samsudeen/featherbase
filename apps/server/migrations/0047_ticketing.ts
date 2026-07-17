// Ticketing app (demo domain for feather-testing-postgres): GitHub-issue
// style tickets for logging data-warehouse problems, built ENTIRELY from
// metadata — DocTypes, roles, permissions, and a workflow. No bespoke
// frontend code: the generic Desk renders it.
import { sql } from '../src/db'
import { createDocType } from '../src/doctype-engine'
import { saveDoc } from '../src/document'
import { initDocState } from '../src/workflow'

export async function up() {
  const [exists] = await sql`select 1 from tab_doctype where name = 'Ticket'`
  if (exists) return

  // Roles: managers triage every ticket; reporters only see their own.
  for (const name of ['Ticket Manager', 'Ticket Reporter'])
    await saveDoc('Role', { name })

  await createDocType({
    name: 'Ticket Comment',
    module: 'Ticketing',
    istable: true,
    fields: [{ fieldname: 'comment', fieldtype: 'Long Text', reqd: true }],
  })

  await createDocType({
    name: 'Ticket',
    module: 'Ticketing',
    autoname: 'TICK-.####',
    title_field: 'title',
    fields: [
      { fieldname: 'title', label: 'Title', fieldtype: 'Data', reqd: true, in_list_view: true },
      {
        fieldname: 'ticket_type',
        label: 'Type',
        fieldtype: 'Select',
        options: 'Bug\nEnhancement\nQuestion\nTask',
        default_value: 'Bug',
        in_list_view: true,
      },
      {
        fieldname: 'priority',
        label: 'Priority',
        fieldtype: 'Select',
        options: 'Low\nMedium\nHigh\nCritical',
        default_value: 'Medium',
        in_list_view: true,
      },
      { fieldname: 'area', label: 'Area', fieldtype: 'Data' },
      { fieldname: 'description', label: 'Description', fieldtype: 'Long Text' },
      { fieldname: 'assignee', label: 'Assignee', fieldtype: 'Link', options: 'User' },
      { fieldname: 'resolution', label: 'Resolution', fieldtype: 'Long Text' },
      { fieldname: 'comments', label: 'Comments', fieldtype: 'Table', options: 'Ticket Comment' },
    ],
  })

  await saveDoc('DocPerm', {
    ref_doctype: 'Ticket',
    role: 'Ticket Manager',
    permlevel: 0,
    can_read: true,
    can_write: true,
    can_create: true,
    can_delete: true,
  })
  // Reporters: create tickets, read/write ONLY their own (if_owner).
  await saveDoc('DocPerm', {
    ref_doctype: 'Ticket',
    role: 'Ticket Reporter',
    permlevel: 0,
    if_owner: true,
    can_read: true,
    can_write: true,
    can_create: true,
  })

  // Lifecycle: Open → In Progress → Resolved → Closed (+ quick-close and
  // reopen). Resolving REQUIRES a filled resolution (workflow condition).
  await saveDoc('Workflow', {
    name: 'Ticket Workflow',
    document_type: 'Ticket',
    is_active: true,
    states: [
      { state: 'Open', doc_status: '0' },
      { state: 'In Progress', doc_status: '0' },
      { state: 'Resolved', doc_status: '0' },
      { state: 'Closed', doc_status: '0' },
    ],
    transitions: [
      { state: 'Open', action: 'Start Progress', next_state: 'In Progress', allowed: 'Ticket Manager' },
      {
        state: 'In Progress',
        action: 'Resolve',
        next_state: 'Resolved',
        allowed: 'Ticket Manager',
        condition: '!!(doc.resolution && String(doc.resolution).trim())',
      },
      { state: 'Resolved', action: 'Close', next_state: 'Closed', allowed: 'Ticket Manager' },
      { state: 'Open', action: 'Close', next_state: 'Closed', allowed: 'Ticket Manager' },
      { state: 'Resolved', action: 'Reopen', next_state: 'Open', allowed: 'Ticket Manager' },
      { state: 'Closed', action: 'Reopen', next_state: 'Open', allowed: 'Ticket Manager' },
    ],
  })

  // Sample tickets — the kind of issues logged against a retail data
  // warehouse (sales marts, SAP reconciliation, refresh jobs).
  const seeds = [
    {
      title: 'Sales mismatch between DW and SAP for store CHN-02',
      ticket_type: 'Bug',
      priority: 'Critical',
      area: 'sales mart',
      description:
        'June net sales in the DW sales mart are ~2.3% lower than the SAP report for store CHN-02. Suspect the month filter drops the last day of the month.',
    },
    {
      title: 'Nightly store-master refresh job fails on duplicate key',
      ticket_type: 'Bug',
      priority: 'High',
      area: 'etl',
      description:
        'The 02:00 store-master load aborts with a unique-constraint error when a store is re-coded. Needs an upsert instead of a plain insert.',
    },
    {
      title: 'Add category-wise margin report for merchandising',
      ticket_type: 'Enhancement',
      priority: 'Medium',
      area: 'reporting',
      description:
        'Merchandising wants a monthly category margin report (sales, cost, margin %) with division and store filters.',
    },
    {
      title: 'Why do fashion division numbers exclude accessories?',
      ticket_type: 'Question',
      priority: 'Low',
      area: 'semantics',
      description:
        "Business asks whether 'Fashion' in the dashboards means the business division or the SAP '01 Fashion N Lifestyle' category — accessories differ between the two.",
    },
    {
      title: 'Archive 2019 POS transactions to cold storage',
      ticket_type: 'Task',
      priority: 'Low',
      area: 'ops',
      description: 'The POS fact table crossed 500M rows; move pre-2020 partitions out of the hot database.',
    },
  ]
  for (const doc of seeds) await saveDoc('Ticket', doc)

  // Migrations run without the controller registry, so the Workflow
  // controller's after_save (ensureStateField) did not fire — initDocState
  // adds the workflow_state field and points existing tickets at 'Open'.
  await initDocState('Ticket')
}

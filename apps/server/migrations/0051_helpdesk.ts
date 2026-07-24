// Helpdesk app (HD Ticket): the framework's flagship demo, defined ENTIRELY
// from metadata — DocType, roles, permissions, a workflow bound to the real
// `status` field, an SLA, email rules, a server script, and a public web
// form. Structure only: demo users, the round-robin assignment rule (which
// links those users), and sample tickets live in scripts/seed-helpdesk.ts —
// demo content never ships in the migration chain.
import { sql } from '../src/db'
import { createDocType } from '../src/doctype-engine'
import { saveDoc } from '../src/document'

export async function up() {
  // Databases seeded by the pre-migration seed-helpdesk.ts already carry the
  // identical structure — skip cleanly.
  const [exists] = await sql`select 1 from tab_doctype where name = 'HD Ticket'`
  if (exists) return

  for (const name of ['Support Agent', 'Support Manager', 'Customer']) {
    const [role] = await sql`select 1 from tab_role where name = ${name}`
    if (!role) await saveDoc('Role', { name })
  }

  await createDocType({
    name: 'HD Ticket',
    module: 'Helpdesk',
    autoname: 'HDT-.#####',
    title_field: 'subject',
    fields: [
      { fieldname: 'subject', label: 'Subject', fieldtype: 'Data', reqd: true, in_list_view: true },
      { fieldname: 'description', label: 'Description', fieldtype: 'Text' },
      {
        fieldname: 'status', label: 'Status', fieldtype: 'Select', in_list_view: true,
        options: 'Open\nIn Progress\nResolved\nClosed', default_value: 'Open',
      },
      {
        fieldname: 'priority', label: 'Priority', fieldtype: 'Select', in_list_view: true,
        options: 'Low\nMedium\nHigh\nUrgent', default_value: 'Medium',
      },
      { fieldname: 'raised_by', label: 'Raised By (email)', fieldtype: 'Data' },
      { fieldname: 'agent', label: 'Agent', fieldtype: 'Link', options: 'User', in_list_view: true },
      { fieldname: 'resolution_details', label: 'Resolution Details', fieldtype: 'Text' },
      { fieldname: 'response_by', label: 'Response By', fieldtype: 'Datetime', read_only: true },
      { fieldname: 'resolution_by', label: 'Resolution By', fieldtype: 'Datetime', read_only: true },
      { fieldname: 'sla_status', label: 'SLA', fieldtype: 'Data', read_only: true, in_list_view: true },
    ],
  })

  // Agents work every ticket; managers may also delete; customers get a
  // portal view of their OWN tickets only (creation happens through the web
  // form, which attributes the logged-in submitter). The collab grants cover
  // doctypes with no "All"-role defaults.
  const grants: [string, string, Record<string, boolean>][] = [
    ['HD Ticket', 'Support Agent', { can_read: true, can_write: true, can_create: true }],
    ['HD Ticket', 'Support Manager', { can_read: true, can_write: true, can_create: true, can_delete: true }],
    ['HD Ticket', 'Customer', { if_owner: true, can_read: true, can_create: true }],
    ['ToDo', 'Support Agent', { can_read: true, can_write: true }],
    ['ToDo', 'Support Manager', { can_read: true, can_write: true }],
    // Comment/File need can_write: on insert, fields are stripped to the
    // user's WRITE permlevels (permissions.ts stripUnwritableFields), so a
    // create-only grant could never set content.
    ['Comment', 'Support Agent', { can_read: true, can_write: true, can_create: true }],
    ['Comment', 'Support Manager', { can_read: true, can_write: true, can_create: true }],
    ['Comment', 'Customer', { can_read: true, can_write: true, can_create: true }],
    ['File', 'Support Agent', { can_read: true, can_write: true, can_create: true }],
    ['File', 'Support Manager', { can_read: true, can_write: true, can_create: true }],
    ['File', 'Customer', { can_read: true, can_write: true, can_create: true }],
    ['Version', 'Support Agent', { can_read: true }],
    ['Version', 'Support Manager', { can_read: true }],
  ]
  for (const [ref_doctype, role, perms] of grants) {
    const [have] = await sql`
      select 1 from tab_docperm where ref_doctype = ${ref_doctype} and role = ${role}`
    if (!have) await saveDoc('DocPerm', { ref_doctype, role, ...perms })
  }

  // Bound to the real `status` field (state_field) — no synthetic
  // workflow_state column, so no initDocState backfill is needed.
  await saveDoc('Workflow', {
    name: 'HD Ticket Flow',
    document_type: 'HD Ticket',
    is_active: true,
    state_field: 'status',
    states: [
      { state: 'Open', doc_status: '0' },
      { state: 'In Progress', doc_status: '0' },
      { state: 'Resolved', doc_status: '0' },
      { state: 'Closed', doc_status: '0' },
    ],
    transitions: [
      { state: 'Open', action: 'Start', next_state: 'In Progress', allowed: 'Support Agent' },
      {
        state: 'In Progress', action: 'Resolve', next_state: 'Resolved', allowed: 'Support Agent',
        condition: 'doc.resolution_details && String(doc.resolution_details).trim().length > 0',
      },
      { state: 'Resolved', action: 'Close', next_state: 'Closed', allowed: 'Support Manager' },
      { state: 'Resolved', action: 'Reopen', next_state: 'Open', allowed: 'Customer' },
    ],
  })

  await saveDoc('Email Account', {
    name: 'Helpdesk Notifications',
    email_id: 'support@helpdesk.test',
    is_default: true,
  })
  await saveDoc('Email Rule', {
    name: 'HD Ticket Resolved Notice',
    document_type: 'HD Ticket',
    event: 'on_save',
    condition_field: 'status',
    condition_value: 'Resolved',
    recipient: '{{ doc.raised_by }}',
    subject: 'Your ticket {{ doc.name }} has been resolved',
    message:
      'Hello,\n\nyour ticket "{{ doc.subject }}" was resolved.\n\n' +
      'Resolution: {{ doc.resolution_details }}\n\n' +
      'Reply to reopen it from your portal.',
    enabled: true,
  })

  await saveDoc('Server Script', {
    name: 'HD Ticket Defaults',
    script_type: 'Document Event',
    reference_doctype: 'HD Ticket',
    event: 'validate',
    script: 'if (!doc.raised_by) { doc.raised_by = doc.owner }',
    enabled: true,
  })

  await saveDoc('Service Level Agreement', {
    name: 'HD Ticket SLA',
    document_type: 'HD Ticket',
    enabled: true,
    priority_field: 'priority',
    fulfilled_states: 'Resolved\nClosed',
    escalation_role: 'Support Manager',
    priorities: [
      { priority: 'Urgent', response_hours: 1, resolution_hours: 4 },
      { priority: 'High', response_hours: 4, resolution_hours: 24 },
      { priority: 'Medium', response_hours: 8, resolution_hours: 48 },
      { priority: 'Low', response_hours: 24, resolution_hours: 72 },
    ],
  })

  await saveDoc('Web Form', {
    name: 'New Ticket',
    title: 'Raise a support ticket',
    route: 'new-ticket',
    document_type: 'HD Ticket',
    published: true,
    success_message: 'Thanks — your ticket has been filed. Track it in your portal.',
    web_fields: JSON.stringify(['subject', 'description', 'priority']),
  })
}

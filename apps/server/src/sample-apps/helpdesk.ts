// Helpdesk sample app (HD Ticket): the framework's flagship demo, defined
// ENTIRELY from metadata — Table, roles, permissions, a workflow bound to the
// real `status` field, an SLA, email rules, a server script, and a public web
// form. It used to ship in the migration chain (0051, removed by 0057); now
// it is OPT-IN: scripts/seed-helpdesk.ts installs it on dev machines, and the
// helpdesk test suites install it inside their own sandbox transactions.
// Demo content (users, sample tickets, the round-robin assignment rule) stays
// in scripts/seed-helpdesk.ts — structure only here.
import { sql } from '../db'
import { createTable } from '../doctype-engine'
import { saveDoc } from '../document'

export async function installHelpdesk() {
  // Idempotent: a database that already carries the structure skips cleanly.
  const [exists] = await sql`select 1 from table_def where name = 'HD Ticket'`
  if (exists) return

  for (const name of ['Support Agent', 'Support Manager', 'Customer']) {
    const [role] = await sql`select 1 from role where name = ${name}`
    if (!role) await saveDoc('Role', { name })
  }

  await createTable({
    name: 'HD Ticket',
    module: 'Helpdesk',
    id_pattern: 'HDT-.#####',
    title_column: 'subject',
    columns: [
      { column_name: 'subject', label: 'Subject', column_type: 'Data', reqd: true, in_list_view: true },
      { column_name: 'description', label: 'Description', column_type: 'Text' },
      {
        column_name: 'ticket_status', label: 'Status', column_type: 'Choice', in_list_view: true,
        choices: 'Open\nIn Progress\nResolved\nClosed', default_value: 'Open',
      },
      {
        column_name: 'priority', label: 'Priority', column_type: 'Choice', in_list_view: true,
        choices: 'Low\nMedium\nHigh\nUrgent', default_value: 'Medium',
      },
      { column_name: 'raised_by', label: 'Raised By (email)', column_type: 'Data' },
      { column_name: 'agent', label: 'Agent', column_type: 'Reference', reference_table: 'User', in_list_view: true },
      { column_name: 'resolution_details', label: 'Resolution Details', column_type: 'Text' },
      { column_name: 'response_by', label: 'Response By', column_type: 'Datetime', read_only: true },
      { column_name: 'resolution_by', label: 'Resolution By', column_type: 'Datetime', read_only: true },
      { column_name: 'sla_status', label: 'SLA', column_type: 'Data', read_only: true, in_list_view: true },
    ],
  })

  // Agents work every ticket; managers may also delete; customers get a
  // portal view of their OWN tickets only (creation happens through the web
  // form, which attributes the logged-in submitter). The collab grants cover
  // doctypes with no "All"-role defaults.
  const grants: [string, string, Record<string, boolean>][] = [
    ['HD Ticket', 'Support Agent', { can_read: true, can_write: true, can_create: true }],
    ['HD Ticket', 'Support Manager', { can_read: true, can_write: true, can_create: true, can_delete: true }],
    ['HD Ticket', 'Customer', { own_rows_only: true, can_read: true, can_create: true }],
    ['ToDo', 'Support Agent', { can_read: true, can_write: true }],
    ['ToDo', 'Support Manager', { can_read: true, can_write: true }],
    // Comment/File need can_write: on insert, fields are stripped to the
    // user's WRITE tiers (permissions.ts stripUnwritableFields), so a
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
  for (const [refTable, role, perms] of grants) {
    const [have] = await sql`
      select 1 from permission where ref_table = ${refTable} and role = ${role}`
    if (!have) await saveDoc('Permission', { ref_table: refTable, role, ...perms })
  }

  // Bound to the real `ticket_status` field (state_field) — no synthetic
  // workflow_state column, so no initDocState backfill is needed.
  await saveDoc('Workflow', {
    name: 'HD Ticket Flow',
    ref_table: 'HD Ticket',
    is_active: true,
    state_field: 'ticket_status',
    states: [
      { state: 'Open', target_status: 'draft' },
      { state: 'In Progress', target_status: 'draft' },
      { state: 'Resolved', target_status: 'draft' },
      { state: 'Closed', target_status: 'draft' },
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
    ref_table: 'HD Ticket',
    event: 'on_save',
    condition_field: 'ticket_status',
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
    ref_table: 'HD Ticket',
    event: 'validate',
    script: 'if (!doc.raised_by) { doc.raised_by = doc.created_by }',
    enabled: true,
  })

  await saveDoc('Service Level Agreement', {
    name: 'HD Ticket SLA',
    ref_table: 'HD Ticket',
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
    ref_table: 'HD Ticket',
    published: true,
    success_message: 'Thanks — your ticket has been filed. Track it in your portal.',
    web_fields: JSON.stringify(['subject', 'description', 'priority']),
  })
}

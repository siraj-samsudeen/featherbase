// Helpdesk sample app (HD Ticket): the framework's flagship demo, defined
// ENTIRELY from metadata — Table, roles, permissions, and fixture documents:
// a workflow bound to the real `ticket_status` field, an SLA, an email
// account + rule, a server script, and a public web form. It used to ship in
// the migration chain (0051, removed by 0057) and then as an imperative
// installer; it is now a genuine AppManifest (PLAT-006, #78) — REGISTERED at
// boot (index.ts) but NOT installed, so a fresh deployment has zero helpdesk
// tables. `POST /api/install_app { name: 'helpdesk' }` brings the whole
// thing up and uninstall removes exactly what install created. Demo content
// (users, sample tickets, the round-robin assignment rule) stays in
// scripts/seed-helpdesk.ts — structure only here.
import type { AppManifest } from '../apps'

const helpdesk: AppManifest = {
  name: 'helpdesk',
  tables: [
    {
      name: 'HD Ticket',
      // User-space on purpose: app tables carry the app's own module (never
      // system: true), so the Admin sidebar groups HD Ticket under
      // "Helpdesk", not under the collapsed System group.
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
    },
  ],

  roles: ['Support Agent', 'Support Manager', 'Customer'],

  // Agents work every ticket; managers may also delete; customers get a
  // portal view of their OWN tickets only (creation happens through the web
  // form, which attributes the logged-in submitter — deliberately no
  // can_write, so the install's can_create-without-can_write warning is
  // expected). The collab grants cover doctypes with no "All"-role defaults.
  permissions: [
    { table: 'HD Ticket', role: 'Support Agent', can_read: true, can_write: true, can_create: true },
    { table: 'HD Ticket', role: 'Support Manager', can_read: true, can_write: true, can_create: true, can_delete: true },
    { table: 'HD Ticket', role: 'Customer', own_rows_only: true, can_read: true, can_create: true },
    { table: 'ToDo', role: 'Support Agent', can_read: true, can_write: true },
    { table: 'ToDo', role: 'Support Manager', can_read: true, can_write: true },
    // Comment/File need can_write: on insert, fields are stripped to the
    // user's WRITE tiers (permissions.ts stripUnwritableFields), so a
    // create-only grant could never set content.
    { table: 'Comment', role: 'Support Agent', can_read: true, can_write: true, can_create: true },
    { table: 'Comment', role: 'Support Manager', can_read: true, can_write: true, can_create: true },
    { table: 'Comment', role: 'Customer', can_read: true, can_write: true, can_create: true },
    { table: 'File', role: 'Support Agent', can_read: true, can_write: true, can_create: true },
    { table: 'File', role: 'Support Manager', can_read: true, can_write: true, can_create: true },
    { table: 'File', role: 'Customer', can_read: true, can_write: true, can_create: true },
    { table: 'Version', role: 'Support Agent', can_read: true },
    { table: 'Version', role: 'Support Manager', can_read: true },
  ],

  fixtures: [
    {
      // Bound to the real `ticket_status` field (state_field) — no synthetic
      // workflow_state column, so no initDocState backfill is needed.
      table: 'Workflow',
      rows: [
        {
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
        },
      ],
    },
    {
      // is_default on purpose: installing the app makes its notifications
      // deliverable out of the box. Uninstall removes the account (a recorded
      // fixture) and deliberately leaves NO default — email.ts
      // defaultSender() falls back to the oldest account, then to
      // no-reply@localhost, so nothing dangles (same call 0057 made).
      table: 'Email Account',
      rows: [{ name: 'Helpdesk Notifications', email_id: 'support@helpdesk.test', is_default: true }],
    },
    {
      table: 'Email Rule',
      rows: [
        {
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
        },
      ],
    },
    {
      table: 'Server Script',
      rows: [
        {
          name: 'HD Ticket Defaults',
          script_type: 'Document Event',
          ref_table: 'HD Ticket',
          event: 'validate',
          script: 'if (!doc.raised_by) { doc.raised_by = doc.created_by }',
          enabled: true,
        },
      ],
    },
    {
      table: 'Service Level Agreement',
      rows: [
        {
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
        },
      ],
    },
    {
      // Published: /form/new-ticket is publicly reachable the moment the app
      // installs — the app's intended front door for customers.
      table: 'Web Form',
      rows: [
        {
          name: 'New Ticket',
          title: 'Raise a support ticket',
          route: 'new-ticket',
          ref_table: 'HD Ticket',
          published: true,
          success_message: 'Thanks — your ticket has been filed. Track it in your portal.',
          web_fields: JSON.stringify(['subject', 'description', 'priority']),
        },
      ],
    },
  ],
}

export default helpdesk

// De-ship the Helpdesk demo (#74). Migration 0051 installed a full demo app
// — the HD Ticket Table, three roles, 14 permission grants, a workflow, an
// SLA, a default email account, an email rule, a server script, and a
// published web form — into EVERY database. That structure now lives in
// src/sample-apps/helpdesk.ts and is opt-in (scripts/seed-helpdesk.ts; the
// helpdesk test suites install it inside their sandbox transactions).
//
// This teardown removes everything 0051 created, existence-checked at each
// step, so it is a no-op on a database that never had the Helpdesk (0051 is
// deleted from the chain, so fresh installs skip straight past it). Same
// shape as 0052_drop_ticketing.ts, but with POST-0055 names throughout
// (ref_table, user_settings.table_name, no tab_ prefix) — this migration
// sorts after the terminology rename.
import { sql } from '../src/db'

export async function up() {
  const [exists] = await sql`select 1 from table_def where name = 'HD Ticket'`
  if (!exists) return

  // Workflow + its sub-table rows and pending workflow actions.
  await sql`delete from workflow_document_state where parent in (select row_id from workflow where ref_table = 'HD Ticket')`
  await sql`delete from workflow_transition where parent in (select row_id from workflow where ref_table = 'HD Ticket')`
  await sql`delete from workflow where ref_table = 'HD Ticket'`
  await sql`delete from workflow_action where ref_table = 'HD Ticket'`

  // Automation bound to HD Ticket: email rule, server script, SLA (+ its
  // priority rows), the published web form, and the demo round-robin
  // assignment rule if scripts/seed-helpdesk.ts ever created it here.
  await sql`delete from email_rule where ref_table = 'HD Ticket'`
  await sql`delete from server_script where ref_table = 'HD Ticket'`
  await sql`delete from sla_priority where parent in (select row_id from service_level_agreement where ref_table = 'HD Ticket')`
  await sql`delete from service_level_agreement where ref_table = 'HD Ticket'`
  await sql`delete from web_form where ref_table = 'HD Ticket'`
  await sql`delete from assignment_rule_user where parent in (select row_id from assignment_rule where ref_table = 'HD Ticket')`
  await sql`delete from assignment_rule where ref_table = 'HD Ticket'`

  // The demo email account was is_default. Deleting it may leave NO default
  // account — that is fine and intended: email.ts defaultSender() falls back
  // to the oldest account, then to no-reply@localhost. Never fabricate a
  // replacement default here.
  await sql`delete from email_account where row_id = 'Helpdesk Notifications' and email_id = 'support@helpdesk.test'`

  // Collab/system rows referencing HD Ticket rows.
  await sql`delete from todo where ref_table = 'HD Ticket'`
  await sql`delete from comment where ref_table = 'HD Ticket'`
  await sql`delete from version where ref_table = 'HD Ticket'`
  await sql`delete from notification_log where ref_table = 'HD Ticket'`
  await sql`delete from email_queue where ref_table = 'HD Ticket'`
  await sql`delete from tag_link where ref_table = 'HD Ticket'`
  await sql`delete from user_settings where table_name = 'HD Ticket'`

  // The 14 grants from 0051: everything on HD Ticket itself, plus the collab
  // grants the helpdesk roles got on ToDo/Comment/File/Version.
  await sql`delete from permission where ref_table = 'HD Ticket'`
  await sql`delete from permission
    where role in ('Support Agent', 'Support Manager', 'Customer')
      and ref_table in ('ToDo', 'Comment', 'File', 'Version')`

  // Rows, metadata, and the physical table.
  await sql`delete from column_def where parent = 'HD Ticket'`
  await sql`delete from table_def where name = 'HD Ticket'`
  await sql.unsafe('drop table if exists hd_ticket')

  // The three roles go only if nothing still references them — a database
  // seeded with demo users (or with user-created grants/workflows on these
  // roles) keeps them.
  for (const role of ['Support Agent', 'Support Manager', 'Customer']) {
    const [used] = await sql`
      select 1 where exists (select 1 from has_role where role = ${role})
         or exists (select 1 from permission where role = ${role})
         or exists (select 1 from workflow_transition where allowed = ${role})`
    if (!used) await sql`delete from role where row_id = ${role}`
  }
}

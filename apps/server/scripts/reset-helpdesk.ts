/* Dev tool: remove every Helpdesk artifact (Ticket DocType + documents,
 * workflow, rules, SLA, web form, demo collab rows) so seed-helpdesk.ts can
 * run against a clean slate. Roles and users are left in place — the seed is
 * idempotent about those. Direct SQL on purpose: this is teardown tooling,
 * not part of the metadata-only app definition.
 */
import { sql } from '../src/db'

async function main() {
  await sql`delete from tab_web_form where route = 'new-ticket'`
  await sql`delete from tab_workflow_document_state where parent in (select name from tab_workflow where document_type = 'Ticket')`
  await sql`delete from tab_workflow_transition where parent in (select name from tab_workflow where document_type = 'Ticket')`
  await sql`delete from tab_workflow where document_type = 'Ticket'`
  await sql`delete from tab_workflow_action where ref_doctype = 'Ticket'`
  await sql`delete from tab_email_rule where document_type = 'Ticket'`
  await sql`delete from tab_assignment_rule_user where parent in (select name from tab_assignment_rule where document_type = 'Ticket')`
  await sql`delete from tab_assignment_rule where document_type = 'Ticket'`
  await sql`delete from tab_sla_priority where parent in (select name from tab_service_level_agreement where document_type = 'Ticket')`
  await sql`delete from tab_service_level_agreement where document_type = 'Ticket'`
  await sql`delete from tab_server_script where reference_doctype = 'Ticket'`
  await sql`delete from tab_todo where reference_doctype = 'Ticket'`
  await sql`delete from tab_comment where ref_doctype = 'Ticket'`
  await sql`delete from tab_notification_log where ref_doctype = 'Ticket'`
  await sql`delete from tab_version where ref_doctype = 'Ticket'`
  await sql`delete from tab_email_queue where reference_doctype = 'Ticket'`
  await sql`delete from tab_docperm where ref_doctype = 'Ticket'`
  await sql`delete from tab_docfield where parent in ('Ticket', 'Ticket Activity')`
  await sql`delete from tab_doctype where name in ('Ticket', 'Ticket Activity')`
  await sql.unsafe('drop table if exists tab_ticket')
  await sql.unsafe('drop table if exists tab_ticket_activity')
  console.log('Helpdesk artifacts removed.')
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error(err)
    await sql.end().catch(() => {})
    process.exit(1)
  })

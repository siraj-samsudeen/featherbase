/* Dev tool: remove every Helpdesk artifact (HD Ticket DocType + documents,
 * workflow, rules, SLA, web form, demo collab rows) so seed-helpdesk.ts can
 * run against a clean slate. Roles and users are left in place — the seed is
 * idempotent about those. The migration-seeded `Ticket` demo app (0047) is
 * NOT touched. Direct SQL on purpose: this is teardown tooling, not part of
 * the metadata-only app definition.
 */
import { sql } from '../src/db'

const DT = 'HD Ticket'

async function main() {
  await sql`delete from tab_web_form where route = 'new-ticket'`
  await sql`delete from tab_workflow_document_state where parent in (select name from tab_workflow where document_type = ${DT})`
  await sql`delete from tab_workflow_transition where parent in (select name from tab_workflow where document_type = ${DT})`
  await sql`delete from tab_workflow where document_type = ${DT}`
  await sql`delete from tab_workflow_action where ref_doctype = ${DT}`
  await sql`delete from tab_email_rule where document_type = ${DT}`
  await sql`delete from tab_assignment_rule_user where parent in (select name from tab_assignment_rule where document_type = ${DT})`
  await sql`delete from tab_assignment_rule where document_type = ${DT}`
  await sql`delete from tab_sla_priority where parent in (select name from tab_service_level_agreement where document_type = ${DT})`
  await sql`delete from tab_service_level_agreement where document_type = ${DT}`
  await sql`delete from tab_server_script where reference_doctype = ${DT}`
  await sql`delete from tab_todo where reference_doctype = ${DT}`
  await sql`delete from tab_comment where ref_doctype = ${DT}`
  await sql`delete from tab_notification_log where ref_doctype = ${DT}`
  await sql`delete from tab_version where ref_doctype = ${DT}`
  await sql`delete from tab_email_queue where reference_doctype = ${DT}`
  await sql`delete from tab_docperm where ref_doctype = ${DT}`
  await sql`delete from tab_docfield where parent = ${DT}`
  await sql`delete from tab_doctype where name = ${DT}`
  await sql.unsafe('drop table if exists tab_hd_ticket')
  console.log('Helpdesk (HD Ticket) artifacts removed.')
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error(err)
    await sql.end().catch(() => {})
    process.exit(1)
  })

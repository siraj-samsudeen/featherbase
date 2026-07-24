// Remove the migration-seeded `Ticket` demo app (0047). It duplicated the
// richer HD Ticket helpdesk (0051) — two ticketing systems with divergent
// field names, roles, and priority vocabularies. Databases created after
// 0047 was deleted from the chain have nothing to remove and skip. Direct
// SQL on purpose: this is teardown of a retired app, the same shape as
// scripts/reset-helpdesk.ts.
import { sql } from '../src/db'

export async function up() {
  const [exists] = await sql`select 1 from tab_doctype where name = 'Ticket'`
  if (!exists) return

  await sql`delete from tab_workflow_document_state where parent in (select name from tab_workflow where document_type = 'Ticket')`
  await sql`delete from tab_workflow_transition where parent in (select name from tab_workflow where document_type = 'Ticket')`
  await sql`delete from tab_workflow where document_type = 'Ticket'`
  await sql`delete from tab_workflow_action where ref_doctype = 'Ticket'`
  await sql`delete from tab_todo where reference_doctype = 'Ticket'`
  await sql`delete from tab_comment where ref_doctype = 'Ticket'`
  await sql`delete from tab_notification_log where ref_doctype = 'Ticket'`
  await sql`delete from tab_version where ref_doctype = 'Ticket'`
  await sql`delete from tab_email_queue where reference_doctype = 'Ticket'`
  await sql`delete from tag_link where ref_doctype = 'Ticket'`
  await sql`delete from user_settings where doctype = 'Ticket'`
  await sql`delete from tab_docperm where ref_doctype = 'Ticket'`
  await sql`delete from tab_docfield where parent in ('Ticket', 'Ticket Comment')`
  await sql`delete from tab_doctype where name in ('Ticket', 'Ticket Comment')`
  await sql`delete from tab_has_role where role in ('Ticket Manager', 'Ticket Reporter')`
  await sql`delete from tab_role where name in ('Ticket Manager', 'Ticket Reporter')`
  await sql.unsafe('drop table if exists tab_ticket_comment')
  await sql.unsafe('drop table if exists tab_ticket')
}

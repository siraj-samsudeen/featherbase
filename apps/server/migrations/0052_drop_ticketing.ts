// Remove the migration-seeded `Ticket` demo app (0047). It duplicated the
// richer HD Ticket helpdesk (0051) — two ticketing systems with divergent
// field names, roles, and priority vocabularies. Databases created after
// 0047 was deleted from the chain have nothing to remove and skip. Direct
// SQL on purpose: this is teardown of a retired app, the same shape as
// scripts/reset-helpdesk.ts.
import { sql } from '../src/db'

export async function up() {
  const [exists] = await sql`select 1 from table_def where name = 'Ticket'`
  if (!exists) return

  await sql`delete from workflow_document_state where parent in (select name from workflow where ref_table = 'Ticket')`
  await sql`delete from workflow_transition where parent in (select name from workflow where ref_table = 'Ticket')`
  await sql`delete from workflow where ref_table = 'Ticket'`
  await sql`delete from workflow_action where ref_table = 'Ticket'`
  await sql`delete from todo where ref_table = 'Ticket'`
  await sql`delete from comment where ref_table = 'Ticket'`
  await sql`delete from notification_log where ref_table = 'Ticket'`
  await sql`delete from version where ref_table = 'Ticket'`
  await sql`delete from email_queue where ref_table = 'Ticket'`
  await sql`delete from tag_link where ref_doctype = 'Ticket'`
  await sql`delete from user_settings where doctype = 'Ticket'`
  await sql`delete from permission where ref_table = 'Ticket'`
  await sql`delete from column_def where parent in ('Ticket', 'Ticket Comment')`
  await sql`delete from table_def where name in ('Ticket', 'Ticket Comment')`
  await sql`delete from has_role where role in ('Ticket Manager', 'Ticket Reporter')`
  await sql`delete from role where name in ('Ticket Manager', 'Ticket Reporter')`
  await sql.unsafe('drop table if exists ticket_comment')
  await sql.unsafe('drop table if exists ticket')
}

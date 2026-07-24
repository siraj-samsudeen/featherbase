/* Dev tool: remove the Helpdesk DEMO CONTENT (tickets and their collab rows,
 * the round-robin Assignment Rule) so seed-helpdesk.ts can run against a
 * clean slate. The helpdesk STRUCTURE — HD Ticket DocType, roles, DocPerms,
 * workflow, SLA, email rule, server script, web form — ships in migration
 * 0051_helpdesk.ts and is NOT touched; neither are the demo users (the seed
 * is idempotent about those). Direct SQL on purpose: this is teardown
 * tooling, not part of the metadata-only app definition.
 */
import { sql } from '../src/db'

const DT = 'HD Ticket'

async function main() {
  await sql`delete from tab_assignment_rule_user where parent in (select name from tab_assignment_rule where document_type = ${DT})`
  await sql`delete from tab_assignment_rule where document_type = ${DT}`
  await sql`delete from tab_workflow_action where ref_doctype = ${DT}`
  await sql`delete from tab_todo where reference_doctype = ${DT}`
  await sql`delete from tab_comment where ref_doctype = ${DT}`
  await sql`delete from tab_notification_log where ref_doctype = ${DT}`
  await sql`delete from tab_version where ref_doctype = ${DT}`
  await sql`delete from tab_email_queue where reference_doctype = ${DT}`
  await sql`delete from tab_hd_ticket`
  console.log('Helpdesk demo content removed (structure from 0051 left in place).')
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error(err)
    await sql.end().catch(() => {})
    process.exit(1)
  })

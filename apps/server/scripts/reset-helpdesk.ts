/* Dev tool: remove the Helpdesk DEMO CONTENT (tickets and their collab rows,
 * the round-robin Assignment Rule) so seed-helpdesk.ts can run against a
 * clean slate. The helpdesk STRUCTURE — HD Ticket Table, roles, Permissions,
 * workflow, SLA, email rule, server script, web form — comes from
 * src/sample-apps/helpdesk.ts (installed by the seed script) and is NOT
 * touched; neither are the demo users (the seed is idempotent about those).
 * Direct SQL on purpose: this is teardown tooling, not part of the
 * metadata-only app definition. Names are post-0055 (ref_table, no tab_
 * prefix). No-op when the structure was never installed.
 */
import { sql } from '../src/db'

const DT = 'HD Ticket'

async function main() {
  const [exists] = await sql`select 1 from table_def where name = ${DT}`
  if (!exists) {
    console.log('Helpdesk structure not installed — nothing to reset.')
    return
  }
  await sql`delete from assignment_rule_user where parent in (select name from assignment_rule where ref_table = ${DT})`
  await sql`delete from assignment_rule where ref_table = ${DT}`
  await sql`delete from workflow_action where ref_table = ${DT}`
  await sql`delete from todo where ref_table = ${DT}`
  await sql`delete from comment where ref_table = ${DT}`
  await sql`delete from notification_log where ref_table = ${DT}`
  await sql`delete from version where ref_table = ${DT}`
  await sql`delete from email_queue where ref_table = ${DT}`
  await sql`delete from hd_ticket`
  console.log('Helpdesk demo content removed (structure left in place).')
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error(err)
    await sql.end().catch(() => {})
    process.exit(1)
  })

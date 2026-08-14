import { sql } from '../db'
import { registerJob } from '../jobs'
import { getMeta } from '../meta'
import { tableName } from '../table-engine'
import { getActiveWorkflow, stateField } from '../workflow'
import { queueEmail } from '../email'

// SLA escalation: a recurring job that finds rows past their
// `resolution_by` deadline that are still open (their state is not one of the
// SLA's fulfilled states), flips `sla_status` to Overdue, and emails the
// holders of the SLA's escalation role. Each row escalates exactly once
// (the sla_status flip is the claim).

registerJob('check_sla', async () => {
  const [tableOk] = await sql`
    select 1 from information_schema.tables
    where table_name = 'service_level_agreement'`
  if (!tableOk) return

  const slas = await sql`
    select row_id, ref_table, fulfilled_states, escalation_role
    from service_level_agreement where enabled = true`

  for (const sla of slas) {
    const table = sla.ref_table as string
    const meta = await getMeta(table).catch(() => null)
    if (!meta) continue
    const has = (f: string) => meta.columns.some((x) => x.column_name === f)
    // Escalation needs both the deadline and the claim column.
    if (!has('resolution_by') || !has('sla_status')) continue

    const fulfilled = String(sla.fulfilled_states ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    // The row's "state" is its workflow state when a workflow is active,
    // else its `status` column when it has one.
    const wf = await getActiveWorkflow(table)
    const stateCol = wf ? stateField(wf) : has('status') ? 'status' : null

    const tbl = tableName(table)
    const stateCond =
      stateCol && fulfilled.length
        ? sql`and (${sql(stateCol)} is null or ${sql(stateCol)} not in ${sql(fulfilled)})`
        : sql``
    const overdue = await sql`
      update ${sql(tbl)} set sla_status = 'Overdue'
      where sla_status = 'On Track' and resolution_by < now() ${stateCond}
      returning row_id`
    if (!overdue.length) continue

    const role = (sla.escalation_role as string) || null
    if (!role) continue
    const holders = await sql`
      select distinct u.row_id, u.email from has_role hr
      join "user" u on u.row_id = hr.parent
      where hr.parenttype = 'User' and hr.role = ${role} and u.enabled = true`
    for (const row of overdue) {
      for (const h of holders) {
        await queueEmail({
          to: (h.email as string) || (h.row_id as string),
          subject: `SLA breached: ${table} ${row.row_id as string}`,
          body:
            `${table} ${row.row_id as string} has passed its resolution deadline ` +
            `and is now Overdue.\n\nOpen the row: /admin/${encodeURIComponent(
              table,
            )}/${encodeURIComponent(row.row_id as string)}`,
          ref_table: table,
          reference_name: row.row_id as string,
        })
      }
    }
  }
})

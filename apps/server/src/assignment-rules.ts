import { sql } from './db'
import { tableName } from './table-engine'
import { getMeta } from './meta'
import { createAssignment } from './assign'
import { evalCondition } from './server-scripts'

// Assignment Rules: metadata-driven auto-assignment. A rule names a Table,
// an optional boolean condition over the new row, and a pool of users;
// each matching creation assigns the row round-robin across the pool
// (ToDo + notification, like a manual /api/assign). If the rule sets
// assign_to_field, the picked user is also written into that column so the
// row itself carries its assignee (e.g. a Ticket's `agent`).

export async function evaluateAssignmentRules(
  table: string,
  row: Record<string, unknown>,
): Promise<void> {
  // The Assignment Rule Table may not exist yet during early migrations.
  const [tableOk] = await sql`
    select 1 from information_schema.tables where table_name = 'assignment_rule'`
  if (!tableOk) return

  const rules = await sql`
    select row_id, assign_condition, assign_to_field, last_user, description
    from assignment_rule
    where ref_table = ${table} and disabled = false`

  for (const rule of rules) {
    if (!evalCondition(rule.assign_condition as string | null, row, `assignment rule ${rule.row_id}`))
      continue
    const pool = await sql`
      select "user" from assignment_rule_user
      where parent = ${rule.row_id as string} and parenttype = 'Assignment Rule'
      order by position`
    const users = pool.map((r) => r.user as string).filter(Boolean)
    if (!users.length) continue

    // Round-robin: continue after the previously assigned user.
    const lastIdx = users.indexOf(String(rule.last_user ?? ''))
    const next = users[(lastIdx + 1) % users.length]

    await createAssignment(
      table,
      String(row.row_id),
      next,
      'Administrator',
      (rule.description as string | null) || `Auto-assigned ${table} ${String(row.row_id)}`,
    )
    await sql`
      update assignment_rule set last_user = ${next} where row_id = ${rule.row_id as string}`

    const field = (rule.assign_to_field as string | null)?.trim()
    if (field) {
      // Stamp the assignee into the row's own column (post-commit, so the
      // column must exist on the Table; unknown columns are ignored).
      const meta = await getMeta(table)
      if (meta.columns.some((f) => f.column_name === field)) {
        await sql`
          update ${sql(tableName(table))} set ${sql(field)} = ${next}
          where ${sql(meta.row_key)} = ${String(row.row_id)}`
        row[field] = next
      }
    }
  }
}

import { holdManagedSet, managedFieldsOf } from './managed-settings'
import { sql } from './db'
import { tableRelation } from './table-engine'
import { getMeta } from './meta'
import { createAssignment } from './assign'
import { evalCondition } from './server-scripts'
import { directWriteRestriction } from './security-tables'

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
    // Refused when saved; legacy rules cannot bypass the direct-write guard.
    const restriction = await directWriteRestriction(table, String(rule.assign_to_field ?? '').trim())
    if (restriction) {
      console.warn(`[assignment-rules] ${String(rule.row_id)} targets ${table} ${restriction === 'access' ? 'access' : 'upload-managed'} data; skipped`)
      continue
    }
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
      if (!meta.columns.some((f) => f.column_name === field)) continue
      const relation = await tableRelation(table)
      const stamped = await sql.begin(async (tx) => {
        const stx = tx as unknown as typeof sql
        // #465 D5: never a field the instance settings file sets, judged
        // under the settings lock held to commit (#493).
        await holdManagedSet(stx, table)
        if ((await managedFieldsOf(table, String(row.row_id), stx)).includes(field)) return false
        await stx`
          update ${stx(relation)} set ${stx(field)} = ${next}
          where ${stx(meta.row_key)} = ${String(row.row_id)}`
        return true
      })
      if (stamped) row[field] = next
    }
  }
}

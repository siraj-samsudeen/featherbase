import { sql } from './db'
import { tableName } from './doctype-engine'
import { getMeta } from './meta'
import { createAssignment } from './assign'
import { evalCondition } from './server-scripts'

// Assignment Rules: metadata-driven auto-assignment. A rule names a DocType,
// an optional boolean condition over the new document, and a pool of users;
// each matching creation assigns the document round-robin across the pool
// (ToDo + notification, like a manual /api/assign). If the rule sets
// assign_to_field, the picked user is also written into that column so the
// document itself carries its assignee (e.g. a Ticket's `agent`).

export async function evaluateAssignmentRules(
  doctype: string,
  doc: Record<string, unknown>,
): Promise<void> {
  // The Assignment Rule DocType may not exist yet during early migrations.
  const [tableOk] = await sql`
    select 1 from information_schema.tables where table_name = 'tab_assignment_rule'`
  if (!tableOk) return

  const rules = await sql`
    select name, assign_condition, assign_to_field, last_user, description
    from tab_assignment_rule
    where document_type = ${doctype} and disabled = false`

  for (const rule of rules) {
    if (!evalCondition(rule.assign_condition as string | null, doc, `assignment rule ${rule.name}`))
      continue
    const pool = await sql`
      select "user" from tab_assignment_rule_user
      where parent = ${rule.name as string} and parenttype = 'Assignment Rule'
      order by idx`
    const users = pool.map((r) => r.user as string).filter(Boolean)
    if (!users.length) continue

    // Round-robin: continue after the previously assigned user.
    const lastIdx = users.indexOf(String(rule.last_user ?? ''))
    const next = users[(lastIdx + 1) % users.length]

    await createAssignment(
      doctype,
      String(doc.name),
      next,
      'Administrator',
      (rule.description as string | null) || `Auto-assigned ${doctype} ${String(doc.name)}`,
    )
    await sql`
      update tab_assignment_rule set last_user = ${next} where name = ${rule.name as string}`

    const field = (rule.assign_to_field as string | null)?.trim()
    if (field) {
      // Stamp the assignee into the document's own column (post-commit, so the
      // field must exist on the DocType; unknown fields are ignored).
      const meta = await getMeta(doctype)
      if (meta.fields.some((f) => f.fieldname === field)) {
        await sql`
          update ${sql(tableName(doctype))} set ${sql(field)} = ${next}
          where name = ${String(doc.name)}`
        doc[field] = next
      }
    }
  }
}

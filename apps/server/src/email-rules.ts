import { sql } from './db'
import { queueEmail, renderTemplate } from './email'
import { getMeta } from './meta'
import { OUTSIDE_READER, restrictRow } from './row-readers'

// EML-004: evaluate Email Rules for a lifecycle event and queue an email for
// each matching rule. Called post-commit so a rolled-back transaction never
// sends mail. A blank condition_field means the rule always fires.
//
// #340: the subject and message are rendered here, against the row without
// its restricted columns, so the email never carries one. The condition and
// the recipient still read the whole row: neither puts a value in the mail.

export type LifecycleEvent = 'on_create' | 'on_save' | 'on_submit' | 'on_cancel'

export async function evaluateEmailRules(
  event: LifecycleEvent,
  table: string,
  row: Record<string, unknown>,
  // The row as it was BEFORE this save (updates only). When given and the
  // rule has a condition, the rule fires only on the transition into the
  // matching value — a row that already matched last save doesn't re-fire the
  // rule on every subsequent save.
  old?: Record<string, unknown>,
): Promise<void> {
  // The Email Rule Table may not exist yet during early migrations.
  const [tableOk] = await sql`
    select 1 from information_schema.tables where table_name = 'email_rule'`
  if (!tableOk) return

  const rules = await sql`
    select row_id, condition_field, condition_value, recipient, subject, message
    from email_rule
    where ref_table = ${table} and event = ${event} and enabled = true`

  let visible: Record<string, unknown> | undefined
  for (const rule of rules) {
    const field = rule.condition_field as string | null
    if (field) {
      const expected = String(rule.condition_value ?? '')
      const actual = row[field] == null ? '' : String(row[field])
      if (actual !== expected) continue
      if (old) {
        const previous = old[field] == null ? '' : String(old[field])
        if (previous === expected) continue // already matched — not a transition
      }
    }
    // Recipient supports {{ doc.field }} so a rule can email the row's
    // own contact (e.g. {{doc.raised_by}}) instead of a fixed address.
    const to = renderTemplate(String(rule.recipient ?? ''), row).trim()
    if (!to) continue
    visible ??= await restrictRow(await getMeta(table), row, OUTSIDE_READER)
    await queueEmail({
      to,
      subject: rule.subject ? renderTemplate(String(rule.subject), visible) : `${table} ${String(row.row_id)} — ${event}`,
      body: renderTemplate(String(rule.message ?? ''), visible),
      ref_table: table,
      reference_name: String(row.row_id),
    })
  }
}

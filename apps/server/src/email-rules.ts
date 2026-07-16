import { sql } from './db'
import { queueEmail } from './email'

// EML-004: evaluate Email Rules for a lifecycle event and queue an email for
// each matching rule. Called post-commit so a rolled-back transaction never
// sends mail. A blank condition_field means the rule always fires.

export type LifecycleEvent = 'on_create' | 'on_save' | 'on_submit' | 'on_cancel'

export async function evaluateEmailRules(
  event: LifecycleEvent,
  doctype: string,
  doc: Record<string, unknown>,
): Promise<void> {
  // The Email Rule DocType may not exist yet during early migrations.
  const [tableOk] = await sql`
    select 1 from information_schema.tables where table_name = 'tab_email_rule'`
  if (!tableOk) return

  const rules = await sql`
    select name, condition_field, condition_value, recipient, subject, message
    from tab_email_rule
    where document_type = ${doctype} and event = ${event} and enabled = true`

  for (const rule of rules) {
    const field = rule.condition_field as string | null
    if (field) {
      const expected = String(rule.condition_value ?? '')
      const actual = doc[field] == null ? '' : String(doc[field])
      if (actual !== expected) continue
    }
    await queueEmail({
      to: rule.recipient as string,
      subject: (rule.subject as string) || `${doctype} ${String(doc.name)} — ${event}`,
      body: (rule.message as string) || '',
      reference_doctype: doctype,
      reference_name: String(doc.name),
      render: true,
    })
  }
}

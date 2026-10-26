// Who a system notice goes to: every enabled System Manager with an email
// address (the leaver-check summary, the waiting-for-access alert). A notice
// with nobody to send it to is recorded as undelivered, never dropped
// silently: one activity row and one JSON log line (#463).
import { logActivity } from './audit'
import { sql } from './db'

export const NO_RECIPIENTS = 'no System Manager has an email address'

/** Distinct, lower-cased addresses of enabled, current System Managers. */
export async function systemManagerEmails(): Promise<string[]> {
  const rows = await sql`
    select distinct lower(trim(p.email)) as email from person p
    join has_role r on r.parent = p.row_id and r.parenttype = 'Person' and r.role = 'System Manager'
    where p.enabled and p.replaced_by is null and coalesce(trim(p.email), '') <> ''
    order by 1`
  return rows.map((r) => String(r.email))
}

/** Record that `notice` reached nobody. `notice` names the kind of notice,
 *  never a person or an address. */
export async function recordUndeliveredNotice(notice: string): Promise<void> {
  await logActivity('system', `notice_undelivered: ${NO_RECIPIENTS} (${notice})`.slice(0, 140))
  console.warn(JSON.stringify({ event: 'notice_undelivered', notice, reason: NO_RECIPIENTS }))
}

// #429: people a sign-in rule let in hold no role and see only the no-access
// page. System Managers list them here and get one email per arrival.
import { sql, withTransaction } from './db'
import { logActivity } from './audit'
import { queueEmail, type MailMessage } from './email'
import { recordUndeliveredNotice, systemManagerEmails } from './system-notice'
import { config } from './config'
import { adminLinkOrigin } from './instance-addresses'
import type { SignInMethod } from './identities'

export const ALERT_SUBJECT = 'New sign-in waiting for access'
/** Alerts across the whole instance per day; past it, one line in the log. */
export const DAILY_ALERT_CAP = 20
/** The alert row's actor: the system, not a person (the person is the target). */
const ALERT_ACTOR = 'system'
const alertOperation = (person: string) => `access_alert for ${person}`
/** The day the cap counts: India's, whatever the database session's zone. */
const ALERT_DAY_ZONE = 'Asia/Kolkata'
const WAITING_PATH = '/featherbase/admin/waiting-for-access'

// A role of their own: `All` and `Guest` are implicit, so they do not count.
const waitingWhere = () => sql`
  p.enabled and not coalesce(p.built_in, false) and p.replaced_by is null
  and not exists (
    select 1 from has_role r
    where r.parent = p.row_id and r.parenttype = 'Person' and r.role not in ('All', 'Guest'))`

/** A name that is still an address shows as its domain only (#429). */
function shownName(name: string | null | undefined): string | null {
  if (!name) return null
  return name.includes('@') ? name.split('@').pop() || null : name
}

/** The dev mock Google provider serves whenever Google has no client id. */
export function isMockProvider(method: SignInMethod): boolean {
  return method.kind === 'google' && !String(method.client_id ?? '').trim()
}

// #835: the page lists them through the standard Person list, filtered by
// WAITING_FOR_ACCESS_FILTERS (shared); this count is the same cohort.
export async function countWaitingForAccess(): Promise<number> {
  const [row] = await sql`select count(*)::int as n from person p where ${waitingWhere()}`
  return Number(row.n)
}

// ------------------------------------------------------------------ alert

type Sender = (msg: MailMessage) => Promise<unknown>
let sender: Sender = queueEmail

/** Test seam: swap how alert mail is handed to the transport. */
export function _setAlertSender(fn: Sender | null): void {
  sender = fn ?? queueEmail
}

/** One email to every enabled System Manager with an address, the first time
 *  a sign-in rule creates `person`. Never throws: a sign-in must not fail
 *  because mail did. The cap is best-effort: arrivals at the same moment can
 *  pass it by a few. An arrival past the cap is recorded as alerted and is
 *  never mailed later; the page still lists them. Returns how many System
 *  Managers were mailed, or 'no recipients' when none has an address. */
export async function alertNewArrival(person: string, method: SignInMethod): Promise<number | 'no recipients'> {
  let delivered: number | 'no recipients' = 0
  try {
    // Runs after the sign-in's own transaction committed, in one of its own:
    // the activity row, the queued emails and their jobs commit together, or
    // none of them do.
    await withTransaction(async () => {
      const [p] = await sql`select p.full_name, p.email from person p where p.row_id = ${person} and ${waitingWhere()}`
      if (!p) return
      const [seen] = await sql`select 1 from activity_log where operation = ${alertOperation(person)} limit 1`
      if (seen) return
      const [{ n }] = await sql`
        select count(*)::int as n from activity_log
        where operation like 'access\_alert for %'
          and created_at >= (date_trunc('day', now() at time zone ${ALERT_DAY_ZONE}) at time zone ${ALERT_DAY_ZONE})`
      await logActivity(ALERT_ACTOR, alertOperation(person))
      if (Number(n) >= DAILY_ALERT_CAP) {
        if (Number(n) === DAILY_ALERT_CAP)
          console.warn(JSON.stringify({ event: 'waiting_for_access_alert_cap', cap: DAILY_ALERT_CAP, note: 'further alerts today are not emailed; see the Waiting for access page' }))
        return
      }
      const managers = await systemManagerEmails()
      if (!managers.length) {
        await recordUndeliveredNotice('waiting-for-access alert')
        delivered = 'no recipients'
        return
      }
      const domain = String(p.email ?? '').split('@')[1] || 'no address'
      const body = [
        'Someone signed in for the first time and has no access yet.',
        '',
        `Name: ${shownName(p.full_name as string | null) || 'not given'}`,
        `Email domain: ${domain}`,
        `Signed in with: ${method.label || method.key}`,
        '',
        `Give them roles from the Waiting for access page: ${adminLinkOrigin(config.instanceAddresses, config.environment) ?? ''}${WAITING_PATH}`,
      ].join('\n')
      for (const to of managers)
        await sender({ to, subject: ALERT_SUBJECT, body, ref_table: 'Person', reference_name: person })
      delivered = managers.length
    })
  } catch (err) {
    console.warn(JSON.stringify({ event: 'waiting_for_access_alert_failed', person, method: method.key, error: err instanceof Error ? err.message : String(err) }))
    return 0
  }
  return delivered
}

// #429: people a sign-in rule let in hold no role and see only the no-access
// page. System Managers list them here and get one email per arrival.
import { sql, withTransaction } from './db'
import { logActivity } from './audit'
import { queueEmail, type MailMessage } from './email'
import { SITE_URL } from './password-reset'
import type { SignInMethod } from './identities'

export const ALERT_SUBJECT = 'New sign-in waiting for access'
/** Alerts across the whole instance per day; past it, one line in the log. */
export const DAILY_ALERT_CAP = 20
const ALERT_OPERATION = 'access_alert'
export const WAITING_PATH = '/featherbase/admin/waiting-for-access'

// A role of their own: `All` and `Guest` are implicit, so they do not count.
const waitingWhere = () => sql`
  p.enabled and not coalesce(p.built_in, false) and p.replaced_by is null
  and not exists (
    select 1 from has_role r
    where r.parent = p.row_id and r.parenttype = 'Person' and r.role not in ('All', 'Guest'))`

export interface WaitingPerson {
  person: string
  full_name: string | null
  email_domain: string | null
  method: string | null
  method_label: string | null
  arrived_by: string | null
  created_at: string
  first_sign_in: string | null
  last_sign_in: string | null
}

const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString())

/** Newest first. Only the address's domain leaves the server here. */
export async function listWaitingForAccess(): Promise<WaitingPerson[]> {
  const rows = await sql`
    select p.row_id, p.full_name, nullif(split_part(p.email, '@', 2), '') as email_domain, p.created_at,
      i.method, m.label as method_label, i.linked_by, i.linked_at, i.last_used_at,
      l.first_login, l.last_login
    from person p
    left join lateral (
      -- How they arrived: the identity a rule created, else their first one.
      select method, linked_by, linked_at, last_used_at from sign_in_identity s
      where s.person_id = p.row_id
      order by (s.linked_by = 'new-person') desc, s.linked_at asc limit 1
    ) i on true
    left join sign_in_method m on m.row_id = i.method
    left join lateral (
      select min(a.created_at) as first_login, max(a.created_at) as last_login
      from activity_log a where a."user" = p.row_id and a.operation = 'login'
    ) l on true
    where ${waitingWhere()}
    order by p.created_at desc, p.row_id`
  return rows.map((r) => ({
    person: String(r.row_id),
    full_name: (r.full_name as string | null) ?? null,
    email_domain: (r.email_domain as string | null) ?? null,
    method: (r.method as string | null) ?? null,
    method_label: (r.method_label as string | null) || (r.method as string | null) || null,
    arrived_by: (r.linked_by as string | null) ?? null,
    created_at: iso(r.created_at)!,
    first_sign_in: iso(r.first_login),
    last_sign_in: iso(r.last_login ?? r.last_used_at),
  }))
}

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
 *  because mail did. */
export async function alertNewArrival(person: string, method: SignInMethod): Promise<void> {
  try {
    // A savepoint, so a failure here cannot poison a surrounding transaction.
    await withTransaction(async () => {
      const [p] = await sql`select p.full_name, p.email from person p where p.row_id = ${person} and ${waitingWhere()}`
      if (!p) return
      const [seen] = await sql`select 1 from activity_log where operation = ${ALERT_OPERATION} and "user" = ${person} limit 1`
      if (seen) return
      const [{ n }] = await sql`
        select count(*)::int as n from activity_log
        where operation = ${ALERT_OPERATION} and created_at >= date_trunc('day', now())`
      await logActivity(person, ALERT_OPERATION, { full_name: (p.full_name as string | null) ?? null, sign_in_method: method.key })
      if (Number(n) >= DAILY_ALERT_CAP) {
        if (Number(n) === DAILY_ALERT_CAP)
          console.warn(JSON.stringify({ event: 'waiting_for_access_alert_cap', cap: DAILY_ALERT_CAP, note: 'further alerts today are not emailed; see the Waiting for access page' }))
        return
      }
      const managers = await sql`
        select distinct p.email from person p
        join has_role r on r.parent = p.row_id and r.parenttype = 'Person' and r.role = 'System Manager'
        where p.enabled and p.replaced_by is null and coalesce(trim(p.email), '') <> ''
        order by p.email`
      const domain = String(p.email ?? '').split('@')[1] || 'no address'
      const body = [
        'Someone signed in for the first time and has no access yet.',
        '',
        `Name: ${(p.full_name as string | null) || 'not given'}`,
        `Email domain: ${domain}`,
        `Signed in with: ${method.label || method.key}`,
        '',
        `Give them roles from the Waiting for access page: ${SITE_URL}${WAITING_PATH}`,
      ].join('\n')
      for (const m of managers)
        await sender({ to: String(m.email), subject: ALERT_SUBJECT, body, ref_table: 'Person', reference_name: person })
    })
  } catch (err) {
    console.warn(JSON.stringify({ event: 'waiting_for_access_alert_failed', person, method: method.key, error: err instanceof Error ? err.message : String(err) }))
  }
}

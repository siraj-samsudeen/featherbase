// #429, #955: who is waiting for access, per app. A person waits for an app
// only after opening it without access: an installed app's pages, Feather
// Dash, or Featherbase itself. Opening it records one Access Request row;
// System Managers list them, get one email per person and app, and one
// reminder a day later. A request goes once the person can open that app,
// however they came to.
import { INTERIM_APPS } from 'shared'
import { sql, withTransaction } from './db'
import { logActivity } from './audit'
import { queueEmail, type MailMessage } from './email'
import { recordUndeliveredNotice, systemManagerEmails } from './system-notice'
import { config } from './config'
import { adminLinkOrigin } from './instance-addresses'
import { canOpenApp, canUseAdmin, homeApp } from './landing'
import { getRoles } from './permissions'
import { accessApprovers, appCatalog, servedApp } from './runtime-packages'
import { isInstalled } from './apps'
import { VIEWER_ROLE } from './sales-target'
import { errorMessage } from './errors'

export const ALERT_SUBJECT = 'Someone is waiting for access'
export const REMINDER_SUBJECT = 'Still waiting for access'
/** Alerts across the whole instance per day; past it, one line in the log. */
export const DAILY_ALERT_CAP = 20
/** How long a request waits before System Managers are reminded, once. */
export const REMINDER_AFTER_HOURS = 24
/** The alert row's actor: the system, not a person (the person is the target). */
const ALERT_ACTOR = 'system'
/** The day the cap counts: India's, whatever the database session's zone. */
const ALERT_DAY_ZONE = 'Asia/Kolkata'
const WAITING_PATH = '/featherbase/admin/waiting-for-access'

/** Featherbase itself: the Admin, or the report a viewer opens there. */
export const FEATHERBASE_APP = { name: 'featherbase', title: 'Featherbase' } as const

interface AccessTarget {
  name: string
  title: string
}

/** The app `name` names, as a person can ask for it: Featherbase, Feather
 *  Dash until it is installed, or an installed app whose pages are served
 *  here. Null for anything else, which nobody can ask for. */
export async function accessTarget(name: string): Promise<AccessTarget | null> {
  if (name === FEATHERBASE_APP.name) return FEATHERBASE_APP
  const interim = Object.hasOwn(INTERIM_APPS, name) ? INTERIM_APPS[name] : undefined
  if (interim && !(await isInstalled(name))) return { name, title: interim.title }
  return servedApp(name)
}

/** Can `person` open `app` now: the same rule as the page they opened. */
export async function canOpen(person: string, app: string): Promise<boolean> {
  if (app !== FEATHERBASE_APP.name) return canOpenApp(person, app)
  return (await canUseAdmin(person)) || (await getRoles(person)).includes(VIEWER_ROLE)
}

/** Removes every request whose person can now open its app, or who can no
 *  longer sign in. Run before the list is counted, so the count, the list and
 *  the reminder agree with what each person can open right now. */
export async function settleAccessRequests(): Promise<void> {
  const rows = await sql`
    select r.row_id, r.person, r.app_name,
      coalesce(p.enabled and p.replaced_by is null, false) as live
    from access_request r left join person p on p.row_id = r.person`
  const settled: string[] = []
  for (const row of rows)
    if (!row.live || (await canOpen(String(row.person), String(row.app_name)))) settled.push(String(row.row_id))
  if (settled.length) await sql`delete from access_request where row_id in ${sql(settled)}`
}

export async function countWaitingForAccess(): Promise<number> {
  await settleAccessRequests()
  const [row] = await sql`select count(*)::int as n from access_request where declined_at is null`
  return Number(row.n)
}

export interface AccessAnswer {
  /** `open`: they can open it after all. `waiting`: an admin has been told.
   *  `elsewhere`: they belong in the app at `home`, and nobody was told.
   *  `declined`: an admin declined it (#1173); nobody is told again. */
  state: 'open' | 'waiting' | 'elsewhere' | 'apps' | 'declined'
  title: string
  home?: string
  /** `apps`: the apps they can open, each open to everyone (#659: none of them is theirs). */
  apps?: { name: string; title: string; href: string }[]
}

/** `person` opened `app` without access, as far as the page knew: record
 *  their request and, the first time, tell the System Managers. Null when
 *  `app` names nothing a person can ask for, or `person` is a built-in
 *  account. Never throws for mail. */
export async function requestAccess(person: string, app: string): Promise<AccessAnswer | null> {
  const target = await accessTarget(app)
  if (!target) return null
  if (await canOpen(person, target.name)) return { state: 'open', title: target.title }
  // Found on staging (10-Nov-2026): someone who belongs in an app, sent to the Admin, isn't waiting
  // for it. Their app is named so the page sends them there; nothing is recorded or mailed.
  if (target.name === 'featherbase') {
    const home = await homeApp(person)
    if (home) return { state: 'elsewhere', title: target.title, home }
    // Only apps open to everyone: shown them, and nobody is told.
    const apps = (await appCatalog(person)).map(({ name, title, href }) => ({ name, title, href }))
    if (apps.length) return { state: 'apps', title: target.title, apps }
  }
  // A built-in account (Administrator, Guest) is nobody to give a role to:
  // it asks for nothing, and an app's address shows it as unavailable.
  const [{ built_in: builtIn }] = await sql`select coalesce(built_in, false) as built_in from person where row_id = ${person}`
  if (builtIn) return null
  const made = await sql`
    insert into access_request (row_id, person, email, app, app_name, created_by, updated_by)
    select substr(md5(random()::text || clock_timestamp()::text), 1, 10), p.row_id, p.email, ${target.title}, ${target.name}, p.row_id, p.row_id
    from person p where p.row_id = ${person}
    on conflict (person, app_name) do nothing
    returning row_id`
  if (made.length) await alertAccessRequest(person, target)
  else {
    const [held] = await sql`select declined_at from access_request where person = ${person} and app_name = ${target.name}`
    if (held?.declined_at) return { state: 'declined', title: target.title }
  }
  return { state: 'waiting', title: target.title }
}

// ------------------------------------------------------------------ mail

type Sender = (msg: MailMessage) => Promise<unknown>
let sender: Sender = queueEmail

/** Test seam: swap how alert mail is handed to the transport. */
export function _setAlertSender(fn: Sender | null): void {
  sender = fn ?? queueEmail
}

const linkOrigin = () => adminLinkOrigin(config.instanceAddresses, config.environment) ?? ''
const pageLink = () => `${linkOrigin()}${WAITING_PATH}`

/** #1046: the enabled people with an address who hold one of `roles`
 *  directly or through an App Role Binding of `app`, System Managers left
 *  out (they get the System Managers' mail). */
async function approverEmails(app: string, roles: readonly string[]): Promise<string[]> {
  if (!roles.length) return []
  const rows = await sql`
    select distinct lower(trim(p.email)) as email from person p
    join has_role r on r.parent = p.row_id and r.parenttype = 'Person'
    where p.enabled and p.replaced_by is null and coalesce(trim(p.email), '') <> ''
      and (r.role in ${sql([...roles])} or r.role in (
        select b.bound_role from app_role_binding b where b.app = ${app} and b.app_role in ${sql([...roles])}))
      and not exists (select 1 from has_role s where s.parent = p.row_id and s.parenttype = 'Person' and s.role = 'System Manager')
    order by 1`
  return rows.map((r) => String(r.email))
}

/** A name that is still an address shows as its domain only (#429). */
function shownName(name: string | null | undefined): string | null {
  if (!name) return null
  return name.includes('@') ? name.split('@').pop() || null : name
}

/** One email to every enabled System Manager with an address. The cap is
 *  best-effort: requests at the same moment can pass it by a few. A request
 *  past the cap is not mailed now; the page lists it and the reminder names
 *  it. Returns how many were mailed, or 'no recipients' when none has an
 *  address. Never throws: the page must open whatever mail does. */
export async function alertAccessRequest(person: string, target: AccessTarget): Promise<number | 'no recipients'> {
  let delivered: number | 'no recipients' = 0
  try {
    // The activity row, the queued emails and their jobs commit together, or
    // none of them do.
    await withTransaction(async () => {
      const [{ n }] = await sql`
        select count(*)::int as n from activity_log
        where operation like 'access\_alert for %'
          and created_at >= (date_trunc('day', now() at time zone ${ALERT_DAY_ZONE}) at time zone ${ALERT_DAY_ZONE})`
      await logActivity(ALERT_ACTOR, `access_alert for ${person} in ${target.name}`)
      if (Number(n) >= DAILY_ALERT_CAP) {
        if (Number(n) === DAILY_ALERT_CAP)
          console.warn(JSON.stringify({ event: 'waiting_for_access_alert_cap', cap: DAILY_ALERT_CAP, note: 'further alerts today are not emailed; see the Waiting for access page' }))
        return
      }
      const managers = await systemManagerEmails()
      const approvers = accessApprovers(target.name)
      const others = (await approverEmails(target.name, approvers.roles)).filter((to) => !managers.includes(to))
      if (!managers.length && !others.length) {
        await recordUndeliveredNotice('waiting-for-access alert')
        delivered = 'no recipients'
        return
      }
      const [p] = await sql`select full_name, email from person where row_id = ${person}`
      const body = [
        `Someone opened ${target.title} and has no access to it yet.`,
        '',
        `Name: ${shownName(p.full_name as string | null) || 'not given'}`,
        `Email domain: ${String(p.email ?? '').split('@')[1] || 'no address'}`,
        `App: ${target.title}`,
        '',
        `Give them a role from the Waiting for access page: ${pageLink()}`,
      ].join('\n')
      for (const to of managers)
        await sender({ to, subject: ALERT_SUBJECT, body, ref_table: 'Person', reference_name: person })
      // #1046: an app's approvers give access on the app's own page.
      const theirs = body.replace(`Give them a role from the Waiting for access page: ${pageLink()}`,
        approvers.page ? `See who is waiting, and give them access: ${linkOrigin()}${approvers.page}` : `Give them access in ${target.title}.`)
      for (const to of others)
        await sender({ to, subject: ALERT_SUBJECT, body: theirs, ref_table: 'Person', reference_name: person })
      delivered = managers.length + others.length
    })
  } catch (err) {
    console.warn(JSON.stringify({ event: 'waiting_for_access_alert_failed', person, app: target.name, error: errorMessage(err) }))
    return 0
  }
  return delivered
}

/** The SLA: every request still waiting a day after it was made goes into
 *  one reminder to each System Manager, once. Returns how many requests the
 *  reminder named, or 'no recipients' when no System Manager has an address. */
export async function remindAccessRequests(): Promise<number | 'no recipients'> {
  await settleAccessRequests()
  return withTransaction(async () => {
    const dueWhere = sql`declined_at is null and reminded_at is null and created_at < now() - make_interval(hours => ${REMINDER_AFTER_HOURS})`
    const managers = await systemManagerEmails()
    // With nobody to tell, nothing is marked reminded: a later run, once a
    // System Manager has an address, still names these requests.
    if (!managers.length) {
      const [waiting] = await sql`select 1 from access_request where ${dueWhere} limit 1`
      if (!waiting) return 0
      await recordUndeliveredNotice('waiting-for-access reminder')
      return 'no recipients'
    }
    const due = await sql`update access_request set reminded_at = now() where ${dueWhere} returning person, app, created_at`
    if (!due.length) return 0
    const names = await sql`select row_id, full_name, email from person where row_id in ${sql(due.map((r) => String(r.person)))}`
    const who = new Map(names.map((p) => [String(p.row_id), shownName(p.full_name as string | null) || 'not given']))
    const lines = [...due]
      .sort((a, b) => +new Date(a.created_at as string) - +new Date(b.created_at as string))
      .map((r) => `- ${who.get(String(r.person))}, ${r.app as string}`)
    const body = [
      `${due.length === 1 ? 'This request has' : `These ${due.length} requests have`} waited more than a day for access:`,
      '',
      ...lines,
      '',
      `Give them a role from the Waiting for access page: ${pageLink()}`,
    ].join('\n')
    for (const to of managers) await sender({ to, subject: REMINDER_SUBJECT, body })
    return due.length
  })
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)

/** #1173: what a person whose request was declined is told; never the reason. */
export const DECLINED_LINE = 'An admin declined your request. Ask your manager if you need it.'

/** What an installed app's address shows a person who has just asked for it
 *  by opening it. */
export function noAccessYetPage(title: string, declined = false): string {
  const app = escapeHtml(title)
  if (declined)
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>No access to ${app}</title></head>
      <body style="font:16px system-ui;background:#f4f5f6;color:#1c2126;margin:0;padding:8vw"><main data-testid="access-declined" style="max-width:36rem;margin:auto;background:white;border:1px solid #ebeef0;border-radius:8px;padding:2rem">
      <h1>You don't have access to ${app}</h1><p>${DECLINED_LINE}</p>
      <p><a href="/featherbase/login">Sign in as someone else</a></p></main></body></html>`
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>No access to ${app} yet</title></head>
      <body style="font:16px system-ui;background:#f4f5f6;color:#1c2126;margin:0;padding:8vw"><main data-testid="no-access-yet" style="max-width:36rem;margin:auto;background:white;border:1px solid #ebeef0;border-radius:8px;padding:2rem">
      <h1>You don't have access to ${app} yet</h1><p>An admin has been told. Once they give you access, open this page again.</p>
      <p><a href="/featherbase/login">Sign in as someone else</a></p></main></body></html>`
}

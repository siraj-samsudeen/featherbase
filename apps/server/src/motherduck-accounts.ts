// #1346: MotherDuck Accounts, kept in step with MotherDuck's own list of users,
// as the roster sync keeps Employees in step with HR.
//
// - The list comes from GET {MOTHERDUCK_API_BASE}/v1/users with the server's one
//   MOTHERDUCK_TOKEN. Featherbase only ever reads MotherDuck: GET calls only.
//   MotherDuck answers only a token whose role may view all members; without it
//   the run stops and says what to grant.
// - Three statuses. Active: listed and usable. Deprovisioned: listed, but
//   MotherDuck says `is_deprovisioned`. Removed: no longer listed; the row stays,
//   with the day it went. Nothing is ever deleted.
// - An account is linked to its Person when exactly one enabled person has its
//   email. Every other account a person uses gets one ticket (the Tickets app's
//   own create action, as the master sync raises its tickets), assigned to the
//   System Settings' MotherDuck reviewer. Once the account has a Person, by
//   email or by hand, the sync resolves that ticket.
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { sql } from './db'
import { readVariable } from './env'
import { saveDoc } from './document'
import { runAsSystemActor } from './system-actor'
import { runPackageAction } from './runtime-packages'
import { withAppIdentity } from './app-lifecycle'
import { actionTransaction } from './action-transaction'
import { createServiceAccount } from './service-accounts'
import { describePeople, type Standing } from './person-standing'

export const MOTHERDUCK_ACCOUNT_TABLE = 'MotherDuck Account'
export const MOTHERDUCK_ACCOUNT_JOB = 'sync_motherduck_accounts'
const TICKETS_APP = 'tickets'
const SYNC_ACCOUNT_LABEL = 'svc-motherduck-sync'

/** A run that cannot go on, said in words an operator can act on. */
export class MotherDuckSyncStop extends Error {}

const userSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  email: z.string().nullish(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  is_service_account: z.boolean().nullish(),
  is_deprovisioned: z.boolean().nullish(),
  roles: z.array(z.string()).nullish(),
})
const pageSchema = z.object({ users: z.array(userSchema), next_page_token: z.string().nullish() })
export type MotherDuckUser = z.infer<typeof userSchema>

type Fetch = (url: string, init: RequestInit) => Promise<Response>
// Injectable for the sandboxed suite (no network).
let fetcher: Fetch = fetch
export function _setMotherDuckUsersFetch(f: Fetch | null) {
  fetcher = f ?? fetch
}

/** Every user MotherDuck lists, all pages. The token is sent, never logged or returned. */
export async function listMotherDuckUsers(): Promise<MotherDuckUser[]> {
  const token = readVariable('MOTHERDUCK_TOKEN')
  if (!token?.trim()) throw new MotherDuckSyncStop('MOTHERDUCK_TOKEN is not set, so there is no MotherDuck to read')
  const base = (readVariable('MOTHERDUCK_API_BASE') ?? 'https://api.motherduck.com').replace(/\/+$/, '')
  const users: MotherDuckUser[] = []
  let page: string | null = null
  for (let pages = 1; ; pages++) {
    const url = new URL(`${base}/v1/users`)
    url.searchParams.set('limit', '100')
    if (page) url.searchParams.set('page_token', page)
    const res = await fetcher(url.toString(), {
      method: 'GET', headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(30_000),
    })
    if (res.status === 401 || res.status === 403)
      throw new MotherDuckSyncStop(`MotherDuck refused to list its users (${res.status}). In MotherDuck, give the role of the account `
        + 'MOTHERDUCK_TOKEN signs in as the permission "View all members" (member_management.view_all_members). Featherbase only reads; it needs no Admin token.')
    if (!res.ok) throw new Error(`MotherDuck answered ${res.status} when asked for its users`)
    const parsed = pageSchema.safeParse(await res.json())
    if (!parsed.success) throw new Error('MotherDuck answered its list of users in a shape this server does not know')
    users.push(...parsed.data.users)
    page = parsed.data.next_page_token || null
    if (!page) return users
    if (pages >= 200) throw new Error('MotherDuck kept answering with more pages; stopped after 200')
  }
}

export interface MotherDuckSyncResult {
  listed: number; added: number; updated: number; removed: number; linked: number
  tickets_raised: string[]; tickets_resolved: string[]; ticket_errors: string[]
}

const today = () => new Date().toISOString().slice(0, 10)
// A ticket's revision, as the Tickets app reads it back.
const iso = (v: unknown) => new Date(v as string).toISOString()
const day = (v: unknown) => v ? new Date(v as string).toISOString().slice(0, 10) : ''
const statusOf = (u: MotherDuckUser) => u.is_deprovisioned ? 'Deprovisioned' : 'Active'
const nameOf = (u: MotherDuckUser) => [u.first_name, u.last_name].filter((p) => p?.trim()).join(' ') || null

/** The service account the sync writes and raises tickets as: never a person.
 *  Tickets lets only its support people assign and resolve, so an instance that
 *  wants the review tickets lists this account in Tickets' support_users. */
export async function motherDuckSyncAccount(): Promise<string> {
  return actionTransaction(async () => {
    await sql`select pg_advisory_xact_lock(hashtext('motherduck-sync-account'))`
    const [found] = await sql`select row_id from service_account where lower(label) = lower(${SYNC_ACCOUNT_LABEL})`
    return found ? String(found.row_id) : (await createServiceAccount(SYNC_ACCOUNT_LABEL, ['All'], 'Administrator')).row_id
  })
}

/** One run: list, bring every row in step, link by email, then raise and resolve tickets. */
export async function syncMotherDuckAccounts(): Promise<MotherDuckSyncResult> {
  const users = await listMotherDuckUsers()
  const actor = await motherDuckSyncAccount()
  const result: MotherDuckSyncResult = { listed: users.length, added: 0, updated: 0, removed: 0, linked: 0, tickets_raised: [], tickets_resolved: [], ticket_errors: [] }
  await runAsSystemActor(actor, async () => {
    const stored = new Map((await sql`select * from motherduck_account`).map((r) => [String(r.row_id), r]))
    const on = today()
    for (const u of users) {
      const row = stored.get(u.id)
      const fields: Record<string, unknown> = {
        username: u.username, email: u.email?.trim() || null, full_name: nameOf(u),
        roles: (u.roles ?? []).join(', ') || null, service_account: Boolean(u.is_service_account),
        account_status: statusOf(u), removed_on: null, last_listed_on: on,
      }
      if (!row) {
        await saveDoc(MOTHERDUCK_ACCOUNT_TABLE, { row_id: u.id }, actor, 'insert', { managedValues: { ...fields, first_listed_on: on } })
        result.added++
        continue
      }
      const changed = Object.entries(fields).some(([k, v]) => k === 'last_listed_on' ? day(row[k]) !== on
        : k === 'removed_on' ? row[k] != null : String(row[k] ?? '') !== String(v ?? ''))
      if (changed) {
        await saveDoc(MOTHERDUCK_ACCOUNT_TABLE, { row_id: u.id, updated_at: row.updated_at }, actor, 'upsert', { managedValues: fields })
        result.updated++
      }
    }
    const listed = new Set(users.map((u) => u.id))
    for (const [id, row] of stored) {
      if (listed.has(id) || row.account_status === 'Removed') continue
      await saveDoc(MOTHERDUCK_ACCOUNT_TABLE, { row_id: id, updated_at: row.updated_at }, actor, 'upsert', { managedValues: { account_status: 'Removed', removed_on: on } })
      result.removed++
    }
    result.linked = await linkByEmail(actor)
  })
  await reviewTickets(actor, result)
  return result
}

/** Exactly one person with the account's email (a leaver too; never one merged into
 *  another) is who uses it: link it. Never overwrites a link. */
async function linkByEmail(actor: string): Promise<number> {
  const sure = await sql`
    select a.row_id, a.updated_at, min(p.row_id) as person from motherduck_account a
    join person p on p.replaced_by is null and p.email is not null and lower(trim(p.email)) = lower(trim(a.email))
    where a.person is null and a.email is not null and not a.service_account
    group by a.row_id, a.updated_at having count(*) = 1`
  for (const a of sure)
    await saveDoc(MOTHERDUCK_ACCOUNT_TABLE, { row_id: a.row_id, updated_at: a.updated_at, person: a.person }, actor)
  return sure.length
}

/** One candidate as the reviewer reads it: name (id) · code · job at place. */
/** Who a person is to the organisation, as a reviewer reads it: name · code · job at place. */
export function personWords(name: string, s: Standing | undefined): string {
  const jobs = (s?.jobs ?? []).map((j) => [j.job, j.site?.name].filter(Boolean).join(' at ')).join('; ')
  return [name, s?.code, jobs].filter(Boolean).join(' · ')
}

/** One candidate as the reviewer reads it in a ticket: name (id) · code · job at place. */
export function candidateLine(name: string, person: string, s: Standing | undefined): string {
  return `- ${personWords(`${name} (${person})`, s)}`
}

/** A person whose name a username reads as, with who they are to the organisation. */
export interface SuggestedPerson { person: string; name: string; standing: Standing | undefined }

/** The key a username is matched on: its letters, without the `ea_` prefix. */
const nameKey = (username: string) => username.replace(/^ea_/i, '').toLowerCase().replace(/[^a-z]/g, '')

/** People whose name each username reads as, for the reviewer to choose from. */
export async function suggestedPeople(usernames: string[]): Promise<Map<string, SuggestedPerson[]>> {
  const keys = [...new Set(usernames.map(nameKey))]
  // Three letters at least: a shorter key reads as everyone.
  const rows = keys.length ? await sql`select k.key, p.row_id, p.full_name from unnest(${keys}::text[]) as k(key)
    cross join lateral (select row_id, full_name from person where replaced_by is null and full_name is not null
      and length(k.key) >= 3 and regexp_replace(lower(full_name), '[^a-z]', '', 'g') like k.key || '%'
      order by lower(full_name) collate "C", row_id limit 6) p order by k.key, lower(p.full_name) collate "C", p.row_id` : []
  const standing = await describePeople(rows.map((r) => String(r.row_id)))
  const byKey = new Map<string, SuggestedPerson[]>()
  for (const r of rows)
    byKey.set(String(r.key), [...(byKey.get(String(r.key)) ?? []),
      { person: String(r.row_id), name: String(r.full_name), standing: standing.get(String(r.row_id)) }])
  return new Map(usernames.map((u) => [u, byKey.get(nameKey(u)) ?? []]))
}

/** #1396: one account as the Link to people screen shows it. */
export interface LinkingAccount {
  row_id: string; username: string; full_name: string | null; email: string | null
  account_status: string; service_account: boolean; review_ticket: string | null; updated_at: string
  person: { id: string; name: string } | null
  /** Only for an account a person uses and that has no Person yet. */
  suggestions: { person: string; name: string; label: string }[]
}

/** Every account, with its person and, for one still to link, the people its username reads as. */
export async function linkingAccounts(): Promise<LinkingAccount[]> {
  const rows = await sql`select a.row_id, a.username, a.full_name, a.email, a.account_status, a.service_account, a.review_ticket,
    a.updated_at, a.person, p.full_name as person_name
    from motherduck_account a left join person p on p.row_id = a.person order by lower(a.username), a.row_id`
  const open = rows.filter((r) => !r.person && !r.service_account).map((r) => String(r.username))
  const suggested = await suggestedPeople(open)
  return rows.map((r) => ({
    row_id: String(r.row_id), username: String(r.username), full_name: r.full_name ?? null, email: r.email ?? null,
    account_status: String(r.account_status), service_account: Boolean(r.service_account),
    review_ticket: r.review_ticket ?? null, updated_at: iso(r.updated_at),
    person: r.person ? { id: String(r.person), name: String(r.person_name ?? r.person) } : null,
    suggestions: (suggested.get(String(r.username)) ?? [])
      .map((s) => ({ person: s.person, name: s.name, label: personWords(s.name, s.standing) })),
  }))
}

async function candidates(username: string): Promise<string[]> {
  return ((await suggestedPeople([username])).get(username) ?? []).map((p) => candidateLine(p.name, p.person, p.standing))
}

async function ticketAction<T>(actor: string, operation: string, payload: Record<string, unknown>, key: string): Promise<T> {
  const [installed] = await sql`select package_version from installed_app where name = ${TICKETS_APP} and enabled`
  if (!installed) throw new MotherDuckSyncStop('the Tickets app is not installed and on, so no ticket was raised')
  try {
    const answer = await runAsSystemActor(actor, () => withAppIdentity(TICKETS_APP, String(installed.package_version),
      () => runPackageAction(TICKETS_APP, operation, { idempotencyKey: key, payload }, actor))) as { result: T }
    return answer.result
  } catch (error) {
    if (/Only support|Not authorized/.test(String(error)))
      throw new MotherDuckSyncStop(`Tickets refused the MotherDuck sync's service account (${actor}): add it to the Tickets setting support_users, so it may assign and close its review tickets`)
    throw error
  }
}

/** One ticket step for one account. A stop (Tickets refuses the sync, or is not
 *  on) ends the ticket work for this run; any other error is noted and the
 *  next account goes on. */
async function attempt(result: MotherDuckSyncResult, account: unknown, step: () => Promise<void>): Promise<boolean> {
  try {
    await step()
    return true
  } catch (error) {
    result.ticket_errors.push(error instanceof MotherDuckSyncStop ? error.message : `${String(account)}: ${String(error).slice(0, 200)}`)
    return !(error instanceof MotherDuckSyncStop)
  }
}

const UMBRELLA_TITLE = 'MotherDuck accounts to link to people'
const OPEN = (column: string) => sql`${sql(column)} not in ('Resolved', 'Closed')`

/** #1397: the one umbrella ticket the review tickets sit under, found by the marker in its
 *  details whatever its state, never by its title. */
async function findUmbrella(actor: string) {
  const [found] = await sql`select t.row_id, t.updated_at, t.ticket_state, t.assigned_to from tickets.ticket t join tickets.request r on r.row_id = t.row_id
    where t.created_by = ${actor} and r.details_json::jsonb ? 'motherduck_umbrella' order by t.created_at, t.row_id limit 1`
  return found
}

/** The umbrella, open, for a ticket about to be raised under it: raised once, reopened after. */
async function openUmbrella(actor: string, assignee: string | null): Promise<string> {
  let umbrella = await findUmbrella(actor)
  if (!umbrella) {
    const original = [
      'Every MotherDuck user the daily sync could not link to a person by email has a ticket under this one.',
      'Link each by setting Person on its MotherDuck Account; its ticket then closes itself, and this one closes when none is left.',
    ].join('\n\n')
    // A stopped run that raised it is found again above, so the key only guards a replay within a run.
    await ticketAction(actor, 'create', { title: UMBRELLA_TITLE, original, details: { motherduck_umbrella: 'accounts' }, ...(assignee ? { raiser: assignee } : {}) },
      `motherduck-umbrella-${today()}`)
    umbrella = await findUmbrella(actor)
  } else if (['Resolved', 'Closed'].includes(String(umbrella.ticket_state))) {
    await ticketAction(actor, 'reopen', { row_id: String(umbrella.row_id), updated_at: iso(umbrella.updated_at), reason: 'A MotherDuck user needs linking to a person again.' },
      `motherduck-umbrella-reopen-${String(umbrella.row_id)}-${iso(umbrella.updated_at)}`)
    umbrella = await findUmbrella(actor)
  }
  return String(umbrella.row_id)
}

/** One ticket per account a person uses that has no Person; resolved once it has one. */
async function reviewTickets(actor: string, result: MotherDuckSyncResult): Promise<void> {
  const [reviewer] = await sql`select value from single_value where table_name = 'System Settings' and field = 'motherduck_reviewer'`
  const assignee = reviewer?.value ? String(reviewer.value) : null
  // Every account no ticket is recorded on: a ticket a stopped run raised is
  // found again even if the account was linked since (Codex round 2); a new one
  // is raised only for an account still unlinked and still in MotherDuck.
  const unrecorded = await sql`select row_id, updated_at, username, email, account_status, person from motherduck_account
    where review_ticket is null and not service_account order by username`
  const needsTicket = (a: (typeof unrecorded)[number]) => a.person == null && a.account_status !== 'Removed'
  // Asked first, not caught: a failed query would end a caller's transaction.
  const [tickets] = await sql`select to_regclass('tickets.ticket') is not null as present`
  if (!tickets?.present) {
    if (unrecorded.some(needsTicket)) result.ticket_errors.push('the Tickets app is not installed and on, so no ticket was raised')
    return
  }
  // #1397: every ticket raised sits under the umbrella, opened (or reopened) only when one is raised.
  let umbrella: string | null = null
  for (const a of unrecorded) {
    const going = await attempt(result, a.username, async () => {
      const title = `Link MotherDuck user ${String(a.username)} to a person`
      // Codex: a run that raised the ticket but stopped before recording it left
      // it open with no account naming it; it is found again, never raised twice.
      // By the account's MotherDuck id in the ticket's details, never its title:
      // a username can be reused by another account (Codex round 3).
      const [orphan] = await sql`select t.row_id from tickets.ticket t join tickets.request r on r.row_id = t.row_id
        where t.created_by = ${actor} and t.ticket_state not in ('Resolved', 'Closed')
          and r.details_json::jsonb ->> 'motherduck_account' = ${String(a.row_id)}
        order by t.created_at, t.row_id limit 1`
      if (!orphan && !needsTicket(a)) return
      const people = orphan ? [] : await candidates(String(a.username))
      const original = [
        `MotherDuck user ${String(a.username)} is not linked to a person in Featherbase.`,
        `Email in MotherDuck: ${a.email ? String(a.email) : '(none)'}. Status: ${String(a.account_status)}.`,
        people.length ? `People whose name it reads as:\n${people.join('\n')}` : 'No person\'s name reads as this username.',
        `Link it by setting Person on the MotherDuck Account ${String(a.username)}; this ticket then closes itself.`,
      ].join('\n\n')
      // Raised for the reviewer: a ticket's request is private to the person it is
      // raised for and Tickets support, and the reviewer must read who it may be.
      if (!orphan) umbrella ??= await openUmbrella(actor, assignee)
      const payload = { title, original, details: { motherduck_account: String(a.row_id) }, ...(assignee ? { raiser: assignee } : {}),
        ...(umbrella ? { parent_ticket: umbrella } : {}) }
      const ticket = orphan ? String(orphan.row_id) : String((await ticketAction<{ ticket: { row_id: string } }>(actor, 'create', payload,
        `motherduck-account-${String(a.row_id)}-${createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16)}`)).ticket.row_id)
      await runAsSystemActor(actor, () => saveDoc(MOTHERDUCK_ACCOUNT_TABLE, { row_id: a.row_id, updated_at: a.updated_at }, actor, 'upsert',
        { managedValues: { review_ticket: ticket } }))
      if (!orphan) result.tickets_raised.push(ticket)
    })
    if (!going) return
  }
  // Each open review ticket nobody is assigned to goes to the reviewer, this run
  // or a later one; one support has reassigned is left as it is.
  // #1397: the umbrella too, here and not where it is raised: assigning needs support, raising does not.
  const unassigned = await sql`select a.username, t.row_id, t.updated_at from motherduck_account a
    join tickets.ticket t on t.row_id = a.review_ticket
    where a.person is null and t.assigned_to is null and t.ticket_state not in ('Resolved', 'Closed')
    union all select ${UMBRELLA_TITLE}, t.row_id, t.updated_at from tickets.ticket t join tickets.request r on r.row_id = t.row_id
    where t.created_by = ${actor} and r.details_json::jsonb ? 'motherduck_umbrella' and t.assigned_to is null and t.ticket_state not in ('Resolved', 'Closed')`
  // Codex round 2: tickets nobody is given are said, not left silent; they are
  // assigned on the first run after a reviewer is set.
  if (unassigned.length && !assignee)
    result.ticket_errors.push(`no MotherDuck reviewer is set in System Settings, so ${unassigned.length} review tickets are not assigned to anyone`)
  for (const t of assignee ? unassigned : []) {
    const going = await attempt(result, t.username, () => ticketAction(actor, 'edit', { row_id: String(t.row_id), updated_at: iso(t.updated_at), assigned_to: assignee },
      `motherduck-account-assign-${String(t.row_id)}-${iso(t.updated_at)}`))
    if (!going) return
  }
  const linked = await sql`select a.username, a.review_ticket, t.updated_at from motherduck_account a
    join tickets.ticket t on t.row_id = a.review_ticket
    where a.person is not null and t.ticket_state not in ('Resolved', 'Closed')`
  for (const a of linked) {
    await attempt(result, a.username, async () => {
      await ticketAction(actor, 'resolve', { row_id: String(a.review_ticket), updated_at: iso(a.updated_at),
        reason: `MotherDuck user ${String(a.username)} is now linked to a person.`, reference: `MotherDuck Account ${String(a.username)}` },
        `motherduck-account-resolve-${String(a.review_ticket)}-${iso(a.updated_at)}`)
      result.tickets_resolved.push(String(a.review_ticket))
    })
  }
  // The umbrella closes when none of its tickets is open; the next one raised opens it again.
  const open = await findUmbrella(actor)
  if (!open || ['Resolved', 'Closed'].includes(String(open.ticket_state))) return
  const [left] = await sql`select count(*)::int as n from tickets.ticket where parent_ticket = ${String(open.row_id)} and ${OPEN('ticket_state')}`
  if (left.n > 0) return
  await attempt(result, UMBRELLA_TITLE, async () => {
    await ticketAction(actor, 'resolve', { row_id: String(open.row_id), updated_at: iso(open.updated_at),
      reason: 'Every MotherDuck user under it is linked to a person.', reference: 'MotherDuck Accounts' },
      `motherduck-umbrella-resolve-${String(open.row_id)}-${iso(open.updated_at)}`)
    result.tickets_resolved.push(String(open.row_id))
  })
}

/** #1397: review tickets raised before the umbrella (or taken out of it), still open, under no parent.
 *  A dry run lists them; `apply` files each under the umbrella, opening it if need be. */
export async function fileReviewTicketsUnderUmbrella(apply: boolean): Promise<{ umbrella: string | null; tickets: string[]; filed: string[]; errors: string[] }> {
  const [installed] = await sql`select to_regclass('tickets.ticket') is not null as present`
  if (!installed?.present) return { umbrella: null, tickets: [], filed: [], errors: ['the Tickets app is not installed, so there are no review tickets to file'] }
  const actor = await motherDuckSyncAccount()
  const loose = await sql`select t.row_id, t.updated_at from motherduck_account a join tickets.ticket t on t.row_id = a.review_ticket
    where t.parent_ticket is null and ${OPEN('ticket_state')} order by t.row_id`
  const tickets = loose.map((t) => String(t.row_id))
  const known = await findUmbrella(actor)
  if (!apply || !loose.length) return { umbrella: known ? String(known.row_id) : null, tickets, filed: [], errors: [] }
  const [reviewer] = await sql`select value from single_value where table_name = 'System Settings' and field = 'motherduck_reviewer'`
  const filed: string[] = [], errors: string[] = []
  return runAsSystemActor(actor, async () => {
    const umbrella = await openUmbrella(actor, reviewer?.value ? String(reviewer.value) : null)
    for (const t of loose) {
      try {
        await ticketAction(actor, 'edit', { row_id: String(t.row_id), updated_at: iso(t.updated_at), parent_ticket: umbrella },
          `motherduck-umbrella-file-${String(t.row_id)}-${iso(t.updated_at)}`)
        filed.push(String(t.row_id))
      } catch (error) { errors.push(`${String(t.row_id)}: ${String(error).slice(0, 200)}`) }
    }
    return { umbrella, tickets, filed, errors }
  })
}

export function formatUmbrellaFiling(r: Awaited<ReturnType<typeof fileReviewTicketsUnderUmbrella>>, apply: boolean): string {
  const lines = [`MotherDuck umbrella: ${r.umbrella ?? 'none yet (raised on --apply)'} · ${r.tickets.length} open review tickets under no parent${r.tickets.length ? `: ${r.tickets.join(', ')}` : ''}`]
  if (apply) lines.push(`filed ${r.filed.length} under ${r.umbrella ?? 'no umbrella'}`)
  for (const e of r.errors) lines.push(`not filed: ${e}`)
  lines.push(apply ? 'motherduck umbrella: applied' : 'motherduck umbrella: dry run; nothing was changed')
  return lines.join('\n')
}

export function formatMotherDuckSync(r: MotherDuckSyncResult): string {
  return `MotherDuck accounts: ${r.listed} listed · ${r.added} added · ${r.updated} updated · ${r.removed} removed · ${r.linked} linked by email`
    + ` · ${r.tickets_raised.length} tickets raised · ${r.tickets_resolved.length} resolved · ${r.ticket_errors.length} tickets not handled`
}

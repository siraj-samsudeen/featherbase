// The roster link (#1157). A first sign-in links a roster row only when its
// person signs in (#970); this links every current row before that, so an
// administrator can open anyone's access page and staging's test mode can sign
// in as anyone. It runs on the same roster the method's settings name, as a
// scheduled job after the loaders have written it, and from the CLI.
//
// - A current row (current status, not retired) gets a Person, a live link,
//   its identifiers and the row's person, in one transaction per row.
// - An existing Person is matched, never duplicated: the row's own person, a
//   link for the row's record, or the person holding its record number.
// - What a first sign-in holds for an administrator is held here too, noted
//   once as `roster_link_held <method> <row> <reason>`, never a value.
// - A live link whose record is on the roster but on no current row ends as
//   `left`, closing the identifiers a roster wrote. People are never deleted.
//   A record on no row at all is left alone: absence is not evidence.
// - A run that would end implausibly many links ends none and says so.
//
// A link signs nobody in by itself: outside test mode the service still checks
// the password and must name the link's record (recordToName).
import { sql, withTransaction } from './db'
import { logActivity } from './audit'
import { saveDoc } from './document'
import { runAsSystemActor } from './system-actor'
import { ROSTER_LINK_ACTOR } from 'shared'
import { ROSTER_LINK_RUN } from './delegated-login'
import { auditIdentity, getSignInMethod, newIdentityId, type SignInMethod } from './identities'
import { addIdentifier, closeRow, endIdentityIdentifiers, writeThroughIdentity } from './person-identifiers'
import { normaliseValue, type IdentifierKind, type NormaliseRule } from './identifiers'
import { rowOf, usableRoster, type Roster, type RosterRow } from './roster-first-sign-in'
import { errorMessage } from './errors'

export const ROSTER_LINK_JOB = 'link_roster'
const ACTOR = ROSTER_LINK_ACTOR
/** The identifier source this writes, and the ones a leaver's end closes. A
 *  value someone recorded by hand is never closed here. */
const SOURCE = 'roster-link'
const ROSTER_SOURCES = [SOURCE, 'first-sign-in']
/** A run may end at most this share of the method's live links... */
const MAX_END_SHARE = 0.05
/** ...or this many, whichever is more. */
const MIN_END_LIMIT = 10

export type HeldReason =
  | 'duplicate_id'
  | 'no_sign_in_id'
  | 'no_record_number'
  | 'value_unusable'
  | 'sign_in_id_linked_elsewhere'
  | 'held_by_another_person'
  | 'value_held_elsewhere'
  | 'link_ended'
  | 'person_unusable'
  | 'privileged'

type Action = 'create' | 'link' | 'complete'
type Decision =
  | { action: 'unchanged'; person: string }
  | { action: 'held'; reason: HeldReason; person: string | null }
  | { action: Action; person: string | null; needLink: boolean; renameLink: string | null; needRowPerson: boolean; identifiers: [string, string][] }

export interface PlannedRow {
  row_id: string
  sign_in_id: string
  record: string
  name: string
  action: Decision['action']
  reason?: HeldReason
  person: string | null
}

export interface PlannedEnd {
  identity: string
  person: string
  record: string
}

export interface RosterLinkPlan {
  method: string
  table: string
  rows: PlannedRow[]
  ends: PlannedEnd[]
  live_links: number
  end_limit: number
  refused: string | null
  /** Enabled email rules and webhooks a run's saves would set off: on the
   *  people it makes, and on the roster rows it points at them. */
  side_effects: string[]
}

export interface RosterLinkRun {
  plan: RosterLinkPlan | null
  created: number
  linked: number
  completed: number
  unchanged: number
  held: number
  ended: number
  refused: string | null
  failed: string[]
}

interface Ctx {
  method: SignInMethod
  roster: Roster
  systems: Map<string, { normalise: NormaliseRule; kind: IdentifierKind }>
}

interface Link {
  id: string
  person: string
  subject: string
  sign_in_name: string
  ended: boolean
  ended_reason: string | null
}

/** What the database holds about a set of rows, read in a few queries. */
interface Facts {
  duplicates: Set<string>
  liveBySubject: Map<string, Link>
  liveByName: Map<string, Link>
  endedBySubject: Map<string, Link>
  holders: Map<string, string[]>
  people: Map<string, { usable: boolean; privileged: boolean }>
}

const key = (system: string, value: string) => `${system}\u0000${value}`

async function context(methodKey: string): Promise<Ctx | null> {
  const method = await getSignInMethod(methodKey)
  const roster = method ? await usableRoster(method) : null
  if (!method || !roster) return null
  const ids = [roster.recordSystem, ...Object.keys(roster.link.identifiers)]
  const rows = await sql`select row_id, normalise, kind from identifier_system where row_id in ${sql(ids)}`
  const systems = new Map(rows.map((r) => [String(r.row_id), { normalise: r.normalise as NormaliseRule, kind: r.kind as IdentifierKind }]))
  return { method, roster, systems }
}

/** The row's values as the systems store them: the record number first.
 *  Null when one cannot be held, an empty identifier column among them. */
function valuesOf(ctx: Ctx, row: RosterRow): [string, string][] | null {
  const out: [string, string][] = []
  const add = (system: string, raw: string) => {
    const s = ctx.systems.get(system)!
    out.push([system, normaliseValue(raw, s.normalise, s.kind)])
  }
  try {
    add(ctx.roster.recordSystem, row.record)
    for (const [system, raw] of Object.entries(row.values)) add(system, raw)
  } catch {
    return null
  }
  return out
}

async function currentRows(ctx: Ctx, rowId?: string): Promise<RosterRow[]> {
  const { link, relation } = ctx.roster
  const rows = await sql`
    select * from ${sql(relation)}
    where trim(${sql(link.status_column)}::text) = ${link.current_status} and retired_at is null
      ${rowId ? sql`and row_id = ${rowId}` : sql``}
    order by row_id
    ${rowId ? sql`for update` : sql``}`
  return rows.map((r) => rowOf(r, link))
}

async function loadFacts(ctx: Ctx, rows: RosterRow[]): Promise<Facts> {
  const { link, relation } = ctx.roster
  const names = [...new Set(rows.map((r) => r.sign_in_id.toLowerCase()).filter(Boolean))]
  const records = [...new Set(rows.map((r) => r.record).filter(Boolean))]
  // A shared ID is not guessed between, in any status (as rowsWithId).
  const dup = await sql`
    select lower(trim(${sql(link.sign_in_id_column)}::text)) as id from ${sql(relation)}
    where lower(trim(${sql(link.sign_in_id_column)}::text)) = any(${names}) group by 1 having count(*) > 1`
  const links = await sql`
    select id, person_id, subject, sign_in_name, ended_at is not null as ended, ended_reason from sign_in_identity
    where method = ${ctx.method.key} and subject is not null
      and (subject = any(${records}) or (ended_at is null and lower(sign_in_name) = any(${names})))
    order by ended_at nulls first`
  const facts: Facts = {
    duplicates: new Set(dup.map((r) => String(r.id))),
    liveBySubject: new Map(),
    liveByName: new Map(),
    endedBySubject: new Map(),
    holders: new Map(),
    people: new Map(),
  }
  for (const r of links) {
    const l: Link = { id: String(r.id), person: String(r.person_id), subject: String(r.subject), sign_in_name: String(r.sign_in_name), ended: Boolean(r.ended), ended_reason: r.ended_reason as string | null }
    if (!l.ended) {
      facts.liveBySubject.set(l.subject, l)
      facts.liveByName.set(l.sign_in_name.toLowerCase(), l)
    } else facts.endedBySubject.set(l.subject, l) // oldest first, so the latest end wins
  }
  const values = [...new Set(rows.flatMap((r) => (valuesOf(ctx, r) ?? []).map(([, v]) => v)))]
  const held = await sql`
    select distinct system, value, person_id from person_identifier
    where upper_inf(valid) and system in ${sql([...ctx.systems.keys()])} and value = any(${values})`
  for (const h of held) {
    const k = key(String(h.system), String(h.value))
    facts.holders.set(k, [...(facts.holders.get(k) ?? []), String(h.person_id)])
  }
  const candidates = [...new Set([...rows.map((r) => r.person), ...links.map((l) => l.person_id), ...held.map((h) => h.person_id)].filter(Boolean).map(String))]
  const people = await sql`
    select u.row_id, (not u.built_in and u.replaced_by is null) as usable,
      (u.row_id = 'Administrator' or exists (
        select 1 from has_role r where r.parent = u.row_id and r.role in ('System Manager', 'Administrator'))) as privileged
    from person u where u.row_id = any(${candidates})`
  for (const p of people) facts.people.set(String(p.row_id), { usable: Boolean(p.usable), privileged: Boolean(p.privileged) })
  return facts
}

/** What this one current row needs. Pure, over facts read beforehand. */
function decide(ctx: Ctx, facts: Facts, row: RosterRow): Decision {
  const held = (reason: HeldReason, person: string | null = row.person): Decision => ({ action: 'held', reason, person })
  if (!row.sign_in_id) return held('no_sign_in_id')
  if (!row.record) return held('no_record_number')
  if (facts.duplicates.has(row.sign_in_id.toLowerCase())) return held('duplicate_id')
  const values = valuesOf(ctx, row)
  if (!values) return held('value_unusable')
  const live = facts.liveBySubject.get(row.record)
  const byName = facts.liveByName.get(row.sign_in_id.toLowerCase())
  if (byName && byName.subject !== row.record) return held('sign_in_id_linked_elsewhere')
  const [[, recordValue]] = values
  const candidates = new Set([row.person, live?.person, ...(facts.holders.get(key(ctx.roster.recordSystem, recordValue)) ?? [])].filter((p): p is string => Boolean(p)))
  const ended = live ? undefined : facts.endedBySubject.get(row.record)
  if (ended) {
    // An administrator ended it: theirs to undo. A leaver who came back is linked afresh.
    if (ended.ended_reason !== 'left') return held('link_ended')
    candidates.add(ended.person)
  }
  if (candidates.size > 1) return held('held_by_another_person')
  const person = candidates.size ? [...candidates][0] : null
  if (person) {
    const p = facts.people.get(person)
    // A StyleHR administrator can reset passwords there; that never reaches an administrator here.
    if (p?.privileged) return held('privileged', person)
    if (!p?.usable) return held('person_unusable', person)
  }
  const identifiers: [string, string][] = []
  for (const [system, value] of values.slice(1)) {
    const holders = facts.holders.get(key(system, value)) ?? []
    if (holders.some((h) => h !== person)) return held('value_held_elsewhere', person)
    if (!person || !holders.includes(person)) identifiers.push([system, value])
  }
  const needLink = !live
  const renameLink = live && live.sign_in_name.toLowerCase() !== row.sign_in_id.toLowerCase() ? live.id : null
  const needRowPerson = !person || row.person !== person
  if (person && !needLink && !renameLink && !needRowPerson && !identifiers.length) return { action: 'unchanged', person }
  return { action: !person ? 'create' : needLink ? 'link' : 'complete', person, needLink, renameLink, needRowPerson, identifiers }
}

/** Live links on the method whose record is on the roster, but on no current row. */
async function leavers(ctx: Ctx, identity?: string): Promise<PlannedEnd[]> {
  const { link, relation } = ctx.roster
  const rec = sql`trim(r.${sql(link.record_number_column)}::text)`
  const rows = await sql`
    select i.id, i.person_id, i.subject from sign_in_identity i
    where i.method = ${ctx.method.key} and i.ended_at is null and i.subject is not null
      ${identity ? sql`and i.id = ${identity}` : sql``}
      and exists (select 1 from ${sql(relation)} r where ${rec} = i.subject)
      and not exists (select 1 from ${sql(relation)} r where ${rec} = i.subject
        and trim(r.${sql(link.status_column)}::text) = ${link.current_status} and r.retired_at is null)
    order by i.id
    ${identity ? sql`for update of i` : sql``}`
  return rows.map((r) => ({ identity: String(r.id), person: String(r.person_id), record: String(r.subject) }))
}

async function planWith(ctx: Ctx): Promise<RosterLinkPlan> {
  const rows = await currentRows(ctx)
  const facts = await loadFacts(ctx, rows)
  const planned = rows.map((row) => {
    const d = decide(ctx, facts, row)
    return { row_id: row.row_id, sign_in_id: row.sign_in_id, record: row.record, name: row.name, action: d.action, person: d.person, ...(d.action === 'held' ? { reason: d.reason } : {}) }
  })
  const ends = await leavers(ctx)
  const [{ n }] = await sql`select count(*)::int as n from sign_in_identity where method = ${ctx.method.key} and ended_at is null and subject is not null`
  const live = Number(n)
  const limit = Math.max(MIN_END_LIMIT, Math.ceil(live * MAX_END_SHARE))
  const refused = ends.length > limit ? `it would end ${ends.length} of ${live} live links, more than the limit of ${limit}` : null
  const tables = ['Person', ctx.roster.link.table]
  const rules = await sql`select row_id, ref_table, event from email_rule where enabled and ref_table in ${sql(tables)} order by row_id`
  const hooks = await sql`select row_id, webhook_table, webhook_event from webhook where enabled and webhook_table in ${sql(tables)} order by row_id`
  const side_effects = [
    ...rules.map((r) => `email rule ${r.row_id} (${r.ref_table}, ${r.event})`),
    ...hooks.map((h) => `webhook ${h.row_id} (${h.webhook_table}, ${h.webhook_event})`),
  ]
  return { method: ctx.method.key, table: ctx.roster.link.table, rows: planned, ends, live_links: live, end_limit: limit, refused, side_effects }
}

/** What a run would do, changing nothing. Null when the method has no usable roster. */
export async function planRosterLink(methodKey: string): Promise<RosterLinkPlan | null> {
  const ctx = await context(methodKey)
  return ctx ? planWith(ctx) : null
}

/** Once per method, row and reason, so a nightly run cannot flood the log. */
async function hold(method: string, rowId: string, reason: HeldReason) {
  const operation = `roster_link_held ${method} ${rowId} ${reason}`.slice(0, 140)
  const [seen] = await sql`select 1 from activity_log where operation = ${operation} limit 1`
  if (!seen) await logActivity('system', operation)
}

/** One row, under its lock, decided again: the plan may be stale. */
async function linkRow(ctx: Ctx, rowId: string): Promise<Decision['action']> {
  const { link: config } = ctx.roster
  return withTransaction(async () => {
    const [row] = await currentRows(ctx, rowId)
    // No longer current: the leaver pass sees it on the next run.
    if (!row) return 'unchanged'
    const d = decide(ctx, await loadFacts(ctx, [row]), row)
    if (d.action === 'held') await hold(ctx.method.key, row.row_id, d.reason)
    if (d.action === 'held' || d.action === 'unchanged') return d.action
    let person = d.person
    if (!person) {
      const made = await runAsSystemActor(ACTOR, () => saveDoc('Person', { email: null, full_name: row.name, enabled: true, roles: [] }, ACTOR, 'insert'))
      person = String(made.row_id)
    }
    if (d.needLink) {
      const identity = newIdentityId()
      await sql`insert into sign_in_identity ${sql({
        id: identity,
        person_id: person,
        method: ctx.method.key,
        subject: row.record,
        sign_in_name: row.sign_in_id,
        display_name: row.name,
        linked_by: ROSTER_LINK_RUN,
      })}`
      await writeThroughIdentity(identity)
      await auditIdentity(ACTOR, 'linked', person, ctx.method.key, identity)
    }
    if (d.renameLink) await sql`update sign_in_identity set sign_in_name = ${row.sign_in_id} where id = ${d.renameLink}`
    const [{ today }] = await sql`select current_date::text as today`
    for (const [system, value] of d.identifiers)
      await addIdentifier(person, { system, value, valid_from: String(today) }, ACTOR, { internal: { source: SOURCE, verified: true }, db: sql })
    if (d.needRowPerson) await runAsSystemActor(ACTOR, () => saveDoc(config.table, { row_id: row.row_id, updated_at: row.updated_at, [config.person_column]: person }, ACTOR))
    return d.action
  })
}

/** End one leaver's link, checked again under its lock. */
async function endLink(ctx: Ctx, end: PlannedEnd): Promise<boolean> {
  const systems = Object.keys(ctx.roster.link.identifiers)
  return withTransaction(async () => {
    const [still] = await leavers(ctx, end.identity)
    if (!still) return false
    await endIdentityIdentifiers(end.identity)
    // The codes a roster wrote close with it. A person still current on
    // another row gets theirs back on the next run.
    for (const r of await sql`
      select id from person_identifier where person_id = ${end.person} and system in ${sql(systems)}
        and upper_inf(valid) and source in ${sql(ROSTER_SOURCES)}`)
      await closeRow(String(r.id))
    await sql`update sign_in_identity set ended_at = now(), ended_reason = 'left' where id = ${end.identity}`
    await auditIdentity(ACTOR, 'ended_left', end.person, ctx.method.key, end.identity)
    return true
  })
}

/** Link every current row and end every leaver's link. One row's failure
 *  never stops the rest; the run throws afterwards, naming the rows. */
const COUNTED = { create: 'created', link: 'linked', complete: 'completed', unchanged: 'unchanged', held: 'held' } as const

/** Run `fn`, keeping a failure on the run instead of stopping it. */
async function attempt<T>(run: RosterLinkRun, id: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (err) {
    run.failed.push(`${id}: ${errorMessage(err)}`)
    return null
  }
}

/** Link every current row and end every leaver's link. `plan` applies a dry
 *  run already made; every row is decided again under its lock either way.
 *  One row's failure never stops the rest. */
export async function runRosterLink(methodKey: string, opts: { plan?: RosterLinkPlan } = {}): Promise<RosterLinkRun> {
  const run: RosterLinkRun = { plan: null, created: 0, linked: 0, completed: 0, unchanged: 0, held: 0, ended: 0, refused: null, failed: [] }
  const ctx = await context(methodKey)
  if (!ctx) return run
  const plan = opts.plan ?? (await planWith(ctx))
  run.plan = plan
  run.refused = plan.refused
  for (const row of plan.rows) {
    const done = row.action === 'unchanged' ? 'unchanged' : await attempt(run, row.row_id, () => linkRow(ctx, row.row_id))
    if (done) run[COUNTED[done]]++
  }
  if (plan.refused) await logActivity('system', `roster_link_refused ${methodKey}: ${plan.refused}`.slice(0, 140))
  else for (const end of plan.ends) if (await attempt(run, end.identity, () => endLink(ctx, end))) run.ended++
  return run
}

/** Every delegated method with a usable roster, one after another. */
export async function runAllRosterLinks(): Promise<RosterLinkRun[]> {
  const methods = await sql`select row_id from sign_in_method where kind = 'delegated_password' and enabled and new_person = 'create_if_on_roster' order by row_id`
  const out: RosterLinkRun[] = []
  for (const m of methods) out.push(await runRosterLink(String(m.row_id)))
  return out
}

/** Counts and reasons only: no names, codes or values, so it is safe for logs. */
export function formatRosterLink(plan: RosterLinkPlan | null, run?: RosterLinkRun): string {
  if (!plan) return 'roster link: no usable roster; nothing to do'
  const tally = (action: string) => plan.rows.filter((r) => r.action === action).length
  const reasons = new Map<string, number>()
  for (const r of plan.rows) if (r.reason) reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1)
  const heldBy = [...reasons].map(([r, n]) => `${r} ${n}`).join(', ') || 'none'
  const lines = [`roster link ${plan.method}: ${plan.rows.length} current rows in ${plan.table}; ${plan.live_links} live links before the run`]
  if (run)
    lines.push(
      `roster link ${plan.method}: created ${run.created}, linked ${run.linked}, completed ${run.completed}, unchanged ${run.unchanged}, held ${run.held}, ended ${run.ended}`,
      ...(run.failed.length ? [`roster link ${plan.method}: FAILED ${run.failed.length}`] : []),
    )
  else
    lines.push(
      `roster link ${plan.method}: would create ${tally('create')}, link ${tally('link')}, complete ${tally('complete')}; unchanged ${tally('unchanged')}; held ${tally('held')} (${heldBy})`,
      `roster link ${plan.method}: would end ${plan.ends.length} (limit ${plan.end_limit})`,
    )
  if (plan.side_effects.length) lines.push(`roster link ${plan.method}: its saves set off ${plan.side_effects.join('; ')}`)
  if (plan.refused) lines.push(`roster link ${plan.method}: ENDED NONE — ${plan.refused}`)
  return lines.join('\n')
}

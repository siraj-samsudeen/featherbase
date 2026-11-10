// A first sign-in that links a staff roster row (#970). Someone signs in at a
// connected service with no link yet. Before the service is asked, the ID must
// be exactly one current roster row that nobody holds, so Featherbase is still
// no password checker for any other ID. After a yes that names that row's
// record, one transaction makes the person, the link and the identifiers, and
// writes the person onto the row. Every refusal reads like a wrong password. A
// case an administrator must settle is noted in the activity log as
// `first_sign_in_held <method> <row> <reason>`: never the ID, a name or a value.
import { sql, withTransaction } from './db'
import { AppError } from './errors'
import { logActivity } from './audit'
import { INVALID_CREDENTIALS, type IssuedSession } from './auth'
import { saveDoc } from './document'
import { getMeta } from './meta'
import { tableRelation } from './table-engine'
import { runAsSystemActor } from './system-actor'
import { signInActor } from 'shared'
import { ROSTER_LINK, ROSTER_LINKS, checkWithProvider, rosterFrom, type DelegatedLoginConfig, type RosterLink } from './delegated-login'
import { auditIdentity, newIdentityId, type SignInMethod } from './identities'
import { addIdentifier, writeThroughIdentity } from './person-identifiers'
import { normaliseValue, type IdentifierKind, type NormaliseRule } from './identifiers'
import { completeSignIn } from './sign-in'

type HeldReason = 'duplicate_id' | 'row_has_person' | 'no_record_number' | 'already_linked' | 'service_named_another_record' | 'link_failed'

export interface Roster {
  link: RosterLink
  relation: string
  recordSystem: string
}

export interface RosterRow {
  row_id: string
  updated_at: unknown
  sign_in_id: string
  record: string
  person: string | null
  name: string
  status: string
  retired: boolean
  values: Record<string, string>
}

const refused = () => new AppError('AuthenticationError', INVALID_CREDENTIALS)

/** Once per method, row and reason, so repeated tries cannot flood the log. */
export async function hold(method: string, target: string, reason: HeldReason): Promise<void> {
  const operation = `first_sign_in_held ${method} ${target} ${reason}`.slice(0, 140)
  const [seen] = await sql`select 1 from activity_log where operation = ${operation} limit 1`
  if (!seen) await logActivity('system', operation)
}

function misconfigured(method: string, what: string): null {
  console.warn(`[first-sign-in] ${method}: roster not usable (${what})`)
  return null
}

/** The method's roster when its rule is on and everything it names exists;
 *  null otherwise, and the sign-in is then refused like any unknown ID. */
export async function usableRoster(method: SignInMethod): Promise<Roster | null> {
  if (method.new_person !== 'create_if_on_roster') return null
  let link: RosterLink | null
  try {
    link = rosterFrom(method.settings)
  } catch (err) {
    return misconfigured(method.key, (err as Error).message)
  }
  if (!link) return misconfigured(method.key, 'no roster')
  const [row] = await sql`select identifier_system from sign_in_method where row_id = ${method.key}`
  const recordSystem = row?.identifier_system as string | null | undefined
  if (!recordSystem) return misconfigured(method.key, 'no identifier system for the record number')
  let meta
  try {
    meta = await getMeta(link.table)
  } catch {
    return misconfigured(method.key, 'its Table does not exist')
  }
  if (meta.data_source) return misconfigured(method.key, 'its Table lives in an outside source')
  const columns = new Map(meta.columns.map((c) => [c.column_name, c]))
  const named = [link.sign_in_id_column, link.record_number_column, link.person_column, link.name_column, link.status_column, ...Object.values(link.identifiers)]
  if (!named.every((c) => columns.has(c))) return misconfigured(method.key, 'a column it names does not exist')
  const person = columns.get(link.person_column)!
  if (person.column_type !== 'Reference' || person.reference_table !== 'Person') return misconfigured(method.key, 'its person column is not a link to Person')
  const systems = [recordSystem, ...Object.keys(link.identifiers)]
  const enabled = await sql`select row_id from identifier_system where row_id in ${sql(systems)} and enabled`
  if (enabled.length !== new Set(systems).size) return misconfigured(method.key, 'an identifier system it names is missing or off')
  return { link, recordSystem, relation: await tableRelation(link.table) }
}

export function rowOf(r: Record<string, unknown>, link: RosterLink): RosterRow {
  const text = (column: string) => String(r[column] ?? '').trim()
  return {
    row_id: String(r.row_id),
    updated_at: r.updated_at,
    sign_in_id: text(link.sign_in_id_column),
    record: text(link.record_number_column),
    person: (r[link.person_column] as string | null) || null,
    name: text(link.name_column),
    status: text(link.status_column),
    retired: r.retired_at != null,
    values: Object.fromEntries(Object.entries(link.identifiers).map(([system, column]) => [system, text(column)])),
  }
}

/** Every roster row carrying this ID, in any status: a shared ID is not
 *  guessed between, even when only one of its rows is current. */
async function rowsWithId({ link, relation }: Roster, id: string): Promise<RosterRow[]> {
  const rows = await sql`
    select * from ${sql(relation)}
    where lower(trim(${sql(link.sign_in_id_column)})) = lower(trim(${id})) and trim(${sql(link.sign_in_id_column)}) <> ''
    limit 2`
  return rows.map((r) => rowOf(r, link))
}

/** Does anyone already hold this row's record or ID here? An ended link counts:
 *  it never opens an account again (person-resolution D5). */
async function heldElsewhere(method: SignInMethod, { recordSystem }: Roster, row: RosterRow): Promise<HeldReason | null> {
  const [linked] = await sql`
    select 1 from sign_in_identity
    where method = ${method.key} and (subject = ${row.record} or lower(sign_in_name) = lower(${row.sign_in_id})) limit 1`
  if (linked) return 'already_linked'
  for (const [system, raw] of [[recordSystem, row.record], ...Object.entries(row.values)]) {
    const [s] = await sql`select normalise, kind from identifier_system where row_id = ${system}`
    let value: string
    try {
      value = normaliseValue(raw, s.normalise as NormaliseRule, s.kind as IdentifierKind)
    } catch {
      return 'link_failed' // a value the identifier system cannot hold
    }
    const [held] = await sql`select 1 from person_identifier where system = ${system} and value = ${value} and upper_inf(valid) limit 1`
    if (held) return 'already_linked'
  }
  return null
}

/** The one row this ID may link, or null with the reason noted when an
 *  administrator must settle it. An ID on no row notes nothing: anyone can type one. */
async function candidate(method: SignInMethod, roster: Roster, id: string): Promise<RosterRow | null> {
  const rows = await rowsWithId(roster, id)
  if (rows.length === 0) return null
  if (rows.length > 1) {
    await hold(method.key, rows[0].row_id, 'duplicate_id')
    return null
  }
  const [row] = rows
  // #859: a retired row is out of use, whatever its status says.
  if (row.status !== roster.link.current_status || row.retired) return null
  // A concurrent first sign-in committed just now. The service still checks this
  // one's password, and link() then lands it on the winner.
  if (row.person && (await winner(method, row))) return row
  const problem = await problemWith(method, roster, row)
  if (problem) {
    await hold(method.key, row.row_id, problem)
    return null
  }
  return row
}

async function problemWith(method: SignInMethod, roster: Roster, row: RosterRow): Promise<HeldReason | null> {
  if (row.person) return 'row_has_person'
  if (!row.record) return 'no_record_number'
  return heldElsewhere(method, roster, row)
}

interface Linked {
  user: string
  identity: string
}

/** The live link a concurrent first sign-in, or the roster link (#1157), just
 *  made for this very record. */
async function winner(method: SignInMethod, row: { record: string; person: string | null }): Promise<Linked | null> {
  const [won] = await sql`
    select id, person_id from sign_in_identity
    where method = ${method.key} and subject = ${row.record} and ended_at is null and linked_by in ${sql(ROSTER_LINKS)}`
  if (!won || String(won.person_id) !== row.person) return null
  return { user: String(won.person_id), identity: String(won.id) }
}

/** All or nothing, with the row locked so two sign-ins take turns; everything
 *  checked before asking is checked again, since the row may have moved on. */
async function link(method: SignInMethod, roster: Roster, id: string, asked: RosterRow): Promise<Linked | HeldReason> {
  const { link: config, relation, recordSystem } = roster
  return withTransaction(async () => {
    const [locked] = await sql`select * from ${sql(relation)} where row_id = ${asked.row_id} for update`
    if (!locked) return 'link_failed'
    const row = rowOf(locked, config)
    if (row.person) {
      const won = row.record === asked.record ? await winner(method, row) : null
      return won ?? 'row_has_person'
    }
    if (row.retired || row.status !== config.current_status || row.record !== asked.record || row.sign_in_id.toLowerCase() !== id.toLowerCase()) return 'link_failed'
    if ((await rowsWithId(roster, id)).length > 1) return 'duplicate_id'
    const problem = await problemWith(method, roster, row)
    if (problem) return problem

    const actor = signInActor(method.kind)
    const person = await runAsSystemActor(actor, () => saveDoc('Person', { email: null, full_name: row.name, enabled: true, roles: [] }, actor, 'insert'))
    const user = String(person.row_id)
    const identity = newIdentityId()
    await sql`insert into sign_in_identity ${sql({
      id: identity,
      person_id: user,
      method: method.key,
      subject: row.record,
      sign_in_name: row.sign_in_id,
      display_name: row.name,
      linked_by: ROSTER_LINK,
      last_used_at: new Date(),
    })}`
    await writeThroughIdentity(identity)
    const [{ today }] = await sql`select current_date::text as today`
    for (const [system, value] of Object.entries(row.values))
      if (system !== recordSystem)
        await addIdentifier(user, { system, value, valid_from: String(today) }, actor, { internal: { source: 'first-sign-in', verified: true }, db: sql })
    await runAsSystemActor(actor, () => saveDoc(config.table, { row_id: row.row_id, updated_at: row.updated_at, [config.person_column]: user }, actor))
    await auditIdentity(user, 'linked', user, method.key, identity)
    return { user, identity }
  })
}

/** Sign in someone with no link yet, through the method's roster. Refused in
 *  the generic wording, without asking the service, unless a row qualifies. */
export async function rosterFirstSignIn(cfg: DelegatedLoginConfig, id: string, password: string, ipAddress: string | null): Promise<IssuedSession> {
  const method = cfg.method
  const roster = await usableRoster(method)
  if (!roster) throw refused()
  const row = await candidate(method, roster, id)
  if (!row) throw refused()
  const status = await checkWithProvider(cfg, id, password, { key: roster.link.provider_record_key, record: row.record })
  if (status === 'another_record') {
    await hold(method.key, row.row_id, 'service_named_another_record')
    throw refused()
  }
  // Saying "has left" here would confirm a password for someone with no account.
  if (status === 'left') throw refused()
  if (status !== 'verified') return completeSignIn(method, { status }, null, { ipAddress })
  let linked: Linked | HeldReason
  try {
    linked = await link(method, roster, id, row)
  } catch (err) {
    // A save refused it, or another row with this record won the unique link: nothing
    // was kept. Any other database failure stays a failure, not a wrong password.
    if (!(err instanceof AppError) && (err as { code?: string }).code !== '23505') throw err
    linked = 'link_failed'
  }
  if (typeof linked === 'string') {
    await hold(method.key, row.row_id, linked)
    throw refused()
  }
  return completeSignIn(method, { status }, linked, { ipAddress })
}

// Person identifiers (OpenSpec change `person-resolution` D3/D4/D5/D9,
// Phase 1a-i): one row per value a person has or had, each with the period
// it was valid (half-open dates; an open upper bound means current), where it
// came from and whether it is verified. `person_identifier` is written only
// here — never through the generic row API.
import { sql, type Sql, type TxSql } from './db'
import { AppError } from './errors'
import { logActivity } from './audit'
import { getRoles, hasPermission, isPrivileged, permittedTiers } from './permissions'
import { opaqueId } from './opaque-id'
import { PLATFORM_SCHEMA } from './platform-schema'
import {
  SENSITIVITY,
  assuranceOf,
  completeSystemRow,
  displayValue,
  normaliseValue,
  type EditedBy,
  type IdentifierKind,
  type NormaliseRule,
  type Sensitivity,
} from './identifiers'

export const CORE_PEOPLE_REVIEW = {
  compare_columns: ['full_name', 'codes', 'roles', 'data_scope', 'sign_in_methods', 'last_sign_in'],
  survivor_rule: 'most-recent-sign-in',
}
export const CORE_PEOPLE_REVIEW_JSON = JSON.stringify(CORE_PEOPLE_REVIEW)

export function newIdentifierId(): string {
  return opaqueId('pid_')
}

type Db = Sql | TxSql

export interface IdentifierSystemRow {
  row_id: string
  label: string
  kind: IdentifierKind
  source: string | null
  match: 'Off' | 'Suggest'
  sensitivity: Sensitivity
  normalise: NormaliseRule
  one_holder_at_a_time: boolean
  one_per_person: boolean
  assigner_scoped: boolean
  edited_by: EditedBy
  enabled: boolean
}

export async function getSystem(key: string, db: Db = sql): Promise<IdentifierSystemRow> {
  const [row] = await db`select * from identifier_system where row_id = ${key}`
  if (!row) throw new AppError('NotFoundError', `Identifier system ${key} not found`)
  return row as unknown as IdentifierSystemRow
}

export interface IdentifierRow {
  id: string
  person_id: string
  system: string
  assigner: string
  value: string | null
  value_hint: string | null
  valid_from: string | null
  valid_to: string | null
  verified: boolean
  record_identifier_id: string | null
  worker_type: string | null
  source: string
  recorded_at: string
  recorded_by: string
  note: string | null
}

const rowFields = (db: Db) => db`
  id, person_id, system, assigner, value, value_hint,
  case when lower_inf(valid) or lower(valid) = '-infinity'::date then null else lower(valid)::text end as valid_from,
  case when upper_inf(valid) then null else upper(valid)::text end as valid_to,
  verified, record_identifier_id, worker_type, source, recorded_at, recorded_by, note`

function isoDate(v: unknown, field: string): string | null {
  if (v == null || v === '') return null
  const s = String(v)
  // A real calendar day only: 2026-02-30 must not roll over into March.
  const parsed = new Date(`${s}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== s)
    throw new AppError('ValidationError', `${field} must be a date (YYYY-MM-DD)`, { [field]: 'a date' })
  return s
}

// ------------------------------------------------------------- who may

/** Can this principal read restricted identifiers (D9)? */
export async function readsRestricted(viewer: string): Promise<boolean> {
  if (await isPrivileged(viewer)) return true
  if ((await getRoles(viewer)).includes('Data Quality Manager')) return true
  return (await permittedTiers(viewer, 'Person', 'read')).has('restricted')
}

/** Has this system's source (the roster sync) written any row yet? Until it
 *  has, its values are FROZEN at what the migration carried over, and a
 *  System Manager keeps the joiner and correction procedures going by hand
 *  (review decision B-M6). Derived, so the hand path closes by itself the day
 *  the sync starts writing. */
export async function sourceFrozen(system: IdentifierSystemRow, db: Db = sql): Promise<boolean> {
  if (!system.source) return false
  const [fed] = await db`select 1 from person_identifier where system = ${system.row_id} and source = ${system.source} limit 1`
  return !fed
}

/** Who may add, end or correct a value of this system (D9). Returns whether
 *  the write is verified (self ⇒ false) and whether it must carry a note (a
 *  System Manager's hand entry in a source-fed system while its source is
 *  frozen: unverified, with the reason written down). Never echoes a value. */
export async function assertMayEdit(actor: string, system: IdentifierSystemRow, person: string): Promise<{ verified: boolean; noteRequired?: boolean }> {
  const roles = await getRoles(actor)
  const manager = actor === 'Administrator' || roles.includes('System Manager')
  switch (system.edited_by) {
    case 'source':
      if (roles.includes('Identity Sync')) return { verified: true }
      if (manager && SENSITIVITY[system.sensitivity]?.tier !== 'restricted' && (await sourceFrozen(system)))
        return { verified: false, noteRequired: true }
      throw new AppError(
        'PermissionError',
        `${system.label} comes from ${system.source || 'another system'}; correct it there`,
        { code: 'source_managed' },
      )
    case 'system-manager':
      if (manager) return { verified: true }
      break
    case 'reviewers':
      if (manager || roles.includes('Data Quality Manager')) return { verified: true }
      break
    case 'self':
      if (manager) return { verified: true }
      if (actor === person) return { verified: false }
      break
  }
  throw new AppError('PermissionError', `You may not change ${system.label} values`, { code: 'not_allowed' })
}

/** "This record was merged into Asha Kumar" — a name, never the survivor's
 *  opaque id (review B-M2); the id stays in the error's data for links. */
export async function mergedInto(survivor: string, db: Db = sql): Promise<AppError> {
  const [p] = await db`select coalesce(nullif(trim(full_name), ''), '@' || username, email) as name from person where row_id = ${survivor}`
  const name = (p?.name as string | null) ?? 'another record'
  return new AppError('ConflictError', `This record was merged into ${name}. Open that record to make changes.`, { code: 'replaced_by', survivor })
}

async function assertWritablePerson(person: string, db: Db) {
  const [p] = await db`select row_id, built_in, replaced_by from person where row_id = ${person} for share`
  if (!p) throw new AppError('NotFoundError', `Person ${person} not found`)
  if (p.built_in) throw new AppError('ValidationError', 'A built-in account has no identifiers', { code: 'built_in' })
  if (p.replaced_by)
    throw await mergedInto(String(p.replaced_by), db)
}

// ------------------------------------------------------------- reads

export interface PanelRow {
  id: string
  system: string
  system_label: string
  kind: IdentifierKind
  assigner: string
  value: string | null
  valid_from: string | null
  valid_to: string | null
  current: boolean
  verified: boolean
  source: string
  recorded_at: string
  note: string | null
  worker_type: string | null
  editable: boolean
  /** A System Manager's hand edit while the source is frozen: needs a note. */
  note_required: boolean
}

/** A person's identifiers as this viewer may see them (D3): Normal values to
 *  anyone who can read the person; Restricted only to restricted readers
 *  (and the person themself); Restricted-hidden never in panels; Secret by
 *  its last four digits. */
export async function listIdentifiers(person: string, viewer: string): Promise<PanelRow[]> {
  const restricted = viewer === person || (await readsRestricted(viewer))
  // One column list (rowFields) for every read; the panel's extra columns join on.
  const rows = await sql`
    select i.*, s.label as system_label, s.kind, s.sensitivity, s.edited_by, s.source as system_source, s.row_id as system_key
    from (select ${rowFields(sql)}, upper_inf(valid) as current, lower(valid) as starts
          from person_identifier where person_id = ${person}) i
    join identifier_system s on s.row_id = i.system
    order by s.label, i.current desc, i.starts desc`
  const out: PanelRow[] = []
  for (const r of rows) {
    const shown = displayValue(
      { value: r.value as string | null, value_hint: r.value_hint as string | null },
      r.sensitivity as Sensitivity,
      restricted && (viewer !== person || (r.sensitivity as Sensitivity) !== 'Restricted, hidden'),
    )
    if (!shown.shown) continue
    let editable = false
    let noteRequired = false
    try {
      const may = await assertMayEdit(viewer, { row_id: String(r.system_key), label: String(r.system_label), source: r.system_source as string | null, edited_by: r.edited_by as EditedBy, sensitivity: r.sensitivity as Sensitivity } as IdentifierSystemRow, person)
      editable = true
      noteRequired = may.noteRequired === true
    } catch {
      editable = false
    }
    out.push({
      id: String(r.id), system: String(r.system), system_label: String(r.system_label), kind: r.kind as IdentifierKind,
      assigner: String(r.assigner ?? ''), value: shown.value, valid_from: r.valid_from as string | null,
      valid_to: r.valid_to as string | null, current: r.current === true, verified: r.verified === true,
      source: String(r.source), recorded_at: new Date(r.recorded_at as string | Date).toISOString(), note: (r.note as string | null) ?? null,
      worker_type: (r.worker_type as string | null) ?? null, editable, note_required: noteRequired,
    })
  }
  return out
}

/** The systems this viewer may add a value to for this person (the panel's
 *  add form): enabled, stored in plain (Secret needs Phase 1b), and allowed
 *  by the system's `edited_by`. */
export async function addableSystems(person: string, viewer: string): Promise<{ row_id: string; label: string; note_required: boolean }[]> {
  const systems = (await sql`select * from identifier_system where enabled order by label`) as unknown as IdentifierSystemRow[]
  const out: { row_id: string; label: string; note_required: boolean }[] = []
  for (const s of systems) {
    if (SENSITIVITY[s.sensitivity]?.storage !== 'plain') continue
    try {
      const may = await assertMayEdit(viewer, s, person)
      out.push({ row_id: s.row_id, label: s.label, note_required: may.noteRequired === true })
    } catch {
      /* not theirs to add */
    }
  }
  return out
}

/** What a new row of this system would default to, and how the stored row
 *  differs (D2: each Advanced setting has its preset and "revert to default";
 *  forbidden options say why). */
export async function systemDefaults(key: string) {
  const row = await getSystem(key)
  const preset = completeSystemRow({ row_id: row.row_id, kind: row.kind })
  const fields = ['normalise', 'one_holder_at_a_time', 'one_per_person', 'assigner_scoped', 'edited_by', 'retain_after_leaving_days', 'match', 'sensitivity'] as const
  const differs = fields.filter((f) => (preset[f] ?? null) !== ((row as unknown as Record<string, unknown>)[f] ?? null))
  const forbidden: { field: string; reason: string }[] = []
  if (row.match !== 'Off') forbidden.push({ field: 'one_holder_at_a_time', reason: 'Off while Match is on: a second holder must be accepted so the duplicate can be pointed out' })
  if (row.kind !== 'national-id') forbidden.push({ field: 'sensitivity', reason: 'Secret is only for a national ID' })
  return { preset: Object.fromEntries(fields.map((f) => [f, preset[f] ?? null])), differs, forbidden, assurance: assuranceOf(row.kind) }
}

/** Find people by an exact (normalised) value. Restricted and
 *  Restricted-hidden systems answer only restricted readers. A replaced
 *  record answers with its survivor. */
export async function findByIdentifier(systemKey: string, raw: string, viewer: string) {
  if (!(await hasPermission(viewer, 'Person', 'read'))) throw new AppError('PermissionError', 'You may not search people')
  const system = await getSystem(systemKey)
  const s = SENSITIVITY[system.sensitivity]
  if (s.storage === 'fingerprint')
    throw new AppError('ValidationError', 'Searching this identifier needs fingerprinting, which is not switched on', { code: 'fingerprint_unavailable' })
  if (s.tier === 'restricted' && !(await readsRestricted(viewer))) throw new AppError('PermissionError', `You may not search ${system.label}`)
  const value = normaliseValue(raw, system.normalise, system.kind)
  // A search of restricted values is recorded — who, which system, when —
  // never the value typed (D3).
  if (s.tier === 'restricted') await logActivity(viewer, `identifier_search ${system.row_id}`)
  const rows = await sql`
    select i.person_id, coalesce(p.replaced_by, i.person_id) as resolved_to, p.replaced_by is not null as replaced,
      upper_inf(i.valid) as current, i.assigner, false as pending_invite
    from person_identifier i join person p on p.row_id = i.person_id
    where i.system = ${system.row_id} and i.value = ${value}
    order by upper_inf(i.valid) desc, lower(i.valid) desc`
  // An invitee holds no email identifier until their first sign-in, so an
  // email search also matches an open invite's address (stored folded).
  if (system.row_id === 'email') {
    const invites = await sql`
      select s.person_id, coalesce(p.replaced_by, s.person_id) as resolved_to, p.replaced_by is not null as replaced,
        true as current, '' as assigner, true as pending_invite
      from sign_in_identity s join person p on p.row_id = s.person_id
      where s.subject is null and s.ended_at is null and s.pending_email = ${value}`
    // Only a current holder hides the invite: a former holder re-invited at
    // the same address is still waiting to sign in.
    const held = new Set(rows.filter((r) => r.current === true).map((r) => String(r.person_id)))
    rows.push(...invites.filter((r) => !held.has(String(r.person_id))))
  }
  // Only people this viewer may read: the Person permission and Data Scope
  // apply to search results as to any read (Codex review on #385).
  const { getDoc } = await import('./document')
  const readable: Record<string, unknown>[] = []
  for (const r of rows) {
    try {
      await getDoc('Person', String(r.person_id), viewer)
      readable.push(r)
    } catch {
      /* not theirs to see */
    }
  }
  return readable.map((r) => ({
    person_id: String(r.person_id),
    resolved_to: String(r.resolved_to),
    replaced: r.replaced === true,
    current: r.current === true,
    assigner: String(r.assigner ?? ''),
    pending_invite: r.pending_invite === true,
  }))
}

// ------------------------------------------------------------- writes

export interface AddInput {
  system: string
  value: unknown
  assigner?: string | null
  valid_from?: string | null
  valid_to?: string | null
  worker_type?: string | null
  record_identifier_id?: string | null
  note?: string | null
}

export type WriteResult = { result: 'created' | 'updated' | 'unchanged'; identifier: IdentifierRow }

function mapWriteError(err: unknown): never {
  const e = err as { code?: string; constraint_name?: string }
  if (e?.code === '23P01')
    throw new AppError('ConflictError', 'Someone else holds this value for an overlapping period', { code: 'overlap' })
  if (e?.code === '23505' && e.constraint_name === 'person_identifier_one_per_person')
    throw new AppError('ConflictError', 'This person already has a current value in this system', { code: 'one_per_person' })
  if (e?.code === '23514' && e.constraint_name === 'person_identifier_valid_not_empty')
    throw new AppError('ValidationError', 'The period ends before it starts', { valid_to: 'after valid_from' })
  throw err as Error
}

/** The Person Identifier write path (D3). `internal` writes (sign-in
 *  write-through, migrations) skip the editor check; everyone else is held to
 *  the system's `edited_by`. Saving the same current value again changes and
 *  logs nothing. */
export async function addIdentifier(
  person: string,
  input: AddInput,
  actor: string,
  opts: { internal?: { source: string; verified: boolean }; db?: Db } = {},
): Promise<WriteResult> {
  const db = opts.db ?? sql
  const system = await getSystem(String(input.system ?? ''), db)
  if (!system.enabled) throw new AppError('ValidationError', `${system.label} is turned off`, { code: 'system_disabled' })
  if (SENSITIVITY[system.sensitivity].storage === 'fingerprint')
    throw new AppError('ValidationError', `${system.label} needs fingerprinting, which is not switched on yet`, { code: 'fingerprint_unavailable' })
  const may = opts.internal ? { verified: opts.internal.verified, noteRequired: false } : await assertMayEdit(actor, system, person)
  const verified = may.verified
  if (may.noteRequired && !String(input.note ?? '').trim())
    throw new AppError('ValidationError', `Say why you are recording this ${system.label} by hand (the roster sync is not running yet)`, { note: 'required' })
  const source = opts.internal?.source ?? (actor === person ? 'self' : 'manual')
  const value = normaliseValue(input.value, system.normalise, system.kind)
  const assigner = system.assigner_scoped ? String(input.assigner ?? '').trim() : ''
  const from = isoDate(input.valid_from, 'valid_from')
  // A value recorded by hand starts today (the database's date, the same
  // clock that closes rows); a migration or feed with no date has always held it.
  const startsToday = !from && !opts.internal
  const to = isoDate(input.valid_to, 'valid_to')
  if (input.worker_type != null && system.kind !== 'employee-record')
    throw new AppError('ValidationError', 'Only an employee record carries a worker type', { worker_type: 'not for this system' })
  const run = async (t: Db) => {
    await assertWritablePerson(person, t)
    if (input.record_identifier_id) {
      const [rec] = await t`
        select i.id from person_identifier i join identifier_system s on s.row_id = i.system
        where i.id = ${input.record_identifier_id} and i.person_id = ${person} and s.kind = 'external-record'`
      if (!rec) throw new AppError('ValidationError', 'The record must be one of this person’s record numbers', { record_identifier_id: 'not a record of this person' })
    }
    const [same] = await t`
      select ${rowFields(t)} from person_identifier
      where person_id = ${person} and system = ${system.row_id} and assigner = ${assigner} and value = ${value}
        and upper_inf(valid) and ${to}::date is null`
    if (same) {
      // A value someone records independently takes over a row that only
      // mirrored a sign-in or the person's email, so ending that source no
      // longer closes it (Codex review on #385).
      if (MIRROR_SOURCES.includes(String(same.source)) && !MIRROR_SOURCES.includes(source)) {
        const [row] = await t`
          update person_identifier set source = ${source}, verified = verified or ${verified}, edited_at = now(), edited_by = ${actor}
          where id = ${String(same.id)} returning ${rowFields(t)}`
        await logActivity(actor, `identifier_recorded ${system.row_id} for ${person} (${String(same.id)})`.slice(0, 140))
        return { result: 'updated' as const, identifier: row as unknown as IdentifierRow }
      }
      return { result: 'unchanged' as const, identifier: same as unknown as IdentifierRow }
    }
    const id = newIdentifierId()
    const [row] = await t`
      insert into person_identifier (id, person_id, system, assigner, value, valid, verified, record_identifier_id,
        worker_type, one_holder, one_per_person, source, recorded_by, note)
      values (${id}, ${person}, ${system.row_id}, ${assigner}, ${value},
        daterange(coalesce(${from}::date, case when ${startsToday}::boolean then current_date else '-infinity'::date end), ${to}::date, '[)'), ${verified},
        ${input.record_identifier_id ?? null}, ${input.worker_type ?? null}, ${system.one_holder_at_a_time}, ${system.one_per_person},
        ${source}, ${actor}, ${input.note ?? null})
      returning ${rowFields(t)}`
    await logActivity(actor, `identifier_added ${system.row_id} for ${person} (${id})`.slice(0, 140))
    return { result: 'created' as const, identifier: row as unknown as IdentifierRow }
  }
  try {
    return opts.db ? await run(opts.db) : await sql.begin((tx) => run(tx as unknown as Sql))
  } catch (err) {
    return mapWriteError(err)
  }
}

async function lockedRow(id: string, db: Db) {
  const [row] = await db`
    select ${rowFields(db)}, lower(valid)::text as lower_raw from person_identifier where id = ${id} for update`
  if (!row) throw new AppError('NotFoundError', `Identifier ${id} not found`)
  return row as unknown as IdentifierRow & { lower_raw: string }
}

// ----------------------------------------------- the employee-code system

/** The StyleHR employee-code system: what sales-target scoping reads
 *  (`currentEmployeeCodes` in sales-target.ts, #408). */
export const EMPLOYEE_CODE_SYSTEM = 'stylehr-employee-code'

/** Whose identifier this is — for the routes' Person read / Data Scope check
 *  (the same one adding a value runs). Never echoes the value. */
export async function identifierPerson(id: string): Promise<string> {
  const [row] = await sql`select person_id from person_identifier where id = ${id}`
  if (!row) throw new AppError('NotFoundError', `Identifier ${id} not found`)
  return String(row.person_id)
}

/** End a value (valid_to) or correct its spell (bounds, assigner, note). An
 *  unchanged write changes and logs nothing. */
export async function updateIdentifier(
  id: string,
  change: { valid_from?: string | null; valid_to?: string | null; assigner?: string | null; note?: string | null; worker_type?: string | null; end?: boolean },
  actor: string,
): Promise<{ result: 'updated' | 'unchanged'; identifier: IdentifierRow }> {
  // `end: true` ends the value today by the database's clock — the one
  // every other period boundary uses — rather than a date a browser computed.
  if (change.end) {
    const [{ today }] = await sql`select current_date::text as today`
    change = { ...change, valid_to: String(today) }
  }
  try {
    return await sql.begin(async (tx) => {
      const t = tx as unknown as Sql
      const current = await lockedRow(id, t)
      const system = await getSystem(current.system, t)
      const may = await assertMayEdit(actor, system, current.person_id)
      if (may.noteRequired && !String(change.note ?? '').trim())
        throw new AppError('ValidationError', `Say why you are changing this ${system.label} by hand (the roster sync is not running yet)`, { note: 'required' })
      await assertWritablePerson(current.person_id, t)
      const from = change.valid_from !== undefined ? isoDate(change.valid_from, 'valid_from') : current.valid_from
      const to = change.valid_to !== undefined ? isoDate(change.valid_to, 'valid_to') : current.valid_to
      const assigner = change.assigner !== undefined && system.assigner_scoped ? String(change.assigner ?? '').trim() : current.assigner
      const note = change.note !== undefined ? change.note : current.note
      const workerType = change.worker_type !== undefined ? change.worker_type : current.worker_type
      if (from === current.valid_from && to === current.valid_to && assigner === current.assigner && note === current.note && workerType === current.worker_type)
        return { result: 'unchanged' as const, identifier: current }
      // Ending a value on the day it started leaves an empty period: it was
      // never in force, so it is removed (and logged) rather than kept.
      if (to && from && to < from)
        throw new AppError('ValidationError', 'The period ends before it starts', { valid_to: 'on or after valid_from' })
      if (to && from && to === from && change.valid_to !== undefined && to !== current.valid_to) {
        await t`delete from person_identifier where id = ${id}`
        await logActivity(actor, `identifier_removed ${system.row_id} for ${current.person_id} (${id})`.slice(0, 140))
        return { result: 'updated' as const, identifier: { ...current, valid_to: to } }
      }
      const [row] = await t`
        update person_identifier set
          valid = daterange(coalesce(${from}::date, '-infinity'::date), ${to}::date, '[)'),
          assigner = ${assigner}, note = ${note}, worker_type = ${workerType}, edited_at = now(), edited_by = ${actor}
        where id = ${id} returning ${rowFields(t)}`
      await logActivity(actor, `identifier_${to && !current.valid_to ? 'ended' : 'corrected'} ${system.row_id} for ${current.person_id} (${id})`.slice(0, 140))
      return { result: 'updated' as const, identifier: row as unknown as IdentifierRow }
    })
  } catch (err) {
    return mapWriteError(err)
  }
}

/** Remove a value recorded by mistake (not an ended one — end it instead). */
export async function deleteIdentifier(id: string, actor: string): Promise<void> {
  await sql.begin(async (tx) => {
    const t = tx as unknown as Sql
    const current = await lockedRow(id, t)
    const system = await getSystem(current.system, t)
    const may = await assertMayEdit(actor, system, current.person_id)
    // By hand in a frozen source-fed system, only what was recorded by hand
    // may be removed; a carried-over value is ended (with a note), not erased.
    if (may.noteRequired && current.source !== 'manual')
      throw new AppError('PermissionError', `This ${system.label} was not recorded by hand; end it instead`, { code: 'source_managed' })
    // A replaced record is inert: its history is not edited (D1).
    await assertWritablePerson(current.person_id, t)
    await t`delete from person_identifier where id = ${id}`
    await logActivity(actor, `identifier_removed ${system.row_id} for ${current.person_id} (${id})`.slice(0, 140))
  })
}

// ----------------------------------------------------- write-through (D5)

/** The rows write-through owns: mirrors of a sign-in or of the person's own
 *  email. A value someone entered or a feed recorded is never closed by
 *  write-through, even when it holds the same address (Codex review on #385). */
const MIRROR_SOURCES = ['sign-in', 'person-email', 'self-email']

/** Is this address still the person's own email, or the verified address of
 *  one of their live Google links (other than `excludingIdentity`)? Then its
 *  `email` row stays current: one row stands for every live source. */
async function emailStillBacked(person: string, address: string, db: Db, excludingIdentity: string | null): Promise<boolean> {
  const [own] = await db`select 1 from person where row_id = ${person} and lower(trim(email)) = ${address}`
  if (own) return true
  const [linked] = await db`
    select 1 from sign_in_identity i join sign_in_method m on m.row_id = i.method and m.kind = 'google'
    where i.person_id = ${person} and i.ended_at is null and i.subject is not null and lower(trim(i.email)) = ${address}
      and i.id <> ${excludingIdentity ?? ''}`
  return Boolean(linked)
}

/** Close a current row today; a row opened today is removed instead (an
 *  empty period is no history). */
async function closeRow(id: string, db: Db) {
  const [row] = await db`select lower(valid) >= current_date as same_day from person_identifier where id = ${id}`
  if (!row) return
  if (row.same_day) await db`delete from person_identifier where id = ${id}`
  else await db`update person_identifier set valid = daterange(lower(valid), current_date, '[)'), edited_at = now() where id = ${id}`
}

async function openRow(person: string, systemKey: string, value: string, source: string, verified: boolean, db: Db) {
  const [system] = await db`select * from identifier_system where row_id = ${systemKey} and enabled`
  if (!system) return
  const [p] = await db`select built_in, replaced_by from person where row_id = ${person}`
  if (!p || p.built_in || p.replaced_by) return
  const normalised = normaliseValue(value, system.normalise as NormaliseRule, system.kind as IdentifierKind)
  const [have] = await db`
    select 1 from person_identifier where person_id = ${person} and system = ${systemKey} and value = ${normalised} and upper_inf(valid)`
  if (have) return
  try {
    await db`
      insert into person_identifier (id, person_id, system, assigner, value, valid, verified, one_holder, one_per_person, source, recorded_by)
      values (${newIdentifierId()}, ${person}, ${systemKey}, '', ${normalised}, daterange(current_date, null, '[)'),
        ${verified}, ${system.one_holder_at_a_time === true}, ${system.one_per_person === true}, ${source}, ${source})`
  } catch (err) {
    // A value someone else holds for an overlapping period (23P01) is a 409.
    mapWriteError(err)
  }
}

/** What a live sign-in identity writes: the matching identifier row for a
 *  method with an identifier system (a StyleHR record number), and an
 *  `email` row for an address the provider verified. */
async function identityTargets(identityId: string, db: Db) {
  const [i] = await db`
    select i.person_id, i.subject, i.subject_kind, i.email, m.kind, m.identifier_system
    from sign_in_identity i join sign_in_method m on m.row_id = i.method where i.id = ${identityId}`
  if (!i || i.subject == null) return { person: null as string | null, targets: [] as [string, string][] }
  const targets: [string, string][] = []
  if (i.identifier_system && i.subject_kind === 'record-id') targets.push([String(i.identifier_system), String(i.subject)])
  if (i.kind === 'google' && i.email) targets.push(['email', String(i.email)])
  return { person: String(i.person_id), targets }
}

export async function writeThroughIdentity(identityId: string, db: Db = sql): Promise<void> {
  const { person, targets } = await identityTargets(identityId, db)
  if (!person) return
  for (const [system, value] of targets) {
    try {
      await openRow(person, system, value, 'sign-in', true, db)
    } catch (err) {
      // A provider value that does not fit the system's format is not worth
      // refusing the sign-in over; it is simply not mirrored. A value another
      // person holds is a conflict (409) and stops the link.
      if (!(err instanceof AppError) || err.type !== 'ValidationError') throw err
    }
  }
}

/** Ending an identity closes the row it wrote (moved, unlinked, left). */
export async function endIdentityIdentifiers(identityId: string, db: Db = sql): Promise<void> {
  const { person, targets } = await identityTargets(identityId, db)
  if (!person) return
  for (const [system, value] of targets) {
    const [s] = await db`select normalise, kind from identifier_system where row_id = ${system}`
    if (!s) continue
    let normalised: string
    try {
      normalised = normaliseValue(value, s.normalise as NormaliseRule, s.kind as IdentifierKind)
    } catch {
      continue
    }
    if (system === 'email' && (await emailStillBacked(person, normalised, db, identityId))) continue
    for (const r of await db`
      select id from person_identifier
      where person_id = ${person} and system = ${system} and value = ${normalised} and upper_inf(valid)
        and source in ${db(MIRROR_SOURCES)}`)
      await closeRow(String(r.id), db)
  }
}

/** A provider reported a different verified address for a live identity
 *  (a Google account renamed): its mirror moves with it (Codex review on
 *  #385) — the old address closes unless something else still holds it. */
export async function reconcileIdentityEmail(identityId: string, oldEmail: string | null, db: Db = sql): Promise<void> {
  const [i] = await db`
    select i.person_id, i.email, m.kind from sign_in_identity i join sign_in_method m on m.row_id = i.method
    where i.id = ${identityId} and i.ended_at is null and i.subject is not null`
  if (!i || i.kind !== 'google') return
  const before = oldEmail?.trim().toLowerCase() || null
  const after = (i.email as string | null)?.trim().toLowerCase() || null
  if (before === after) return
  const person = String(i.person_id)
  if (before && !(await emailStillBacked(person, before, db, null)))
    for (const r of await db`
      select id from person_identifier where person_id = ${person} and system = 'email' and value = ${before} and upper_inf(valid)
        and source in ${db(MIRROR_SOURCES)}`)
      await closeRow(String(r.id), db)
  await writeThroughIdentity(identityId, db)
}

/** `person.email` stays the primary contact; every address is also an
 *  `email` row (C7). A change closes the old address's row and opens one for
 *  the new. */
export async function writeThroughEmail(person: string, oldEmail: string | null, newEmail: string | null, actor: string, db: Db = sql) {
  const before = oldEmail?.trim().toLowerCase() || null
  const after = newEmail?.trim().toLowerCase() || null
  if (before === after) return
  // The person's email has already changed in this transaction, so only a
  // live Google link can still back the old address.
  if (before && !(await emailStillBacked(person, before, db, null)))
    for (const r of await db`
      select id from person_identifier where person_id = ${person} and system = 'email' and value = ${before} and upper_inf(valid)
        and source in ${db(MIRROR_SOURCES)}`)
      await closeRow(String(r.id), db)
  if (after) await openRow(person, 'email', after, actor === person ? 'self-email' : 'person-email', actor !== person, db)
}

// #927: keep a master Table in step with a copied warehouse table.
// A rule maps the copied table onto a master Table through the master data's
// Source Link Table and says, per column, whether the source or Featherbase
// owns it. Each run compares three values per column — the last source value
// seen (the snapshot), the source now (the copied row) and Featherbase now —
// applies what the source owns and changed, and raises a ticket for every
// other difference. Nothing is ever deleted, and nothing is ever auto-linked.
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { sql } from './db'
import { AppError } from './errors'
import { actionTransaction } from './action-transaction'
import { getMeta, type TableMeta } from './meta'
import { tableRelation } from './table-engine'
import { saveDoc } from './document'
import { annotateHistory, latestVersion } from './import-corrections'
import { assertSystemManager } from './permissions'
import { runAsSystemActor } from './system-actor'
import { runPackageAction } from './runtime-packages'
import { appOperation, withAppIdentity } from './app-lifecycle'
import { createServiceAccount } from './service-accounts'
import { copyInfo, DELETED_AT_SOURCE } from './sources/table-copy'
import { differenceFingerprint } from './master-sync-names'
import type { SessionUser } from './auth'

const name = z.string().trim().min(1).max(140)
export const masterSyncRuleSchema = z.object({
  master_table: name,
  /** The value the link Table's system column holds for this source, e.g. StyleHR. */
  source_system: name,
  link: z.object({
    table: name,
    system_column: name,
    key_column: name,
    /** The link Table's column holding the master row's id. */
    master_column: name,
    kind_column: name.optional(),
    kind: name.optional(),
  }).strict(),
  /** Per master column: the copied column it comes from and who owns it. */
  columns: z.record(name, z.object({ source: name, owner: z.enum(['source', 'featherbase']) }).strict())
    .refine(columns => Object.keys(columns).length > 0, 'Name at least one column'),
  /** A row gone from the source sets this column to this value; without it, a ticket. */
  inactive: z.object({ column: name, value: z.union([z.string(), z.boolean(), z.number()]) }).strict().optional(),
  tickets: z.object({
    /** The app that raises them: Tickets, whose `create` action is used. */
    app: name.default('tickets'),
    /** The Tickets ticket type differences are raised as, e.g. source_change. */
    type: name,
    /** The value the type's source_system field takes (it routes the ticket). */
    source_system: name.optional(),
  }).strict(),
}).strict()
export type MasterSyncRule = z.infer<typeof masterSyncRuleSchema>

export type DifferenceKind = 'source_changed' | 'edited_here' | 'conflict' | 'differs_at_link' | 'unlinked' | 'gone' | 'missing_master' | 'ambiguous_link' | 'cannot_apply'
export type ColumnDecision = { apply: true } | { apply: false; raise?: DifferenceKind }

type Value = string | null
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?)?$/
/** A date written as an ISO day (optionally with a time), whose day exists. */
function isoDay(value: string): string | null {
  const day = ISO_DAY.exec(value)
  if (!day) return null
  const d = new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3])))
  return d.getUTCFullYear() === Number(day[1]) && d.getUTCMonth() === Number(day[2]) - 1 && d.getUTCDate() === Number(day[3])
    ? `${day[1]}-${day[2]}-${day[3]}` : null
}
/** One spelling per value, read as the master column's type, so 7, "7" and
 *  "7.000000000" compare equal for a number, and a date for its day. */
export function normalize(value: unknown, columnType?: string): Value {
  // JSON keeps its types: 7 and "7", "" and nothing, are different values.
  if (columnType === 'JSON') return value === null || value === undefined ? null : JSON.stringify(value)
  if (value === null || value === undefined || value === '') return null
  if (columnType === 'Int' || columnType === 'Float' || columnType === 'Currency') {
    const n = Number(value)
    return Number.isFinite(n) ? String(n) : String(value)
  }
  if (columnType === 'Check') {
    const text = String(value).toLowerCase()
    // Anything else stays as written, so it is seen as a change and refused, not read as false.
    return ['1', 'true', 't', 'yes'].includes(text) ? 'true' : ['0', 'false', 'f', 'no'].includes(text) ? 'false' : String(value)
  }
  if (columnType === 'Date' || columnType === 'Datetime') {
    if (value instanceof Date) return columnType === 'Date' ? value.toISOString().slice(0, 10) : value.toISOString()
    const text = String(value)
    // Only ISO dates are read as dates; the day is the one written, never shifted by a zone.
    if (!isoDay(text)) return text
    if (columnType === 'Date') return isoDay(text)
    return new Date(text).toISOString()
  }
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const NOT_FITTING = Symbol('not fitting')
/** The source value as the master column stores it; NOT_FITTING when it cannot be. */
export function toMaster(value: unknown, columnType?: string): unknown {
  // JSON keeps its own value; comparison spells it as text, storage must not.
  if (columnType === 'JSON') return value ?? null
  const n = normalize(value, columnType)
  if (n === null) return null
  if (columnType === 'Int' || columnType === 'Float' || columnType === 'Currency') {
    const number = Number(n)
    if (!Number.isFinite(number) || (columnType === 'Int' && !Number.isInteger(number))) return NOT_FITTING
    return number
  }
  if (columnType === 'Check') return n === 'true' ? true : n === 'false' ? false : NOT_FITTING
  if (columnType === 'Date' || columnType === 'Datetime') {
    if (value instanceof Date) return n
    // Not an ISO date, a day that does not exist (30-Feb), or an unreadable time: never guessed.
    return isoDay(String(value)) ? n : NOT_FITTING
  }
  return n
}
export const isNotFitting = (value: unknown) => value === NOT_FITTING

/**
 * The three-way rule for one column. `snapshot` is undefined on a row's first
 * sync after it is linked: there is no last value yet, so the source is never
 * applied over a value Featherbase already holds.
 */
export function decideColumn(owner: 'source' | 'featherbase', snapshot: Value | undefined, source: Value, featherbase: Value): ColumnDecision {
  if (featherbase === source) return { apply: false }
  if (snapshot === undefined) {
    // First sync of a newly linked row: fill an empty source-owned value, and
    // raise a source-owned disagreement; Featherbase-owned values are ours.
    if (owner === 'featherbase') return { apply: false }
    return featherbase === null ? { apply: true } : { apply: false, raise: 'differs_at_link' }
  }
  const sourceChanged = source !== snapshot
  const featherbaseChanged = featherbase !== snapshot
  if (sourceChanged && featherbaseChanged) return { apply: false, raise: 'conflict' }
  if (sourceChanged) return owner === 'source' ? { apply: true } : { apply: false, raise: 'source_changed' }
  // Featherbase changed, the source did not.
  return owner === 'source' ? { apply: false, raise: 'edited_here' } : { apply: false }
}

export async function masterSyncRule(copied: string): Promise<MasterSyncRule | null> {
  const [row] = await sql`select rule from featherbase.master_sync where copied_table = ${copied}`
  return row ? masterSyncRuleSchema.parse(row.rule) : null
}

function column(meta: TableMeta, field: string, what: string, keyAllowed = false) {
  const found = meta.columns.find(c => c.column_name === field)
  if (!found && !(keyAllowed && field === 'row_id')) throw new AppError('ValidationError', `${meta.name} has no column ${field} (${what})`)
  return found
}

/** Platform work on Tables an app owns names that app's installed version, not
 *  the version the caller's client may or may not have sent. */
async function asInstalledApps<T>(tables: string[], fn: () => Promise<T>): Promise<T> {
  const owners = await sql`select distinct i.name, i.package_version from installed_app i
    join table_def t on t.owner_app = i.name where t.name in ${sql(tables)}`
  return owners.reduce<() => Promise<T>>((next, owner) => () => withAppIdentity(String(owner.name), String(owner.package_version), next), fn)()
}

/** A System Manager sets (or, with null, removes) a copied table's sync rule. */
export async function setMasterSync(user: SessionUser, copied: string, input: unknown) {
  await assertSystemManager(user.row_id)
  if (!(await copyInfo(copied))) throw new AppError('NotFoundError', `${copied} is not a copied table`)
  if (input === null) {
    await sql`delete from featherbase.master_sync where copied_table = ${copied}`
    return null
  }
  const parsed = masterSyncRuleSchema.safeParse(input)
  if (!parsed.success) throw new AppError('ValidationError', `Sync rule: ${parsed.error.issues.map(i => `${i.path.join('.') || 'rule'} ${i.message}`).join('; ')}`)
  const rule = parsed.data
  return asInstalledApps([rule.master_table, rule.link.table], () => checkAndSaveRule(user, copied, rule))
}

/** Checked when a rule is set and again on every run: Tables change after a rule is
 *  written, and a save silently drops a column that has become read-only. */
function checkRule(rule: MasterSyncRule, copiedMeta: TableMeta, master: TableMeta, link: TableMeta) {
  if (master.name === copiedMeta.name) throw new AppError('ValidationError', 'A copied table cannot be its own master')
  // Provenance lives on the history row: a master without history cannot say where a change came from.
  if (!master.track_changes) throw new AppError('ValidationError', `${master.name} keeps no history, so a synced change could not say where it came from`)
  for (const [field, spec] of Object.entries(rule.columns)) {
    const target = column(master, field, 'a synced master column')
    if (target?.read_only) throw new AppError('ValidationError', `${master.name}.${field} is read-only`)
    column(copiedMeta, spec.source, `the source of ${field}`, true)
  }
  for (const field of [rule.link.system_column, rule.link.key_column, rule.link.master_column, ...(rule.link.kind_column ? [rule.link.kind_column] : [])])
    column(link, field, 'a link column', true)
  if (!!rule.link.kind_column !== (rule.link.kind !== undefined)) throw new AppError('ValidationError', 'A link kind needs both kind_column and kind')
  if (rule.inactive) {
    const inactive = column(master, rule.inactive.column, 'the inactive column')
    if (inactive?.read_only) throw new AppError('ValidationError', `${master.name}.${rule.inactive.column} is read-only`)
    if (isNotFitting(toMaster(rule.inactive.value, inactive?.column_type))) throw new AppError('ValidationError', `The inactive value does not fit ${master.name}.${rule.inactive.column}`)
  }
}

async function checkAndSaveRule(user: SessionUser, copied: string, rule: MasterSyncRule) {
  const [copiedMeta, master, link] = await Promise.all([getMeta(copied), getMeta(rule.master_table), getMeta(rule.link.table)])
  checkRule(rule, copiedMeta, master, link)
  await actionTransaction(async () => {
    // Serialized with runs. A rule that matches rows differently starts again
    // from Featherbase: the last values seen belong to the old matching.
    await sql`select pg_advisory_xact_lock(hashtext('master-sync:' || ${copied}))`
    const before = await masterSyncRule(copied)
    await sql`insert into featherbase.master_sync (copied_table, rule, updated_by) values (${copied}, ${sql.json(rule)}, ${user.row_id})
      on conflict (copied_table) do update set rule = excluded.rule, updated_by = excluded.updated_by, updated_at = now()`
    if (before && JSON.stringify(matching(before)) !== JSON.stringify(matching(rule)))
      await sql`delete from featherbase.master_sync_snapshot where copied_table = ${copied}`
  })
  return rule
}

/** What decides which value is compared with which. */
const matching = (rule: MasterSyncRule) => ({ master: rule.master_table, source: rule.source_system, link: rule.link,
  columns: Object.entries(rule.columns).map(([field, spec]) => [field, spec.source]).sort() })

export interface MasterSyncResult {
  run_id: string
  linked: number; applied: number; unchanged: number
  raised: number; already_raised: number
  tickets: string[]; ticket_errors: string[]
}

const KIND_TEXT: Record<DifferenceKind, string> = {
  source_changed: 'The source changed a value Featherbase owns. Check our value.',
  edited_here: 'This value was edited in Featherbase, but the source owns it. Should the source be fixed?',
  conflict: 'Both the source and Featherbase changed this value. Nothing was applied; decide which is right.',
  differs_at_link: 'When this row was linked, Featherbase and the source disagreed on a value the source owns. Nothing was applied.',
  unlinked: 'A new source row has no link to a Featherbase row. Create the Featherbase row or link an existing one.',
  gone: 'This row is no longer in the source. Nothing was deleted; decide what to do with the Featherbase row.',
  missing_master: 'A link points at a Featherbase row that does not exist. Fix the link.',
  ambiguous_link: 'This source key is linked to more than one Featherbase row. Keep one link.',
  cannot_apply: 'The source changed a value the source owns, but the new value does not fit the Featherbase column. Nothing was applied.',
}

interface Difference {
  kind: DifferenceKind; source_key: string; master_row: string | null
  column_name: string | null; source_value: Value; featherbase_value: Value
}

/** The service account the sync writes and raises tickets as: never a person.
 *  It holds System Manager only inside a sync (system-actor.ts). */
export const SYNC_ACCOUNT_LABEL = 'svc-master-sync'
async function syncActor(by: string): Promise<string> {
  return actionTransaction(async () => {
    // Two first syncs at once: the second finds the account the first made.
    await sql`select pg_advisory_xact_lock(hashtext('master-sync-account'))`
    const [found] = await sql`select row_id from service_account where lower(label) = lower(${SYNC_ACCOUNT_LABEL})`
    return found ? String(found.row_id) : (await createServiceAccount(SYNC_ACCOUNT_LABEL, ['All'], by)).row_id
  })
}

/** Every refresh of a copy, manual or scheduled, brings its master Table in step. */
export async function syncAfterCopy(user: SessionUser, copied: string): Promise<MasterSyncResult | null> {
  return (await masterSyncRule(copied)) ? runMasterSync(user, copied) : null
}

/** Compare and apply in one transaction, then raise the new differences as tickets. */
export async function runMasterSync(user: SessionUser, copied: string): Promise<MasterSyncResult> {
  await assertSystemManager(user.row_id)
  const actor = await syncActor(user.row_id)
  // The app lifecycle lock comes before any row lock, as every save takes them,
  // so a sync can never wait on an upgrade that waits on the sync.
  const outcome = await appOperation(() => runAsSystemActor(actor, () => actionTransaction(() => compareAndApply(actor, copied))))
  const { tickets, ticket_errors } = await raiseTickets(actor, copied)
  return { ...outcome, tickets, ticket_errors }
}

async function compareAndApply(actor: string, copied: string): Promise<Omit<MasterSyncResult, 'tickets' | 'ticket_errors'>> {
  await sql`select pg_advisory_xact_lock(hashtext('master-sync:' || ${copied}))`
  const rule = await masterSyncRule(copied)
  if (!rule) throw new AppError('NotFoundError', `${copied} has no master sync rule`)
  return asInstalledApps([rule.master_table, rule.link.table], () => applyRule(actor, copied, rule))
}

async function applyRule(actor: string, copied: string, rule: MasterSyncRule): Promise<Omit<MasterSyncResult, 'tickets' | 'ticket_errors'>> {
  // Two copies feeding one master take turns, so they never lock its rows in opposite orders.
  await sql`select pg_advisory_xact_lock(hashtext('master-sync-master:' || ${rule.master_table}))`
  const [copiedMeta, master, link] = await Promise.all([getMeta(copied), getMeta(rule.master_table), getMeta(rule.link.table)])
  checkRule(rule, copiedMeta, master, link)
  const runId = `sync-${randomUUID()}`
  const result = { run_id: runId, linked: 0, applied: 0, unchanged: 0, raised: 0, already_raised: 0 }

  // source key → master row, for this source system (and key kind).
  const linkRel = sql(await tableRelation(link.name))
  const kindFilter = rule.link.kind_column ? sql`and ${sql(rule.link.kind_column)} = ${rule.link.kind!}` : sql``
  const links = await sql`select ${sql(rule.link.key_column)} as source_key, ${sql(rule.link.master_column)} as master_row from ${linkRel}
    where ${sql(rule.link.system_column)} = ${rule.source_system} ${kindFilter}`
  const linked = new Map<string, Set<string>>()
  for (const l of links) {
    if (l.source_key == null || l.master_row == null || l.master_row === '') continue
    const key = String(l.source_key)
    linked.set(key, (linked.get(key) ?? new Set()).add(String(l.master_row)))
  }
  const sourceColumns = [...new Set(Object.values(rule.columns).map(c => c.source))]
  const copiedRows = await sql`select row_id, ${sql(DELETED_AT_SOURCE)}, ${sql(sourceColumns)} from ${sql(await tableRelation(copiedMeta.name))} order by row_id`
  const snapshots = new Map((await sql`select source_key, master_row, source_values from featherbase.master_sync_snapshot where copied_table = ${copied}`)
    .map(s => [String(s.source_key), s as { master_row: string; source_values: Record<string, Value> }]))
  const masterRel = sql(await tableRelation(master.name))
  const differences: Difference[] = []

  for (const row of copiedRows) {
    const key = String(row.row_id)
    const targets = linked.get(key)
    if (!targets) {
      if (!row[DELETED_AT_SOURCE]) differences.push({ kind: 'unlinked', source_key: key, master_row: null, column_name: null, source_value: null, featherbase_value: null })
      continue
    }
    if (targets.size > 1) {
      differences.push({ kind: 'ambiguous_link', source_key: key, master_row: [...targets].sort().join(', '), column_name: null, source_value: null, featherbase_value: null })
      continue
    }
    for (const target of targets) {
      const [current] = await sql`select * from ${masterRel} where ${sql(master.row_key)} = ${target} for update`
      if (!current) {
        differences.push({ kind: 'missing_master', source_key: key, master_row: target, column_name: null, source_value: null, featherbase_value: null })
        continue
      }
      result.linked++
      const values: Record<string, unknown> = {}
      // What this run saw, kept as the row's last-seen values once it is done.
      let seen: Record<string, Value> | undefined
      // A source value that could not be applied was not "seen": the column
      // keeps its old baseline, so a later valid value still applies.
      const keepBaseline = (field: string) => {
        const before = snapshots.get(key)
        if (before?.master_row === target && Object.hasOwn(before.source_values, field)) seen![field] = before.source_values[field]
        else delete seen![field]
      }
      if (row[DELETED_AT_SOURCE]) {
        // Never delete: mark inactive when the rule says how, else ask.
        if (!rule.inactive) differences.push({ kind: 'gone', source_key: key, master_row: target, column_name: null, source_value: null, featherbase_value: null })
        else {
          const type = master.columns.find(c => c.column_name === rule.inactive!.column)?.column_type
          if (normalize(current[rule.inactive.column], type) !== normalize(rule.inactive.value, type)) values[rule.inactive.column] = toMaster(rule.inactive.value, type)
        }
      } else {
        const snapshot = snapshots.get(key)
        const seenBefore = snapshot && snapshot.master_row === target ? snapshot.source_values : undefined
        seen = {}
        for (const [field, spec] of Object.entries(rule.columns)) {
          const type = master.columns.find(c => c.column_name === field)?.column_type
          const source = normalize(row[spec.source], type)
          const featherbase = normalize(current[field], type)
          seen[field] = source
          const decision = decideColumn(spec.owner, seenBefore === undefined || !Object.hasOwn(seenBefore, field) ? undefined : seenBefore[field], source, featherbase)
          const stored = decision.apply ? toMaster(row[spec.source], type) : undefined
          if (decision.apply && isNotFitting(stored)) {
            differences.push({ kind: 'cannot_apply', source_key: key, master_row: target, column_name: field, source_value: source, featherbase_value: featherbase })
            keepBaseline(field)
          } else if (decision.apply) values[field] = stored
          else if (decision.raise) differences.push({ kind: decision.raise, source_key: key, master_row: target, column_name: field, source_value: source, featherbase_value: featherbase })
        }
      }
      if (!Object.keys(values).length) result.unchanged++
      else try {
        // One row's save is its own savepoint: a value the master refuses
        // (a Choice it does not offer, a required value emptied, too long)
        // is raised, and every other row still syncs.
        await actionTransaction(async () => {
          const previous = await latestVersion(master.name, target)
          const saved = await saveDoc(master.name, { row_id: target, updated_at: current.updated_at, ...values }, actor, 'upsert')
          // Provenance: a later outbound feed skips what came from this source.
          await annotateHistory(master, saved, actor, previous, { synced_from: rule.source_system, sync_copied_table: copied, sync_run: runId })
        })
        result.applied++
      } catch (error) {
        if (!(error instanceof AppError) || error.type !== 'ValidationError') throw error
        for (const field of Object.keys(values)) {
          differences.push({ kind: 'cannot_apply', source_key: key, master_row: target, column_name: field,
            source_value: normalize(values[field], master.columns.find(c => c.column_name === field)?.column_type),
            featherbase_value: normalize(current[field], master.columns.find(c => c.column_name === field)?.column_type) })
          if (seen) keepBaseline(field)
        }
      }
      if (seen) await sql`insert into featherbase.master_sync_snapshot (copied_table, source_key, master_row, source_values)
        values (${copied}, ${key}, ${target}, ${sql.json(seen)})
        on conflict (copied_table, source_key) do update set master_row = excluded.master_row, source_values = excluded.source_values, seen_at = now()`
    }
  }
  for (const d of differences) {
    // One ticket per difference: the same values, unresolved, never raise twice.
    const fingerprint = differenceFingerprint(copied, rule.master_table, rule.source_system, d)
    const inserted = await sql`insert into featherbase.master_sync_difference
      (copied_table, fingerprint, kind, source_key, master_row, column_name, source_value, featherbase_value, ticket_app, ticket_payload, run_id)
      values (${copied}, ${fingerprint}, ${d.kind}, ${d.source_key}, ${d.master_row}, ${d.column_name}, ${d.source_value}, ${d.featherbase_value},
        ${rule.tickets.app}, ${sql.json(ticketPayload(rule, master, d))}, ${runId})
      on conflict (copied_table, fingerprint) do nothing returning fingerprint`
    if (inserted.length) result.raised++
    else result.already_raised++
  }
  await sql`update featherbase.master_sync set last_synced_at = clock_timestamp(), last_run_id = ${runId} where copied_table = ${copied}`
  return result
}

function ticketPayload(rule: MasterSyncRule, master: TableMeta, d: Difference) {
  const label = d.column_name ? master.columns.find(c => c.column_name === d.column_name)!.label : undefined
  const where = d.master_row ? `${master.name} ${d.master_row}` : `${rule.source_system} ${d.source_key}`
  const title = d.column_name ? `${rule.source_system} · ${where}: ${label}` : `${rule.source_system} · ${where}`
  const lines = [KIND_TEXT[d.kind], `Source: ${rule.source_system} key ${d.source_key}.`,
    ...(d.column_name ? [`Field: ${label}.`, `Featherbase now: ${d.featherbase_value ?? '(empty)'}.`, `Source now: ${d.source_value ?? '(empty)'}.`] : [])]
  const details: Record<string, string> = { record_key: d.master_row ?? d.source_key, action: KIND_TEXT[d.kind] }
  if (rule.tickets.source_system) details.source_system = rule.tickets.source_system
  if (label) details.field = label
  if (d.featherbase_value !== null && d.column_name) details.current_value = d.featherbase_value
  if (d.source_value !== null && d.column_name) details.expected_value = d.source_value
  return { title: title.slice(0, 140), original: lines.join('\n'), kind: rule.tickets.type, details }
}

/** Each recorded difference without a ticket yet; safe to repeat (idempotent). */
async function raiseTickets(actor: string, copied: string): Promise<{ tickets: string[]; ticket_errors: string[] }> {
  const pending = await sql`select fingerprint, ticket_app, ticket_payload from featherbase.master_sync_difference
    where copied_table = ${copied} and ticket is null order by raised_at, fingerprint`
  const tickets: string[] = [], ticket_errors: string[] = []
  for (const d of pending) {
    try {
      // The app chosen when the difference was recorded, so a retry is never sent elsewhere.
      const app = String(d.ticket_app)
      // Platform work on the app's behalf names its installed version, not the caller's client.
      const [installed] = await sql`select package_version from installed_app where name = ${app}`
      const answer = await runAsSystemActor(actor, () => withAppIdentity(app, String(installed.package_version), () => runPackageAction(app, 'create',
        { idempotencyKey: `master-sync-${d.fingerprint}`, payload: d.ticket_payload }, actor))) as { result: { ticket: { row_id: string } } }
      // An app that answers without a ticket is an error, kept and retried like any other.
      const ticket = String(answer.result.ticket.row_id)
      await sql`update featherbase.master_sync_difference set ticket = ${ticket}, ticket_error = null
        where copied_table = ${copied} and fingerprint = ${String(d.fingerprint)}`
      tickets.push(ticket)
    } catch (error) {
      // The sync's own changes are committed; a ticket that could not be
      // raised stays pending and is retried on the next run.
      const message = String(error)
      ticket_errors.push(message)
      await sql`update featherbase.master_sync_difference set ticket_error = ${message.slice(0, 500)}
        where copied_table = ${copied} and fingerprint = ${String(d.fingerprint)}`
    }
  }
  return { tickets, ticket_errors }
}

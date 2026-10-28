import { isDeepStrictEqual } from 'node:util'
import { AppError } from './errors'
import { sql } from './db'
import { actionTransaction } from './action-transaction'
import { getMeta, type TableMeta } from './meta'
import { getDoc, saveDoc, saveSystemRow } from './document'
import { tableRelation } from './table-engine'
import { assertDocPermission } from './permissions'
import { permittedTiers, isSharedWith, stripUnwritableFields } from './permissions'
import { assertManagedUnchanged, holdManagedSet } from './managed-settings'
import { registerCollectionAction } from './actions'

type Row = Record<string, unknown>
type Change = [string, unknown, unknown]
interface History { row_id: string; created_by: string; created_at: Date; data: { changed?: Change[]; import_run?: string; resolution?: { field: string; decision: 'keep' | 'source'; incoming: unknown } } }
interface Conflict { field: string; kept: unknown; incoming: unknown; editor: string; edited_at: Date }
export interface ImportPlan { values: Row; conflicts: Conflict[]; fields_updated: number; source_values: Row; protected_values: Row }
const normalized = (value: unknown, type: string): unknown => {
  if (value == null) return null
  if (type === 'Date') return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
  if (type === 'Datetime') return (value instanceof Date ? value : new Date(String(value))).toISOString()
  if (['Int', 'Float', 'Currency'].includes(type)) return Number(value)
  if (type === 'Check') return value === true || value === 1 || value === '1'
  return value
}
const same = (a: unknown, b: unknown, type: string) => isDeepStrictEqual(normalized(a, type), normalized(b, type))

/** The latest actual field change decides ownership. Source observations are
 * history, including an initial import and an import that changed nothing. */
export async function planImport(meta: TableMeta, current: Row, input: Row, user: string): Promise<ImportPlan> {
  const shared = await isSharedWith(user, meta.name, String(current.row_id), 'write')
  const allowed = shared ? input : stripUnwritableFields(meta.columns, await permittedTiers(user, meta.name, 'write'), input)
  const values: Row = { ...input }
  const source_values: Row = {}
  const protected_values: Row = {}
  const conflicts: Conflict[] = []
  let fields_updated = 0
  const history = meta.track_changes ? await sql<History[]>`select row_id, created_by, created_at, data from version where ref_table = ${meta.name} and ref_name = ${String(current.row_id)} and created_at >= (select created_at from table_def where name = ${meta.name}) order by created_at desc, row_id desc` : []
  // Pre-feature import versions already have a trustworthy link from their log.
  const logs = meta.track_changes ? await sql`select touched, created_at from import_log where ref_table = ${meta.name} and created_at >= (select created_at from table_def where name = ${meta.name}) order by created_at desc` : []
  const previousImports = logs.flatMap(l => (Array.isArray(l.touched) ? l.touched as { row_id: string; version?: string; action: string }[] : []).map(t => ({ ...t, observed_at: l.created_at as Date }))).filter(t => t.row_id === current.row_id)
  const observations = meta.track_changes ? await sql<{ values: Row }[]>`select values from featherbase.import_source where ref_table = ${meta.name} and ref_name = ${String(current.row_id)} and created_at >= ${current.created_at as Date} order by created_at desc, row_id desc` : []
  const importedVersions = new Set(previousImports.flatMap(t => t.version ? [t.version] : []))
  for (const column of meta.columns) {
    const field = column.column_name
    if (!Object.hasOwn(allowed, field) || column.read_only || ['Section Break', 'Column Break', 'Sub-table'].includes(column.column_type)) continue
    source_values[field] = normalized(allowed[field], column.column_type)
    const latest = history.find(h => h.data.changed?.some(c => c[0] === field) || h.data.resolution?.field === field)
    const person = latest && !(latest.data.resolution?.field === field && latest.data.resolution.decision === 'source') && !latest.data.import_run && !importedVersions.has(latest.row_id)
    if (person) protected_values[field] = normalized(current[field], column.column_type)
    if (same(current[field], allowed[field], column.column_type)) continue
    if (person) {
      const observation = observations.find(o => Object.hasOwn(o.values, field))
      let supplied: unknown
      let hasSupplied = false
      if (observation) { supplied = observation.values[field]; hasSupplied = true }
      else {
        const oldImport = history.find(h => importedVersions.has(h.row_id) && h.data.changed?.some(c => c[0] === field))
        if (oldImport) { supplied = oldImport.data.changed!.find(c => c[0] === field)![2]; hasSupplied = true }
        else if (previousImports.some(t => t.action === 'inserted')) {
          const earliest = [...history].reverse().find(h => h.data.changed?.some(c => c[0] === field))
          if (earliest) { supplied = earliest.data.changed!.find(c => c[0] === field)![1]; hasSupplied = true }
        }
      }
      delete values[field]
      if (!hasSupplied || !same(supplied, allowed[field], column.column_type)) conflicts.push({ field, kept: normalized(current[field], column.column_type), incoming: normalized(allowed[field], column.column_type), editor: latest.created_by, edited_at: latest.created_at })
    } else fields_updated++
  }
  return { values, conflicts, fields_updated, source_values, protected_values }
}

async function latestVersion(table: string, name: string): Promise<string | null> {
  const [version] = await sql`select row_id from version where ref_table = ${table} and ref_name = ${name} and created_at >= (select created_at from table_def where name = ${table}) order by created_at desc, row_id desc limit 1`
  return version ? String(version.row_id) : null
}

async function annotateHistory(meta: TableMeta, row: Row, user: string, previous: string | null, extra: Row): Promise<string | undefined> {
  if (!meta.track_changes) return
  const [version] = await sql`select row_id, data from version where ref_table = ${meta.name} and ref_name = ${String(row.row_id)} and created_at >= (select created_at from table_def where name = ${meta.name}) order by created_at desc, row_id desc limit 1`
  if (version && version.row_id !== previous) {
    await sql`update version set data = ${sql.json({ ...version.data, ...extra })} where row_id = ${version.row_id}`
    return String(version.row_id)
  }
  if (!extra.resolution) return
  const event = await saveSystemRow('Version', { ref_table: meta.name, ref_name: row.row_id, data: { changed: [], ...extra } }, user)
  // System rows use now(), which is transaction-start rather than wall time.
  await sql`update version set created_at = clock_timestamp(), updated_at = clock_timestamp() where row_id = ${String(event.row_id)}`
  return String(event.row_id)
}

export async function saveImportedRow(meta: TableMeta, input: Row, user: string, runId: string, update: boolean): Promise<{ saved: Row; version?: string }> {
  return actionTransaction(async () => {
    await holdManagedSet(sql, meta.name)
    let plan: ImportPlan | undefined
    if (update) {
      const [current] = await sql`select * from ${sql(await tableRelation(meta.name))} where ${sql(meta.row_key)} = ${String(input.row_id)} for update`
      if (!current) throw new AppError('NotFoundError', 'The imported row no longer exists')
      await assertManagedUnchanged(sql, meta, String(input.row_id), current, { ...current, ...input }, user)
      // SaveDoc performs the complete write gate; preview/list use getDoc.
      plan = await planImport(meta, { ...current, row_id: current[meta.row_key] }, input, user)
    }
    const previous = await latestVersion(meta.name, String(input.row_id))
    const saved = await saveDoc(meta.name, plan?.values ?? input, user, update ? 'upsert' : 'insert')
    for (const [field, kept] of Object.entries(plan?.protected_values ?? {})) {
      const column = meta.columns.find(c => c.column_name === field)!
      if (!same(saved[field], kept, column.column_type)) throw new AppError('ValidationError', 'An automation changed a protected import field')
    }
    for (const conflict of plan?.conflicts ?? []) {
      // One current conflict per field. A newer source supersedes its earlier offer.
      await sql`update featherbase.import_conflict set closed = true where ref_table = ${meta.name} and ref_name = ${String(saved.row_id)} and field = ${conflict.field} and closed is not true`
      const raised = await saveSystemRow('Import Conflict', { ref_table: meta.name, ref_name: saved.row_id, ...conflict, run_id: runId, closed: false }, user)
      await sql`update featherbase.import_conflict set created_at = clock_timestamp() where row_id = ${String(raised.row_id)}`
    }
    const sources = plan?.source_values ?? Object.fromEntries(meta.columns.filter(c => Object.hasOwn(input, c.column_name)).map(c => [c.column_name, normalized(saved[c.column_name], c.column_type)]))
    // A source that now agrees with the person resolves its old disagreement.
    // A hand edit since an old offer makes that offer stale; a new conflict,
    // if any, above already carries the current correction.
    const open = await sql`select row_id, field, kept from featherbase.import_conflict where ref_table = ${meta.name} and ref_name = ${String(saved.row_id)} and closed is not true`
    for (const conflict of open) {
      const field = String(conflict.field)
      const column = meta.columns.find(c => c.column_name === field)
      if (column && Object.hasOwn(sources, field) && (same(sources[field], saved[field], column.column_type) || !same(conflict.kept, saved[field], column.column_type)))
        await sql`update featherbase.import_conflict set closed = true where row_id = ${conflict.row_id}`
    }
    const version = await annotateHistory(meta, saved, user, previous, { import_run: runId })
    if (meta.track_changes) {
      const observation = await saveSystemRow('Import Source', { ref_table: meta.name, ref_name: saved.row_id, values: sources, run_id: runId }, user)
      await sql`update featherbase.import_source set created_at = clock_timestamp() where row_id = ${String(observation.row_id)}`
    }
    return { saved, version }
  })
}

export async function mayResolve(meta: TableMeta, row: Row, field: string, user: string): Promise<boolean> {
  const column = meta.columns.find(c => c.column_name === field)
  if (!column || column.read_only) return false
  if (await isSharedWith(user, meta.name, String(row.row_id), 'write')) return true
  try { await assertDocPermission(user, meta.name, 'write', String(row.created_by)) } catch (e) { if (e instanceof AppError) return false; throw e }
  return (await permittedTiers(user, meta.name, 'write')).has(column.tier)
}
registerCollectionAction('import-conflicts', {
  effect: 'read', description: 'List readable import conflicts for this Table.',
  handler: async ({ table, user }) => {
    const meta = await getMeta(table)
    const rows = await sql`select * from featherbase.import_conflict where ref_table = ${table} and closed is not true and created_at >= (select created_at from table_def where name = ${table}) order by created_at, row_id`
    const conflicts = []
    for (const conflict of rows) {
      let row: Row
      try { row = await getDoc(table, String(conflict.ref_name), user.row_id) } catch (e) { if (e instanceof AppError && ['PermissionError', 'NotFoundError'].includes(e.type)) continue; throw e }
      const column = meta.columns.find(c => c.column_name === conflict.field)
      if (!column || !Object.hasOwn(row, column.column_name)) continue
      conflicts.push({ id: conflict.row_id, row_id: conflict.ref_name, field: conflict.field, label: column.label || column.column_name, kept: conflict.kept, incoming: conflict.incoming, editor: conflict.editor, edited_at: conflict.edited_at, run_id: conflict.run_id, can_resolve: await mayResolve(meta, row, column.column_name, user.row_id) })
    }
    return { conflicts }
  },
})
registerCollectionAction('resolve-import-conflict', {
  effect: 'write', description: 'Resolve one import conflict by keeping the correction or adopting the source.',
  handler: async ({ table, args, user }) => {
    if (typeof args.conflict_id !== 'string' || !['keep', 'source'].includes(String(args.decision))) throw new AppError('ValidationError', 'Choose keep or source for an import conflict')
    return actionTransaction(async () => {
      const meta = await getMeta(table)
      // Lock parent first, as imports do, so resolution never deadlocks with import.
      const [found] = await sql`select * from featherbase.import_conflict where row_id = ${String(args.conflict_id)} and ref_table = ${table} and created_at >= (select created_at from table_def where name = ${table})`
      if (!found) throw new AppError('NotFoundError', 'Import conflict not found')
      await sql`select 1 from ${sql(await tableRelation(table))} where ${sql(meta.row_key)} = ${String(found.ref_name)} for update`
      const [conflict] = await sql`select * from featherbase.import_conflict where row_id = ${String(args.conflict_id)} and closed is not true for update`
      if (!conflict) throw new AppError('ConflictError', 'This import conflict is already closed')
      const row = await getDoc(table, String(conflict.ref_name), user.row_id)
      if (!Object.hasOwn(row, String(conflict.field)) || !(await mayResolve(meta, row, String(conflict.field), user.row_id))) throw new AppError('PermissionError', 'You cannot edit this field of this row')
      const column = meta.columns.find(c => c.column_name === conflict.field)!
      if (!same(row[column.column_name], conflict.kept, column.column_type)) throw new AppError('ConflictError', 'This field changed after the conflict was raised; import again before resolving')
      const previous = await latestVersion(table, String(row.row_id))
      // Both decisions pass through saveDoc for the same row/field write gates.
      const saved = await saveDoc(table, { row_id: row.row_id, updated_at: row.updated_at, [column.column_name]: args.decision === 'source' ? conflict.incoming : row[column.column_name] }, user.row_id)
      await annotateHistory(meta, saved, user.row_id, previous, { resolution: { field: column.column_name, decision: args.decision, incoming: conflict.incoming } })
      await sql`update featherbase.import_conflict set closed = true where row_id = ${conflict.row_id}`
      return { resolved: true }
    })
  },
})

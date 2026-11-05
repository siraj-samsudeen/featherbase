// #859 (design decisions 9-14): a System Manager deletes rows permanently,
// with their own history, comments, attachments and shares. Rows that still
// point at them are found from metadata and either deleted too ("cascade")
// or have their link cleared ("clear"); a dependent that allows neither
// holds the whole delete. Every removed row leaves an Access Log entry with
// the reason and a snapshot. All of it runs in one transaction.
import { randomUUID } from 'node:crypto'
import { canRetire, rowDisplayTitle } from 'shared'
import { sql, usingTransaction } from './db'
import { saveDoc } from './document'
import { AppError } from './errors'
import { ROW_KEY, getMeta, type TableMeta } from './meta'
import { assertSystemManager, isPrivileged } from './permissions'
import { tableRelation, tableName } from './table-engine'
import { PLATFORM_SCHEMA, platformRelation } from './platform-schema'
import { ROW_ID_HOLDERS } from './document-activity'
import { runHooks } from './controllers'
import { assertMandatoryAccess } from './mandatory-access'
import { assertRowNotManaged } from './managed-settings'
import { deleteStored } from './storage'
import { afterCommitOf, afterDocumentCommit } from './action-transaction'
import { isBound } from './sources/dispatch'

type Db = typeof sql
type Row = Record<string, unknown>
export type LinkMode = 'cascade' | 'clear'

/** The most rows one permanent delete may remove, cascade included. */
export const MAX_PURGE_ROWS = 1000

export interface PurgeRow { table: string; row_id: string; title: string }
export interface PurgeGroup {
  /** The Table whose rows point at the rows being deleted. */
  table: string
  column: string
  /** A sub-table's lines: the documents holding them are named in `rows`. */
  lines: boolean
  /** For lines, the Table of the documents holding them (each decides for its own). */
  parent_table?: string
  count: number
  /** Up to 50, to name them. */
  rows: (PurgeRow & { parent?: { table: string; row_id: string } })[]
  action: 'delete' | 'clear' | 'blocked'
  /** Why the group cannot be deleted, cleared, or either. */
  why?: string
}
export interface PurgePlan {
  links: LinkMode
  /** Every row the delete removes, those it was asked for first. */
  rows: PurgeRow[]
  groups: PurgeGroup[]
  blocked: boolean
  /** What goes with the rows: their comments, history, attachments and shares. */
  activity: { comments: number; versions: number; files: number; shares: number }
}

/** Why a Table's rows cannot be deleted permanently, or null when they can. */
export function purgeRefusal(meta: TableMeta): string | null {
  // A Table with an access policy holds private work, whose deletion record
  // could not stay readable once its row is gone (mandatory access needs the
  // row); its rows keep their own lifecycle.
  if (!canRetire(meta) || meta.system || isBound(meta) || meta.access_policy)
    return `${meta.name} rows cannot be deleted permanently`
  return null
}

/** Display advice: whether this person may delete this Table's rows permanently. */
export async function mayPurge(user: string, meta: TableMeta): Promise<boolean> {
  return purgeRefusal(meta) === null && (await isPrivileged(user))
}

const titleOf = (meta: TableMeta, row: Row) => rowDisplayTitle(meta, row, String(row[meta.row_key] ?? row[ROW_KEY]))

/** The rows one import run added that are still there. */
async function runRows(db: Db, table: string, runId: string): Promise<string[]> {
  const parts = await db`
    select touched from ${db(platformRelation(tableName('Import Log')))}
    where ref_table = ${table} and run_id = ${runId}
      and created_at >= (select created_at from table_def where name = ${table})`
  if (!parts.length) throw new AppError('NotFoundError', `No import run ${runId} on ${table}`)
  const ids = parts.flatMap((p) => (Array.isArray(p.touched) ? p.touched : []))
    .filter((t: { action?: string }) => t.action === 'inserted').map((t: { row_id: string }) => String(t.row_id))
  if (!ids.length) return []
  const meta = await getMeta(table)
  const present = await db`select ${db(meta.row_key)} as id from ${db(await tableRelation(table))} where ${db(meta.row_key)} = any(${ids})`
  return present.map((r) => String(r.id))
}

/** The ids a request names: `{ ids }` or `{ run_id }`. */
export async function purgeTargets(db: Db, table: string, args: Record<string, unknown>): Promise<string[]> {
  if (typeof args.run_id === 'string' && args.run_id) return runRows(db, table, args.run_id)
  let ids = args.ids
  if (typeof ids === 'string') {
    try { ids = JSON.parse(ids) } catch { throw new AppError('BadRequestError', 'ids must be a JSON list') }
  }
  if (!Array.isArray(ids) || !ids.length || !ids.every((i) => typeof i === 'string' && i))
    throw new AppError('ValidationError', 'Expected { ids: [row ids] } or { run_id }')
  return [...new Set(ids as string[])]
}

export function linkMode(raw: unknown): LinkMode {
  if (raw === undefined || raw === null || raw === '' || raw === 'cascade') return 'cascade'
  if (raw === 'clear') return 'clear'
  throw new AppError('ValidationError', "links must be 'cascade' or 'clear'")
}

interface PlannedLine { table: string; row_id: string; parent: string; parenttype: string }

/** Works out everything a permanent delete would remove or unlink. With
 *  `lock`, every row it reaches is locked as it is reached (inside the
 *  purge's transaction), so the graph cannot change under it. */
export async function planPurge(db: Db, table: string, ids: string[], links: LinkMode, user: string, lock = false): Promise<PurgePlan & { lines: PlannedLine[] }> {
  const rootMeta = await getMeta(table)
  const refused = purgeRefusal(rootMeta)
  if (refused) throw new AppError('ValidationError', refused)
  if (ids.length > MAX_PURGE_ROWS)
    throw new AppError('ValidationError', `This would delete more than ${MAX_PURGE_ROWS} rows; delete fewer at a time`)
  const forUpdate = lock ? db`for update` : db``
  const removed = new Map<string, Set<string>>() // table -> ids being removed (documents and lines)
  const rows: PurgeRow[] = []
  const lines: PlannedLine[] = []
  const groups: PurgeGroup[] = []
  const queue: { table: string; ids: string[] }[] = []
  const isRemoved = (t: string, id: string) => removed.get(t)?.has(id) ?? false
  const mark = (t: string, id: string) => {
    if (!removed.has(t)) removed.set(t, new Set())
    removed.get(t)!.add(id)
  }
  const checkSize = () => {
    if (rows.length + lines.length > MAX_PURGE_ROWS)
      throw new AppError('ValidationError', `This would delete more than ${MAX_PURGE_ROWS} rows; delete fewer at a time`)
  }
  // Mandatory privacy holds for a System Manager too: a row private to
  // someone else is never previewed, changed or removed.
  const visible = async (meta: TableMeta, row: Row) => {
    try { await assertMandatoryAccess(user, meta, row) } catch (err) {
      if (err instanceof AppError && err.type === 'PermissionError')
        throw new AppError('PermissionError', 'Some of the rows this reaches are private to someone else, so they cannot be deleted permanently')
      throw err
    }
  }
  const addLine = async (lineTable: string, line: Row) => {
    const id = String(line[ROW_KEY])
    if (isRemoved(lineTable, id)) return
    mark(lineTable, id)
    lines.push({ table: lineTable, row_id: id, parent: String(line.parent), parenttype: String(line.parenttype) })
    queue.push({ table: lineTable, ids: [id] })
    checkSize()
  }
  const addDoc = async (meta: TableMeta, row: Row) => {
    const id = String(row[meta.row_key])
    if (isRemoved(meta.name, id)) return false
    await visible(meta, row)
    mark(meta.name, id)
    rows.push({ table: meta.name, row_id: id, title: titleOf(meta, row) })
    checkSize()
    // Its own lines go with it, and something may point at a line too.
    for (const f of meta.columns) {
      if (f.column_type !== 'Sub-table') continue
      const owned = await db`select * from ${db(await tableRelation(f.row_table!))} where parent = ${id} and parenttype = ${meta.name} ${forUpdate}`
      for (const line of owned) await addLine(f.row_table!, line as Row)
    }
    return true
  }

  const roots = await db`select * from ${db(await tableRelation(table))} where ${db(rootMeta.row_key)} = any(${ids}) ${forUpdate}`
  const found = new Set(roots.map((r) => String(r[rootMeta.row_key])))
  const missing = ids.filter((id) => !found.has(id))
  if (missing.length) throw new AppError('NotFoundError', `${table} ${missing.slice(0, 5).join(', ')} not found`)
  for (const r of roots) await addDoc(rootMeta, r as Row)
  queue.unshift({ table, ids: [...found] })

  while (queue.length) {
    const step = queue.shift()!
    const refs = await db`
      select c.parent, c.column_name, c.reqd from column_def c
      where c.column_type = 'Reference' and c.reference_table = ${step.table} order by c.parent, c.column_name`
    for (const ref of refs) {
      const holder = String(ref.parent)
      const column = String(ref.column_name)
      const meta = await getMeta(holder).catch(() => null)
      const group = (g: Omit<PurgeGroup, 'table' | 'column'>) => groups.push({ table: holder, column, ...g })
      if (!meta) {
        group({ lines: false, count: 0, rows: [], action: 'blocked', why: `${holder} is not available, so its links cannot be checked` })
        continue
      }
      if (meta.kind === 'settings') {
        const held = await db`select 1 from single_value where table_name = ${holder} and field = ${column} and value = any(${step.ids}) limit 1`
        if (held.length) group({ lines: false, count: held.length, rows: [], action: 'blocked', why: `A setting of ${holder} points at it; change that setting first` })
        continue
      }
      if (isBound(meta)) {
        group({ lines: false, count: 0, rows: [], action: 'blocked', why: `${holder} lives on a connected database, so its links cannot be checked` })
        continue
      }
      const rel = await tableRelation(holder)
      const isLines = meta.kind === 'sub_table'
      const hits = (await db`select * from ${db(rel)} where ${db(column)} = any(${step.ids}) ${forUpdate}`) as Row[]
      // A row already being removed takes its link with it.
      const live = hits.filter((h) => !isRemoved(holder, String(h[meta.row_key]))
        && !(isLines && isRemoved(String(h.parenttype), String(h.parent))))
      if (!live.length) continue
      // A sub-table can serve several parent Tables: each parent decides for
      // its own lines, so a private parent's lines are never swept along.
      const buckets: [string | null, Row[]][] = []
      if (!isLines) buckets.push([null, live])
      else for (const h of live) {
        const at = buckets.find(([t]) => t === String(h.parenttype))
        if (at) at[1].push(h)
        else buckets.push([String(h.parenttype), [h]])
      }
      for (const [parentTable, bucket] of buckets) {
        const parentMeta = parentTable ? await getMeta(parentTable).catch(() => null) : null
        const canDelete = isLines ? Boolean(parentMeta) && purgeRefusal(parentMeta!) === null : purgeRefusal(meta) === null
        const canClear = !ref.reqd && !meta.system && !meta.system_written
          && !(isLines && (!parentMeta || parentMeta.system || parentMeta.system_written || parentMeta.access_policy))
        const action: PurgeGroup['action'] = links === 'cascade'
          ? (canDelete ? 'delete' : canClear ? 'clear' : 'blocked')
          : (canClear ? 'clear' : canDelete ? 'delete' : 'blocked')
        const named: PurgeGroup['rows'] = []
        for (const h of bucket) {
          // Every dependent, a blocked one too: a private row is never named.
          await visible(meta, h)
          if (named.length >= 50) continue
          if (isLines) {
            const [p] = parentMeta ? await db`select * from ${db(await tableRelation(parentMeta.name))} where ${db(parentMeta.row_key)} = ${String(h.parent)}` : []
            named.push({ table: holder, row_id: String(h[ROW_KEY]), title: parentMeta && p ? titleOf(parentMeta, p) : String(h.parent), parent: { table: String(h.parenttype), row_id: String(h.parent) } })
          } else named.push({ table: holder, row_id: String(h[meta.row_key]), title: titleOf(meta, h) })
        }
        group({
          lines: isLines, ...(parentTable ? { parent_table: parentTable } : {}), count: bucket.length, rows: named, action,
          ...(action === 'blocked' ? { why: ref.reqd ? `${holder}.${column} is required and ${parentTable ?? holder} rows cannot be deleted here` : `${parentTable ?? holder} rows cannot be changed here` } : {}),
        })
        if (action === 'delete') {
          const next: string[] = []
          for (const h of bucket) {
            if (isLines) await addLine(holder, h)
            else if (await addDoc(meta, h)) next.push(String(h[meta.row_key]))
          }
          if (next.length) queue.push({ table: holder, ids: next })
        }
      }
    }
  }
  const activity = { comments: 0, versions: 0, files: 0, shares: 0 }
  for (const [t, set] of removed) {
    const list = [...set]
    const [c] = await db`
      select (select count(*)::int from comment where ref_table = ${t} and ref_name = any(${list})) as comments,
             (select count(*)::int from version where ref_table = ${t} and ref_name = any(${list})) as versions,
             (select count(*)::int from file where ref_table = ${t} and ref_name = any(${list})) as files,
             (select count(*)::int from share where share_table = ${t} and share_name = any(${list})) as shares`
    for (const k of Object.keys(activity) as (keyof typeof activity)[]) activity[k] += Number(c[k])
  }
  return { links, rows, lines, groups, blocked: groups.some((g) => g.action === 'blocked'), activity }
}

export async function purgePreview(table: string, args: Record<string, unknown>, user: string): Promise<PurgePlan> {
  await assertSystemManager(user)
  const { lines: _lines, ...plan } = await planPurge(sql, table, await purgeTargets(sql, table, args), linkMode(args.links), user)
  return plan
}

const MAX_REASON = 1000

/** Removes every platform record naming a row: its comments, history, files,
 *  shares, tags and the rest (ROW_ID_HOLDERS), all but the Access Log. */
async function forgetRow(db: Db, table: string, rowId: string, files: string[], depth = 0) {
  // A comment or a file can itself carry comments and files; they go too.
  if (depth < 8)
    for (const [kind, relation] of [['Comment', 'comment'], ['File', 'file']] as const) {
      const nested = await db`select row_id from ${db(`${PLATFORM_SCHEMA}.${relation}`)} where ref_table = ${table} and ref_name = ${rowId}`
      for (const n of nested) await forgetRow(db, kind, String(n.row_id), files, depth + 1)
    }
  const attached = await db`select file_url from ${db(`${PLATFORM_SCHEMA}.file`)} where ref_table = ${table} and ref_name = ${rowId}`
  for (const f of attached) if (typeof f.file_url === 'string' && f.file_url) files.push(f.file_url)
  for (const { relation, tableColumn, nameColumn } of ROW_ID_HOLDERS) {
    if (relation === 'access_log') continue
    await db`delete from ${db(`${PLATFORM_SCHEMA}.${relation}`)} where ${db(tableColumn)} = ${table} and ${db(nameColumn)} = ${rowId}`
  }
}

/** Deletes permanently what planPurge finds, planned again inside the transaction with every row locked. */
export async function purgeRows(table: string, args: Record<string, unknown>, user: string): Promise<{ deleted: number; cleared: number }> {
  await assertSystemManager(user)
  const reason = typeof args.reason === 'string' ? args.reason.trim() : ''
  if (!reason) throw new AppError('ValidationError', 'A reason is required to delete permanently', { reason: 'Required' })
  if (reason.length > MAX_REASON) throw new AppError('ValidationError', `A reason is at most ${MAX_REASON} characters`, { reason: 'Too long' })
  if (args.confirm !== true) throw new AppError('ValidationError', 'Confirm the permanent delete', { confirm: 'Required' })
  const links = linkMode(args.links)
  const files: string[] = []
  const result = await afterCommitOf(() => sql.begin(async (tx) => {
    const db = tx as unknown as Db
    const ids = await purgeTargets(db, table, args)
    if (!ids.length) return { deleted: 0, cleared: 0 }
    const plan = await planPurge(db, table, ids, links, user, true)
    if (plan.blocked)
      throw new AppError('ValidationError', `Cannot delete permanently: ${plan.groups.filter((g) => g.action === 'blocked').map((g) => g.why).join('; ')}`)
    const run = randomUUID()
    const root = `${table} ${ids.length === 1 ? ids[0] : `${ids.length} rows`}`
    const removedIds = new Map<string, string[]>()
    for (const r of [...plan.rows, ...plan.lines]) removedIds.set(r.table, [...(removedIds.get(r.table) ?? []), r.row_id])
    let cleared = 0
    let deleted = 0

    // A surviving document changes only through the engine's own update
    // (AGENTS.md invariant 2), bound to this transaction: its validation,
    // hooks and scripts run and what they change is kept, its history and
    // revision move, and a refusal rolls the whole delete back. That covers
    // a cleared link, and a line removed from a document that stays.
    const owned = new Set(plan.rows.map((r) => `${r.table}/${r.row_id}`))
    const saveSurviving = async (docTable: string, docId: string, change: (doc: Row, docMeta: TableMeta) => Promise<Row>) => {
      const docMeta = await getMeta(docTable)
      const [doc] = await db`select * from ${db(await tableRelation(docTable))} where ${db(docMeta.row_key)} = ${docId} for update`
      if (!doc) return
      const values = await change(doc as Row, docMeta)
      await usingTransaction(db, () => saveDoc(docTable, { [ROW_KEY]: docId, updated_at: doc.updated_at, ...values }, user))
    }
    // A document's lines in the shape a save takes: every own column, by id.
    const linesOf = async (docMeta: TableMeta, docId: string, field: string) => {
      const col = docMeta.columns.find((c) => c.column_name === field)!
      const lineMeta = await getMeta(col.row_table!)
      const kept = await db`select * from ${db(await tableRelation(lineMeta.name))} where parent = ${docId} and parenttype = ${docMeta.name} and parentfield = ${field} order by position`
      // Stored values in the save API's own shape: a Date column is its day,
      // a Datetime its instant, as text (the driver hands back Date objects).
      const wire = (type: string, v: unknown) => v instanceof Date ? (type === 'Date' ? v.toISOString().slice(0, 10) : v.toISOString()) : v
      return kept.map((l) => Object.fromEntries([[ROW_KEY, l[ROW_KEY]], ...lineMeta.columns.filter((c) => !['Sub-table', 'Section Break', 'Column Break'].includes(c.column_type)).map((c) => [c.column_name, wire(c.column_type, l[c.column_name])])]))
    }

    for (const g of plan.groups.filter((x) => x.action === 'clear')) {
      const meta = await getMeta(g.table)
      const [col] = await db`select reference_table from column_def where parent = ${g.table} and column_name = ${g.column}`
      const pointedAt = removedIds.get(String(col.reference_table)) ?? []
      const all = (await db`select * from ${db(await tableRelation(g.table))} where ${db(g.column)} = any(${pointedAt})`) as Row[]
      // A row being deleted itself (or a line of one) keeps its link to the
      // end, so its deletion record holds the row as it was.
      const holders = all.filter((h) => g.lines
        ? (!g.parent_table || String(h.parenttype) === g.parent_table) && !owned.has(`${h.parenttype}/${h.parent}`) && !removedIds.get(g.table)?.includes(String(h[ROW_KEY]))
        : !owned.has(`${g.table}/${h[meta.row_key]}`))
      for (const h of holders) {
        if (g.lines) {
          await saveSurviving(String(h.parenttype), String(h.parent), async (_doc, docMeta) => ({
            [String(h.parentfield)]: (await linesOf(docMeta, String(h.parent), String(h.parentfield)))
              .map((l) => (l[ROW_KEY] === h[ROW_KEY] ? { ...l, [g.column]: null } : l)),
          }))
        } else await saveSurviving(g.table, String(h[meta.row_key]), async () => ({ [g.column]: null }))
        cleared++
      }
    }

    // Lines removed as dependents of their own: their document stays and
    // loses them through its own update.
    const byDoc = new Map<string, PlannedLine[]>()
    for (const line of plan.lines) {
      if (owned.has(`${line.parenttype}/${line.parent}`)) continue
      const key = `${line.parenttype}\u0000${line.parent}`
      byDoc.set(key, [...(byDoc.get(key) ?? []), line])
    }
    for (const group of byDoc.values()) {
      const { parenttype, parent } = group[0]
      const gone = new Set(group.map((l) => l.row_id))
      const snapshots = new Map<string, Row>()
      for (const line of group) {
        const [row] = await db`select * from ${db(await tableRelation(line.table))} where ${db(ROW_KEY)} = ${line.row_id}`
        if (row) snapshots.set(line.row_id, row as Row)
      }
      await saveSurviving(parenttype, parent, async (_doc, docMeta) => {
        const values: Row = {}
        const fields = new Set([...snapshots.values()].map((l) => String(l.parentfield)))
        for (const field of fields)
          values[field] = (await linesOf(docMeta, parent, field)).filter((l) => !gone.has(String(l[ROW_KEY])))
        return values
      })
      for (const line of group) {
        const snapshot = snapshots.get(line.row_id)
        if (!snapshot) continue
        await forgetRow(db, line.table, line.row_id, files)
        await record(db, user, line.table, line.row_id, reason, snapshot, run, root)
        deleted++
      }
    }

    // Dependents before the rows they point at; the asked-for rows last.
    for (const r of [...plan.rows].reverse()) {
      const meta = await getMeta(r.table)
      const rel = await tableRelation(r.table)
      const [row] = await db`select * from ${db(rel)} where ${db(meta.row_key)} = ${r.row_id} for update`
      if (!row) continue
      await assertRowNotManaged(db, meta, r.row_id, user)
      await runHooks('on_trash', { row: row as Row, meta, user, isNew: false, tx: db })
      const ownLines: Record<string, Row[]> = {}
      for (const f of meta.columns) {
        if (f.column_type !== 'Sub-table') continue
        const childRel = await tableRelation(f.row_table!)
        ownLines[f.column_name] = (await db`delete from ${db(childRel)} where parent = ${r.row_id} and parenttype = ${r.table} returning *`) as Row[]
        for (const line of ownLines[f.column_name]) await forgetRow(db, f.row_table!, String(line[ROW_KEY]), files)
      }
      await forgetRow(db, r.table, r.row_id, files)
      await db`delete from ${db(rel)} where ${db(meta.row_key)} = ${r.row_id}`
      await record(db, user, r.table, r.row_id, reason, { ...(row as Row), ...ownLines }, run, root)
      deleted++
    }

    // Nothing may still point at a removed row: a reference written while
    // this ran refuses the whole delete rather than dangle.
    for (const [t, list] of removedIds) {
      const refs = await db`select parent, column_name from column_def where column_type = 'Reference' and reference_table = ${t}`
      for (const ref of refs) {
        const holder = await getMeta(String(ref.parent)).catch(() => null)
        if (!holder || holder.kind === 'settings' || isBound(holder)) continue
        const [left] = await db`select 1 from ${db(await tableRelation(holder.name))} where ${db(String(ref.column_name))} = any(${list}) limit 1`
        if (left) throw new AppError('ConflictError', `${holder.name} gained a link to a row being deleted; try again`)
      }
    }
    return { deleted, cleared }
  }))
  // Stored bytes go only after the commit, and only when no File row still
  // names them (as a Table's delete does, DEL-R7).
  await afterDocumentCommit(async () => {
    for (const url of new Set(files)) {
      if (!/^\/(?:private\/)?files\/[a-f0-9]{16}_[\w.-]+$/.test(url)) continue
      try {
        const survivors = await sql`select 1 from file where file_url = ${url} limit 1`
        if (!survivors.length) await deleteStored(url)
      } catch { console.warn('Permanent delete: attachment cleanup could not complete') }
    }
  })
  return result
}

async function record(db: Db, user: string, table: string, rowId: string, reason: string, snapshot: Row, run: string, root: string) {
  await db`insert into access_log ${db({
    [ROW_KEY]: randomUUID(), created_by: user, updated_by: user, status: 'draft', position: 0,
    user, operation: 'purge', ref_table: table, reference_name: rowId, method: 'delete permanently',
    scope: `${root} (${run})`, reason, snapshot: JSON.parse(JSON.stringify(snapshot)) as unknown as string,
  })}`
}

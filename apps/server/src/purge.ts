// #859 (design decisions 9-14): a System Manager deletes rows permanently,
// with their own history, comments, attachments and shares. Rows that still
// point at them are found from metadata and either deleted too ("cascade")
// or have their link cleared ("clear"); a dependent that allows neither
// holds the whole delete. Every removed row leaves an Access Log entry with
// the reason and a snapshot. All of it runs in one transaction.
import { randomUUID } from 'node:crypto'
import { canRetire, rowDisplayTitle } from 'shared'
import { sql } from './db'
import { AppError } from './errors'
import { ROW_KEY, getMeta, type TableMeta } from './meta'
import { assertSystemManager, isPrivileged } from './permissions'
import { tableRelation, tableName } from './table-engine'
import { PLATFORM_SCHEMA, platformRelation } from './platform-schema'
import { ROW_ID_HOLDERS } from './document-activity'
import { runHooks } from './controllers'
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
  if (!canRetire(meta) || meta.system || isBound(meta))
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

/** Works out everything a permanent delete would remove or unlink. Reads only. */
export async function planPurge(db: Db, table: string, ids: string[], links: LinkMode): Promise<PurgePlan> {
  const rootMeta = await getMeta(table)
  const refused = purgeRefusal(rootMeta)
  if (refused) throw new AppError('ValidationError', refused)
  const removed = new Map<string, Set<string>>() // table -> ids being removed
  const rows: PurgeRow[] = []
  const groups: PurgeGroup[] = []
  const add = (t: string, id: string) => {
    if (!removed.has(t)) removed.set(t, new Set())
    removed.get(t)!.add(id)
  }
  const roots = await db`select * from ${db(await tableRelation(table))} where ${db(rootMeta.row_key)} = any(${ids})`
  const found = new Set(roots.map((r) => String(r[rootMeta.row_key])))
  const missing = ids.filter((id) => !found.has(id))
  if (missing.length) throw new AppError('NotFoundError', `${table} ${missing.slice(0, 5).join(', ')} not found`)
  for (const r of roots) { add(table, String(r[rootMeta.row_key])); rows.push({ table, row_id: String(r[rootMeta.row_key]), title: titleOf(rootMeta, r) }) }

  const queue: { table: string; ids: string[] }[] = [{ table, ids: [...found] }]
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
      const lines = meta.kind === 'sub_table'
      const hits = lines
        ? await db`select ${db(meta.row_key)} as id, parent, parenttype from ${db(rel)} where ${db(column)} = any(${step.ids})`
        : await db`select * from ${db(rel)} where ${db(column)} = any(${step.ids})`
      // A row already being removed takes its link with it.
      const live = hits.filter((h) => lines
        ? !removed.get(String(h.parenttype))?.has(String(h.parent))
        : !removed.get(holder)?.has(String(h[meta.row_key])))
      if (!live.length) continue
      const parentMeta = lines ? await getMeta(String(live[0].parenttype)).catch(() => null) : null
      const canDelete = lines ? Boolean(parentMeta) && purgeRefusal(parentMeta!) === null : purgeRefusal(meta) === null
      const canClear = !ref.reqd && !meta.system && !meta.system_written
      const action: PurgeGroup['action'] = links === 'cascade'
        ? (canDelete ? 'delete' : canClear ? 'clear' : 'blocked')
        : (canClear ? 'clear' : canDelete ? 'delete' : 'blocked')
      const named: PurgeGroup['rows'] = []
      for (const h of live.slice(0, 50)) {
        if (lines) {
          const pm = await getMeta(String(h.parenttype)).catch(() => null)
          const [p] = pm ? await db`select * from ${db(await tableRelation(pm.name))} where ${db(pm.row_key)} = ${String(h.parent)}` : []
          named.push({ table: holder, row_id: String(h.id), title: pm && p ? titleOf(pm, p) : String(h.parent), parent: { table: String(h.parenttype), row_id: String(h.parent) } })
        } else named.push({ table: holder, row_id: String(h[meta.row_key]), title: titleOf(meta, h) })
      }
      group({
        lines, count: live.length, rows: named, action,
        ...(action === 'blocked' ? { why: ref.reqd ? `${holder}.${column} is required and ${holder} rows cannot be deleted here` : `${holder} rows cannot be changed here` } : {}),
      })
      if (action === 'delete' && !lines) {
        const next: string[] = []
        for (const h of live) {
          const id = String(h[meta.row_key])
          add(holder, id)
          rows.push({ table: holder, row_id: id, title: titleOf(meta, h) })
          next.push(id)
        }
        queue.push({ table: holder, ids: next })
      }
      if (rows.length > MAX_PURGE_ROWS)
        throw new AppError('ValidationError', `This would delete more than ${MAX_PURGE_ROWS} rows; delete fewer at a time`)
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
  return { links, rows, groups, blocked: groups.some((g) => g.action === 'blocked'), activity }
}

export async function purgePreview(table: string, args: Record<string, unknown>, user: string): Promise<PurgePlan> {
  await assertSystemManager(user)
  return planPurge(sql, table, await purgeTargets(sql, table, args), linkMode(args.links))
}

const MAX_REASON = 1000

/** Deletes permanently what planPurge finds, re-planned inside the transaction. */
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
    // Lock what is asked for first, so the plan below holds when it runs.
    const rootMeta = await getMeta(table)
    await db`select 1 from ${db(await tableRelation(table))} where ${db(rootMeta.row_key)} = any(${ids}) for update`
    const plan = await planPurge(db, table, ids, links)
    if (plan.blocked)
      throw new AppError('ValidationError', `Cannot delete permanently: ${plan.groups.filter((g) => g.action === 'blocked').map((g) => g.why).join('; ')}`)
    const run = randomUUID()
    const root = `${table} ${ids.length === 1 ? ids[0] : `${ids.length} rows`}`
    let cleared = 0
    let deleted = 0

    for (const g of plan.groups) {
      if (g.action === 'blocked') continue
      const meta = await getMeta(g.table)
      // Every link this group holds to any removed row of the Table it points at.
      const [col] = await db`select reference_table from column_def where parent = ${g.table} and column_name = ${g.column}`
      const pointedAt = plan.rows.filter((r) => r.table === String(col.reference_table)).map((r) => r.row_id)
      if (g.action === 'clear') {
        const rel = await tableRelation(g.table)
        const before = await db`
          select ${db(meta.row_key)} as id, ${db(g.column)} as was, ${g.lines ? db`parent, parenttype` : db`null as parent, null as parenttype`}
          from ${db(rel)} where ${db(g.column)} = any(${pointedAt}) for update`
        await db`
          update ${db(rel)} set ${db(g.column)} = null, updated_at = clock_timestamp(), updated_by = ${user}
          where ${db(g.column)} = any(${pointedAt})`
        cleared += before.length
        for (const c of before) {
          // The cleared link is history on the row that held it (a line's, on its document).
          const [refTable, refName] = g.lines ? [String(c.parenttype), String(c.parent)] : [g.table, String(c.id)]
          await db`insert into version ${db({
            [ROW_KEY]: randomUUID(), created_by: user, updated_by: user, status: 'draft', position: 0,
            ref_table: refTable, ref_name: refName,
            data: { changed: g.lines ? [] : [[g.column, c.was, null]], link_cleared: { column: g.column, was: c.was, reason } } as unknown as string,
          })}`
        }
      } else if (g.lines) {
        const rel = await tableRelation(g.table)
        const gone = await db`delete from ${db(rel)} where ${db(g.column)} = any(${pointedAt}) returning *`
        for (const line of gone) {
          await record(db, user, g.table, String(line[meta.row_key]), reason, { ...line }, run, root)
          deleted++
        }
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
      const lines: Record<string, Row[]> = {}
      for (const f of meta.columns) {
        if (f.column_type !== 'Sub-table') continue
        const childRel = await tableRelation(f.row_table!)
        lines[f.column_name] = (await db`select * from ${db(childRel)} where parent = ${r.row_id} and parenttype = ${r.table} order by position`) as Row[]
        await db`delete from ${db(childRel)} where parent = ${r.row_id} and parenttype = ${r.table}`
      }
      const attached = await db`select file_url from file where ref_table = ${r.table} and ref_name = ${r.row_id}`
      for (const f of attached) if (typeof f.file_url === 'string' && f.file_url) files.push(f.file_url)
      for (const { relation, tableColumn, nameColumn } of ROW_ID_HOLDERS) {
        if (relation === 'access_log') continue
        await db`delete from ${db(`${PLATFORM_SCHEMA}.${relation}`)} where ${db(tableColumn)} = ${r.table} and ${db(nameColumn)} = ${r.row_id}`
      }
      await db`delete from ${db(rel)} where ${db(meta.row_key)} = ${r.row_id}`
      await record(db, user, r.table, r.row_id, reason, { ...(row as Row), ...lines }, run, root)
      deleted++
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

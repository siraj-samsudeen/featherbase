// #206/#207 (issue #197): a file-import, seen and undone as one thing.
//
// "Since here by mistake it created these 11 tables, I did not have an easy
// way to see these tables came from where and delete them all in one."
//
// The Import Log has always held the facts — a row per part per target — but
// reading eleven Tables' provenance out of it meant eyeballing timestamps.
// #206 gave every part of one file-import a shared `batch_id`; this rolls
// those rows back up into the thing the user actually did.
import { AppError } from './errors'
import { sql } from './db'
import { deleteTable, tableName } from './table-engine'
import { assertSystemManager } from './permissions'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

export interface BatchTarget {
  table: string
  /** This import CREATED the Table, rather than adding rows to an existing one. */
  created: boolean
  inserted: number
  updated: number
  failed: number
  /** The run identity a revert addresses — one per target, shared by its parts. */
  run_id: string | null
  reverted_at: string | null
  sheets: string[]
  /** Whether the Table is still there. A deleted one is history, not a target. */
  exists: boolean
}

export interface ImportBatch {
  batch_id: string
  file_name: string | null
  started_at: string
  user: string | null
  targets: BatchTarget[]
  inserted: number
  updated: number
  failed: number
  /** Tables this import brought into existence — what #207 offers to remove. */
  created: number
}

const count = (v: unknown): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

interface LogRow {
  batch_id: string
  ref_table: string
  file_name: string | null
  sheet_name: string | null
  table_created: boolean | null
  inserted: number | string | null
  updated: number | string | null
  failed: number | string | null
  run_id: string | null
  reverted_at: Date | null
  created_at: Date
  created_by: string | null
}

/**
 * The most recent file-imports, newest first.
 *
 * Batches are picked first and their parts fetched second, rather than
 * `limit`-ing the log itself: one import is an unbounded number of log rows
 * (a target per sheet, a part per chunk), so a row limit would cut a batch in
 * half and report it as smaller than it was.
 */
export async function listBatches(limit = DEFAULT_LIMIT, only?: string): Promise<ImportBatch[]> {
  const capped = Math.min(Math.max(1, Math.trunc(limit) || DEFAULT_LIMIT), MAX_LIMIT)
  const log = tableName('Import Log')

  // `only` addresses one batch however old it is — a batch named in a URL
  // must not depend on still being on the first page of recent ones.
  const picked = only
    ? await sql.unsafe<{ batch_id: string; started_at: Date }[]>(
        `select batch_id, min(created_at) as started_at
           from "${log}" where batch_id = $1 group by batch_id`,
        [only],
      )
    : await sql.unsafe<{ batch_id: string; started_at: Date }[]>(
        `select batch_id, min(created_at) as started_at
           from "${log}"
          where batch_id is not null
          group by batch_id
          order by min(created_at) desc
          limit $1`,
        [capped],
      )
  if (!picked.length) return []

  const ids = picked.map((b) => b.batch_id)
  const rows = await sql.unsafe<LogRow[]>(
    `select batch_id, ref_table, file_name, sheet_name, table_created, inserted, updated,
            failed, run_id, reverted_at, created_at, created_by
       from "${log}"
      where batch_id = any($1)
      order by created_at asc`,
    [ids],
  )

  // Which of the named Tables still exist — asked once for the whole page
  // rather than per target.
  const named = [...new Set(rows.map((r) => r.ref_table))]
  const alive = new Set(
    (
      await sql<{ name: string }[]>`select name from table_def where name = any(${named})`
    ).map((t) => t.name),
  )

  const byBatch = new Map<string, LogRow[]>()
  for (const row of rows) {
    const list = byBatch.get(row.batch_id)
    if (list) list.push(row)
    else byBatch.set(row.batch_id, [row])
  }

  return picked.map(({ batch_id, started_at }) => {
    const parts = byBatch.get(batch_id) ?? []
    const targets = new Map<string, BatchTarget>()
    for (const part of parts) {
      let target = targets.get(part.ref_table)
      if (!target) {
        target = {
          table: part.ref_table,
          created: false,
          inserted: 0,
          updated: 0,
          failed: 0,
          run_id: null,
          reverted_at: null,
          sheets: [],
          exists: alive.has(part.ref_table),
        }
        targets.set(part.ref_table, target)
      }
      // `table_created` is stamped on the FIRST part of the first sheet only,
      // so it is an OR across the target rather than a per-part fact.
      target.created ||= part.table_created === true
      // Int columns are bigint in Postgres and come back as strings; `+=`
      // on those concatenates ("0" + "1" + "2" = "012") rather than adding.
      target.inserted += count(part.inserted)
      target.updated += count(part.updated)
      target.failed += count(part.failed)
      target.run_id ??= part.run_id
      if (part.reverted_at) target.reverted_at = part.reverted_at.toISOString()
      if (part.sheet_name && !target.sheets.includes(part.sheet_name))
        target.sheets.push(part.sheet_name)
    }
    const list = [...targets.values()]
    return {
      batch_id,
      file_name: parts.find((p) => p.file_name)?.file_name ?? null,
      started_at: started_at.toISOString(),
      user: parts[0]?.created_by ?? null,
      targets: list,
      inserted: list.reduce((n, t) => n + t.inserted, 0),
      updated: list.reduce((n, t) => n + t.updated, 0),
      failed: list.reduce((n, t) => n + t.failed, 0),
      created: list.filter((t) => t.created && t.exists).length,
    }
  })
}

export async function getBatch(batchId: string): Promise<ImportBatch> {
  const [batch] = await listBatches(1, batchId)
  if (!batch) throw new AppError('NotFoundError', `No import batch ${batchId}`)
  return batch
}

export interface BatchDeletion {
  deleted: string[]
  /** Named with the reason, never silently dropped from the count. */
  refused: { table: string; message: string }[]
}

/**
 * #207: delete every Table this import CREATED.
 *
 * Deliberately only the created ones. A Table that existed before the import
 * had rows added to it, and deleting it would destroy data the import never
 * made — taking those rows back is what the per-run revert is for, and it is
 * offered separately and per target.
 *
 * Each Table goes through the ordinary deleteTable path, so a Table another
 * Table now points at refuses in the usual way. A refusal is reported, not
 * fatal: ten Tables that can go should still go.
 */
export async function deleteBatchTables(batchId: string, user: string): Promise<BatchDeletion> {
  await assertSystemManager(user)
  const batch = await getBatch(batchId)
  const deleted: string[] = []
  const refused: { table: string; message: string }[] = []
  for (const target of batch.targets) {
    if (!target.created || !target.exists) continue
    try {
      await deleteTable(target.table, user)
      deleted.push(target.table)
    } catch (err) {
      refused.push({
        table: target.table,
        message: err instanceof Error ? err.message : 'Could not delete',
      })
    }
  }
  return { deleted, refused }
}

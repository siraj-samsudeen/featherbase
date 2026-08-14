import { createHash } from 'node:crypto'
import { AppError } from '../errors'
import { checkRowForInsert, saveDoc, validateRowForUpdate } from '../document'
import { ROW_KEY, getMeta, type TableMeta } from '../meta'
import { assertDocPermission, assertPermission, permissionScope } from '../permissions'
import { registerCollectionAction } from '../actions'
import { sql } from '../db'
import { tableName } from '../doctype-engine'

// IMP-005: bulk import — POST /api/table/:table:import { rows: [...] }.
// The first real collection-action registrant (#61 left the registry empty on
// purpose). Every row goes through saveDoc's full lifecycle — permissions,
// validation, id patterns, automation triggers. Best-effort: bad rows are
// reported by index, good rows still land.
//
// UPS-R1 (spec 0004): an optional `key_column` turns the run into an upsert.
// Each row resolves via UPS-R2 to update / insert / fail; updates go through
// saveDoc's update lifecycle (hooks, validation, versioning — never raw SQL);
// the response and the Import Log carry updated / inserted / failed as
// separate counts. Absent `key_column`, insert-only semantics byte-for-byte.
const MAX_ROWS = 10_000
// ADR 0008: failures kept in the Import Log's error summary (Q3 owns 'more').
const LOG_ERROR_SAMPLE = 20

interface FailedRow {
  index: number
  message: string
  fields?: Record<string, string>
}

type RowAction = 'update' | 'insert' | 'fail'

interface Resolution {
  action: RowAction
  // update: the matched row, loaded once so the saveDoc update can carry the
  // optimistic-concurrency stamp and the permission preflight the creator.
  row_id?: string
  updated_at?: Date
  created_by?: string
  // fail: why, phrased for the per-row report.
  message?: string
}

interface UpsertArgs {
  keyColumn: string
  emptyCells: 'keep' | 'clear'
  // The run's mapped columns — the universe UPS-R3's 'clear' applies to.
  // Empty cells arrive as ABSENT keys (IMP-R8), so clearing needs to know
  // which absences were mapped-but-empty rather than simply unmapped.
  columns: string[] | null
}

// UPS-R2 — match resolution. Keys resolve against the DATABASE, never the
// request (a chunked run must match rows landed by earlier chunks); a key
// duplicated WITHIN the request fails all its rows (last-wins would hide an
// authorship conflict inside one file); a key matching several database rows
// fails with the count (a one-line mass update is UPS-H1 in miniature).
//
// Performance (spec 0004 closure sweep): the lookup casts the key column to
// text for one `= any(...)` scan per request — a seq scan on an unindexed
// key column. That is the stated answer for now: one scan per 500-row chunk,
// not per row; an index-on-demand lands when a real dataset hurts.
async function resolveRows(
  meta: TableMeta,
  rows: unknown[],
  keyColumn: string,
): Promise<Resolution[]> {
  const keyOf = (row: unknown): string => {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return ''
    const v = (row as Record<string, unknown>)[keyColumn]
    return v == null ? '' : String(v).trim()
  }
  const counts = new Map<string, number>()
  for (const row of rows) {
    const k = keyOf(row)
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const wanted = [...counts.keys()]
  const matches = new Map<string, { row_id: string; updated_at: Date; created_by: string }[]>()
  if (wanted.length) {
    const tbl = tableName(meta.name)
    const key = sql(meta.row_key)
    const found =
      keyColumn === ROW_KEY
        ? await sql`
            select ${key} as row_id, ${key} as k, updated_at, created_by
            from ${sql(tbl)} where ${key} = any(${wanted})`
        : await sql`
            select ${key} as row_id, ${sql(keyColumn)}::text as k, updated_at, created_by
            from ${sql(tbl)} where ${sql(keyColumn)}::text = any(${wanted})`
    for (const r of found) {
      const k = String(r.k)
      if (!matches.has(k)) matches.set(k, [])
      matches.get(k)!.push({
        row_id: String(r.row_id),
        updated_at: r.updated_at as Date,
        created_by: String(r.created_by),
      })
    }
  }
  return rows.map((row) => {
    if (typeof row !== 'object' || row === null || Array.isArray(row))
      return { action: 'fail', message: 'row must be an object' } satisfies Resolution
    const k = keyOf(row)
    if (!k)
      return {
        action: 'fail',
        message: `row has no value in the match key column ${keyColumn}`,
      } satisfies Resolution
    if ((counts.get(k) ?? 0) > 1)
      return {
        action: 'fail',
        message: `key ${k} appears more than once in the import`,
      } satisfies Resolution
    const hit = matches.get(k) ?? []
    if (hit.length > 1)
      return {
        action: 'fail',
        message: `key ${k} matches ${hit.length} existing rows`,
      } satisfies Resolution
    if (hit.length === 1)
      return {
        action: 'update',
        row_id: hit[0].row_id,
        updated_at: hit[0].updated_at,
        created_by: hit[0].created_by,
      } satisfies Resolution
    return { action: 'insert' } satisfies Resolution
  })
}

// UPS-R1 — the whole-request permission gate, extended from IMP-R10's: a
// run mixing inserts and updates checks both; own-rows scoping applies per
// matched row; any refusal refuses the request whole, before any write.
async function assertRunPermitted(
  user: string,
  table: string,
  resolutions: Resolution[],
): Promise<void> {
  if (resolutions.some((r) => r.action === 'insert'))
    await assertPermission(user, table, 'create')
  const updates = resolutions.filter((r) => r.action === 'update')
  if (updates.length) {
    // One scope read, then the per-row own-rows judgement against each
    // matched row's creator (assertDocPermission semantics, batched).
    const scope = await permissionScope(user, table, 'write')
    if (scope === 'all') return
    for (const u of updates) await assertDocPermission(user, table, 'write', u.created_by!)
  }
}

// #145: resolveRows compares `${key}::text = any(...)`, so only an
// EXPRESSION index on exactly that cast serves the query — a plain column
// index would not. Once per process per (table, key); IF NOT EXISTS
// carries restarts. The hash suffix keeps long table/column names inside
// Postgres's 63-char identifier limit without truncation collisions.
const ensuredKeyIndexes = new Set<string>()

async function ensureKeyIndex(table: string, keyColumn: string): Promise<void> {
  if (keyColumn === ROW_KEY) return // the primary key already serves it
  const cacheKey = `${table}:${keyColumn}`
  if (ensuredKeyIndexes.has(cacheKey)) return
  const tbl = tableName(table)
  const suffix = createHash('sha256').update(cacheKey).digest('hex').slice(0, 8)
  const idx = `${tbl}_${keyColumn}`.slice(0, 46) + `_${suffix}_ukidx`
  await sql.unsafe(`create index if not exists "${idx}" on "${tbl}" ((("${keyColumn}")::text))`)
  ensuredKeyIndexes.add(cacheKey)
}

function parseUpsertArgs(meta: TableMeta, args: Record<string, unknown>): UpsertArgs | null {
  const key = args.key_column
  if (key == null || key === '') {
    if (args.empty_cells != null)
      throw new AppError('ValidationError', 'empty_cells requires key_column')
    return null
  }
  if (typeof key !== 'string')
    throw new AppError('ValidationError', 'key_column must be a column name')
  if (key !== ROW_KEY && !meta.columns.some((c) => c.column_name === key))
    throw new AppError('ValidationError', `${meta.name} has no column ${key} to match on`)
  const emptyCells = args.empty_cells ?? 'keep'
  if (emptyCells !== 'keep' && emptyCells !== 'clear')
    throw new AppError('ValidationError', "empty_cells must be 'keep' or 'clear'")
  let columns: string[] | null = null
  if (args.columns != null) {
    if (!Array.isArray(args.columns) || args.columns.some((c) => typeof c !== 'string'))
      throw new AppError('ValidationError', 'columns must be an array of column names')
    for (const c of args.columns as string[])
      if (c !== ROW_KEY && !meta.columns.some((mc) => mc.column_name === c))
        throw new AppError('ValidationError', `${meta.name} has no column ${c}`)
    columns = args.columns as string[]
  }
  if (emptyCells === 'clear' && !columns)
    throw new AppError(
      'ValidationError',
      "empty_cells: 'clear' requires columns (the mapped columns the clearing applies to)",
    )
  return { keyColumn: key, emptyCells, columns }
}

// UPS-R3 — what an update touches: only mapped columns change. With the
// per-run choice 'clear', a mapped column ABSENT from the row is the file
// saying "this cell is empty" — send an explicit null so the update clears
// it. With 'keep' (the default) absence stays absence: the stored value
// survives. Row identity never changes: the update is addressed to the
// matched name, and a mapped id differing from it fails the row instead of
// renaming anything.
function updateValues(
  row: Record<string, unknown>,
  upsert: UpsertArgs,
  matched: Resolution,
): Record<string, unknown> {
  const values: Record<string, unknown> = { ...row }
  if (upsert.emptyCells === 'clear')
    for (const col of upsert.columns!)
      if (col !== ROW_KEY && col !== upsert.keyColumn && !(col in values)) values[col] = null
  values[ROW_KEY] = matched.row_id
  // The optimistic-concurrency stamp updateDoc demands; saveDoc normalizes it.
  values.updated_at = matched.updated_at
  return values
}

registerCollectionAction('import', {
  effect: 'write',
  description:
    'Bulk-insert rows ({ rows: [...] }); returns { inserted, failed }. ' +
    'With key_column, upserts: rows matching an existing value update it ' +
    "({ updated, inserted, failed }); empty_cells 'keep'|'clear' picks what " +
    'an empty mapped cell does to a matched row. ' +
    'With dry_run: true, reports per-row actions and writes nothing.',
  handler: async ({ table, args, user }) => {
    const rows = args.rows
    if (!Array.isArray(rows) || rows.length === 0)
      throw new AppError('ValidationError', 'Expected { rows: [...] } with at least one row')
    if (rows.length > MAX_ROWS)
      throw new AppError('ValidationError', `Import is capped at ${MAX_ROWS} rows per request`)

    const meta = await getMeta(table)
    if (meta.kind !== 'table')
      throw new AppError('ValidationError', `Cannot import into a ${meta.kind} Table`)
    // EDS: bulk import is not supported on source-bound Tables yet. The dry
    // run already refused (checkRowForInsert); the real import must agree
    // rather than fan 10k row-by-row writes at a foreign store.
    if (meta.data_source)
      throw new AppError(
        'ValidationError',
        `${table} is bound to data source ${meta.data_source}; bulk import is not supported on bound Tables yet`,
      )

    const upsert = parseUpsertArgs(meta, args)
    // #145 (ruled 2026-08-11): the match key gets its index the first time a
    // REAL keyed run uses it — before resolution, so even this request's
    // lookup is served. Rehearsals create nothing (IMP-I3's spirit covers
    // the catalog too).
    if (upsert && !args.dry_run) await ensureKeyIndex(table, upsert.keyColumn)
    const resolutions = upsert ? await resolveRows(meta, rows, upsert.keyColumn) : null
    if (resolutions) await assertRunPermitted(user.row_id, table, resolutions)

    // IMP-007: dry run — same gates, schema-level validation of every row
    // (types, reqd, choices, name rules, existing-name conflicts), zero
    // writes. Automation triggers don't run, so a trigger can still reject
    // individual rows at real import time. With key_column the report is
    // action-aware (UPS-R1): per-row update / insert / fail, still no writes.
    if (args.dry_run) {
      if (!resolutions) await assertPermission(user.row_id, table, 'create')
      const failed: FailedRow[] = []
      const actions: RowAction[] = []
      const seenNames = new Set<string>()
      for (const [index, row] of rows.entries()) {
        if (typeof row !== 'object' || row === null || Array.isArray(row)) {
          failed.push({ index, message: 'row must be an object' })
          actions.push('fail')
          continue
        }
        const resolution = resolutions?.[index]
        if (resolution && resolution.action === 'fail') {
          failed.push({ index, message: resolution.message! })
          actions.push('fail')
          continue
        }
        try {
          if (resolution?.action === 'update') {
            // The matched name is the row's identity for this run; validate
            // the mapped values as the update they will become. The insert
            // checks (name conflicts, reqd columns) do not apply.
            checkRowForUpdate(meta, row as Record<string, unknown>, resolution, upsert!)
            actions.push('update')
            continue
          }
          const name = String((row as Record<string, unknown>)[ROW_KEY] ?? '').trim()
          if (name && seenNames.has(name))
            throw new AppError('ConflictError', `Duplicate name ${name} within the import`)
          await checkRowForInsert(meta, row as Record<string, unknown>)
          if (name) seenNames.add(name)
          actions.push('insert')
        } catch (err) {
          failed.push({
            index,
            message: err instanceof Error ? err.message : String(err),
            ...(err instanceof AppError && err.fields ? { fields: err.fields } : {}),
          })
          actions.push('fail')
        }
      }
      if (!resolutions) return { dry_run: true, valid: rows.length - failed.length, failed }
      return {
        dry_run: true,
        valid: rows.length - failed.length,
        updated: actions.filter((a) => a === 'update').length,
        inserted: actions.filter((a) => a === 'insert').length,
        failed,
        actions,
      }
    }

    let inserted = 0
    let updated = 0
    const failed: FailedRow[] = []
    // RVT-R1 (spec 0005): record every row this part writes — id, action,
    // and the updated_at stamp the write left — so the run is revertable.
    const touched: TouchedRow[] = []
    const runStart = new Date()
    for (const [index, row] of rows.entries()) {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        failed.push({ index, message: 'row must be an object' })
        continue
      }
      const resolution = resolutions?.[index]
      if (resolution && resolution.action === 'fail') {
        failed.push({ index, message: resolution.message! })
        continue
      }
      try {
        if (resolution?.action === 'update') {
          const record = row as Record<string, unknown>
          if (
            upsert!.keyColumn !== ROW_KEY &&
            record[ROW_KEY] != null &&
            String(record[ROW_KEY]).trim() !== '' &&
            String(record[ROW_KEY]).trim() !== resolution.row_id
          )
            // UPS-R3: changing an id via upsert does not exist — refusing is
            // louder than silently dropping the file's id cell.
            throw new AppError(
              'ValidationError',
              `row maps Row ID ${String(record[ROW_KEY]).trim()} but matches ${resolution.row_id}; an upsert cannot change a row's id`,
            )
          const saved = await saveDoc(table, updateValues(record, upsert!, resolution), user.row_id, 'upsert')
          updated++
          touched.push(await touchedUpdate(table, saved, runStart))
        } else {
          const saved = await saveDoc(table, row as Record<string, unknown>, user.row_id, 'insert')
          inserted++
          touched.push({
            row_id: String(saved[ROW_KEY]),
            action: 'inserted',
            stamp: stampOf(saved.updated_at),
          })
        }
      } catch (err) {
        if (err instanceof AppError && err.type === 'PermissionError') throw err
        failed.push({
          index,
          message: err instanceof Error ? err.message : String(err),
          ...(err instanceof AppError && err.fields ? { fields: err.fields } : {}),
        })
      }
    }
    await writeImportLog(table, user.row_id, { inserted, updated, upsert }, failed, args.context, touched)
    if (!upsert) return { inserted, failed }
    return { updated, inserted, failed }
  },
})

// RVT-R1: the record of one written row. `version` names the version row an
// update produced (its before-values are the revert's restore source); an
// insert has none, and a no-op update deliberately records none.
export interface TouchedRow {
  row_id: string
  action: 'updated' | 'inserted'
  stamp: string
  version?: string
}

const stampOf = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString()

// Tie an update to the version row it just wrote. recordVersion skips no-op
// updates, so "the newest version row, only if born in this request" is
// exact: an older row fails the runStart check and the entry carries no
// version — RVT-R3's `skipped: unchanged` at revert time.
async function touchedUpdate(table: string, saved: Record<string, unknown>, runStart: Date): Promise<TouchedRow> {
  const entry: TouchedRow = {
    row_id: String(saved[ROW_KEY]),
    action: 'updated',
    stamp: stampOf(saved.updated_at),
  }
  const [v] = await sql`
    select row_id, created_at from version
    where ref_table = ${table} and ref_name = ${entry.row_id}
    order by created_at desc limit 1`
  if (v && (v.created_at as Date).getTime() >= runStart.getTime()) entry.version = String(v.row_id)
  return entry
}

// The dry-run counterpart of an upsert update: validate the mapped values
// the way the update will (partial schema — reqd columns may stay untouched
// on the matched row), including what 'clear' will null out. Throws AppError
// on the first problem, mirroring checkRowForInsert.
function checkRowForUpdate(
  meta: TableMeta,
  row: Record<string, unknown>,
  resolution: Resolution,
  upsert: UpsertArgs,
): void {
  const record = updateValues(row, upsert, resolution)
  if (
    upsert.keyColumn !== ROW_KEY &&
    row.row_id != null &&
    String(row.row_id).trim() !== '' &&
    String(row.row_id).trim() !== resolution.row_id
  )
    throw new AppError(
      'ValidationError',
      `row maps Row ID ${String(row.row_id).trim()} but matches ${resolution.row_id}; an upsert cannot change a row's id`,
    )
  validateRowForUpdate(meta, record)
}

// IMP-011: one Import Log row per :import request, whatever the caller —
// the wizard passes file/sheet/chunk context, a plain API import logs bare
// counts. skipPermissions: the log is system-written; the importer needs no
// grant on Import Log itself. Best-effort — a logging failure (e.g. a
// database mid-upgrade without 0056) never breaks the import that happened.
// UPS-R5: a keyed run also records its key_column and empty_cells choice —
// that stored pair is what the wizard later offers back as the visible
// "as last time" suggestion. A run with no key stores nothing (nulls).
async function writeImportLog(
  table: string,
  user: string,
  counts: { inserted: number; updated: number; upsert: UpsertArgs | null },
  failed: FailedRow[],
  context: unknown,
  touched: TouchedRow[],
): Promise<void> {
  const ctx = (typeof context === 'object' && context !== null ? context : {}) as Record<
    string,
    unknown
  >
  const str = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 140) : undefined)
  const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : undefined)
  await saveDoc(
    'Import Log',
    {
      ref_table: table,
      inserted: counts.inserted,
      updated: counts.updated,
      failed: failed.length,
      error_summary: failed.length
        ? failed
            .slice(0, LOG_ERROR_SAMPLE)
            .map((f) => `#${f.index}: ${f.message}`)
            .join('\n') +
          (failed.length > LOG_ERROR_SAMPLE ? `\n… and ${failed.length - LOG_ERROR_SAMPLE} more` : '')
        : undefined,
      key_column: counts.upsert?.keyColumn,
      empty_cells: counts.upsert ? counts.upsert.emptyCells : undefined,
      file_name: str(ctx.file_name),
      sheet_name: str(ctx.sheet_name),
      table_created: ctx.table_created === true,
      part: int(ctx.part),
      parts: int(ctx.parts),
      // RVT-R1: the run identity (wizard-minted, shared across parts) and
      // this part's written rows. A run without a run_id is not revertable.
      run_id: str(ctx.run_id),
      touched: touched.length ? touched : undefined,
    },
    user,
    'insert',
    { skipPermissions: true },
  ).catch(() => {})
}

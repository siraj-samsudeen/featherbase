import { randomUUID } from 'node:crypto'
import { observeUnchangedRows, planImport, saveImportedRow } from '../import-corrections'
import { getDoc } from '../document'
import { createHash } from 'node:crypto'
import { quoteIdent } from '../sql-identifier'
import { AppError, errorMessage, orWhenRefused } from '../errors'
import { checkLinksForUpdate, checkRowForInsert, saveDoc, saveSystemRow, validateRowForUpdate } from '../document'
import { ROW_KEY, getMeta, type TableMeta } from '../meta'
import { assertDocPermission, assertPermission, permissionScope, permittedColumns, includesColumn } from '../permissions'
import { registerCollectionAction, type CollectionActionContext } from '../actions'
import { sql } from '../db'
import { withStablePermissionReads, writesNoRememberedFacts } from '../permission-reads'
import { canRetire, tableRelation, quoteRelation } from '../table-engine'

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
// Named import threshold (packages/shared/src/import.ts): failures kept in the Import Log's error summary (Q3 owns 'more').
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
  // #859: the matched row is retired. The update leaves it retired.
  retired?: boolean
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
// #517: a key is compared with its surrounding whitespace trimmed from BOTH
// sides — the file's value here, the stored value in SQL — so a stored "A1 "
// matches a file's "A1". KEY_PADDING is exactly the set JavaScript's trim()
// removes (the web's duplicate check trims the same way), so both sides
// agree on every character.
export const KEY_PADDING =
  '\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'
// The stored side: the exact expression the key index is built on.
const storedKey = (column: string) => `btrim((${quoteIdent(column)})::text, '${KEY_PADDING}')`

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
  const matches = new Map<string, { row_id: string; updated_at: Date; created_by: string; retired: boolean }[]>()
  if (wanted.length) {
    const tbl = await tableRelation(meta.name)
    const key = sql(meta.row_key)
    const retired = canRetire(meta) ? sql`retired_at is not null` : sql`false`
    const found =
      keyColumn === ROW_KEY
        ? await sql`
            select ${key} as row_id, ${key} as k, updated_at, created_by, ${retired} as retired
            from ${sql(tbl)} where ${key} = any(${wanted})`
        : await sql`
            select ${key} as row_id, ${sql.unsafe(storedKey(keyColumn))} as k, updated_at, created_by, ${retired} as retired
            from ${sql(tbl)} where ${sql.unsafe(storedKey(keyColumn))} = any(${wanted})`
    for (const r of found) {
      const k = String(r.k)
      if (!matches.has(k)) matches.set(k, [])
      matches.get(k)!.push({
        row_id: String(r.row_id),
        updated_at: r.updated_at as Date,
        created_by: String(r.created_by),
        retired: r.retired === true,
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
        retired: hit[0].retired,
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

// #145: resolveRows compares the trimmed text of the key (storedKey), so
// only an EXPRESSION index on exactly that expression serves the query — a
// plain column index would not. Once per process per (table, key); IF NOT EXISTS
// carries restarts. The hash suffix keeps long table/column names inside
// Postgres's 63-char identifier limit without truncation collisions.
const ensuredKeyIndexes = new Set<string>()

async function ensureKeyIndex(table: string, keyColumn: string): Promise<void> {
  if (keyColumn === ROW_KEY) return // the primary key already serves it
  const cacheKey = `${table}:${keyColumn}`
  if (ensuredKeyIndexes.has(cacheKey)) return
  const tbl = await tableRelation(table)
  const suffix = createHash('sha256').update(cacheKey).digest('hex').slice(0, 8)
  const idx = `${tbl}_${keyColumn}`.slice(0, 46) + `_${suffix}_ukidx`
  await sql.unsafe(`create index if not exists ${quoteIdent(idx)} on ${quoteRelation(tbl)} ((${storedKey(keyColumn)}))`)
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
      if (col !== ROW_KEY && col !== upsert.keyColumn && !Object.hasOwn(values, col)) values[col] = null
  values[ROW_KEY] = matched.row_id
  // The optimistic-concurrency stamp updateDoc demands; saveDoc normalizes it.
  values.updated_at = matched.updated_at
  return values
}

registerCollectionAction('import', {
  effect: 'write',
  description:
    'Bulk-insert rows ({ rows: [...] }); returns { inserted, failed, run_id }, ' +
    'the run_id from context or a new one, which import-revert undoes. ' +
    'With key_column, upserts: rows matching an existing value update it ' +
    "({ updated, inserted, failed, run_id }); empty_cells 'keep'|'clear' picks what " +
    'an empty mapped cell does to a matched row. ' +
    'With dry_run: true, reports per-row actions and writes nothing.',
  handler: async (context) => {
    const result = await importRows(context)
    if (!context.args.dry_run && 'changed' in result) {
      const { changed, unchanged, ...response } = result
      return response
    }
    return result
  },
})

// Only trusted server callers supply managedColumns or skipUnchanged. The
// registered HTTP handler above deliberately forwards context alone, never
// caller args here. #971: skipUnchanged leaves a row that would change nothing
// unsaved, so it runs no automations and its last-updated time stays.
export async function importRows({ table, args, user }: CollectionActionContext, managedColumns: readonly string[] = [], opts: { skipUnchanged?: boolean } = {}) {
    const rows = args.rows
    if (!Array.isArray(rows) || rows.length === 0)
      throw new AppError('ValidationError', 'Expected { rows: [...] } with at least one row')
    if (rows.length > MAX_ROWS)
      throw new AppError('ValidationError', `Import is capped at ${MAX_ROWS} rows per request`)

    const meta = await getMeta(table)
    if (meta.kind !== 'table')
      throw new AppError('ValidationError', `Cannot import into a ${meta.kind} Table`)
    // EDS: bulk import is not supported on source-bound Tables yet — refused
    // here for the real run and the dry run alike, rather than fanning 10k
    // row-by-row writes at a foreign store.
    if (meta.data_source)
      throw new AppError(
        'ValidationError',
        `${table} is bound to data source ${meta.data_source}; bulk import is not supported on bound Tables yet`,
      )

    if (args.analyze_keys != null && typeof args.analyze_keys !== 'boolean')
      throw new AppError('ValidationError', 'analyze_keys must be a boolean')
    // Analysis must return before upsert setup: no index, save or Import Log.
    // It writes nothing, so its per-row permission checks share one read of
    // the caller's roles and grants (#1042).
    if (args.analyze_keys) {
      const key_candidates = await withStablePermissionReads(async () => {
        if (!Array.isArray(args.columns) || args.columns.some((c) => typeof c !== 'string'))
          throw new AppError('ValidationError', 'columns must be an array of column names')
        const columns = [...new Set(args.columns as string[])]
        for (const column of columns)
          if (column !== ROW_KEY && !meta.columns.some((c) => c.column_name === column))
            throw new AppError('ValidationError', `${meta.name} has no column ${column}`)
        const readColumns = await permittedColumns(user.row_id, table, 'read')
        // A Column read only on the caller's own rows, beside rows read in
        // full, is never offered: whether a guess matched a hidden value would
        // otherwise show in the answer.
        const readEverywhere = await permittedColumns(user.row_id, table, 'read', '')
        const ownRowsOnly = (await permissionScope(user.row_id, table, 'read')) === 'own_rows'
        const writeColumns = await permittedColumns(user.row_id, table, 'write')
        // The row key is not a metadata Column: any grant of the action reaches it.
        const reaches = (selection: ReadonlySet<string>, definition: (typeof meta.columns)[number] | undefined) =>
          definition ? includesColumn(selection, definition) : selection.size > 0
        const key_candidates: { column: string; matched: number; complete: boolean; can_match: boolean }[] = []
        for (const column of columns) {
          const definition = meta.columns.find((c) => c.column_name === column)
          if (definition && (definition.read_only || ['Section Break', 'Column Break', 'Sub-table'].includes(definition.column_type))) continue
          if (!reaches(readColumns, definition)) continue
          if (!ownRowsOnly && !reaches(readEverywhere, definition)) continue
          const matches = await resolveRows(meta, rows, column)
          // A single blank, duplicate or ambiguous key invalidates the column.
          if (matches.some((r) => r.action === 'fail')) continue
          const hidden = await orWhenRefused(async () => {
            let hides = false
            for (const match of matches) {
              if (match.action !== 'update') continue
              // getDoc includes own-row, reference-scope and attached-row gates,
              // and drops the Columns this caller may not read on that row: a
              // key matched on a hidden value would disclose it.
              const readable = await getDoc(table, match.row_id!, user.row_id)
              hides ||= column !== ROW_KEY && !Object.hasOwn(readable, column)
            }
            return hides
          }, () => undefined, ['PermissionError'])
          if (hidden === undefined) continue
          if (hidden) continue
          // Readable overlap still matters to an append-only caller. Whether
          // this key can authorize an upsert is a separate permission fact.
          const can_match = reaches(writeColumns, definition)
            && await orWhenRefused(async () => { await assertRunPermitted(user.row_id, table, matches); return true }, () => false, ['PermissionError'])
          const matched = matches.filter((r) => r.action === 'update').length
          key_candidates.push({ column, matched, complete: matched === rows.length, can_match })
        }
        return key_candidates
      })
      return { key_candidates }
    }

    // #1074: a run into a Table someone made reads each person-and-Table
    // fact once, not once a row: its saves cannot change those facts.
    const run = () => runImport(meta, rows, { table, args, user } as CollectionActionContext, managedColumns, opts)
    return writesNoRememberedFacts(meta) ? withStablePermissionReads(run) : run()
}

async function runImport(meta: TableMeta, rows: unknown[], { table, args, user }: CollectionActionContext, managedColumns: readonly string[], opts: { skipUnchanged?: boolean }) {
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
      let fieldsUpdated = 0
      let fieldsKept = 0
      let changed = 0
      let unchanged = 0
      let rowsKept = 0
      let conflicts = 0
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
            // Refused if this person cannot read the row. The rehearsal then compares
            // with what is stored, as the real import does; only counts leave here.
            await getDoc(table, resolution.row_id!, user.row_id)
            const current = await getDoc(table, resolution.row_id!)
            const plan = await planImport(meta, current, updateValues(row as Record<string, unknown>, upsert!, resolution), user.row_id)
            // A value kept as someone's correction is not written, so only the planned values are checked.
            await checkLinksForUpdate(meta, plan.values, user.row_id, current)
            fieldsUpdated += plan.fields_updated
            fieldsKept += plan.fields_kept
            if (plan.fields_updated > 0) changed++
            else unchanged++
            if (plan.fields_kept > 0) rowsKept++
            conflicts += plan.conflicts.length
            actions.push('update')
            continue
          }
          const name = await checkRowForInsert(meta, row as Record<string, unknown>, user.row_id)
          if (name && seenNames.has(name))
            throw new AppError('ConflictError', `Duplicate name ${name} within the import`)
          if (name) seenNames.add(name)
          actions.push('insert')
        } catch (err) {
          failed.push({
            index,
            message: errorMessage(err),
            ...(err instanceof AppError && err.fields ? { fields: err.fields } : {}),
          })
          actions.push('fail')
        }
      }
      if (!resolutions) return { dry_run: true, valid: rows.length - failed.length, failed, changed: 0, unchanged: 0, rows_kept: 0, conflicts: 0, fields_updated: 0, fields_kept: 0, tracks_changes: meta.track_changes }
      return {
        dry_run: true,
        valid: rows.length - failed.length,
        updated: actions.filter((a) => a === 'update').length,
        // #859: matched rows that are retired; the import updates them and
        // they stay retired.
        retired: resolutions.filter((r, i) => actions[i] === 'update' && r.retired).length,
        inserted: actions.filter((a) => a === 'insert').length,
        failed,
        actions,
        changed,
        unchanged,
        rows_kept: rowsKept,
        conflicts,
        fields_updated: fieldsUpdated,
        fields_kept: fieldsKept,
        tracks_changes: meta.track_changes,
      }
    }

    const context = typeof args.context === 'object' && args.context !== null ? args.context as Record<string, unknown> : {}
    const runId = typeof context.run_id === 'string' && context.run_id ? context.run_id.slice(0, 140) : randomUUID()
    let inserted = 0
    let updated = 0
    let changed = 0
    const failed: FailedRow[] = []
    // RVT-R1 (spec 0005): record every row this part writes — id, action,
    // and the updated_at stamp the write left — so the run is revertable.
    const touched: TouchedRow[] = []
    // Only a keyed run skips, so it has resolutions.
    const unchanged = opts.skipUnchanged
      ? await observeUnchangedRows(meta, rows.flatMap((row, index) => resolutions![index].action === 'update'
        ? [{ row_id: resolutions![index].row_id!, values: updateValues(row as Record<string, unknown>, upsert!, resolutions![index]) }]
        : []), user.row_id, runId)
      : new Set<string>()
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
          // Validate the incoming payload before protected fields are removed,
          // exactly as the check step does. A conflict cannot legitimize bad data.
          checkRowForUpdate(meta, record, resolution, upsert!)
          if (unchanged.has(resolution.row_id!)) {
            updated++
            touched.push({ row_id: resolution.row_id!, action: 'updated', stamp: stampOf(resolution.updated_at) })
            continue
          }
          const { saved, version, changed: rowChanged } = await saveImportedRow(meta, updateValues(record, upsert!, resolution), user.row_id, runId, true, managedColumns)
          updated++
          if (rowChanged) changed++
          touched.push({ row_id: String(saved.row_id), action: 'updated', stamp: stampOf(saved.updated_at), ...(version ? { version } : {}) })
        } else {
          const { saved } = await saveImportedRow(meta, row as Record<string, unknown>, user.row_id, runId, false, managedColumns)
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
          message: errorMessage(err),
          ...(err instanceof AppError && err.fields ? { fields: err.fields } : {}),
        })
      }
    }
    // A hook on a row saved above may have written a row already judged
    // unchanged: as its own save would have, that row fails on its old stamp.
    if (unchanged.size && (inserted || updated > unchanged.size)) {
      const after = new Map((await sql`select ${sql(meta.row_key)} as row_id, updated_at from ${sql(await tableRelation(table))} where ${sql(meta.row_key)} = any(${[...unchanged]})`).map(r => [String(r.row_id), stampOf(r.updated_at)]))
      for (const [index, resolution] of resolutions!.entries())
        if (resolution.action === 'update' && unchanged.has(resolution.row_id!) && after.get(resolution.row_id!) !== stampOf(resolution.updated_at))
          failed.push({ index, message: 'The row changed while this import ran' })
    }
    await writeImportLog(table, user.row_id, { inserted, updated, upsert }, failed, { ...context, run_id: runId }, touched)
    // #687: every writing run names its run ID, so the caller can undo it.
    if (!upsert) return { inserted, failed, run_id: runId }
    return { updated, changed, unchanged: updated - changed, inserted, failed, run_id: runId }
}

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
// counts. The log is system-written (#432): it goes through the trusted
// saveSystemRow, and the importer needs no grant on Import Log itself.
// Best-effort — a logging failure (e.g. a database mid-upgrade without 0056)
// never breaks the import that happened.
// UPS-R5: a keyed run also records its key_column and empty_cells choice —
// that stored pair is what the wizard later offers back as the visible
// "as last time" suggestion. A run with no key stores nothing (nulls).
export async function writeImportLog(
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
  await saveSystemRow(
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
      // this part's written rows. A run the caller names no run_id for gets one,
      // returned with the result (#687).
      run_id: str(ctx.run_id),
      // #206: the file-import all of this run's targets belong to.
      batch_id: str(ctx.batch_id),
      touched: touched.length ? touched : undefined,
    },
    user,
  ).catch(() => {})
}

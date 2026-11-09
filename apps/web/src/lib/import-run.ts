// The import-run module: everything a browser surface must know to send
// rows at POST /api/table/:table:import lives behind sendImportRun —
// pre-chunk duplicate gating, chunking, the dry/real response shapes, and
// the translation of the server's per-chunk `index` into a sourceIndex
// (#115: the server's index never escapes this module). Callers hand over
// already-projected CoercedRows and get back a report whose failures name
// source rows; parse-file's excelRow turns those into Excel numbers at
// display time.
import { splitForSend, type CoercedRow } from 'shared'
import { api } from './api'

// Named import threshold (packages/shared/src/import.ts): rows per :import call; log rows are per part. Previously
// declared once per caller.
const IMPORT_CHUNK = 500

export interface ImportFailure {
  sourceIndex: number
  message: string
}

/** What a refused row says (#416): the server's message plus, when it names
 *  them, each refused column and why — "Invalid values for X" alone does not
 *  tell anyone which cell to fix. */
export function failureMessage(
  f: { message: string; fields?: Record<string, string> },
  columnLabel: (column: string) => string = (c) => c,
): string {
  const parts = Object.entries(f.fields ?? {}).map(([column, why]) => `${columnLabel(column)}: ${why}`)
  return parts.length ? `${f.message} — ${parts.join('; ')}` : f.message
}

// UPS-R1's optional upsert arguments, as the server expects them.
export interface ImportUpsertArgs {
  key_column: string
  empty_cells: 'keep' | 'clear'
  columns: string[]
}

export interface ImportKeyCandidate {
  column: string
  matched: number
  complete: boolean
  can_match: boolean
}

export async function analyzeImportKeys(opts: {
  table: string
  rows: CoercedRow[]
  columns: string[]
}): Promise<ImportKeyCandidate[]> {
  if (!opts.rows.length) return []
  // Check the whole target (including grouped sheets) before chunking:
  // otherwise the same key in different parts looks one-to-one to the server.
  const eligible = [...new Set(opts.columns)].filter((column) => {
    const seen = new Set<string>()
    for (const row of opts.rows) {
      const key = row.values[column] == null ? '' : String(row.values[column]).trim()
      if (!key || seen.has(key)) return false
      seen.add(key)
    }
    return true
  })
  let candidates = eligible.map((column) => ({ column, matched: 0, complete: true, can_match: true }))
  for (let at = 0; at < opts.rows.length && candidates.length; at += IMPORT_CHUNK) {
    const res = await api.post<{ key_candidates: ImportKeyCandidate[] }>(
      `/api/table/${encodeURIComponent(opts.table)}:import`,
      { analyze_keys: true, columns: eligible, rows: opts.rows.slice(at, at + IMPORT_CHUNK).map((r) => r.values) },
    )
    candidates = candidates.flatMap((candidate) => {
      const part = res.key_candidates.find((c) => c.column === candidate.column)
      return part ? [{ column: candidate.column, matched: candidate.matched + part.matched, complete: candidate.complete && part.complete, can_match: candidate.can_match && part.can_match }] : []
    })
  }
  return candidates
}

interface ImportRunReport {
  // Dry runs: rows that passed validation. Real runs: inserted + updated.
  valid: number
  updated: number
  changed: number
  unchanged: number
  inserted: number
  failed: ImportFailure[]
  fields_updated: number
  fields_kept: number
  rows_kept: number
  conflicts: number
  tracks_changes: boolean | null
  /** #859: matched rows that are retired; they are updated and stay retired. */
  retired: number
}

export async function sendImportRun(opts: {
  table: string
  rows: CoercedRow[]
  // Present → upsert semantics; its key_column also drives the pre-chunk
  // duplicate gate. Absent → today's append-always.
  upsert?: ImportUpsertArgs | null
  dryRun?: boolean
  // IMP-011: per-chunk context recorded in the Import Log (part/parts are
  // supplied by this module).
  context?: (part: number, parts: number) => Record<string, unknown>
  // Progress, in sent-row terms (1-based from..to of total sent rows).
  onChunk?: (info: { from: number; to: number; total: number }) => void
  // #416: how a refused column is named to the user — the file's own header
  // when the caller knows the mapping, the column name otherwise.
  columnLabel?: (column: string) => string
}): Promise<ImportRunReport> {
  const { send, sendIdx, dupFailed } = splitForSend(opts.rows, opts.upsert?.key_column ?? null)
  const failed: ImportFailure[] = [...dupFailed]
  let valid = 0
  let updated = 0
  let changed = 0
  let unchanged = 0
  let inserted = 0
  let fieldsUpdated = 0
  let fieldsKept = 0
  let rowsKept = 0
  let conflicts = 0
  let retired = 0
  let tracksChanges: boolean | null = null
  const parts = Math.ceil(send.length / IMPORT_CHUNK)
  for (let at = 0; at < send.length; at += IMPORT_CHUNK) {
    const chunk = send.slice(at, at + IMPORT_CHUNK)
    const part = Math.floor(at / IMPORT_CHUNK) + 1
    opts.onChunk?.({ from: at + 1, to: at + chunk.length, total: send.length })
    const res = await api.post<{
      valid?: number
      fields_updated?: number
      fields_kept?: number
      rows_kept?: number
      conflicts?: number
      tracks_changes?: boolean
      updated?: number
      changed?: number
      unchanged?: number
      inserted?: number
      retired?: number
      failed: { index: number; message: string; fields?: Record<string, string> }[]
    }>(`/api/table/${encodeURIComponent(opts.table)}:import`, {
      rows: chunk,
      ...(opts.dryRun ? { dry_run: true } : {}),
      ...(opts.upsert ?? {}),
      ...(opts.context ? { context: opts.context(part, parts) } : {}),
    })
    fieldsUpdated += res.fields_updated ?? 0
    fieldsKept += res.fields_kept ?? 0
    rowsKept += res.rows_kept ?? 0
    conflicts += res.conflicts ?? 0
    retired += res.retired ?? 0
    if (res.tracks_changes !== undefined) tracksChanges = res.tracks_changes
    valid += res.valid ?? 0
    updated += res.updated ?? 0
    changed += res.changed ?? 0
    unchanged += res.unchanged ?? 0
    // A keyless dry run reports no per-action counts: every valid row is an
    // insert. Real runs always report inserted.
    inserted += res.inserted ?? res.valid ?? 0
    // The server's per-chunk index becomes a source index HERE and never
    // leaves this module (#115).
    failed.push(
      ...res.failed.map((f) => ({ sourceIndex: sendIdx[f.index + at], message: failureMessage(f, opts.columnLabel) })),
    )
  }
  failed.sort((a, b) => a.sourceIndex - b.sourceIndex)
  if (!opts.dryRun) valid = inserted + updated
  return { valid, updated, changed, unchanged, inserted, failed, fields_updated: fieldsUpdated, fields_kept: fieldsKept, rows_kept: rowsKept, conflicts, tracks_changes: tracksChanges, retired }
}

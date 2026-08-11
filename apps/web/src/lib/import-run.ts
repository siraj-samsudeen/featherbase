// The import-run module: everything a browser surface must know to send
// rows at POST /api/table/:table:import lives behind sendImportRun —
// pre-chunk duplicate gating, chunking, the dry/real response shapes, and
// the translation of the server's per-chunk `index` into a sourceIndex
// (#115: the server's index never escapes this module). Callers hand over
// already-projected CoercedRows and get back a report whose failures name
// source rows; parse-file's excelRow turns those into Excel numbers at
// display time.
import type { CoercedRow } from 'shared'
import { api } from './api'

// ADR 0008: rows per :import call; log rows are per part. Previously
// declared once per caller.
export const IMPORT_CHUNK = 500

export interface ImportFailure {
  sourceIndex: number
  message: string
}

// UPS-R1's optional upsert arguments, as the server expects them.
export interface ImportUpsertArgs {
  key_column: string
  empty_cells: 'keep' | 'clear'
  columns: string[]
}

export interface ImportRunReport {
  // Dry runs: rows that passed validation. Real runs: inserted + updated.
  valid: number
  updated: number
  inserted: number
  failed: ImportFailure[]
}

// UPS-R2 × IMPORT_CHUNK: the server resolves keys against the database and
// catches duplicates within one REQUEST, but a duplicate split across two
// chunks would reach it as two clean requests — and the second would
// quietly turn into an update of the first's row. The caller holds the
// whole file, so duplicate-key rows fail here, BEFORE chunking, and only
// the clean remainder is sent. sendIdx maps a sent position back to the
// row's SOURCE index in the sheet (#115: blanks included), so every
// server-reported failure names the true spreadsheet row.
export function splitForSend(rows: CoercedRow[], key: string | null) {
  if (!key)
    return {
      send: rows.map((r) => r.values),
      sendIdx: rows.map((r) => r.sourceIndex),
      dupFailed: [] as ImportFailure[],
    }
  const counts = new Map<string, number>()
  for (const r of rows) {
    const k = r.values[key] == null ? '' : String(r.values[key]).trim()
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const send: Record<string, unknown>[] = []
  const sendIdx: number[] = []
  const dupFailed: ImportFailure[] = []
  for (const r of rows) {
    const k = r.values[key] == null ? '' : String(r.values[key]).trim()
    if (k && (counts.get(k) ?? 0) > 1)
      dupFailed.push({
        sourceIndex: r.sourceIndex,
        message: `key ${k} appears more than once in the file`,
      })
    else {
      send.push(r.values)
      sendIdx.push(r.sourceIndex)
    }
  }
  return { send, sendIdx, dupFailed }
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
}): Promise<ImportRunReport> {
  const { send, sendIdx, dupFailed } = splitForSend(opts.rows, opts.upsert?.key_column ?? null)
  const failed: ImportFailure[] = [...dupFailed]
  let valid = 0
  let updated = 0
  let inserted = 0
  const parts = Math.ceil(send.length / IMPORT_CHUNK)
  for (let at = 0; at < send.length; at += IMPORT_CHUNK) {
    const chunk = send.slice(at, at + IMPORT_CHUNK)
    const part = Math.floor(at / IMPORT_CHUNK) + 1
    opts.onChunk?.({ from: at + 1, to: at + chunk.length, total: send.length })
    const res = await api.post<{
      valid?: number
      updated?: number
      inserted?: number
      failed: { index: number; message: string }[]
    }>(`/api/table/${encodeURIComponent(opts.table)}:import`, {
      rows: chunk,
      ...(opts.dryRun ? { dry_run: true } : {}),
      ...(opts.upsert ?? {}),
      ...(opts.context ? { context: opts.context(part, parts) } : {}),
    })
    valid += res.valid ?? 0
    updated += res.updated ?? 0
    // A keyless dry run reports no per-action counts: every valid row is an
    // insert. Real runs always report inserted.
    inserted += res.inserted ?? res.valid ?? 0
    // The server's per-chunk index becomes a source index HERE and never
    // leaves this module (#115).
    failed.push(
      ...res.failed.map((f) => ({ sourceIndex: sendIdx[f.index + at], message: f.message })),
    )
  }
  failed.sort((a, b) => a.sourceIndex - b.sourceIndex)
  if (!opts.dryRun) valid = inserted + updated
  return { valid, updated, inserted, failed }
}

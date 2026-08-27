import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
// (search read non-strictly: the wizard route lives in router.tsx, which
// imports this file — a strict useSearch would need the route object back)
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  autoMapColumns,
  coerceRows,
  inferTableDef,
  applyColumnCombines,
  combineOverlap,
  mergeSheetHeaders,
  mergeSheetRows,
  scoreTableMatch,
  seriesPrefix,
  shouldAutoMatch,
  tableMatchQuality,
  tableNameFromFile,
  type CoercedRow,
  type ColumnCombine,
  type InferredTableDef,
  type TableMatchQuality,
} from 'shared'
import { ApiError, api, listResource } from '../lib/api'
import { ImportOverview, type GroupMode } from '../components/ImportOverview'
import { NamingControl } from '../components/NamingControl'
import { COLUMN_TYPES, NO_COLUMN_TYPES, type TableMeta } from '../lib/meta'
import {
  countDataRows,
  excelRow,
  isBlankRow,
  isImportableFile,
  parseWorkbook,
  type ParsedSheet,
} from '../lib/parse-file'
import { sendImportRun, type ImportUpsertArgs } from '../lib/import-run'
import {
  clearSession,
  loadDecisions,
  loadSheets,
  sameShape,
  saveDecisions,
  saveSheets,
  shapeOf,
  type ImportDecisions,
} from '../lib/import-session'

// IMP-010: the Import wizard. Drop a CSV or a whole workbook; every sheet
// gets a target — a new Table (inferred, like the builder) or an existing
// one (columns auto-mapped by name/label; the suggestion itself is scored on
// column overlap, so a renamed file or sheet still finds its Table). Dry-run
// validates against the server before anything is written.

interface MappableColumn {
  column_name: string
  label: string | null
  column_type: string
}

interface SheetPlan {
  // 'skip' means "parked — not selected on the overview". It is set ONLY by
  // the selection in step one (#200): leaving a sheet unselected is the one
  // way to exclude it, so the target picker has no skip of its own.
  mode: 'new' | 'existing' | 'skip'
  // #201: a merge group. `members` lists the sheet indices this plan speaks
  // for, itself first — [i] for an ordinary sheet, [i, j, k] for a group's
  // lead. `groupedInto` is set on the followers and names their lead, which
  // is how the column step knows to render one card instead of three.
  members: number[]
  groupedInto: number | null
  // #203: this target's own failure, if it threw. Kept per target so one
  // sheet's problem cannot erase another's result.
  failure: string | null
  // #211: columns the USER declared to be one, which folding could never
  // work out — `Store Code` and `Store Name` are the same store to them and
  // to nothing else. Applied on top of the folded set, so the column grid,
  // the inference and the projection all see the result.
  combines: ColumnCombine[]
  // mode new: the Table name to create; mode existing: the target Table.
  table: string
  // Per file column, new-Table mode: import this column at all? (Existing
  // mode has the same control via the mapping's "— skip —".)
  include: boolean[]
  // True when the existing target was picked by column-overlap scoring, not
  // by the user — surfaced as a notice so an unnoticed auto-match can't
  // quietly route rows into a lookalike Table.
  auto_matched: boolean
  // A near-match that didn't clear the auto-select bar (e.g. this sheet fits
  // inside a wider Table) — shown as a hint on the new-Table panel.
  similar: { name: string; mapped: number; total: number } | null
  inferred: InferredTableDef
  // NAM-001, new-Table mode: the new Table's id_pattern, edited through the
  // same NamingControl the Table Builder uses. null = keep the inferred
  // default (a series derived from the Table name).
  id_pattern: string | null
  // per file column: target column_name in the existing Table, 'name' for
  // the Row ID (UPS-R4 — the file's own codes become the ids), or null (skip)
  mapping: (string | null)[]
  // UPS-R1/J1: the match key — a mapped target column (or 'name' for the Row
  // ID) that turns this run into an upsert. null = today's append-always.
  key: string | null
  // UPS-R3: what an empty mapped cell does to a matched row. Per run,
  // meaningful only when a key is set; keep is the default.
  empty_cells: 'keep' | 'clear'
  // UPS-R5: the remembered choice pre-filled from this Table's last keyed
  // import — kept around so the "as last time" notice can say so while the
  // user is free to change or clear it.
  suggested: { key: string; empty_cells: 'keep' | 'clear' } | null
  // Failures carry sourceIndex — the row's 0-based position in the sheet's
  // data rows, blanks included (#115). The server's per-chunk `index` is
  // translated the moment a response lands and never stored. `skipped`
  // counts data rows with nothing in any mapped column: they are sent
  // nowhere, so IMP-I1's arithmetic is disclosed, not silently absorbed.
  check: {
    valid: number
    updated: number
    inserted: number
    skipped: number
    // #201: a merge group's rows come from several sheets, so a failure has
    // to say WHICH — a row number is only true against its own sheet.
    failed: { sheetIndex: number; sourceIndex: number; message: string }[]
  } | null
  result: {
    updated: number
    inserted: number
    skipped: number
    failed: { sheetIndex: number; sourceIndex: number; message: string }[]
    // RVT-R1: the run identity this import was recorded under — what the
    // revert control addresses.
    run_id: string
  } | null
}

// ADR 0008: named UI-side thresholds — suggestion bets. (IMPORT_CHUNK
// lives with the import-run module now.)
const SUGGEST_MIN_SCORE = 0.3 // weakest near-match worth surfacing as a hint
// UPS-H1 (owner decision 2026-08-11): beyond this many updates in one run,
// the count must be typed back — the preview is passive, typing 1,200 is not.
const CONFIRM_UPDATES_OVER = 20
const SUGGEST_MAX = 3 // hints shown per sheet
const ERRORS_ON_SCREEN = 5 // failures listed inline; the log keeps more

interface ImportTarget {
  name: string
  columns: MappableColumn[]
}

async function fetchTargets(): Promise<ImportTarget[]> {
  const list = await listResource<{ row_id: string }>('Table', {
    filters: [['kind', '=', 'table']],
    fields: ['row_id'],
    order_by: 'row_id asc',
    limit_page_length: 500,
  })
  const metas = await Promise.all(
    list.data.map((t) => api.get<TableMeta>(`/api/table/${encodeURIComponent(t.row_id)}:meta`)),
  )
  return metas.map((m) => ({ name: m.name, columns: mappableColumns(m) }))
}

// IMP-013: the target picker. A native <select> over hundreds of Tables was
// unusable — "New Table…" needed a full scroll-back, and the best candidates
// were buried alphabetically. This combobox pins the two actions on top,
// ranks the closest column-overlap matches next (with how much of each
// Table the sheet covers), and filters the full list through a search box.
function TargetPicker({
  i,
  plan,
  sheet,
  targets,
  onPick,
}: {
  i: number
  plan: SheetPlan
  sheet: ParsedSheet
  targets: ImportTarget[]
  onPick: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const ranked = useMemo(
    () =>
      targets
        .map((t) => ({ t, q: tableMatchQuality(sheet.headers, t.columns) }))
        .filter((r) => r.q.score >= SUGGEST_MIN_SCORE)
        .sort((a, b) => b.q.score - a.q.score || b.q.coverage - a.q.coverage)
        .slice(0, SUGGEST_MAX),
    [targets, sheet],
  )

  const f = filter.trim().toLowerCase()
  const bestMatches = ranked.filter((r) => r.t.name.toLowerCase().includes(f))
  const bestNames = new Set(ranked.map((r) => r.t.name))
  const rest = targets.filter((t) => t.name.toLowerCase().includes(f) && !bestNames.has(t.name))

  const display = plan.mode === 'new' ? 'New Table…' : plan.table

  function pick(value: string) {
    onPick(value)
    setOpen(false)
    setFilter('')
  }

  const optionClass =
    'block w-full rounded px-2 py-1 text-left text-sm text-[var(--color-ink)] hover:bg-[var(--color-brand-tint)]'
  const sectionClass =
    'px-2 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400'

  return (
    <div ref={rootRef} className="relative">
      <input
        readOnly
        value={display}
        onClick={() => setOpen((o) => !o)}
        data-testid={`iw-target-${i}`}
        className="fc-input w-56 cursor-pointer py-1"
      />
      {open && (
        <div
          className="fc-card absolute right-0 z-20 mt-1 max-h-80 w-72 overflow-y-auto p-1"
          data-testid={`iw-target-menu-${i}`}
        >
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
              if (e.key === 'Enter') {
                const first = bestMatches[0]?.t.name ?? rest[0]?.name
                if (first) pick(first)
              }
            }}
            placeholder="Search Tables…"
            data-testid={`iw-target-search-${i}`}
            className="fc-input mb-1 w-full py-1"
          />
          <button type="button" onClick={() => pick('__new__')} data-testid={`iw-target-new-${i}`} className={optionClass}>
            <span className="text-[var(--color-brand)]">+</span> New Table…
          </button>
          {bestMatches.length > 0 && (
            <>
              <div className={sectionClass}>Best matches</div>
              {bestMatches.map(({ t, q }) => (
                <button
                  type="button"
                  key={t.name}
                  onClick={() => pick(t.name)}
                  data-testid={`iw-target-opt-${i}-${t.name}`}
                  className={optionClass}
                >
                  {t.name}
                  <span className="ml-2 text-xs text-gray-400">
                    {q.mapped} of its {t.columns.length} columns
                  </span>
                </button>
              ))}
            </>
          )}
          {rest.length > 0 && (
            <>
              <div className={sectionClass}>All Tables</div>
              {rest.map((t) => (
                <button
                  type="button"
                  key={t.name}
                  onClick={() => pick(t.name)}
                  data-testid={`iw-target-opt-${i}-${t.name}`}
                  className={optionClass}
                >
                  {t.name}
                </button>
              ))}
            </>
          )}
          {bestMatches.length === 0 && rest.length === 0 && (
            <p className="px-2 py-1 text-xs text-gray-400">No Table matches "{filter}"</p>
          )}
        </div>
      )}
    </div>
  )
}

// The target Table's CURRENT row count, shown beside the sheet's own counts
// so "11 rows in the file" vs "0 rows in the Table" can never be conflated.
function TargetRowCount({ i, table }: { i: number; table: string }) {
  const count = useQuery({
    queryKey: ['iw-count', table],
    queryFn: () => api.get<{ count: number }>(`/api/table/${encodeURIComponent(table)}:count`),
    staleTime: 30_000,
  })
  if (count.data == null) return null
  return (
    <span className="text-xs text-gray-500" data-testid={`iw-target-count-${i}`}>
      holds {count.data.count} rows now
    </span>
  )
}

// UPS-J1.3: real counts BEFORE anything commits — a dry run over the whole
// (deduplicated) file the moment a match key is chosen, so marking a key is
// never a silent mode switch. React Query keys on the run's shape; the
// sheet's cells are fixed per file load, so the mapped columns + key +
// choice identify the rows deterministically.
function UpsertPreview({
  i,
  table,
  keyColumn,
  emptyCells,
  columns,
  rows,
}: {
  i: number
  table: string
  keyColumn: string
  emptyCells: 'keep' | 'clear'
  columns: string[]
  rows: CoercedRow[]
}) {
  const preview = useQuery({
    queryKey: ['iw-upsert-preview', table, keyColumn, emptyCells, columns.join('·'), rows.length],
    enabled: rows.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const report = await sendImportRun({
        table,
        rows,
        dryRun: true,
        upsert: { key_column: keyColumn, empty_cells: emptyCells, columns },
      })
      return { updated: report.updated, inserted: report.inserted, failed: report.failed.length }
    },
  })
  if (preview.isError) return null // e.g. no permission — rehearse/import will say so
  if (!preview.data)
    return (
      <p className="mt-1 text-xs text-gray-400" data-testid={`iw-preview-pending-${i}`}>
        Counting matches…
      </p>
    )
  return (
    <p className="mt-1 text-sm text-[var(--color-ink)]" data-testid={`iw-preview-${i}`}>
      <strong>{preview.data.updated}</strong> rows match existing rows and will be{' '}
      <strong>updated</strong>; <strong>{preview.data.inserted}</strong> will be added
      {preview.data.failed > 0 && (
        <>
          ; <strong>{preview.data.failed}</strong> will fail
        </>
      )}
    </p>
  )
}

function mappableColumns(meta: TableMeta): MappableColumn[] {
  return meta.columns
    .filter(
      (c) =>
        !NO_COLUMN_TYPES.has(c.column_type) &&
        c.column_type !== 'Sub-table' &&
        !c.hidden &&
        !c.read_only,
    )
    .map((c) => ({ column_name: c.column_name, label: c.label, column_type: c.column_type }))
}

// ADR 0008: preview cap — enough to spot trouble, cheap to render. Failed
// rows beyond the cap always render.
const PREVIEW_ROWS = 50

function previewCell(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v)
}

// The sheet itself, numbered like Excel — through the same excelRow
// translation the error messages use, so the preview and the failures
// CANNOT disagree (#115). Blank rows render as gaps rather than vanishing;
// failed rows are highlighted in place with their message. Collapsed until
// a check or import reports problems.
function SheetPreview({
  i,
  sheet,
  failed,
  label,
}: {
  i: number | string
  sheet: ParsedSheet
  failed: { sourceIndex: number; message: string }[] | null
  // #201: which member sheet this preview is of, when the target is a merge
  // group. Null for an ordinary single-sheet target.
  label?: string | null
}) {
  const byRow = new Map((failed ?? []).map((f) => [f.sourceIndex, f.message]))
  const rows = sheet.rows.map((cells, si) => ({ cells, si }))
  const head = rows.slice(0, PREVIEW_ROWS)
  const tailFailed = rows.slice(PREVIEW_ROWS).filter((r) => byRow.has(r.si))
  const hidden = rows.length - head.length - tailFailed.length
  const problemCol = byRow.size > 0

  function previewRow({ cells, si }: { cells: unknown[]; si: number }) {
    const message = byRow.get(si)
    const blank = isBlankRow(cells)
    return (
      <tr
        key={si}
        data-testid={`iw-preview-row-${i}-${excelRow(si, sheet.headerExcelRow)}`}
        data-failed={message ? 'true' : undefined}
        className={message ? 'bg-red-50' : blank ? 'text-gray-300' : undefined}
      >
        <td className="px-2 py-0.5 text-right text-gray-400">
          {excelRow(si, sheet.headerExcelRow)}
        </td>
        {sheet.headers.map((_, c) => (
          <td key={c} className="whitespace-nowrap px-2 py-0.5">
            {blank ? (c === 0 ? '—' : '') : previewCell(cells[c])}
          </td>
        ))}
        {problemCol && <td className="px-2 py-0.5 text-red-700">{message ?? ''}</td>}
      </tr>
    )
  }

  return (
    <details className="mt-2" data-testid={`iw-sheet-preview-${i}`} open={problemCol}>
      <summary className="cursor-pointer text-xs text-gray-500">
        {label ? `Preview "${label}"` : 'Preview'} — row numbers match your spreadsheet
      </summary>
      <div className="mt-1 max-h-64 overflow-auto rounded border border-gray-100">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-50 text-left text-gray-600">
            <tr>
              {/* The header's own Excel row number sits in the corner. */}
              <th className="w-10 px-2 py-1 text-right font-normal text-gray-400">
                {sheet.headerExcelRow}
              </th>
              {sheet.headers.map((h, c) => (
                <th key={c} className="px-2 py-1 font-medium">
                  {h}
                </th>
              ))}
              {problemCol && <th className="px-2 py-1 font-medium text-red-600">Problem</th>}
            </tr>
          </thead>
          <tbody>
            {head.map(previewRow)}
            {hidden > 0 && (
              <tr data-testid={`iw-preview-gap-${i}`}>
                <td
                  colSpan={sheet.headers.length + (problemCol ? 2 : 1)}
                  className="px-2 py-1 text-gray-400"
                >
                  … {hidden} more rows
                </td>
              </tr>
            )}
            {tailFailed.map(previewRow)}
          </tbody>
        </table>
      </div>
    </details>
  )
}

// Spec 0005 (RVT-J1): revert the run just imported. Rehearse first — a dry
// run's counts before anything commits — then the real revert; rows edited
// after the import come back skipped and NAMED, and reverting those too is
// only ever a second, explicitly chosen act over the named list (RVT-R5).
const SKIP_WORDS: Record<string, string> = {
  'edited-after': 'edited after this import',
  'row-deleted': 'deleted since',
  'already-gone': 'already removed',
  unchanged: 'no changes to undo',
  'no-version-trail': 'no change history',
}

interface RevertReport {
  restored: number
  deleted: number
  skipped: { row_id: string; reason: string }[]
  failed: { row_id: string; message: string }[]
}

function RevertControl({ i, table, runId }: { i: number | string; table: string; runId: string }) {
  const [preview, setPreview] = useState<RevertReport | null>(null)
  const [outcome, setOutcome] = useState<RevertReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function call(body: Record<string, unknown>): Promise<RevertReport | null> {
    setBusy(true)
    setError(null)
    try {
      return await api.post<RevertReport>(`/api/table/${encodeURIComponent(table)}:import-revert`, {
        run_id: runId,
        ...body,
      })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Revert failed')
      return null
    } finally {
      setBusy(false)
    }
  }

  const skips = (r: RevertReport) =>
    r.skipped.map((s) => `${s.row_id} (${SKIP_WORDS[s.reason] ?? s.reason})`).join(', ')

  if (outcome) {
    const editedAfter = outcome.skipped.filter((s) => s.reason === 'edited-after')
    return (
      <div className="mt-1 text-sm" data-testid={`iw-revert-result-${i}`}>
        <span className={outcome.failed.length ? 'text-red-600' : 'text-green-700'}>
          Reverted: {outcome.restored} restored, {outcome.deleted} deleted
          {outcome.skipped.length > 0 && `; skipped ${skips(outcome)}`}
          {outcome.failed.length > 0 &&
            `; failed ${outcome.failed.map((f) => `${f.row_id}: ${f.message}`).join('; ')}`}
        </span>
        {editedAfter.length > 0 && (
          <button
            className="fc-btn ml-2 py-0.5 text-xs"
            data-testid={`iw-revert-override-${i}`}
            disabled={busy}
            onClick={async () => {
              const r = await call({ override: editedAfter.map((s) => s.row_id) })
              if (r) setOutcome(r)
            }}
          >
            Revert these {editedAfter.length} anyway
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="mt-1 text-sm" data-testid={`iw-revert-${i}`}>
      {preview === null ? (
        <button
          className="fc-btn py-0.5 text-xs"
          data-testid={`iw-revert-open-${i}`}
          disabled={busy}
          onClick={async () => {
            const r = await call({ dry_run: true })
            if (r) setPreview(r)
          }}
        >
          Revert this run…
        </button>
      ) : (
        <span data-testid={`iw-revert-preview-${i}`}>
          Will restore {preview.restored} updated rows and delete {preview.deleted} added rows
          {preview.skipped.length > 0 && `; skipping ${skips(preview)}`}.{' '}
          <button
            className="fc-btn-primary ml-1 py-0.5 text-xs"
            data-testid={`iw-revert-confirm-${i}`}
            disabled={busy || (preview.restored === 0 && preview.deleted === 0)}
            onClick={async () => {
              const r = await call({})
              if (r) {
                setOutcome(r)
                setPreview(null)
              }
            }}
          >
            Revert
          </button>{' '}
          <button
            className="fc-btn ml-1 py-0.5 text-xs"
            onClick={() => setPreview(null)}
            disabled={busy}
          >
            Cancel
          </button>
        </span>
      )}
      {error && <span className="ml-2 text-red-600">{error}</span>}
    </div>
  )
}

// RVT-J1.1's second entry point: the history strip. A wizard opened from a
// Table's list (the ?table= preselect) shows that Table's recent runs, each
// with its revert control — the way back to a run after the wizard's
// auto-navigation has moved on. Reads the Import Log the way the R5
// suggestion does: no grant (or a mid-upgrade database) → no strip, silently.
interface RunEntry {
  run_id: string
  file_name: string | null
  inserted: number
  updated: number
  failed: number
  reverted_at: string | null
}

function RunHistory({ table }: { table: string }) {
  const runs = useQuery({
    queryKey: ['iw-run-history', table],
    staleTime: 10_000,
    retry: false,
    queryFn: async (): Promise<RunEntry[]> => {
      const logs = await api.get<{
        data: {
          run_id: string | null
          file_name: string | null
          inserted: unknown
          updated: unknown
          failed: unknown
          reverted_at: string | null
        }[]
      }>(
        `/api/table/${encodeURIComponent('Import Log')}?fields=${encodeURIComponent(
          '["run_id","file_name","inserted","updated","failed","reverted_at","created_at"]',
        )}&filters=${encodeURIComponent(
          JSON.stringify([['ref_table', '=', table]]),
        )}&order_by=${encodeURIComponent('created_at desc')}&limit_page_length=40`,
      )
      const byRun = new Map<string, RunEntry>()
      for (const l of logs.data) {
        if (!l.run_id) continue // pre-run_id logs are not revertable
        const r = byRun.get(l.run_id) ?? {
          run_id: l.run_id,
          file_name: l.file_name,
          inserted: 0,
          updated: 0,
          failed: 0,
          reverted_at: null,
        }
        r.inserted += Number(l.inserted ?? 0)
        r.updated += Number(l.updated ?? 0)
        r.failed += Number(l.failed ?? 0)
        r.reverted_at = r.reverted_at ?? l.reverted_at
        byRun.set(l.run_id, r)
      }
      return [...byRun.values()].slice(0, 5)
    },
  })
  if (!runs.data?.length) return null
  return (
    <div className="fc-card mt-4 p-3" data-testid="iw-run-history">
      <div className="mb-1 text-xs font-medium text-gray-600">Recent imports into {table}</div>
      {runs.data.map((r, idx) => (
        <div
          key={r.run_id}
          className="flex flex-wrap items-center gap-2 text-sm"
          data-testid={`iw-run-${idx}`}
        >
          <span>
            {r.file_name ?? 'API import'} — {r.updated} updated · {r.inserted} added · {r.failed}{' '}
            failed
          </span>
          {r.reverted_at ? (
            <span className="text-xs text-gray-400">reverted</span>
          ) : (
            <RevertControl i={`h${idx}`} table={table} runId={r.run_id} />
          )}
        </div>
      ))}
    </div>
  )
}

export function ImportWizard() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const search = useSearch({ strict: false }) as { table?: string }
  const fileInput = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [sheets, setSheets] = useState<ParsedSheet[]>([])
  const [plans, setPlans] = useState<SheetPlan[]>([])
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  // #203: what the whole run did — stated whenever it STOPS, not only when
  // every target succeeded, so a partial failure still reports and still
  // shows the way on.
  const [runOutcome, setRunOutcome] = useState<{
    imported: number
    failed: string[]
    remaining: number
  } | null>(null)
  // #199: the wizard is two steps now. 'overview' answers "what is in this
  // file?"; 'columns' is the existing per-sheet work, over the chosen sheets
  // only. A CSV (one sheet) skips the overview — there is nothing to choose.
  const [stage, setStage] = useState<'overview' | 'columns'>('overview')
  // #200: which sheets are in. Empty on load, on purpose — including
  // everything by default is what created eleven unwanted Tables.
  const [selected, setSelected] = useState<boolean[]>([])
  const [ovRefused, setOvRefused] = useState(false)
  // #211: which columns are ticked for combining, keyed `${target}:${key}`
  // so two cards cannot collide. UI-only — the decision lands in the plan.
  const [combinePick, setCombinePick] = useState<Record<string, boolean>>({})
  const [combineName, setCombineName] = useState('')
  const [combineRule, setCombineRule] = useState<'first' | 'join'>('first')
  const [groupMode, setGroupMode] = useState<GroupMode>('separate')
  const [mergeName, setMergeName] = useState('')
  // #202: which target the column step is showing. Eleven cards stacked on
  // one screen is the wall this redesign started from, and it also left
  // nowhere to come back TO after looking at imported rows. Holds a PLAN
  // index rather than a position, so deselecting an earlier sheet cannot
  // silently slide the user onto a different target.
  const [current, setCurrent] = useState(0)
  // #204: decisions came back but the file's rows did not — too big for
  // sessionStorage, or a fresh tab. Everything the user DECIDED is intact;
  // only the data needs dropping again.
  const [needsFile, setNeedsFile] = useState<ImportDecisions<SheetPlan> | null>(null)
  // Whether this file's rows are being kept. Said up front, because
  // discovering it on return is exactly the surprise #204 exists to remove.
  const [dataKept, setDataKept] = useState(true)
  // The plan each sheet had when the file was read. Deselecting a sheet parks
  // it as 'skip'; reselecting must restore the target that was worked out for
  // it, not a blank one.
  const natural = useRef<SheetPlan[]>([])
  // UPS-H1's typed confirmation: set when a click-time dry run counted more
  // than CONFIRM_UPDATES_OVER updates; cleared by any plan change.
  // #202: `only` remembers the scope the confirmation was computed for — a
  // per-target run must not be confirmed into a run of everything.
  const [confirmUpdates, setConfirmUpdates] = useState<{
    total: number
    typed: string
    only?: number
  } | null>(null)

  // Every importable Table with its mappable columns — the mapping targets
  // and the corpus the rename-tolerant suggestions score against.
  const targets = useQuery({
    queryKey: ['import-targets'],
    queryFn: fetchTargets,
    staleTime: 60_000,
  })

  // #204: come back to what was left. Runs once — a later render must not
  // stamp saved state back over work done since.
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    const saved = loadDecisions<SheetPlan>()
    if (!saved) return
    setFileName(saved.fileName)
    setPlans(saved.plans)
    // An entry written by an older build may lack it; the plans themselves
    // are a safe stand-in for "what this sheet was worked out to be".
    natural.current = Array.isArray(saved.natural) ? saved.natural : saved.plans
    setSelected(saved.selected)
    setStage(saved.stage)
    setCurrent(saved.current)
    setGroupMode(saved.groupMode)
    setMergeName(saved.mergeName)
    setRunOutcome(saved.outcome)
    setDone(saved.done)
    const rows = loadSheets(saved.fileName)
    if (rows) setSheets(rows)
    // No rows: the decisions stand and the file is asked for again, rather
    // than eleven Tables' worth of naming being thrown away because the data
    // was too big to carry.
    else setNeedsFile(saved)
  }, [])

  // Saved on a delay, because plans change on every keystroke in a column
  // name and a write per character is how this would come to feel broken.
  // The delay is why `pending` exists: leaving the page is precisely when the
  // save matters and precisely when a pending timer is about to be thrown
  // away, so the snapshot is always available to flush immediately.
  const pending = useRef<ImportDecisions<SheetPlan> | null>(null)
  useEffect(() => {
    // A finished run has nothing to resume, and resuming it would be actively
    // wrong: coming back to /admin/import is how you start the NEXT import,
    // and it is where the run-history strip lives. Only unfinished work is
    // worth carrying.
    // Nothing on screen — mid-load, or just cleared — is nothing to save.
    if (!fileName || done || (sheets.length === 0 && !needsFile)) {
      pending.current = null
      return
    }
    const snapshot: ImportDecisions<SheetPlan> = {
      fileName,
      stage,
      selected,
      plans,
      natural: natural.current,
      current,
      groupMode,
      mergeName,
      outcome: runOutcome,
      done,
      // While waiting for the file, `sheets` is empty — the saved shape is
      // what a re-drop is checked against, so it must not be overwritten
      // with the shape of nothing.
      shape: needsFile ? needsFile.shape : shapeOf(sheets),
    }
    pending.current = snapshot
    const timer = setTimeout(() => {
      // Only if this is still the live snapshot. A run that finishes clears
      // the session and nulls `pending`, but a timer scheduled a moment
      // earlier is already in flight — without this guard it lands AFTER the
      // clear and resurrects a session that is over.
      if (pending.current === snapshot) saveDecisions(snapshot)
    }, 400)
    return () => clearTimeout(timer)
  }, [
    fileName,
    stage,
    selected,
    plans,
    current,
    groupMode,
    mergeName,
    runOutcome,
    done,
    sheets,
    needsFile,
  ])

  // Write it out for real whenever this page is being left — a route change
  // (unmount), a reload, or the tab going away. Without this the debounce
  // would swallow the last edit in exactly the case #204 is about: clicking
  // through to the rows you just imported.
  useEffect(() => {
    const flush = () => {
      if (pending.current) saveDecisions(pending.current)
    }
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])

  function startOver() {
    // Before clearing: a queued snapshot would otherwise be flushed back on
    // the way out and undo this.
    pending.current = null
    clearSession()
    setNeedsFile(null)
    setDataKept(true)
    setFileName(null)
    setSheets([])
    setPlans([])
    setSelected([])
    setStage('overview')
    setCurrent(0)
    setRunOutcome(null)
    setDone(false)
    setError(null)
    natural.current = []
  }

  function setPlan(i: number, patch: Partial<SheetPlan>) {
    setPlans((ps) =>
      ps.map((p, j) => (j === i ? { ...p, ...patch, check: null, result: null, failure: null } : p)),
    )
    // A changed plan invalidates a pending typed confirmation — its total
    // was computed for the previous mapping/key.
    setConfirmUpdates(null)
  }

  async function loadFile(file: File) {
    setError(null)
    setDone(false)
    if (!isImportableFile(file.name)) {
      setError(`${file.name}: not a CSV or Excel file`)
      return
    }
    // #204: whatever was on screen is about to be replaced, and parsing is
    // async — so clear it NOW rather than leaving a restored grid live and
    // clickable for the moment it takes to read the file. Editing something
    // that is about to be thrown away is worse than a blank pause.
    const resumeFrom = needsFile
    setSheets([])
    setPlans([])
    setNeedsFile(null)
    try {
      const parsed = await parseWorkbook(file)
      // A drop can beat the targets query; suggestions need the real corpus.
      const tables = await queryClient.ensureQueryData({
        queryKey: ['import-targets'],
        queryFn: fetchTargets,
      })
      setFileName(file.name)
      setSheets(parsed)
      // #204: the rows are kept if they fit. If they do not, say so now —
      // finding out on return that the file must be dropped again is the
      // surprise, not the dropping.
      setDataKept(saveSheets(file.name, parsed))
      // The same file, dropped again to carry on. Plans address sheets by
      // INDEX, so this must be the same workbook before they are applied —
      // otherwise a saved mapping would quietly point at another sheet's
      // columns. Name, sheet names, headers and row counts all have to match.
      if (resumeFrom && sameShape(resumeFrom.shape, shapeOf(parsed))) {
        setPlans(resumeFrom.plans)
        natural.current = resumeFrom.natural
        setSelected(resumeFrom.selected)
        setStage(resumeFrom.stage)
        setCurrent(resumeFrom.current)
        setGroupMode(resumeFrom.groupMode)
        setMergeName(resumeFrom.mergeName)
        setRunOutcome(resumeFrom.outcome)
        setDone(resumeFrom.done)
        return
      }
      const newPlans = parsed.map((sheet) => {
          const newName =
            (parsed.length === 1 ? tableNameFromFile(file.name) : tableNameFromFile(sheet.sheetName)) ||
            'Imported Table'
          const inferred = inferTableDef(newName, sheet.headers, sheet.rows)
          // Rename-tolerant suggestion: best column-overlap match, but
          // auto-selected only when the evidence is strong in BOTH
          // directions (shouldAutoMatch) — a small sheet fitting inside a
          // wider Table becomes a hint, not a silent default. ?table=X (the
          // list-view Import button) wins when it fits at all.
          let best: { name: string; q: TableMatchQuality; cols: number } | null = null
          for (const t of tables) {
            const q = tableMatchQuality(sheet.headers, t.columns)
            if (!best || q.score > best.q.score || (q.score === best.q.score && q.coverage > best.q.coverage))
              best = { name: t.name, q, cols: t.columns.length }
          }
          const pinned = search.table
            ? tables.find((t) => t.name === search.table)
            : undefined
          const pinnedScore = pinned ? scoreTableMatch(sheet.headers, pinned.columns) : 0
          const target =
            pinned && pinnedScore >= SUGGEST_MIN_SCORE
              ? pinned.name
              : best && shouldAutoMatch(newName, best.name, best.q)
                ? best.name
                : null
          const targetCols = tables.find((t) => t.name === target)?.columns ?? []
          const mapping = target ? autoMapColumns(sheet.headers, targetCols) : []
          return {
            mode: target ? 'existing' : 'new',
            table: target ?? newName,
            include: target ? mapping.map((m) => m !== null) : sheet.headers.map(() => true),
            auto_matched: Boolean(target),
            similar:
              !target && best && best.q.score >= 0.6
                ? { name: best.name, mapped: best.q.mapped, total: best.cols }
                : null,
            inferred,
            id_pattern: null,
            mapping,
            key: null,
            empty_cells: 'keep',
            suggested: null,
            check: null,
            result: null,
            members: [] as number[], // filled below, once the index is known
            groupedInto: null as number | null,
            combines: [] as ColumnCombine[],
            failure: null as string | null,
          } satisfies SheetPlan
        })
      // #200: remember what was worked out, then park every sheet. A single
      // sheet (any CSV) has nothing to choose, so it stays selected and the
      // overview is skipped entirely.
      // Every sheet starts as its own target; grouping is opt-in on the
      // overview. Done here rather than in the map above because a plan's
      // members are stated in sheet indices.
      newPlans.forEach((p, i) => {
        p.members = [i]
      })
      natural.current = newPlans
      const only = parsed.length === 1
      setGroupMode('separate')
      setMergeName(tableNameFromFile(file.name) || 'Imported Table')
      setSelected(parsed.map(() => only))
      setStage(only ? 'columns' : 'overview')
      setOvRefused(false)
      setPlans(only ? newPlans : newPlans.map((p) => ({ ...p, mode: 'skip' as const })))
      // UPS-R5: for sheets that landed on an existing Table, offer back that
      // Table's remembered match key — visibly, never silently.
      newPlans.forEach((p, i) => {
        if (p.mode === 'existing') void applySuggestion(i, p.table, p.mapping)
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the file')
    }
  }

  // #200: selecting a sheet restores the target worked out at load; clearing
  // it parks the sheet as 'skip', which every downstream step already honours.
  function applySelection(next: boolean[]) {
    setSelected(next)
    setOvRefused(false)
    setPlans((ps) =>
      ps.map((p, i) =>
        next[i]
          ? p.mode === 'skip'
            ? { ...(natural.current[i] ?? p), check: null, result: null, members: [i], groupedInto: null }
            : { ...p, check: null, result: null, members: [i], groupedInto: null }
          : { ...p, mode: 'skip' as const, check: null, result: null, members: [i], groupedInto: null },
      ),
    )
  }

  // #201: the merged column set for a group — every member's headers folded
  // together and their rows projected onto the result. One sheet's group is
  // just that sheet, so this is the single path both cases take.
  function mergedColumnsFor(plan: SheetPlan) {
    return applyColumnCombines(
      mergeSheetHeaders(plan.members.map((m) => sheets[m].headers)),
      plan.combines,
    )
  }

  // A group behaves like one sheet from here on: same shape, so the grid, the
  // mapping, the type inference and the coercion all read it unchanged.
  function effectiveSheet(plan: SheetPlan, i: number): ParsedSheet {
    if (plan.members.length < 2) return sheets[i]
    const cols = mergedColumnsFor(plan)
    return {
      sheetName: plan.table,
      headers: cols.map((c) => c.label),
      rows: mergeSheetRows(cols, plan.members.map((m) => sheets[m].rows)),
      headerExcelRow: 1,
      visibility: 'visible',
    }
  }

  // One member's rows projected onto the GROUP's column order, so they line
  // up with plan.inferred.columns — while keeping the member's own name and
  // headerExcelRow, which is what makes a failed row's number true (#115).
  function memberSheet(plan: SheetPlan, m: number): ParsedSheet {
    if (plan.members.length < 2) return sheets[m]
    const cols = mergedColumnsFor(plan)
    return {
      sheetName: sheets[m].sheetName,
      headers: cols.map((c) => c.label),
      rows: mergeSheetRows(
        cols,
        plan.members.map((mm) => (mm === m ? sheets[mm].rows : [])),
      ),
      headerExcelRow: sheets[m].headerExcelRow,
      visibility: sheets[m].visibility,
    }
  }

  // #211: changing a combine changes the column SET, so the inferred
  // definition and the include flags are rebuilt from it. Type inference runs
  // over the combined values — a column made of `Store Code` and
  // `Store Name` is Data even where each source alone might have read as
  // something narrower.
  function setCombines(i: number, combines: ColumnCombine[]) {
    setPlans((ps) =>
      ps.map((p, j) => {
        if (j !== i) return p
        const next = { ...p, combines }
        const cols = mergedColumnsFor(next)
        const rows = mergeSheetRows(cols, next.members.map((m) => sheets[m].rows))
        const inferred = inferTableDef(next.table, cols.map((c) => c.label), rows)
        return { ...next, inferred, include: inferred.columns.map(() => true), check: null, result: null }
      }),
    )
  }

  function leaveOverview() {
    const chosen = selected.flatMap((on, i) => (on ? [i] : []))
    if (!chosen.length) {
      setOvRefused(true)
      return
    }
    // #201: fold the chosen sheets into one target, or leave them as one
    // target each. The lead is the first chosen sheet; the rest point at it.
    if (groupMode === 'merge' && chosen.length >= 2) {
      const lead = chosen[0]
      const name = mergeName.trim() || 'Imported Table'
      const cols = mergeSheetHeaders(chosen.map((m) => sheets[m].headers))
      const rows = mergeSheetRows(cols, chosen.map((m) => sheets[m].rows))
      const inferred = inferTableDef(name, cols.map((c) => c.label), rows)
      setPlans((ps) =>
        ps.map((p, i) =>
          i === lead
            ? {
                ...p,
                mode: 'new' as const,
                table: name,
                members: chosen,
                groupedInto: null,
                combines: [],
                failure: null,
                inferred,
                include: inferred.columns.map(() => true),
                auto_matched: false,
                similar: null,
                mapping: [],
                key: null,
                suggested: null,
                check: null,
                result: null,
              }
            : chosen.includes(i)
              ? { ...p, groupedInto: lead, members: [i], check: null, result: null }
              : p,
        ),
      )
    }
    setStage('columns')
    // Start at the first target every time the overview is left, so
    // "← Choose sheets", change the selection, continue lands somewhere that
    // exists rather than on a card that is now skipped.
    setCurrent(chosen[0])
  }

  function retarget(i: number, value: string) {
    const sheet = sheets[i]
    if (value === '__new__') {
      const fallback =
        (sheets.length === 1 ? tableNameFromFile(fileName ?? '') : tableNameFromFile(sheet.sheetName)) ||
        'Imported Table'
      setPlan(i, {
        mode: 'new',
        table: fallback,
        auto_matched: false,
        mapping: [],
        key: null,
        suggested: null,
        include: sheet.headers.map(() => true),
      })
      return
    }
    const cols = targets.data?.find((t) => t.name === value)?.columns ?? []
    const mapping = autoMapColumns(sheet.headers, cols)
    setPlan(i, {
      mode: 'existing',
      table: value,
      auto_matched: false,
      similar: null,
      mapping,
      key: null,
      empty_cells: 'keep',
      suggested: null,
      include: mapping.map((m) => m !== null),
    })
    void applySuggestion(i, value, mapping)
  }

  // UPS-R5: the match key (and empty-cells choice) used on this Table's last
  // keyed import, read back from the Import Log and PRE-FILLED as a visible
  // suggestion — the user confirms or changes it; it is never silently
  // active. A reader without an Import Log grant simply gets no suggestion.
  async function applySuggestion(i: number, forTable: string, map: (string | null)[]) {
    try {
      const logs = await api.get<{ data: { key_column: string | null; empty_cells: string | null }[] }>(
        `/api/table/${encodeURIComponent('Import Log')}?fields=${encodeURIComponent(
          '["key_column","empty_cells"]',
        )}&filters=${encodeURIComponent(
          JSON.stringify([['ref_table', '=', forTable]]),
        )}&order_by=${encodeURIComponent('created_at desc')}&limit_page_length=20`,
      )
      const last = logs.data.find((l) => l.key_column)
      if (!last?.key_column) return
      const key = last.key_column
      // Only offerable if this file still maps that column (or the Row ID).
      if (!map.includes(key)) return
      const empty_cells = last.empty_cells === 'clear' ? 'clear' : 'keep'
      setPlans((ps) =>
        ps.map((p, j) =>
          j === i && p.mode === 'existing' && p.table === forTable && p.key === null
            ? { ...p, key, empty_cells, suggested: { key, empty_cells } }
            : p,
        ),
      )
    } catch {
      // No read on Import Log (or a mid-upgrade database) — no suggestion.
    }
  }

  // Rows for an existing-Table plan: project the mapped file columns and
  // coerce cells to the target column types.
  function mappedRows(sheet: ParsedSheet, plan: SheetPlan) {
    const cols = targets.data?.find((t) => t.name === plan.table)?.columns ?? []
    const typeOf = new Map(cols.map((c) => [c.column_name, c.column_type]))
    const picks = plan.mapping
      .map((target, idx) => (target && plan.include[idx] ? { idx, target } : null))
      .filter((p): p is { idx: number; target: string } => p !== null)
    return coerceRows(
      picks.map((p) => ({ column_name: p.target, column_type: typeOf.get(p.target) ?? 'Data' })),
      sheet.rows.map((r) => picks.map((p) => r[p.idx])),
    )
  }

  function planIdPattern(plan: SheetPlan): string {
    return plan.id_pattern ?? plan.inferred.id_pattern
  }

  // The mapped target columns of an existing-mode run — the `columns` the
  // server needs so UPS-R3's 'clear' knows which absent cells were
  // mapped-but-empty rather than simply unmapped.
  function mappedTargets(plan: SheetPlan): string[] {
    return [
      ...new Set(
        plan.mapping.filter((m, idx): m is string => m !== null && plan.include[idx]),
      ),
    ]
  }


  // Rows for a new-Table plan: 1:1 with the inferred (possibly renamed)
  // columns; blank-named and unchecked columns are dropped.
  function newTableRows(sheet: ParsedSheet, plan: SheetPlan) {
    const picks = plan.inferred.columns
      .map((c, idx) => (c.column_name.trim() && plan.include[idx] ? { idx, c } : null))
      .filter((p): p is { idx: number; c: (typeof plan.inferred.columns)[number] } => p !== null)
    return coerceRows(
      picks.map((p) => ({ column_name: p.c.column_name.trim(), column_type: p.c.column_type })),
      sheet.rows.map((r) => picks.map((p) => r[p.idx])),
    )
  }

  // The upsert arguments of an existing-mode run, or null for append-always.
  function upsertArgs(plan: SheetPlan): ImportUpsertArgs | null {
    if (!plan.key) return null
    return {
      key_column: plan.key,
      empty_cells: plan.empty_cells,
      columns: mappedTargets(plan),
    }
  }

  // #202: `only` scopes a rehearsal to one target — you check what you are
  // looking at. Omitted, it still rehearses every mapped target.
  async function runCheck(only?: number) {
    setError(null)
    setBusy('Checking…')
    try {
      for (const [i, plan] of plans.entries()) {
        if (only !== undefined && i !== only) continue
        if (plan.mode !== 'existing' || plan.groupedInto !== null) continue
        // #201: rehearse member by member, exactly as the import will send
        // them, so a reported row number is true against its own sheet.
        const totals = { valid: 0, updated: 0, inserted: 0, skipped: 0 }
        const failed: { sheetIndex: number; sourceIndex: number; message: string }[] = []
        for (const m of plan.members) {
          const rows = mappedRows(memberSheet(plan, m), plan)
          // IMP-I1 disclosure: data rows with nothing in any MAPPED column
          // are sent nowhere — say so instead of letting the counts quietly
          // disagree with the file.
          totals.skipped += countDataRows(sheets[m].rows) - rows.length
          if (!rows.length) continue
          const report = await sendImportRun({
            table: plan.table,
            rows,
            dryRun: true,
            upsert: upsertArgs(plan),
          })
          totals.valid += report.valid
          totals.updated += report.updated
          totals.inserted += report.inserted
          failed.push(...report.failed.map((f) => ({ ...f, sheetIndex: m })))
        }
        setPlans((ps) => ps.map((p, j) => (j === i ? { ...p, check: { ...totals, failed } } : p)))
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Check failed')
    } finally {
      setBusy(null)
    }
  }

  // #202: `only` imports a single target, so an eleven-sheet workbook is a
  // sequence of small commits rather than one all-or-nothing run. Omitted, it
  // imports every target that has not landed yet.
  async function runImport(confirmed = false, only?: number) {
    setError(null)
    setRunOutcome(null)
    setPlans((ps) =>
      ps.map((p, j) => (only === undefined || j === only ? { ...p, failure: null } : p)),
    )
    setBusy('Importing…')
    try {
      // UPS-H1: a run about to update more than CONFIRM_UPDATES_OVER rows
      // stops here and demands the number be typed back. Counts come from a
      // dry run at click time — the same rehearsal the server will honour —
      // never from stale UI state.
      if (!confirmed) {
        let updates = 0
        for (const [i, plan] of plans.entries()) {
          if (only !== undefined && i !== only) continue
          if (plan.mode !== 'existing' || !plan.key || plan.groupedInto !== null) continue
          const rows = mappedRows(effectiveSheet(plan, i), plan)
          if (!rows.length) continue
          const report = await sendImportRun({
            table: plan.table,
            rows,
            dryRun: true,
            upsert: upsertArgs(plan),
          })
          updates += report.updated
        }
        if (updates > CONFIRM_UPDATES_OVER) {
          setConfirmUpdates({ total: updates, typed: '', only })
          setBusy(null)
          return
        }
      }
      setConfirmUpdates(null)
      // #203: a target's failure belongs to THAT target. The loop used to sit
      // inside one try, so a throw on sheet 2 left sheets 3..n unattempted and
      // unreported, and skipped the completion block — taking with it the only
      // link to the Import Log. Each target now fails on its own.
      let imported = 0
      const failedTargets: string[] = []
      const ran: number[] = []
      for (const [i, plan] of plans.entries()) {
        if (plan.mode === 'skip' || plan.groupedInto !== null) continue
        if (only !== undefined && i !== only) continue
        // #202: a bulk run picks up where the stepper left off. Re-importing
        // a target that already landed would duplicate its rows, and the
        // result on screen is the user's evidence that it did land.
        if (only === undefined && plan.result) continue
        try {
        if (plan.mode === 'new') {
          await api.post('/api/table_def', {
            name: plan.table,
            id_pattern: planIdPattern(plan),
            columns: plan.inferred.columns
              .filter((c, idx) => c.column_name.trim() && plan.include[idx])
              .map((c) => ({
                column_name: c.column_name.trim(),
                label: c.label.trim() || undefined,
                column_type: c.column_type,
                choices: c.column_type === 'Choice' ? c.choices : undefined,
                in_list_view: c.in_list_view,
              })),
          })
        }
        // RVT-R1: one identity for the whole target, shared by its parts —
        // the handle the revert control addresses. #201: for a merge group
        // that means one run_id across every member sheet, so reverting
        // takes back all of them together.
        const runId = crypto.randomUUID()
        // #201: send a part PER MEMBER SHEET rather than one blended batch.
        // The Import Log already records sheet_name per part, and a failed
        // row's number is only true against the sheet it came from — both
        // are lost the moment members are concatenated.
        const total = { updated: 0, inserted: 0, skipped: 0 }
        const failed: { sheetIndex: number; sourceIndex: number; message: string }[] = []
        for (const [memberOrder, m] of plan.members.entries()) {
          const sheet = sheets[m]
          const rows =
            plan.mode === 'new'
              ? newTableRows(memberSheet(plan, m), plan)
              : mappedRows(memberSheet(plan, m), plan)
          total.skipped += countDataRows(sheet.rows) - rows.length
          if (!rows.length) continue
          const report = await sendImportRun({
            table: plan.table,
            rows,
            upsert: plan.mode === 'existing' ? upsertArgs(plan) : null,
            // IMP-011: recorded in the Import Log alongside the counts.
            context: (part, parts) => ({
              file_name: fileName ?? undefined,
              sheet_name: sheet.sheetName,
              table_created: plan.mode === 'new' && memberOrder === 0 && part === 1,
              part,
              parts,
              run_id: runId,
            }),
            onChunk: ({ from, to, total: n }) =>
              setBusy(
                `${plan.table}${plan.members.length > 1 ? ` · ${sheet.sheetName}` : ''}: importing rows ${from}–${to} of ${n}…`,
              ),
          })
          total.updated += report.updated
          total.inserted += report.inserted
          failed.push(...report.failed.map((f) => ({ ...f, sheetIndex: m })))
        }
        setPlans((ps) =>
          ps.map((p, j) =>
            j === i
              ? { ...p, result: { ...total, failed, run_id: runId } }
              : p,
          ),
        )
        imported += 1
        ran.push(i)
        } catch (err) {
          // Recorded, named, and the run continues. A target that threw is
          // not the same as one that imported nothing, so it says which.
          failedTargets.push(plan.table)
          const message = err instanceof ApiError ? err.message : 'Import failed'
          setPlans((ps) =>
            ps.map((p, j) => (j === i ? { ...p, failure: message } : p)),
          )
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['tables'] })
      await queryClient.invalidateQueries({ queryKey: ['import-targets'] })
      // #203: `done` retires the Import button, so it must not latch on a
      // partial failure — the whole point is that the run can be fixed and
      // tried again without starting over.
      // #202: and it must not latch on a per-target run either. Targets 2..n
      // are still to come; `plans` here predates this run, so what landed in
      // it is `ran` rather than anything readable off a plan.
      const landed = (j: number) => ran.includes(j) || Boolean(plans[j]?.result)
      const activeIndexes = plans.flatMap((p, j) =>
        p.mode !== 'skip' && p.groupedInto === null ? [j] : [],
      )
      const stillToGo = activeIndexes.filter((j) => !landed(j)).length
      // #202: "Import complete." after target 1 of 3 would be a lie. The run
      // still always reports when it STOPS (#203) — it just reports what it
      // actually did and what is left.
      setRunOutcome({ imported, failed: failedTargets, remaining: stillToGo })
      const finished = failedTargets.length === 0 && activeIndexes.every(landed)
      setDone(finished)
      // #204: and drop the saved session with it, so the next visit is a
      // clean wizard rather than a re-run of one that is over.
      if (finished) {
        pending.current = null
        clearSession()
      }
      // #202: walk on to the first target still waiting. Staying put after a
      // per-target import would make the next one a hunt; jumping past
      // something unimported would skip it silently.
      if (only !== undefined && !failedTargets.length) {
        const next = activeIndexes.find((j) => !landed(j))
        if (next !== undefined) setCurrent(next)
      }
      const active = plans.filter((p) => p.mode !== 'skip' && p.groupedInto === null)
      // Auto-navigation exists because a lone sheet leaves nothing else to
      // look at. #201: a merge group is one target but many sheets, and its
      // result is a per-sheet summary with ONE revert control for the whole
      // group — jumping to the list view would destroy the only place either
      // can be read, which is the complaint this work started from.
      // #203: and never navigate away from a failure the user has not read.
      if (!failedTargets.length && active.length === 1 && active[0].members.length === 1) {
        navigate({
          to: '/admin/$table',
          params: { table: active[0].table },
          search: { filters: undefined },
        })
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed')
    } finally {
      setBusy(null)
    }
  }

  // #202: the targets the column step walks — a chosen sheet, or a merge
  // group standing for several. Followers and skipped sheets are not targets.
  const targetIndexes = plans.flatMap((p, i) =>
    p.mode !== 'skip' && p.groupedInto === null ? [i] : [],
  )
  // `current` can name a sheet that has since been deselected or folded into
  // a group; falling back to the first target keeps the step renderable
  // rather than blank.
  const currentPos = targetIndexes.indexOf(current)
  const activePos = currentPos === -1 ? 0 : currentPos
  const activeTarget = targetIndexes[activePos] ?? -1
  const activePlan = plans[activeTarget]
  const landedCount = targetIndexes.filter((i) => plans[i]?.result).length
  const anyChecked = plans.some((p) => p.check)
  const blockingProblems = plans.reduce((n, p) => n + (p.check?.failed.length ?? 0), 0)

  // What a step is called. A group is named by the Table it will become —
  // no one member's sheet name speaks for it.
  function targetLabel(i: number): string {
    const plan = plans[i]
    if (!plan) return ''
    if (plan.members.length > 1) return plan.table || 'Merged Table'
    return sheets[i]?.sheetName || plan.table
  }

  // Rows this one target will send, for its own Import button.
  function targetRows(i: number): number {
    const plan = plans[i]
    if (!plan) return 0
    return plan.members.reduce((n, m) => n + countDataRows(sheets[m]?.rows ?? []), 0)
  }

  // A failed row's number is only true against the sheet it came from, so a
  // group says which sheet.
  function failLabel(
    plan: SheetPlan,
    f: { sheetIndex: number; sourceIndex: number; message: string },
  ): string {
    const from = sheets[f.sheetIndex]
    if (!from) return f.message
    const where = plan.members.length > 1 ? `${from.sheetName} row` : 'row'
    return `${where} ${excelRow(f.sourceIndex, from.headerExcelRow)}: ${f.message}`
  }

  return (
    <div data-testid="import-wizard" className="max-w-4xl">
      <h1 className="mb-4 text-xl font-semibold text-[var(--color-ink)]">Import Data</h1>

      <div
        data-testid="iw-dropzone"
        onClick={() => fileInput.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const file = e.dataTransfer.files[0]
          if (file) void loadFile(file)
        }}
        className={`mb-4 cursor-pointer rounded-md border-2 border-dashed px-4 py-6 text-center text-sm transition-colors ${
          dragging
            ? 'border-[var(--color-brand)] bg-blue-50 text-[var(--color-brand)]'
            : 'border-[var(--color-hairline-strong,#d1d8dd)] text-gray-500 hover:border-[var(--color-brand)]'
        }`}
      >
        {fileName && needsFile ? (
          <span data-testid="iw-file-name">
            Drop <strong>{fileName}</strong> again to carry on
          </span>
        ) : fileName ? (
          <span data-testid="iw-file-name">
            <strong>{fileName}</strong> — {sheets.length} sheet{sheets.length === 1 ? '' : 's'}
          </span>
        ) : (
          <>Drag & drop a CSV or Excel workbook here — every sheet becomes an import — or click to browse</>
        )}
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.tsv,.xlsx,.xlsm,.xls"
          data-testid="iw-file-input"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void loadFile(file)
          }}
        />
      </div>

      {/* #204: what was decided outlived the page; the rows did not. Say
          exactly what is being held and what is needed, because a wizard that
          simply reopens empty is what sent the owner here. */}
      {needsFile && (
        <div
          className="mb-3 rounded border border-[var(--color-brand)] bg-[var(--color-brand-tint)] px-3 py-2 text-sm"
          data-testid="iw-resume"
        >
          <strong>Your work on {needsFile.fileName} is saved.</strong>{' '}
          {needsFile.plans.filter((p) => p.mode !== 'skip' && p.groupedInto === null).length} Tables
          planned
          {needsFile.plans.some((p) => p.result) &&
            `, ${needsFile.plans.filter((p) => p.result).length} already imported`}
          . The file itself is not kept in the browser — drop the same file above and it picks up
          where you left off.
          <button
            type="button"
            className="ml-2 underline"
            data-testid="iw-start-over"
            onClick={startOver}
          >
            Start over instead
          </button>
        </div>
      )}

      {/* Said BEFORE leaving the page, not discovered on returning to it. */}
      {!dataKept && sheets.length > 0 && (
        <p className="mb-3 text-xs text-gray-500" data-testid="iw-too-big">
          This workbook is too large to keep in the browser. Your choices are saved, but if you
          leave this page you will need to drop the file again.
        </p>
      )}

      {fileName && !needsFile && (
        <p className="mb-3 text-xs text-gray-500">
          <button
            type="button"
            className="underline"
            data-testid="iw-start-over"
            onClick={startOver}
          >
            Start over
          </button>
          {' — forget this file and every choice made about it.'}
        </p>
      )}

      {search.table && sheets.length === 0 && <RunHistory table={search.table} />}

      {/* #205: the only link to the Import Log used to live inside the
          completion block, which renders only when NOTHING failed — so the
          one situation where the log matters most was the one that hid it.
          It is present from the moment a file is loaded, and after. */}
      <p className="mb-3 text-xs text-gray-500">
        <Link
          to="/admin/$table"
          params={{ table: 'Import Log' }}
          search={{ filters: undefined }}
          className="underline"
          data-testid="iw-history-link"
        >
          View import history
        </Link>
        {' — every import that has run, with what it created and how to undo it.'}
      </p>

      {/* #199: the overview owns the whole screen while it is up — showing
          column grids underneath it would be the wall of controls it exists
          to replace. */}
      {stage === 'overview' && sheets.length > 0 && (
        <ImportOverview
          fileName={fileName ?? ''}
          sheets={sheets}
          selected={selected}
          onSelect={applySelection}
          onContinue={leaveOverview}
          refused={ovRefused}
          mode={groupMode}
          onMode={setGroupMode}
          mergeName={mergeName}
          onMergeName={setMergeName}
        />
      )}

      {/* #202: one target at a time, and always say where you are in the
          sequence. The complaint that started this was eleven sheets on one
          screen; a stepper is only an improvement if it never leaves you
          wondering how many are left. */}
      {stage === 'columns' && sheets.length > 0 && targetIndexes.length > 0 && (
        <div className="fc-card mb-3 p-3" data-testid="iw-stepper">
          <div className="flex flex-wrap items-center gap-3">
            {sheets.length > 1 && !done && (
              <button
                type="button"
                onClick={() => setStage('overview')}
                data-testid="iw-back-to-overview"
                className="fc-btn py-1"
              >
                ← Choose sheets
              </button>
            )}
            <span
              className="text-sm font-semibold text-[var(--color-ink)]"
              data-testid="iw-step-of"
            >
              {targetIndexes.length > 1
                ? `Table ${activePos + 1} of ${targetIndexes.length}`
                : 'One Table'}
              {' — '}
              {targetLabel(activeTarget)}
            </span>
            <span className="ml-auto flex items-center gap-2">
              <button
                type="button"
                className="fc-btn py-1 disabled:opacity-40"
                data-testid="iw-prev"
                disabled={activePos === 0}
                onClick={() => setCurrent(targetIndexes[activePos - 1])}
              >
                ← Previous
              </button>
              <button
                type="button"
                /* Emphasised once this target has landed: its result is read,
                   and moving on is the only thing left to do here. */
                className={`${activePlan?.result ? 'fc-btn-primary' : 'fc-btn'} py-1 disabled:opacity-40`}
                data-testid="iw-next"
                disabled={activePos >= targetIndexes.length - 1}
                onClick={() => setCurrent(targetIndexes[activePos + 1])}
              >
                Next →
              </button>
            </span>
          </div>

          {/* The whole sequence at a glance, and a way to jump. Decided
              targets are marked, so "which of these eleven have I done?" is
              answered without stepping through them. */}
          {targetIndexes.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-1" data-testid="iw-step-strip">
              {targetIndexes.map((i, n) => {
                const plan = plans[i]
                const state = plan.result ? 'done' : plan.failure ? 'failed' : 'todo'
                const tone =
                  state === 'done'
                    ? 'border-green-600 text-green-800'
                    : state === 'failed'
                      ? 'border-[var(--color-danger)] text-[var(--color-danger)]'
                      : 'border-[var(--color-border)] text-gray-600'
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setCurrent(i)}
                    data-testid={`iw-step-${i}`}
                    data-state={state}
                    aria-current={i === activeTarget ? 'step' : undefined}
                    className={`rounded border px-2 py-0.5 text-xs ${tone} ${
                      i === activeTarget
                        ? 'bg-[var(--color-brand-tint)] font-semibold'
                        : 'bg-[var(--color-surface)]'
                    }`}
                  >
                    {state === 'done' ? '✓ ' : state === 'failed' ? '✗ ' : ''}
                    {n + 1}. {targetLabel(i)}
                  </button>
                )
              })}
            </div>
          )}

          <p className="mt-2 text-xs text-gray-500" data-testid="iw-chosen-count">
            {selected.filter(Boolean).length} of {sheets.length} sheets selected
            {targetIndexes.length > 1 &&
              ` — ${landedCount} of ${targetIndexes.length} Tables imported`}
          </p>
        </div>
      )}

      {stage === 'columns' && sheets.map((rawSheet, i) => {
        const plan = plans[i]
        if (!plan) return null
        // #200: unselected sheets are not shown here at all. Leaving them
        // alone on the overview is how they are excluded, so a card saying
        // "this sheet will not be imported" is noise now.
        if (plan.mode === 'skip') return null
        // #201: a merge group renders ONCE, on its lead. The followers'
        // columns are already folded into the lead's merged set.
        if (plan.groupedInto !== null) return null
        // #202: and only the step being walked. Everything else is reachable
        // from the strip above; results live below, so leaving a card does
        // not hide what it did.
        if (i !== activeTarget) return null
        // From here the card speaks for the whole target: for a group that is
        // the merged column set and every member's rows, so the grid, the
        // mapping and the preview all read one shape.
        const merged = plan.members.length > 1
        const sheet = merged ? effectiveSheet(plan, i) : rawSheet
        // Index-aligned with plan.inferred.columns: the grid's row N is this
        // merged column, and combines are expressed in its key.
        const groupColumns = merged ? mergedColumnsFor(plan) : []
        const pickedKeys = groupColumns
          .map((c) => c.key)
          .filter((k) => combinePick[`${i}:${k}`])
        const targetCols = targets.data?.find((t) => t.name === plan.table)?.columns ?? []
        const mappedCount = plan.mapping.filter((m, idx) => m && plan.include[idx]).length
        return (
          <div key={sheet.sheetName + i} className="fc-card mb-4 p-3" data-testid={`iw-sheet-${i}`}>
            <div className="mb-2 flex items-center justify-between">
              {/* The counts describe the FILE's sheet, never the target
                  Table — say so, since sheet and Table often share a name
                  and the Table's own count sits beside the picker. */}
              <div className="text-sm font-semibold text-[var(--color-ink)]">
                {merged ? (
                  <>
                    <span
                      className="fc-pill bg-[var(--color-brand-tint)] text-[var(--color-brand-dark)]"
                      data-testid={`iw-group-${i}`}
                    >
                      {plan.members.length} sheets → one Table
                    </span>{' '}
                    <span className="font-normal text-gray-500">
                      — {plan.members.reduce((n, m) => n + countDataRows(sheets[m].rows), 0)} rows,{' '}
                      {sheet.headers.length} columns combined
                    </span>
                  </>
                ) : (
                  <>
                    Sheet "{sheet.sheetName}"{' '}
                    <span className="font-normal text-gray-500">
                      — {countDataRows(sheet.rows)} rows, {sheet.headers.length} columns in the file
                    </span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="fc-label m-0">Import into</span>
                <TargetPicker
                  i={i}
                  plan={plan}
                  sheet={sheet}
                  targets={targets.data ?? []}
                  onPick={(v) => retarget(i, v)}
                />
                {plan.mode === 'existing' && (
                  <>
                    <TargetRowCount i={i} table={plan.table} />
                    {/* Peek at the target without losing wizard state. */}
                    <a
                      href={`/admin/${encodeURIComponent(plan.table)}`}
                      target="_blank"
                      rel="noreferrer"
                      data-testid={`iw-view-target-${i}`}
                      className="text-xs text-[var(--color-brand)] underline"
                    >
                      view ↗
                    </a>
                  </>
                )}
              </div>
            </div>

            {merged && (
              <div
                className="mb-2 rounded bg-[var(--color-subtle)] px-2 py-1 text-xs text-[var(--color-ink-muted)]"
                data-testid={`iw-group-members-${i}`}
              >
                {plan.members.map((m, k) => {
                  // Column names are folded (case, spaces, punctuation), so a
                  // sheet is only "missing" a column when nothing it has folds
                  // to it — and then its rows leave that column empty. Say so
                  // here rather than letting blanks appear unexplained.
                  const cols = mergedColumnsFor(plan)
                  const absent = cols.filter((c) => c.from[k] === -1)
                  return (
                    <span key={m} className="mr-3 inline-block">
                      {sheets[m].sheetName}{' '}
                      <span className="tabular-nums">({countDataRows(sheets[m].rows)} rows)</span>
                      {absent.length > 0 && (
                        <span className="text-[var(--color-warn)]">
                          {' '}
                          — no {absent.map((c) => c.label).join(', ')}
                        </span>
                      )}
                    </span>
                  )
                })}
              </div>
            )}

            {plan.mode === 'new' ? (
              <>
                {plan.similar && (
                  <div
                    className="mb-2 rounded bg-blue-50 px-2 py-1 text-xs text-blue-800"
                    data-testid={`iw-similar-${i}`}
                  >
                    A similar existing Table matches this sheet:{' '}
                    <a
                      href={`/admin/${encodeURIComponent(plan.similar.name)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold underline"
                    >
                      {plan.similar.name} ↗
                    </a>{' '}
                    ({plan.similar.mapped} of its {plan.similar.total} columns) — pick it under
                    "Import into" to append there instead of creating a new Table.
                  </div>
                )}
                <div className="mb-2 flex items-center gap-2">
                  <label className="fc-label m-0">New Table name</label>
                  <input
                    value={plan.table}
                    onChange={(e) => setPlan(i, { table: e.target.value })}
                    data-testid={`iw-new-name-${i}`}
                    className="fc-input w-64 py-1"
                  />
                </div>
                <table className="w-full text-sm" data-testid={`iw-new-grid-${i}`}>
                  <thead className="bg-gray-50 text-left text-xs text-gray-600">
                    <tr>
                      {merged && (
                        <th className="px-2 py-1" title="Tick two to combine them">
                          Join
                        </th>
                      )}
                      <th className="px-2 py-1">Use</th>
                      <th className="px-2 py-1">File column</th>
                      <th className="px-2 py-1">Label</th>
                      <th className="px-2 py-1">Column name</th>
                      <th className="px-2 py-1">Type</th>
                      <th className="px-2 py-1">Choices</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* NAM-001: the row id is column one of the grid, not a
                        setting above it — every record has an id, and where it
                        comes from is the same kind of decision as any other
                        column's. Always present, never removable. */}
                    <tr
                      className="border-t border-gray-100 bg-blue-50/60"
                      data-testid={`iw-row-id-${i}`}
                    >
                      {merged && <td />}
                      <td className="px-2 py-1 text-center text-gray-400" title="always present">
                        🔒
                      </td>
                      <td className="px-2 py-1" colSpan={5}>
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span className="fc-label m-0 shrink-0">Row ID</span>
                          <div className="min-w-0">
                            <NamingControl
                              value={planIdPattern(plan)}
                              onChange={(pattern) => setPlan(i, { id_pattern: pattern })}
                              columns={plan.inferred.columns
                                .filter((c) => c.column_name.trim())
                                .map((c) => ({
                                  column_name: c.column_name,
                                  label: c.label || c.column_name,
                                }))}
                              defaultPrefix={seriesPrefix(plan.table)}
                              idPrefix={`iw-${i}`}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                    {plan.inferred.columns.map((c, ci) => (
                      /* data-columnrow marks the editable column rows — see the
                         same marker in TableBuilder. Specs select on it so the
                         Row ID row (or any later decorative row) cannot shift
                         the indices they read. */
                      <tr
                        key={ci}
                        data-columnrow=""
                        className={`border-t border-gray-100 ${plan.include[ci] ? '' : 'opacity-40'}`}
                      >
                        {merged && (
                          <td className="px-2 py-1 text-center">
                            <input
                              type="checkbox"
                              checked={Boolean(combinePick[`${i}:${groupColumns[ci]?.key ?? ci}`])}
                              onChange={(e) =>
                                setCombinePick((prev) => ({
                                  ...prev,
                                  [`${i}:${groupColumns[ci]?.key ?? ci}`]: e.target.checked,
                                }))
                              }
                              data-testid={`iw-combine-pick-${i}-${ci}`}
                              aria-label={`Combine ${c.label || c.column_name}`}
                            />
                          </td>
                        )}
                        <td className="px-2 py-1 text-center">
                          <input
                            type="checkbox"
                            checked={plan.include[ci]}
                            onChange={(e) =>
                              setPlan(i, {
                                include: plan.include.map((v, j) => (j === ci ? e.target.checked : v)),
                              })
                            }
                            data-rowfield="include"
                          />
                        </td>
                        <td className="px-2 py-1 text-gray-500">{sheet.headers[ci]}</td>
                        <td className="px-1 py-1">
                          {/* The display name (normalized from the header);
                              the machine name in the next cell is what the
                              database column will be called. */}
                          <input
                            value={c.label}
                            onChange={(e) =>
                              setPlan(i, {
                                inferred: {
                                  ...plan.inferred,
                                  columns: plan.inferred.columns.map((cc, j) =>
                                    j === ci ? { ...cc, label: e.target.value } : cc,
                                  ),
                                },
                              })
                            }
                            data-rowfield="label"
                            className="w-full rounded border border-gray-200 px-1 py-0.5"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <input
                            value={c.column_name}
                            onChange={(e) =>
                              setPlan(i, {
                                inferred: {
                                  ...plan.inferred,
                                  columns: plan.inferred.columns.map((cc, j) =>
                                    j === ci ? { ...cc, column_name: e.target.value } : cc,
                                  ),
                                },
                              })
                            }
                            data-rowfield="column_name"
                            placeholder="(skip)"
                            className="w-full rounded border border-gray-200 px-1 py-0.5"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <select
                            value={c.column_type}
                            onChange={(e) =>
                              setPlan(i, {
                                inferred: {
                                  ...plan.inferred,
                                  columns: plan.inferred.columns.map((cc, j) =>
                                    j === ci ? { ...cc, column_type: e.target.value } : cc,
                                  ),
                                },
                              })
                            }
                            data-rowfield="column_type"
                            className="rounded border border-gray-200 px-1 py-0.5"
                          >
                            {COLUMN_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1 text-xs text-gray-500">
                          {c.column_type === 'Choice' ? c.choices?.split('\n').join(', ') : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* #211: the user's own column knowledge, which folding could
                    never supply. Two ticks and a name; the sample values are
                    there so "are these the same thing?" is answered rather
                    than guessed. */}
                {merged && (
                  <div className="mt-2" data-testid={`iw-combine-${i}`}>
                    {groupColumns.some((c) => c.combinedKeys) && (
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        {groupColumns
                          .filter((c) => c.combinedKeys)
                          .map((c) => (
                            <span
                              key={c.key}
                              className="fc-pill bg-[var(--color-brand-tint)] text-[var(--color-brand-dark)]"
                              data-testid={`iw-combined-${i}-${c.label}`}
                            >
                              {c.label} — combined by you
                              <button
                                type="button"
                                onClick={() =>
                                  setCombines(
                                    i,
                                    plan.combines.filter(
                                      (x) => x.keys.join('+') !== (c.combinedKeys ?? []).join('+'),
                                    ),
                                  )
                                }
                                data-testid={`iw-uncombine-${i}`}
                                className="ml-1 underline"
                              >
                                undo
                              </button>
                            </span>
                          ))}
                      </div>
                    )}

                    {pickedKeys.length >= 2 ? (
                      (() => {
                        const overlap = combineOverlap(groupColumns, pickedKeys)
                        const names = pickedKeys.map(
                          (k) => groupColumns.find((c) => c.key === k)?.label ?? k,
                        )
                        return (
                          <div className="rounded border border-[var(--color-border-strong)] bg-[var(--color-subtle)] p-2">
                            <div className="mb-1 text-sm font-medium text-[var(--color-ink)]">
                              Combine {names.join(' + ')} into one column
                            </div>
                            {/* Sample values: the reason to believe, or not. */}
                            <div className="mb-2 text-xs text-[var(--color-ink-muted)]">
                              {pickedKeys.map((k) => {
                                const col = groupColumns.find((c) => c.key === k)
                                const from = col?.from.findIndex((x) => x !== -1) ?? -1
                                const sample =
                                  from >= 0 && col
                                    ? sheets[plan.members[from]].rows
                                        .map((r) => r[col.from[from]])
                                        .filter((v) => v != null && String(v).trim() !== '')
                                        .slice(0, 4)
                                        .map((v) => String(v))
                                        .join(' · ')
                                    : ''
                                return (
                                  <div key={k} data-testid={`iw-combine-sample-${i}-${k}`}>
                                    <strong>{col?.label ?? k}</strong>: {sample || '(no values)'}
                                  </div>
                                )
                              })}
                            </div>
                            {overlap.length > 0 ? (
                              <div className="mb-2" data-testid={`iw-combine-overlap-${i}`}>
                                <div className="mb-1 rounded bg-[var(--color-warn-tint)] px-2 py-1 text-xs text-[var(--color-warn)]">
                                  {overlap.map((sh) => sheets[plan.members[sh]].sheetName).join(', ')}{' '}
                                  {overlap.length === 1 ? 'has' : 'have'} more than one of these.
                                  Those rows need a rule.
                                </div>
                                <label className="mr-3 text-xs">
                                  <input
                                    type="radio"
                                    name={`iw-combine-rule-${i}`}
                                    checked={combineRule === 'first'}
                                    onChange={() => setCombineRule('first')}
                                    data-testid={`iw-combine-rule-first-${i}`}
                                    className="mr-1 accent-[var(--color-brand)]"
                                  />
                                  Use {names[0]}, falling back to {names[1]}
                                </label>
                                <label className="text-xs">
                                  <input
                                    type="radio"
                                    name={`iw-combine-rule-${i}`}
                                    checked={combineRule === 'join'}
                                    onChange={() => setCombineRule('join')}
                                    data-testid={`iw-combine-rule-join-${i}`}
                                    className="mr-1 accent-[var(--color-brand)]"
                                  />
                                  Join them
                                </label>
                              </div>
                            ) : (
                              <div
                                className="mb-2 rounded bg-[var(--color-good-tint)] px-2 py-1 text-xs text-[var(--color-good)]"
                                data-testid={`iw-combine-no-overlap-${i}`}
                              >
                                No sheet has more than one of these, so every row takes whichever
                                it has. Nothing to resolve.
                              </div>
                            )}
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="fc-label m-0">New column name</span>
                              <input
                                value={combineName || names[0]}
                                onChange={(e) => setCombineName(e.target.value)}
                                data-testid={`iw-combine-name-${i}`}
                                className="fc-input w-48 py-1"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  setCombines(i, [
                                    ...plan.combines,
                                    {
                                      name: (combineName || names[0]).trim(),
                                      keys: pickedKeys,
                                      rule: overlap.length ? combineRule : 'first',
                                    },
                                  ])
                                  setCombinePick({})
                                  setCombineName('')
                                }}
                                data-testid={`iw-combine-go-${i}`}
                                className="fc-btn-primary py-1"
                              >
                                Combine
                              </button>
                              <button
                                type="button"
                                onClick={() => setCombinePick({})}
                                className="fc-btn py-1"
                              >
                                Clear
                              </button>
                            </div>
                          </div>
                        )
                      })()
                    ) : (
                      <p className="text-xs text-[var(--color-ink-faint)]">
                        Tick two columns in the <strong>Join</strong> column to declare them one —
                        for names Featherbase cannot match on its own, like a store code and a
                        store name.
                      </p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                {plan.auto_matched && (
                  <div
                    className="mb-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800"
                    data-testid={`iw-auto-matched-${i}`}
                  >
                    Auto-matched to the existing Table{' '}
                    <a
                      href={`/admin/${encodeURIComponent(plan.table)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold underline"
                    >
                      {plan.table} ↗
                    </a>{' '}
                    because its columns fit this sheet — rows will be <em>added to it</em>. Pick
                    "New Table…" above if you meant to create a separate Table.
                  </div>
                )}
                <div className="mb-1 text-xs text-gray-500" data-testid={`iw-mapped-count-${i}`}>
                  {mappedCount} of {sheet.headers.length} file columns mapped
                </div>
                <table className="w-full text-sm" data-testid={`iw-mapping-${i}`}>
                  <thead className="bg-gray-50 text-left text-xs text-gray-600">
                    <tr>
                      <th className="px-2 py-1">Use</th>
                      <th className="px-2 py-1">File column</th>
                      <th className="px-2 py-1">→ {plan.table} column</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.headers.map((h, hi) => (
                      <tr
                        key={hi}
                        className={`border-t border-gray-100 ${plan.include[hi] ? '' : 'opacity-40'}`}
                      >
                        {/* Skipping is the checkbox, same as the new-Table
                            grid — not a buried option inside the select. */}
                        <td className="px-2 py-1 text-center">
                          <input
                            type="checkbox"
                            checked={plan.include[hi]}
                            onChange={(e) => {
                              const include = plan.include.map((v, j) =>
                                j === hi ? e.target.checked : v,
                              )
                              setPlan(i, {
                                include,
                                // Unticking the key's file column strands the
                                // match key — clear it rather than match on
                                // a column that no longer imports.
                                key:
                                  plan.key &&
                                  plan.mapping.some((m, j) => m === plan.key && include[j])
                                    ? plan.key
                                    : null,
                              })
                            }}
                            data-testid={`iw-map-use-${i}-${hi}`}
                            data-rowfield="include"
                          />
                        </td>
                        <td className="px-2 py-1 text-gray-700">{h || <em>(blank)</em>}</td>
                        <td className="px-1 py-1">
                          <select
                            value={plan.mapping[hi] ?? ''}
                            onChange={(e) => {
                              const mapping = plan.mapping.map((m, j) =>
                                j === hi ? e.target.value || null : m,
                              )
                              const include = plan.include.map((v, j) =>
                                // Picking a column is intent — re-check the row.
                                j === hi ? Boolean(e.target.value) : v,
                              )
                              setPlan(i, {
                                mapping,
                                include,
                                // A remapped file column can strand the match
                                // key — an unmapped key is no key at all.
                                key:
                                  plan.key && mapping.some((m, j) => m === plan.key && include[j])
                                    ? plan.key
                                    : null,
                              })
                            }}
                            data-testid={`iw-map-${i}-${hi}`}
                            className="rounded border border-gray-200 px-1 py-0.5"
                          >
                            <option value="">— pick a column —</option>
                            {/* UPS-R4: the Row ID is a first-class mapping
                                target — the file's own codes become the ids,
                                verbatim; the series continues for rows the
                                file leaves blank. */}
                            <option value="row_id">Row ID</option>
                            {/* Label AND real column name: labels preserve
                                however the source file spelled its headers,
                                so the snake_case identity disambiguates. */}
                            {targetCols.map((c) => (
                              <option key={c.column_name} value={c.column_name}>
                                {c.label && c.label !== c.column_name
                                  ? `${c.label} · ${c.column_name}`
                                  : c.column_name}{' '}
                                ({c.column_type})
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* UPS-J1.2/J1.3: the Match key control — a real labelled,
                    keyboard-reachable control in the mapping step. Default
                    none: append-always stays the default; upsert is opt-in
                    per run. The empty-cells choice (UPS-R3) appears only
                    once a key is set, defaulting to keep. */}
                {(() => {
                  const keyOptions = [
                    ...new Set(
                      plan.mapping.filter(
                        (m, idx): m is string => m !== null && plan.include[idx],
                      ),
                    ),
                  ]
                  const keyLabel = (col: string) => {
                    if (col === 'row_id') return 'Row ID'
                    const c = targetCols.find((tc) => tc.column_name === col)
                    return c?.label && c.label !== c.column_name
                      ? `${c.label} · ${c.column_name}`
                      : col
                  }
                  // The suggestion speaks the column's friendly name — "Match
                  // on Zone Name, as last time" (UPS-J1.2), not the select's
                  // disambiguated idiom.
                  const friendly = (col: string) =>
                    col === 'row_id'
                      ? 'Row ID'
                      : (targetCols.find((tc) => tc.column_name === col)?.label ?? col)
                  return (
                    <div className="mt-2 border-t border-gray-100 pt-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <label htmlFor={`iw-key-${i}`} className="fc-label m-0">
                          Match key
                        </label>
                        <select
                          id={`iw-key-${i}`}
                          value={plan.key ?? ''}
                          onChange={(e) => setPlan(i, { key: e.target.value || null })}
                          data-testid={`iw-key-${i}`}
                          className="rounded border border-gray-200 px-1 py-0.5 text-sm"
                        >
                          <option value="">— none: always add rows —</option>
                          {keyOptions.map((col) => (
                            <option key={col} value={col}>
                              {keyLabel(col)}
                            </option>
                          ))}
                        </select>
                        {plan.suggested && plan.key === plan.suggested.key && (
                          <span
                            className="text-xs text-[var(--color-brand)]"
                            data-testid={`iw-key-suggested-${i}`}
                          >
                            Match on {friendly(plan.suggested.key)}, as last time
                          </span>
                        )}
                        {plan.key && (
                          <span
                            className="flex items-center gap-2 text-sm"
                            data-testid={`iw-empty-cells-${i}`}
                          >
                            <span className="fc-label m-0">Empty cells</span>
                            <label className="flex items-center gap-1">
                              <input
                                type="radio"
                                name={`iw-empty-${i}`}
                                checked={plan.empty_cells === 'keep'}
                                onChange={() => setPlan(i, { empty_cells: 'keep' })}
                                data-testid={`iw-empty-keep-${i}`}
                              />
                              keep existing values
                            </label>
                            <label className="flex items-center gap-1">
                              <input
                                type="radio"
                                name={`iw-empty-${i}`}
                                checked={plan.empty_cells === 'clear'}
                                onChange={() => setPlan(i, { empty_cells: 'clear' })}
                                data-testid={`iw-empty-clear-${i}`}
                              />
                              clear them
                            </label>
                          </span>
                        )}
                      </div>
                      {plan.key && (
                        <UpsertPreview
                          i={i}
                          table={plan.table}
                          keyColumn={plan.key}
                          emptyCells={plan.empty_cells}
                          columns={keyOptions}
                          rows={mappedRows(sheet, plan)}
                        />
                      )}
                    </div>
                  )
                })()}
              </>
            )}

            {/* #115: row numbers are only true against the sheet they came
                from, so a group previews member by member rather than showing
                one blended table with invented numbering. */}
            {(merged ? plan.members : [i]).map((m) => (
              <SheetPreview
                key={m}
                i={merged ? `${i}-${m}` : i}
                label={merged ? sheets[m].sheetName : null}
                sheet={merged ? memberSheet(plan, m) : sheet}
                failed={
                  (plan.result?.failed ?? plan.check?.failed ?? null)?.filter(
                    (f) => f.sheetIndex === m,
                  ) ?? null
                }
              />
            ))}

            {plan.check && (
              <div className="mt-2 text-sm" data-testid={`iw-check-${i}`}>
                {/* UPS-J1.4: with a match key the rehearsal report is
                    action-aware — updates and inserts counted apart. */}
                {plan.check.failed.length === 0 ? (
                  <span className="text-green-700">
                    ✓ All {plan.check.valid} rows are ready to import
                    {plan.key != null &&
                      `: ${plan.check.updated} will update, ${plan.check.inserted} will insert`}
                  </span>
                ) : (
                  <span className="text-red-600">
                    {plan.check.valid} rows ready
                    {plan.key != null &&
                      ` (${plan.check.updated} update · ${plan.check.inserted} insert)`}
                    , {plan.check.failed.length} with problems:{' '}
                    {plan.check.failed
                      .slice(0, ERRORS_ON_SCREEN)
                      .map((f) => failLabel(plan, f))
                      .join('; ')}
                    {plan.check.failed.length > 5 && ` … and ${plan.check.failed.length - 5} more`}
                  </span>
                )}
                {plan.check.skipped > 0 && (
                  <span className="ml-1 text-gray-500" data-testid={`iw-check-skipped-${i}`}>
                    ({plan.check.skipped} rows have no data in the imported columns and will be
                    skipped)
                  </span>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* #202: what this run has done so far, OUTSIDE the card that did it.
          Stepping to the next target must not hide the result of the last
          one — losing sight of a finished import is the complaint this work
          started from, and with one card on screen the card is the wrong
          place to keep it. */}
      {stage === 'columns' && targetIndexes.some((i) => plans[i]?.result || plans[i]?.failure) && (
        <div className="fc-card mb-4 p-3" data-testid="iw-results">
          <div className="fc-label mb-1">This import</div>
          {targetIndexes.map((i) => {
            const plan = plans[i]
            if (!plan.result && !plan.failure) return null
            return (
              <div key={i} className="border-t border-[var(--color-border)] py-2 first:border-t-0">
                {plan.failure && (
                  <div
                    className="rounded bg-[var(--color-danger-tint)] px-2 py-1 text-sm text-[var(--color-danger)]"
                    data-testid={`iw-failure-${i}`}
                  >
                    ✗ {plan.table} failed — {plan.failure}{' '}
                    <button
                      type="button"
                      className="underline"
                      data-testid={`iw-failure-goto-${i}`}
                      onClick={() => setCurrent(i)}
                    >
                      Fix it
                    </button>
                  </div>
                )}
                {plan.result && (
                  <div className="text-sm" data-testid={`iw-result-${i}`}>
                    {/* UPS-J1.5: completion reports updated / inserted /
                        failed as separate counts — never one blended
                        number. */}
                    <span className={plan.result.failed.length ? 'text-red-600' : 'text-green-700'}>
                      {plan.result.updated > 0
                        ? `Updated ${plan.result.updated} and added ${plan.result.inserted} rows in `
                        : `Imported ${plan.result.inserted} rows into `}
                      <Link
                        to="/admin/$table"
                        params={{ table: plan.table }}
                        search={{ filters: undefined }}
                        className="underline"
                      >
                        {plan.table}
                      </Link>
                      {plan.result.failed.length > 0 &&
                        `; ${plan.result.failed.length} failed (first: ${failLabel(
                          plan,
                          plan.result.failed[0],
                        )})`}
                      {plan.result.skipped > 0 &&
                        ` (${plan.result.skipped} rows had no data in the imported columns and were skipped)`}
                    </span>
                    <RevertControl i={i} table={plan.table} runId={plan.result.run_id} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {busy && (
        <p className="mt-2 text-sm text-gray-500" data-testid="iw-progress">
          {busy}
        </p>
      )}
      {error && (
        <p className="mt-2 text-sm text-red-600" data-testid="iw-error">
          {error}
        </p>
      )}
      {runOutcome && (
        <p
          className={`mt-2 text-sm ${runOutcome.failed.length ? 'text-[var(--color-danger)]' : 'text-green-700'}`}
          data-testid="iw-done"
        >
          {runOutcome.failed.length > 0
            ? `Imported ${runOutcome.imported}; ${runOutcome.failed.length} failed: ${runOutcome.failed.join(', ')}.`
            : runOutcome.remaining > 0
              ? `Imported ${runOutcome.imported}; ${runOutcome.remaining} still to import.`
              : 'Import complete.'}
        </p>
      )}

      {stage === 'columns' && sheets.length > 0 && !done && (
        <div className="sticky bottom-0 z-10 mt-4 flex items-center gap-2 rounded-t-[var(--radius-card)] border-t border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-3 shadow-[0_-6px_16px_rgba(25,39,52,0.09)]">
          {/* #202: check what is on screen. Rehearsing targets you cannot
              see puts their report somewhere you are not looking. */}
          {activePlan?.mode === 'existing' && (
            <button
              onClick={() => void runCheck(activeTarget)}
              disabled={!!busy}
              data-testid="iw-check"
              className="fc-btn disabled:opacity-40"
            >
              Check
            </button>
          )}
          {confirmUpdates && (
            <span
              className="mr-2 rounded bg-amber-50 px-2 py-1 text-sm text-amber-900"
              data-testid="iw-confirm-updates"
            >
              This import will <strong>update {confirmUpdates.total} existing rows</strong>. Type{' '}
              <strong>{confirmUpdates.total}</strong> to confirm:{' '}
              <input
                className="fc-input mx-1 w-24 py-0.5"
                data-testid="iw-confirm-input"
                aria-label={`Type ${confirmUpdates.total} to confirm updating ${confirmUpdates.total} rows`}
                value={confirmUpdates.typed}
                onChange={(e) => setConfirmUpdates({ ...confirmUpdates, typed: e.target.value })}
              />
              <button
                className="fc-btn-primary py-0.5 disabled:opacity-40"
                data-testid="iw-confirm-go"
                disabled={!!busy || confirmUpdates.typed.trim() !== String(confirmUpdates.total)}
                onClick={() => void runImport(true, confirmUpdates.only)}
              >
                Update {confirmUpdates.total} rows
              </button>
            </span>
          )}
          {/* #202: import THIS target, then step on. The owner asked to
              "import and then go to that screen where the row is imported"
              mid-flow — which needs a commit per target, not one run at the
              end of eleven. */}
          {targetIndexes.length > 1 &&
            activeTarget !== -1 &&
            (activePlan?.result ? (
              <span className="text-sm text-green-700" data-testid="iw-import-one-done">
                ✓ {activePlan.table} imported
              </span>
            ) : (
              <button
                onClick={() => void runImport(false, activeTarget)}
                disabled={!!busy || !!confirmUpdates}
                data-testid="iw-import-one"
                className="fc-btn-primary disabled:opacity-40"
              >
                {`Import ${targetRows(activeTarget)} rows into ${activePlan?.table || 'this Table'}`}
              </button>
            ))}
          <button
            onClick={() => void runImport()}
            disabled={
              !!busy ||
              !!confirmUpdates ||
              plans.every((p) => p.mode === 'skip') ||
              targetIndexes.every((i) => plans[i]?.result)
            }
            data-testid="iw-import"
            className={`${targetIndexes.length > 1 ? 'fc-btn' : 'fc-btn-primary'} disabled:opacity-40`}
          >
            {anyChecked && blockingProblems > 0
              ? `Import anyway (skip ${blockingProblems} bad rows)`
              : targetIndexes.length > 1
                ? `Import the remaining ${targetIndexes.filter((i) => !plans[i]?.result).length} Tables`
                : `Import ${sheets.reduce(
                    (n, s, si) => n + (plans[si]?.mode === 'skip' ? 0 : countDataRows(s.rows)),
                    0,
                  )} rows`}
          </button>
        </div>
      )}
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
// (search read non-strictly: the wizard route lives in router.tsx, which
// imports this file — a strict useSearch would need the route object back)
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  autoMapColumns,
  coerceRows,
  inferTableDef,
  scoreTableMatch,
  seriesPrefix,
  shouldAutoMatch,
  tableMatchQuality,
  tableNameFromFile,
  type CoercedRow,
  type InferredTableDef,
  type TableMatchQuality,
} from 'shared'
import { ApiError, api, listResource } from '../lib/api'
import { NamingControl } from '../components/NamingControl'
import { COLUMN_TYPES, NO_COLUMN_TYPES, type TableMeta } from '../lib/meta'
import { countDataRows, isImportableFile, parseWorkbook, type ParsedSheet } from '../lib/parse-file'

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
  mode: 'new' | 'existing' | 'skip'
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
  check: {
    valid: number
    updated: number
    inserted: number
    failed: { index: number; message: string }[]
  } | null
  result: {
    updated: number
    inserted: number
    failed: { index: number; message: string }[]
  } | null
}

// ADR 0008: named UI-side thresholds — chunking and suggestion bets.
const IMPORT_CHUNK = 500 // rows per :import call; log rows are per part
const SUGGEST_MIN_SCORE = 0.3 // weakest near-match worth surfacing as a hint
const SUGGEST_MAX = 3 // hints shown per sheet
const ERRORS_ON_SCREEN = 5 // failures listed inline; the log keeps more

interface ImportTarget {
  name: string
  columns: MappableColumn[]
}

async function fetchTargets(): Promise<ImportTarget[]> {
  const list = await listResource<{ name: string }>('Table', {
    filters: [['kind', '=', 'table']],
    fields: ['name'],
    order_by: 'name asc',
    limit_page_length: 500,
  })
  const metas = await Promise.all(
    list.data.map((t) => api.get<TableMeta>(`/api/table/${encodeURIComponent(t.name)}:meta`)),
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

  const display =
    plan.mode === 'new' ? 'New Table…' : plan.mode === 'skip' ? 'Skip this sheet' : plan.table

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
          <button type="button" onClick={() => pick('__skip__')} data-testid={`iw-target-skip-${i}`} className={optionClass}>
            <span className="text-gray-400">⊘</span> Skip this sheet
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

// UPS-R2 × IMPORT_CHUNK: the server resolves keys against the database and
// catches duplicates within one REQUEST, but a duplicate split across two
// chunks would reach it as two clean requests — and the second would
// quietly turn into an update of the first's row. The wizard holds the
// whole file, so it fails duplicate-key rows here, BEFORE chunking, and
// sends only the clean remainder. sendIdx maps a sent position back to the
// row's SOURCE index in the sheet (#115: blanks included), so every
// server-reported failure names the true spreadsheet row.
export function splitForSend(rows: CoercedRow[], key: string | null) {
  if (!key)
    return {
      send: rows.map((r) => r.values),
      sendIdx: rows.map((r) => r.sourceIndex),
      dupFailed: [] as { index: number; message: string }[],
    }
  const counts = new Map<string, number>()
  for (const r of rows) {
    const k = r.values[key] == null ? '' : String(r.values[key]).trim()
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const send: Record<string, unknown>[] = []
  const sendIdx: number[] = []
  const dupFailed: { index: number; message: string }[] = []
  for (const r of rows) {
    const k = r.values[key] == null ? '' : String(r.values[key]).trim()
    if (k && (counts.get(k) ?? 0) > 1)
      dupFailed.push({ index: r.sourceIndex, message: `key ${k} appears more than once in the file` })
    else {
      send.push(r.values)
      sendIdx.push(r.sourceIndex)
    }
  }
  return { send, sendIdx, dupFailed }
}

// #115 / IMP-I1: a failure's `index` is the row's source index among the
// sheet's data rows (blanks included, per parse-file's blankrows: true).
// This is the ONLY translation from internal indices to the row numbers a
// user sees; every message goes through it so the wizard's numbers always
// match Excel's — including when the header itself isn't row 1.
function excelRow(sourceIndex: number, headerExcelRow: number): number {
  return headerExcelRow + 1 + sourceIndex
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
  const { send, dupFailed } = splitForSend(rows, keyColumn)
  const preview = useQuery({
    queryKey: ['iw-upsert-preview', table, keyColumn, emptyCells, columns.join('·'), rows.length],
    enabled: send.length > 0 || dupFailed.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      let updated = 0
      let inserted = 0
      let failed = dupFailed.length
      for (let at = 0; at < send.length; at += IMPORT_CHUNK) {
        const res = await api.post<{
          valid: number
          updated?: number
          inserted?: number
          failed: unknown[]
        }>(`/api/table/${encodeURIComponent(table)}:import`, {
          rows: send.slice(at, at + IMPORT_CHUNK),
          dry_run: true,
          key_column: keyColumn,
          empty_cells: emptyCells,
          columns,
        })
        updated += res.updated ?? 0
        inserted += res.inserted ?? res.valid
        failed += res.failed.length
      }
      return { updated, inserted, failed }
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

  // Every importable Table with its mappable columns — the mapping targets
  // and the corpus the rename-tolerant suggestions score against.
  const targets = useQuery({
    queryKey: ['import-targets'],
    queryFn: fetchTargets,
    staleTime: 60_000,
  })

  function setPlan(i: number, patch: Partial<SheetPlan>) {
    setPlans((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch, check: null, result: null } : p)))
  }

  async function loadFile(file: File) {
    setError(null)
    setDone(false)
    if (!isImportableFile(file.name)) {
      setError(`${file.name}: not a CSV or Excel file`)
      return
    }
    try {
      const parsed = await parseWorkbook(file)
      // A drop can beat the targets query; suggestions need the real corpus.
      const tables = await queryClient.ensureQueryData({
        queryKey: ['import-targets'],
        queryFn: fetchTargets,
      })
      setFileName(file.name)
      setSheets(parsed)
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
          } satisfies SheetPlan
        })
      setPlans(newPlans)
      // UPS-R5: for sheets that landed on an existing Table, offer back that
      // Table's remembered match key — visibly, never silently.
      newPlans.forEach((p, i) => {
        if (p.mode === 'existing') void applySuggestion(i, p.table, p.mapping)
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the file')
    }
  }

  function retarget(i: number, value: string) {
    const sheet = sheets[i]
    if (value === '__skip__') {
      setPlan(i, { mode: 'skip' })
      return
    }
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

  // The upsert arguments of an existing-mode run, or {} for append-always.
  function upsertArgs(plan: SheetPlan): Record<string, unknown> {
    if (!plan.key) return {}
    return {
      key_column: plan.key,
      empty_cells: plan.empty_cells,
      columns: mappedTargets(plan),
    }
  }

  async function runCheck() {
    setError(null)
    setBusy('Checking…')
    try {
      for (const [i, plan] of plans.entries()) {
        if (plan.mode !== 'existing') continue
        const rows = mappedRows(sheets[i], plan)
        if (!rows.length) {
          setPlan(i, { check: { valid: 0, updated: 0, inserted: 0, failed: [] } })
          continue
        }
        const { send, sendIdx, dupFailed } = splitForSend(rows, plan.key)
        const failed: { index: number; message: string }[] = [...dupFailed]
        let valid = 0
        let updated = 0
        let inserted = 0
        for (let at = 0; at < send.length; at += IMPORT_CHUNK) {
          const chunk = send.slice(at, at + IMPORT_CHUNK)
          const res = await api.post<{
            valid: number
            updated?: number
            inserted?: number
            failed: { index: number; message: string }[]
          }>(`/api/table/${encodeURIComponent(plan.table)}:import`, {
            rows: chunk,
            dry_run: true,
            ...upsertArgs(plan),
          })
          valid += res.valid
          updated += res.updated ?? 0
          // A keyless dry run reports no per-action counts: every valid row
          // is an insert.
          inserted += res.inserted ?? res.valid
          failed.push(...res.failed.map((f) => ({ ...f, index: sendIdx[f.index + at] })))
        }
        failed.sort((a, b) => a.index - b.index)
        setPlans((ps) =>
          ps.map((p, j) => (j === i ? { ...p, check: { valid, updated, inserted, failed } } : p)),
        )
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Check failed')
    } finally {
      setBusy(null)
    }
  }

  async function runImport() {
    setError(null)
    setBusy('Importing…')
    try {
      for (const [i, plan] of plans.entries()) {
        if (plan.mode === 'skip') continue
        const sheet = sheets[i]
        let rows: CoercedRow[]
        if (plan.mode === 'new') {
          await api.post('/api/doctype', {
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
          rows = newTableRows(sheet, plan)
        } else {
          rows = mappedRows(sheet, plan)
        }
        const { send, sendIdx, dupFailed } =
          plan.mode === 'existing' ? splitForSend(rows, plan.key) : splitForSend(rows, null)
        let inserted = 0
        let updated = 0
        const failed: { index: number; message: string }[] = [...dupFailed]
        const parts = Math.ceil(send.length / IMPORT_CHUNK)
        for (let at = 0; at < send.length; at += IMPORT_CHUNK) {
          const chunk = send.slice(at, at + IMPORT_CHUNK)
          setBusy(`${plan.table}: importing rows ${at + 1}–${at + chunk.length} of ${send.length}…`)
          const res = await api.post<{
            inserted: number
            updated?: number
            failed: { index: number; message: string }[]
          }>(`/api/table/${encodeURIComponent(plan.table)}:import`, {
            rows: chunk,
            ...(plan.mode === 'existing' ? upsertArgs(plan) : {}),
            // IMP-011: recorded in the Import Log alongside the counts.
            context: {
              file_name: fileName ?? undefined,
              sheet_name: sheet.sheetName,
              table_created: plan.mode === 'new' && at === 0,
              part: Math.floor(at / IMPORT_CHUNK) + 1,
              parts,
            },
          })
          inserted += res.inserted
          updated += res.updated ?? 0
          failed.push(...res.failed.map((f) => ({ ...f, index: sendIdx[f.index + at] })))
        }
        failed.sort((a, b) => a.index - b.index)
        setPlans((ps) =>
          ps.map((p, j) => (j === i ? { ...p, result: { updated, inserted, failed } } : p)),
        )
      }
      await queryClient.invalidateQueries({ queryKey: ['tables'] })
      await queryClient.invalidateQueries({ queryKey: ['import-targets'] })
      setDone(true)
      const active = plans.filter((p) => p.mode !== 'skip')
      if (active.length === 1) {
        navigate({
          to: '/admin/$doctype',
          params: { doctype: active[0].table },
          search: { filters: undefined },
        })
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed')
    } finally {
      setBusy(null)
    }
  }

  const anyChecked = plans.some((p) => p.check)
  const blockingProblems = plans.reduce((n, p) => n + (p.check?.failed.length ?? 0), 0)

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
        {fileName ? (
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

      {sheets.map((sheet, i) => {
        const plan = plans[i]
        if (!plan) return null
        const targetCols = targets.data?.find((t) => t.name === plan.table)?.columns ?? []
        const mappedCount = plan.mapping.filter((m, idx) => m && plan.include[idx]).length
        return (
          <div key={sheet.sheetName + i} className="fc-card mb-4 p-3" data-testid={`iw-sheet-${i}`}>
            <div className="mb-2 flex items-center justify-between">
              {/* The counts describe the FILE's sheet, never the target
                  Table — say so, since sheet and Table often share a name
                  and the Table's own count sits beside the picker. */}
              <div className="text-sm font-semibold text-[var(--color-ink)]">
                Sheet "{sheet.sheetName}"{' '}
                <span className="font-normal text-gray-500">
                  — {countDataRows(sheet.rows)} rows, {sheet.headers.length} columns in the file
                </span>
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

            {plan.mode === 'skip' ? (
              <p className="text-sm text-gray-400" data-testid={`iw-skipped-${i}`}>
                This sheet will not be imported.
              </p>
            ) : plan.mode === 'new' ? (
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
                            <option value="name">Row ID</option>
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
                    if (col === 'name') return 'Row ID'
                    const c = targetCols.find((tc) => tc.column_name === col)
                    return c?.label && c.label !== c.column_name
                      ? `${c.label} · ${c.column_name}`
                      : col
                  }
                  // The suggestion speaks the column's friendly name — "Match
                  // on Zone Name, as last time" (UPS-J1.2), not the select's
                  // disambiguated idiom.
                  const friendly = (col: string) =>
                    col === 'name'
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
                      .map((f) => `row ${excelRow(f.index, sheet.headerExcelRow)}: ${f.message}`)
                      .join('; ')}
                    {plan.check.failed.length > 5 && ` … and ${plan.check.failed.length - 5} more`}
                  </span>
                )}
              </div>
            )}
            {plan.result && (
              <div className="mt-2 text-sm" data-testid={`iw-result-${i}`}>
                {/* UPS-J1.5: completion reports updated / inserted / failed
                    as separate counts — never one blended number. */}
                <span className={plan.result.failed.length ? 'text-red-600' : 'text-green-700'}>
                  {plan.result.updated > 0
                    ? `Updated ${plan.result.updated} and added ${plan.result.inserted} rows in `
                    : `Imported ${plan.result.inserted} rows into `}
                  <Link
                    to="/admin/$doctype"
                    params={{ doctype: plan.table }}
                    search={{ filters: undefined }}
                    className="underline"
                  >
                    {plan.table}
                  </Link>
                  {plan.result.failed.length > 0 &&
                    `; ${plan.result.failed.length} failed (first: row ${excelRow(
                      plan.result.failed[0].index,
                      sheet.headerExcelRow,
                    )}: ${plan.result.failed[0].message})`}
                </span>
              </div>
            )}
          </div>
        )
      })}

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
      {done && (
        <p className="mt-2 text-sm text-green-700" data-testid="iw-done">
          Import complete.{' '}
          <Link
            to="/admin/$doctype"
            params={{ doctype: 'Import Log' }}
            search={{ filters: undefined }}
            className="underline"
            data-testid="iw-history-link"
          >
            View import history
          </Link>
        </p>
      )}

      {sheets.length > 0 && !done && (
        <div className="mt-4 flex items-center gap-2">
          {plans.some((p) => p.mode === 'existing') && (
            <button
              onClick={runCheck}
              disabled={!!busy}
              data-testid="iw-check"
              className="fc-btn disabled:opacity-40"
            >
              Check
            </button>
          )}
          <button
            onClick={runImport}
            disabled={!!busy || plans.every((p) => p.mode === 'skip')}
            data-testid="iw-import"
            className="fc-btn-primary disabled:opacity-40"
          >
            {anyChecked && blockingProblems > 0
              ? `Import anyway (skip ${blockingProblems} bad rows)`
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

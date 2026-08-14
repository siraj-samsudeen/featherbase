import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { coerceRows, idPatternFor, inferTableDef, seriesPrefix, tableNameFromFile } from 'shared'
import { ApiError, api } from '../lib/api'
import { NamingControl } from '../components/NamingControl'
import { ColumnCards } from '../components/ColumnCards'
import { PasteColumns, type PastedColumn } from '../components/PasteColumns'
import { COLUMN_TYPES } from '../lib/meta'
import {
  type BuilderColumn,
  TARGET_REQUIRED_TYPES,
  blankColumn,
  checkColumn,
  slugify,
} from '../lib/column-rules'
import {
  countDataRows,
  excelRow,
  isBlankRow,
  isImportableFile,
  parseWorkbook,
} from '../lib/parse-file'
import { sendImportRun } from '../lib/import-run'

// A column as SENT: its grid row travels with it. The payload drops
// blank-named rows, so the server's `columns.<n>` counts a different list
// than the user is looking at — sourceIndex is the way back, the same
// shape #115 gave imported rows rather than re-deriving the offset.
type KeptColumn = BuilderColumn & { sourceIndex: number }

function keptColumns(columns: BuilderColumn[]): KeptColumn[] {
  return columns
    .map((c, sourceIndex) => ({ ...c, sourceIndex }))
    .filter((c) => c.column_name.trim())
}

const COLUMN_PATH = /^columns\.(\d+)(?:\..+)?$/

// Paths that are not a column are already plain field names; give them the
// user's word for the control rather than the payload key.
const TOP_LEVEL_LABEL: Record<string, string> = {
  name: 'Table name',
  module: 'Module',
  id_pattern: 'Row ID',
  columns: 'Columns',
  system: 'Table',
}

// The user's mental model must never straddle two numbering schemes
// (2026-08-11 owner directive): a server path like `columns.0.column_name`
// is translated to the grid row it came from and named by the label the
// user typed. Returns the per-row errors to mark inline, plus sentences
// for the banner.
function describeFieldErrors(
  fields: Record<string, string>,
  kept: KeptColumn[],
): { rows: Record<number, string>; parts: string[] } {
  const rows: Record<number, string> = {}
  const parts: string[] = []
  for (const [path, message] of Object.entries(fields)) {
    const match = COLUMN_PATH.exec(path)
    const col = match ? kept[Number(match[1])] : undefined
    if (!col) {
      const label = TOP_LEVEL_LABEL[path] ?? (path.includes('.') ? null : path)
      parts.push(label ? `${label}: ${message}` : message)
      continue
    }
    const who = col.label.trim() || col.column_name.trim()
    rows[col.sourceIndex] = rows[col.sourceIndex] ? `${rows[col.sourceIndex]}; ${message}` : message
    parts.push(`Column “${who}”: ${message}`)
  }
  return { rows, parts }
}

interface ImportedFile {
  fileName: string
  headers: string[]
  rows: unknown[][] // sheet geometry, blanks included (#115)
  headerExcelRow: number
}

type BuilderView = 'grid' | 'cards'

// #151: fc-input's tokens at table density, so the grid and the cards read
// as one design. (fc-input itself is px-3 py-1.5 — too tall for grid rows.)
const CELL_INPUT =
  'w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-ink)] outline-none transition placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20'

// The kicker style shared with the cards view's "COLUMN n" headers.
const KICKER = 'text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]'

const VIEW_KEY = 'fc-table-builder-view'

function initialView(): BuilderView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'cards' ? 'cards' : 'grid'
  } catch {
    return 'grid'
  }
}

// UI-011: build and edit Tables entirely from the Admin. Uses POST
// /api/table_def (create) and PUT /api/table_def/:name (schema sync).
// IMP-006: dropping a CSV/Excel file infers the whole definition and
// bulk-imports the file's rows via POST /api/table/:table:import.
// #151: the column list has two views over one state — the grid (power
// view, full engine type list) and cards (guided, friendly type chips) —
// plus a paste-a-list entry box. The database identifier derives from the
// label until the user claims it, and the mirrored server rules run
// inline as advisory hints; the server round-trip (#128) stays the
// authority and is never blocked client-side.
export function TableBuilder() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  // null = follow the Table name (ZONE-.###); a string = the user chose.
  const [namingOverride, setNamingOverride] = useState<string | null>(null)
  // #74: user tables get a real module (default "Custom"). Omitting it used
  // to let the server default the table into 'Core', mis-filing it among the
  // platform tables in the sidebar.
  const [module, setModule] = useState('Custom')
  const [columns, setColumns] = useState<BuilderColumn[]>([blankColumn()])
  const [view, setView] = useState<BuilderView>(initialView)
  const [imported, setImported] = useState<ImportedFile | null>(null)
  const [moreSheets, setMoreSheets] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Field-level SERVER errors, keyed by GRID row — the same mechanism
  // FormView uses (`if (err.fields) setErrors(err.fields)`), so the two
  // pages report a rejected save the one way.
  const [columnErrors, setColumnErrors] = useState<Record<number, string>>({})
  // Rows the user has left (blurred) — only those show the advisory client
  // verdicts, so nobody is scolded mid-word.
  const [touchedRows, setTouchedRows] = useState<Set<number>>(new Set())
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  // The offending input, so a rejected create moves the caret there instead
  // of leaving a screen-reader user with no idea where the fault is.
  const nameInputs = useRef(new Map<number, HTMLInputElement>())
  const [focusRow, setFocusRow] = useState<number | null>(null)

  useEffect(() => {
    if (focusRow == null) return
    nameInputs.current.get(focusRow)?.focus()
    setFocusRow(null)
  }, [focusRow])

  // #151: advisory mirror of the server's rules (see lib/column-rules.ts).
  const verdicts = useMemo(
    () => columns.map((c) => checkColumn(c, columns, name)),
    [columns, name],
  )

  function setBuilderView(v: BuilderView) {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* private mode — the toggle still works, it just doesn't persist */
    }
  }

  // The accusation dies with the correction, not at the next submit: editing
  // a flagged row clears its mark, and the banner goes with the last one.
  function clearColumnError(i: number) {
    if (!(i in columnErrors)) return
    const rest = { ...columnErrors }
    delete rest[i]
    setColumnErrors(rest)
    if (Object.keys(rest).length === 0) setError(null)
  }

  // Adding or removing a row shifts every index below it, so marks keyed by
  // row would start accusing the wrong column. Drop them all instead.
  function clearAllColumnErrors() {
    setTouchedRows(new Set())
    if (Object.keys(columnErrors).length === 0) return
    setColumnErrors({})
    setError(null)
  }

  function setColumn(i: number, patch: Partial<BuilderColumn>) {
    setColumns((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)))
    clearColumnError(i)
  }

  // #151: the identifier follows the label until the user claims it.
  function setColumnLabel(i: number, label: string) {
    const c = columns[i]
    setColumn(i, { label, ...(c.name_touched ? {} : { column_name: slugify(label) }) })
  }

  function markTouched(i: number) {
    setTouchedRows((t) => new Set(t).add(i))
  }

  function addColumn() {
    setColumns((cs) => [...cs, blankColumn()])
    clearAllColumnErrors()
  }

  function removeColumn(i: number) {
    setColumns((cs) => cs.filter((_, j) => j !== i))
    clearAllColumnErrors()
  }

  function addPastedColumns(pasted: PastedColumn[]) {
    setColumns((cs) => [
      ...cs.filter((c) => c.column_name.trim() || c.label.trim()),
      ...pasted.map((p, i) => ({
        ...blankColumn(),
        label: p.label,
        column_name: p.column_name,
        column_type: p.column_type,
        in_list_view: cs.filter((c) => c.column_name.trim()).length + i < 4,
        name_touched: true,
      })),
    ])
    clearAllColumnErrors()
  }

  // Before a name is typed there is no prefix to derive, but the control should
  // still open on "series" — that is the default we want for imports.
  const idPattern = namingOverride ?? (name.trim() ? idPatternFor(name) : '.###')

  async function loadFile(file: File) {
    setError(null)
    setColumnErrors({})
    setTouchedRows(new Set())
    if (!isImportableFile(file.name)) {
      setError(`${file.name}: not a CSV or Excel file`)
      return
    }
    try {
      const sheets = await parseWorkbook(file)
      const { headers, rows, headerExcelRow } = sheets[0]
      // The quick builder handles one sheet; the Import wizard handles all.
      setMoreSheets(sheets.length > 1 ? sheets.length : 0)
      const def = inferTableDef(tableNameFromFile(file.name) || 'Imported Table', headers, rows)
      setImported({ fileName: file.name, headers, rows, headerExcelRow })
      setName((n) => n.trim() || def.name)
      setColumns(
        def.columns.map((c, i) => ({
          column_name: c.column_name,
          label: c.label ?? '',
          column_type: c.column_type,
          // Detected Choice options surface in the grid's target field,
          // editable like hand-entered ones.
          target: c.choices ? c.choices.split('\n').join(', ') : '',
          reqd: false,
          in_list_view: c.in_list_view ?? false,
          source_index: i,
          // An inferred identifier is already claimed — editing the label
          // must not silently rename an imported column.
          name_touched: true,
        })),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the file')
    }
  }

  function clearImport() {
    setImported(null)
    setMoreSheets(0)
    setColumns([blankColumn()])
    setColumnErrors({})
    setTouchedRows(new Set())
    setProgress(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  async function create() {
    setError(null)
    setColumnErrors({})
    setSaving(true)
    // Hoisted out of the try: the catch needs the SENT list to read the
    // server's indices back onto the grid.
    const kept = keptColumns(columns)
    try {
      const payload = {
        name,
        id_pattern: idPattern,
        module: module.trim() || 'Custom',
        columns: kept.map((c) => {
          const target = c.target.trim()
            ? c.target
                .split(/[\n,]/)
                .map((o) => o.trim())
                .filter(Boolean)
                .join('\n')
            : undefined
          return {
            column_name: c.column_name.trim(),
            label: c.label.trim() || undefined,
            column_type: c.column_type,
            reference_table: c.column_type === 'Reference' ? target : undefined,
            choices: c.column_type === 'Choice' ? target : undefined,
            row_table: c.column_type === 'Sub-table' ? target : undefined,
            reqd: c.reqd,
            in_list_view: c.in_list_view,
          }
        }),
      }
      await api.post('/api/table_def', payload)

      if (imported) {
        const importCols = kept.filter((c) => c.source_index !== null)
        const rows = coerceRows(
          importCols.map((c) => ({ column_name: c.column_name.trim(), column_type: c.column_type })),
          imported.rows.map((r) => importCols.map((c) => r[c.source_index!])),
        )
        // IMP-I1 disclosure: data rows with nothing in any imported column
        // are sent nowhere — named below rather than silently absorbed.
        const skipped = countDataRows(imported.rows) - rows.length
        const { inserted, failed } = await sendImportRun({
          table: name,
          rows,
          onChunk: ({ from, to, total }) =>
            setProgress(`Importing rows ${from}–${to} of ${total}…`),
        })
        setProgress(null)
        if (failed.length) {
          setError(
            `Table created; ${inserted} of ${rows.length} rows imported. ` +
              `Failed rows: ${failed
                .slice(0, 3)
                .map((f) => `#${excelRow(f.sourceIndex, imported.headerExcelRow)} (${f.message})`)
                .join('; ')}${failed.length > 3 ? ` and ${failed.length - 3} more` : ''}` +
              (skipped > 0
                ? ` ${skipped} rows had no data in the imported columns and were skipped.`
                : ''),
          )
          await queryClient.invalidateQueries({ queryKey: ['tables'] })
          await queryClient.invalidateQueries({ queryKey: ['home-pages'] })
          setSaving(false)
          return
        }
      }

      await queryClient.invalidateQueries({ queryKey: ['tables'] })
      // #80: the new table auto-appears on its module's home page — refresh
      // the sidebar so that happens without a reload.
      await queryClient.invalidateQueries({ queryKey: ['home-pages'] })
      navigate({ to: '/admin/$table', params: { table: name }, search: { filters: undefined } })
    } catch (err) {
      setProgress(null)
      if (err instanceof ApiError && err.fields) {
        const { rows, parts } = describeFieldErrors(err.fields, kept)
        setColumnErrors(rows)
        setError(parts.length ? `${err.message} — ${parts.join('; ')}` : err.message)
        const first = Object.keys(rows)
          .map(Number)
          .sort((a, b) => a - b)[0]
        if (first !== undefined) setFocusRow(first)
      } else {
        setError(err instanceof ApiError ? err.message : 'Create failed')
      }
    } finally {
      setSaving(false)
    }
  }

  // #115: blanks survive parsing for row-number truth but are not data —
  // neither previewed nor counted anywhere the user reads.
  const dataRows = imported ? countDataRows(imported.rows) : 0
  const previewRows = imported ? imported.rows.filter((r) => !isBlankRow(r)).slice(0, 8) : []
  const previewCols = columns.filter((c) => c.source_index !== null && c.column_name.trim())

  // Server error wins the row's message slot; the client verdict is the
  // advisory fallback shown once the row has been visited.
  function rowMessage(i: number): { text: string; fix?: string } | null {
    if (columnErrors[i]) return { text: columnErrors[i] }
    const v = touchedRows.has(i) ? verdicts[i] : null
    return v && columns[i].column_name.trim() ? { text: v.error, fix: v.fix } : null
  }

  const namingColumns = columns
    .filter((c) => c.column_name.trim())
    .map((c) => ({
      column_name: c.column_name.trim(),
      label: c.label.trim() || c.column_name.trim(),
    }))

  return (
    <div data-testid="table-builder" className="max-w-3xl">
      <h1 className="mb-4 text-xl font-semibold text-[var(--color-ink)]">New Table</h1>

      <div
        data-testid="dt-dropzone"
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
        className={`mb-4 cursor-pointer rounded-md border-2 border-dashed px-4 py-5 text-center text-sm transition-colors ${
          dragging
            ? 'border-[var(--color-brand)] bg-[var(--color-brand)]/5 text-[var(--color-brand)]'
            : 'border-[var(--color-border-strong)] text-[var(--color-ink-muted)] hover:border-[var(--color-brand)]'
        }`}
      >
        {imported ? (
          <span data-testid="dt-file-name">
            <strong>{imported.fileName}</strong> — {dataRows} rows,{' '}
            {imported.headers.length} columns detected{' '}
            <button
              data-testid="dt-clear-file"
              onClick={(e) => {
                e.stopPropagation()
                clearImport()
              }}
              className="ml-1 text-[var(--color-ink-faint)] hover:text-[var(--color-danger)]"
              aria-label="Remove file"
            >
              ×
            </button>
          </span>
        ) : (
          <>Drag & drop a CSV or Excel file here to build the Table from it — or click to browse</>
        )}
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.tsv,.xlsx,.xlsm,.xls"
          data-testid="dt-file-input"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void loadFile(file)
          }}
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-4">
        <div>
          <label className="fc-label">Table name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="dt-name"
            placeholder="e.g. Project"
            className="fc-input max-w-sm"
          />
        </div>
        <div>
          <label className="fc-label">Module</label>
          <input
            value={module}
            onChange={(e) => setModule(e.target.value)}
            data-testid="dt-module"
            placeholder="Custom"
            className="fc-input max-w-48"
          />
        </div>
      </div>

      <div className="mb-1 flex items-end justify-between gap-4">
        {/* #151: B's paste box folds in above the grid — an entry
            accelerator, not a mode. Hidden while a file drives the columns. */}
        <div>{!imported && <PasteColumns onBuild={addPastedColumns} />}</div>
        <div
          className="mb-3 inline-flex overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-border-strong)] text-xs"
          role="group"
          aria-label="Column editor view"
        >
          <button
            data-testid="dt-view-grid"
            onClick={() => setBuilderView('grid')}
            className={`px-3 py-1 font-medium transition ${
              view === 'grid'
                ? 'bg-[var(--color-brand)] text-white'
                : 'bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:bg-[var(--color-subtle)]'
            }`}
          >
            Grid
          </button>
          <button
            data-testid="dt-view-cards"
            onClick={() => setBuilderView('cards')}
            className={`px-3 py-1 font-medium transition ${
              view === 'cards'
                ? 'bg-[var(--color-brand)] text-white'
                : 'bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:bg-[var(--color-subtle)]'
            }`}
          >
            Cards
          </button>
        </div>
      </div>

      {view === 'grid' && (
        <div className="fc-card overflow-x-auto">
          <table className="w-full text-sm" data-testid="dt-fields">
            <thead className="bg-[var(--color-subtle)] text-left">
              <tr>
                <th className={`px-3 py-2 ${KICKER}`}>Field label</th>
                <th className={`px-2 py-2 ${KICKER}`}>
                  Database name <span className="font-normal normal-case tracking-normal">(auto)</span>
                </th>
                <th className={`px-2 py-2 ${KICKER}`}>Type</th>
                <th className={`px-2 py-2 ${KICKER}`}>Details</th>
                <th className={`px-2 py-2 ${KICKER}`} title="Must be filled in every row">Reqd</th>
                <th className={`px-2 py-2 ${KICKER}`} title="Shown in the list view">List</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {/* NAM-001: the row id is column one, matching the Import Wizard.
                  Every record has an id; where it comes from is the same kind of
                  decision as any other column's. Always present, never removed. */}
              <tr
                className="border-t border-[var(--color-border)] bg-[var(--color-brand)]/5"
                data-testid="dt-row-id"
              >
                <td className="px-3 py-2 align-baseline text-[var(--color-ink-muted)]">Row ID</td>
                <td className="px-2 py-2" colSpan={5}>
                  <NamingControl
                    value={idPattern}
                    onChange={setNamingOverride}
                    defaultPrefix={seriesPrefix(name)}
                    columns={namingColumns}
                  />
                </td>
                <td className="px-2 text-center text-[var(--color-ink-faint)]" title="always present">
                  🔒
                </td>
              </tr>
              {columns.map((c, i) => {
                const msg = rowMessage(i)
                return (
                  /* data-columnrow marks the editable column rows: specs address
                     these, so a decorative row (Row ID, and anything added later)
                     can never shift the indices they read. */
                  <tr key={i} className="border-t border-[var(--color-border)] align-top" data-columnrow="">
                    <td className="px-3 py-2">
                      <input
                        value={c.label}
                        onChange={(e) => setColumnLabel(i, e.target.value)}
                        onBlur={() => markTouched(i)}
                        data-rowfield="label"
                        placeholder="e.g. Date of Birth"
                        className={CELL_INPUT}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        value={c.column_name}
                        onChange={(e) => setColumn(i, { column_name: e.target.value, name_touched: true })}
                        onBlur={() => markTouched(i)}
                        data-rowfield="column_name"
                        ref={(el) => {
                          if (el) nameInputs.current.set(i, el)
                          else nameInputs.current.delete(i)
                        }}
                        aria-invalid={msg ? true : undefined}
                        aria-describedby={msg ? `dt-col-error-${i}` : undefined}
                        className={`${CELL_INPUT} font-mono text-xs ${
                          msg ? 'border-[var(--color-danger)]' : ''
                        } ${c.name_touched || c.column_name ? '' : 'bg-[var(--color-subtle)]'}`}
                      />
                      {msg && (
                        <p
                          id={`dt-col-error-${i}`}
                          data-testid={`dt-col-error-${i}`}
                          className="mt-1 rounded-[var(--radius-control)] bg-[var(--color-danger-tint)] px-2 py-1 text-xs text-[var(--color-danger)]"
                        >
                          {msg.text}
                          {msg.fix && (
                            <>
                              {' '}
                              <button
                                onClick={() => setColumn(i, { column_name: msg.fix, name_touched: true })}
                                className="font-semibold underline"
                              >
                                Use “{msg.fix}”
                              </button>
                            </>
                          )}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <select
                        value={c.column_type}
                        onChange={(e) => setColumn(i, { column_type: e.target.value })}
                        data-rowfield="column_type"
                        className={CELL_INPUT}
                      >
                        {COLUMN_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <input
                        value={c.target}
                        onChange={(e) => setColumn(i, { target: e.target.value })}
                        onBlur={() => markTouched(i)}
                        data-rowfield="target"
                        placeholder={
                          c.column_type === 'Choice'
                            ? 'Choices: Small, Medium…'
                            : c.column_type === 'Reference'
                              ? 'Which table?'
                              : c.column_type === 'Sub-table'
                                ? 'Which sub-table?'
                                : ''
                        }
                        disabled={!TARGET_REQUIRED_TYPES.includes(c.column_type)}
                        className={`${CELL_INPUT} disabled:border-transparent disabled:bg-transparent`}
                      />
                    </td>
                    <td className="px-2 py-2 text-center align-middle">
                      <input
                        type="checkbox"
                        checked={c.reqd}
                        onChange={(e) => setColumn(i, { reqd: e.target.checked })}
                        data-rowfield="reqd"
                        className="accent-[var(--color-brand)]"
                      />
                    </td>
                    <td className="px-2 py-2 text-center align-middle">
                      <input
                        type="checkbox"
                        checked={c.in_list_view}
                        onChange={(e) => setColumn(i, { in_list_view: e.target.checked })}
                        data-rowfield="in_list_view"
                        className="accent-[var(--color-brand)]"
                      />
                    </td>
                    <td className="px-2 py-2 text-center align-middle">
                      <button
                        aria-label="Remove column"
                        onClick={() => removeColumn(i)}
                        className="rounded px-1.5 text-sm text-[var(--color-ink-faint)] transition hover:bg-[var(--color-subtle)] hover:text-[var(--color-danger)]"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <button
            onClick={addColumn}
            data-testid="dt-add-field"
            className="w-full border-t border-[var(--color-border)] px-3 py-1.5 text-left text-xs font-medium text-[var(--color-ink-muted)] transition hover:bg-[var(--color-subtle)] hover:text-[var(--color-brand)]"
          >
            + Add column
          </button>
        </div>
      )}

      {view === 'cards' && (
        <div className="space-y-3">
          <div className="fc-card p-5">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
              Row ID
            </div>
            <NamingControl
              value={idPattern}
              onChange={setNamingOverride}
              defaultPrefix={seriesPrefix(name)}
              columns={namingColumns}
            />
          </div>
          <ColumnCards
            columns={columns}
            verdicts={columns.map((_, i) => {
              const msg = rowMessage(i)
              return msg ? { error: msg.text, fix: msg.fix } : null
            })}
            onPatch={(i, p) => {
              setColumn(i, p)
              markTouched(i)
            }}
            onRemove={removeColumn}
            onAdd={addColumn}
          />
        </div>
      )}

      {imported && previewCols.length > 0 && (
        <div className="fc-card mt-4 overflow-x-auto">
          <div className={`border-b border-[var(--color-border)] px-3 py-2 ${KICKER}`}>
            Data preview{' '}
            {dataRows > previewRows.length &&
              `(first ${previewRows.length} of ${dataRows} rows)`}
          </div>
          <table className="w-full text-sm" data-testid="dt-preview">
            <thead className="bg-[var(--color-subtle)] text-left text-xs text-[var(--color-ink-muted)]">
              <tr>
                {previewCols.map((c) => (
                  <th key={c.column_name} className="px-2 py-1">
                    {c.label || c.column_name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((r, ri) => (
                <tr key={ri} className="border-t border-[var(--color-border)]">
                  {previewCols.map((c) => {
                    const v = r[c.source_index!]
                    return (
                      <td key={c.column_name} className="px-2 py-1 text-[var(--color-ink-muted)]">
                        {v instanceof Date ? v.toLocaleDateString() : v == null ? '' : String(v)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {moreSheets > 1 && (
        <p className="mt-3 text-sm text-[var(--color-ink-muted)]" data-testid="dt-more-sheets">
          This workbook has {moreSheets} sheets — only the first is used here. The{' '}
          <Link to="/admin/import" search={{ table: undefined }} className="text-[var(--color-brand)] underline">
            Import wizard
          </Link>{' '}
          imports every sheet.
        </p>
      )}
      {progress && (
        <p className="mt-3 text-sm text-[var(--color-ink-muted)]" data-testid="dt-progress">
          {progress}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-3 rounded border border-[var(--color-danger)] bg-[var(--color-danger-tint)] px-2 py-1.5 text-sm text-[var(--color-danger)]"
          data-testid="dt-error"
        >
          {error}
        </p>
      )}

      <button
        onClick={create}
        disabled={saving || !name.trim()}
        data-testid="dt-create"
        className="fc-btn-primary mt-4 disabled:opacity-40"
      >
        {saving
          ? 'Creating…'
          : imported
            ? `Create Table & Import ${dataRows} rows`
            : 'Create Table'}
      </button>
    </div>
  )
}

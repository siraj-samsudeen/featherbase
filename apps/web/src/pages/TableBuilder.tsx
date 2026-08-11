import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { coerceRows, idPatternFor, inferTableDef, seriesPrefix, tableNameFromFile } from 'shared'
import { ApiError, api } from '../lib/api'
import { NamingControl } from '../components/NamingControl'
import { COLUMN_TYPES } from '../lib/meta'
import {
  countDataRows,
  excelRow,
  isBlankRow,
  isImportableFile,
  parseWorkbook,
} from '../lib/parse-file'
import { sendImportRun } from '../lib/import-run'

interface ColumnRow {
  column_name: string
  label: string
  column_type: string
  // Entered comma-/newline-separated; split into reference_table/choices/row_table
  // on submit depending on column_type.
  target: string
  reqd: boolean
  in_list_view: boolean
  // Index into the imported file's header row; null for hand-added columns.
  source_index: number | null
}

const blank = (): ColumnRow => ({
  column_name: '',
  label: '',
  column_type: 'Data',
  target: '',
  reqd: false,
  in_list_view: false,
  source_index: null,
})

const TARGET_REQUIRED_TYPES = ['Choice', 'Reference', 'Sub-table']

// A column as SENT: its grid row travels with it. The payload drops
// blank-named rows, so the server's `columns.<n>` counts a different list
// than the user is looking at — sourceIndex is the way back, the same
// shape #115 gave imported rows rather than re-deriving the offset.
type KeptColumn = ColumnRow & { sourceIndex: number }

function keptColumns(columns: ColumnRow[]): KeptColumn[] {
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

// UI-011: build and edit Tables entirely from the Admin. Uses POST
// /api/doctype (create) and PUT /api/doctype/:name (schema sync).
// IMP-006: dropping a CSV/Excel file infers the whole definition and
// bulk-imports the file's rows via POST /api/table/:table:import.
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
  const [columns, setColumns] = useState<ColumnRow[]>([blank()])
  const [imported, setImported] = useState<ImportedFile | null>(null)
  const [moreSheets, setMoreSheets] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Field-level server errors, keyed by GRID row — the same mechanism
  // FormView uses (`if (err.fields) setErrors(err.fields)`), so the two
  // pages report a rejected save the one way.
  const [columnErrors, setColumnErrors] = useState<Record<number, string>>({})
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
    if (Object.keys(columnErrors).length === 0) return
    setColumnErrors({})
    setError(null)
  }

  function setColumn(i: number, patch: Partial<ColumnRow>) {
    setColumns((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)))
    clearColumnError(i)
  }

  // Before a name is typed there is no prefix to derive, but the control should
  // still open on "series" — that is the default we want for imports.
  const idPattern = namingOverride ?? (name.trim() ? idPatternFor(name) : '.###')

  async function loadFile(file: File) {
    setError(null)
    setColumnErrors({})
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
          label: c.label,
          column_type: c.column_type,
          // Detected Choice options surface in the grid's target field,
          // editable like hand-entered ones.
          target: c.choices ? c.choices.split('\n').join(', ') : '',
          reqd: false,
          in_list_view: c.in_list_view,
          source_index: i,
        })),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the file')
    }
  }

  function clearImport() {
    setImported(null)
    setMoreSheets(0)
    setColumns([blank()])
    setColumnErrors({})
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
      await api.post('/api/doctype', payload)

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
      navigate({ to: '/admin/$doctype', params: { doctype: name }, search: { filters: undefined } })
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

  return (
    <div data-testid="doctype-builder" className="max-w-3xl">
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
            ? 'border-[var(--color-brand)] bg-blue-50 text-[var(--color-brand)]'
            : 'border-[var(--color-hairline-strong,#d1d8dd)] text-gray-500 hover:border-[var(--color-brand)]'
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
              className="ml-1 text-gray-400 hover:text-red-600"
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

      <div className="fc-card overflow-x-auto">
        <table className="w-full text-sm" data-testid="dt-fields">
          <thead className="bg-gray-50 text-left text-xs text-gray-600">
            <tr>
              <th className="px-2 py-1">Column Name</th>
              <th className="px-2 py-1">Label</th>
              <th className="px-2 py-1">Column Type</th>
              <th className="px-2 py-1">Target</th>
              <th className="px-2 py-1">Reqd</th>
              <th className="px-2 py-1">List</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {/* NAM-001: the row id is column one, matching the Import Wizard.
                Every record has an id; where it comes from is the same kind of
                decision as any other column's. Always present, never removed. */}
            <tr className="border-t border-gray-100 bg-blue-50/60" data-testid="dt-row-id">
              <td className="px-2 py-1 align-baseline text-gray-500">Row ID</td>
              <td className="px-1 py-1" colSpan={5}>
                <NamingControl
                  value={idPattern}
                  onChange={setNamingOverride}
                  defaultPrefix={seriesPrefix(name)}
                  columns={columns
                    .filter((c) => c.column_name.trim())
                    .map((c) => ({
                      column_name: c.column_name.trim(),
                      label: c.label.trim() || c.column_name.trim(),
                    }))}
                />
              </td>
              <td className="px-1 text-center text-gray-300" title="always present">
                🔒
              </td>
            </tr>
            {columns.map((c, i) => (
              /* data-columnrow marks the editable column rows: specs address
                 these, so a decorative row (Row ID, and anything added later)
                 can never shift the indices they read. */
              <tr key={i} className="border-t border-gray-100" data-columnrow="">
                <td className="px-1 py-1">
                  <input
                    value={c.column_name}
                    onChange={(e) => setColumn(i, { column_name: e.target.value })}
                    data-rowfield="column_name"
                    ref={(el) => {
                      if (el) nameInputs.current.set(i, el)
                      else nameInputs.current.delete(i)
                    }}
                    aria-invalid={columnErrors[i] ? true : undefined}
                    aria-describedby={columnErrors[i] ? `dt-col-error-${i}` : undefined}
                    className={`w-full rounded border px-1 py-0.5 ${
                      columnErrors[i] ? 'border-[var(--color-danger)]' : 'border-gray-200'
                    }`}
                  />
                  {columnErrors[i] && (
                    <p
                      id={`dt-col-error-${i}`}
                      data-testid={`dt-col-error-${i}`}
                      className="mt-0.5 text-xs text-[var(--color-danger)]"
                    >
                      {columnErrors[i]}
                    </p>
                  )}
                </td>
                <td className="px-1 py-1">
                  <input
                    value={c.label}
                    onChange={(e) => setColumn(i, { label: e.target.value })}
                    data-rowfield="label"
                    className="w-full rounded border border-gray-200 px-1 py-0.5"
                  />
                </td>
                <td className="px-1 py-1">
                  <select
                    value={c.column_type}
                    onChange={(e) => setColumn(i, { column_type: e.target.value })}
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
                <td className="px-1 py-1">
                  <input
                    value={c.target}
                    onChange={(e) => setColumn(i, { target: e.target.value })}
                    data-rowfield="target"
                    placeholder={TARGET_REQUIRED_TYPES.includes(c.column_type) ? 'required' : ''}
                    className="w-full rounded border border-gray-200 px-1 py-0.5"
                  />
                </td>
                <td className="px-1 py-1 text-center">
                  <input
                    type="checkbox"
                    checked={c.reqd}
                    onChange={(e) => setColumn(i, { reqd: e.target.checked })}
                    data-rowfield="reqd"
                  />
                </td>
                <td className="px-1 py-1 text-center">
                  <input
                    type="checkbox"
                    checked={c.in_list_view}
                    onChange={(e) => setColumn(i, { in_list_view: e.target.checked })}
                    data-rowfield="in_list_view"
                  />
                </td>
                <td className="px-1 text-center">
                  <button
                    aria-label="Remove column"
                    onClick={() => {
                      setColumns((cs) => cs.filter((_, j) => j !== i))
                      clearAllColumnErrors()
                    }}
                    className="text-gray-300 hover:text-red-600"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          onClick={() => {
            setColumns((cs) => [...cs, blank()])
            clearAllColumnErrors()
          }}
          data-testid="dt-add-field"
          className="w-full border-t border-gray-100 px-2 py-1 text-left text-xs text-gray-500 hover:bg-gray-50"
        >
          + Add column
        </button>
      </div>

      {imported && previewCols.length > 0 && (
        <div className="fc-card mt-4 overflow-x-auto">
          <div className="border-b border-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
            Data preview{' '}
            {dataRows > previewRows.length &&
              `(first ${previewRows.length} of ${dataRows} rows)`}
          </div>
          <table className="w-full text-sm" data-testid="dt-preview">
            <thead className="bg-gray-50 text-left text-xs text-gray-600">
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
                <tr key={ri} className="border-t border-gray-100">
                  {previewCols.map((c) => {
                    const v = r[c.source_index!]
                    return (
                      <td key={c.column_name} className="px-2 py-1 text-gray-700">
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
        <p className="mt-3 text-sm text-gray-500" data-testid="dt-more-sheets">
          This workbook has {moreSheets} sheets — only the first is used here. The{' '}
          <Link to="/admin/import" search={{ table: undefined }} className="text-[var(--color-brand)] underline">
            Import wizard
          </Link>{' '}
          imports every sheet.
        </p>
      )}
      {progress && (
        <p className="mt-3 text-sm text-gray-500" data-testid="dt-progress">
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

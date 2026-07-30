import { useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { coerceRows, idPatternFor, inferTableDef, seriesPrefix, tableNameFromFile } from 'shared'
import { ApiError, api } from '../lib/api'
import { NamingControl } from '../components/NamingControl'
import { COLUMN_TYPES } from '../lib/meta'
import { isImportableFile, parseWorkbook } from '../lib/parse-file'

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
const IMPORT_CHUNK = 500

interface ImportedFile {
  fileName: string
  headers: string[]
  rows: unknown[][]
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
  const [columns, setColumns] = useState<ColumnRow[]>([blank()])
  const [imported, setImported] = useState<ImportedFile | null>(null)
  const [moreSheets, setMoreSheets] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)

  function setColumn(i: number, patch: Partial<ColumnRow>) {
    setColumns((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  }

  // Before a name is typed there is no prefix to derive, but the control should
  // still open on "series" — that is the default we want for imports.
  const idPattern = namingOverride ?? (name.trim() ? idPatternFor(name) : '.###')

  async function loadFile(file: File) {
    setError(null)
    if (!isImportableFile(file.name)) {
      setError(`${file.name}: not a CSV or Excel file`)
      return
    }
    try {
      const sheets = await parseWorkbook(file)
      const { headers, rows } = sheets[0]
      // The quick builder handles one sheet; the Import wizard handles all.
      setMoreSheets(sheets.length > 1 ? sheets.length : 0)
      const def = inferTableDef(tableNameFromFile(file.name) || 'Imported Table', headers, rows)
      setImported({ fileName: file.name, headers, rows })
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
    setProgress(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  async function create() {
    setError(null)
    setSaving(true)
    try {
      const kept = columns.filter((c) => c.column_name.trim())
      const payload = {
        name,
        id_pattern: idPattern,
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
        let inserted = 0
        const failed: { index: number; message: string }[] = []
        for (let at = 0; at < rows.length; at += IMPORT_CHUNK) {
          const chunk = rows.slice(at, at + IMPORT_CHUNK)
          setProgress(`Importing rows ${at + 1}–${at + chunk.length} of ${rows.length}…`)
          const res = await api.post<{
            inserted: number
            failed: { index: number; message: string }[]
          }>(`/api/table/${encodeURIComponent(name)}:import`, { rows: chunk })
          inserted += res.inserted
          failed.push(...res.failed.map((f) => ({ ...f, index: f.index + at })))
        }
        setProgress(null)
        if (failed.length) {
          setError(
            `Table created; ${inserted} of ${rows.length} rows imported. ` +
              `Failed rows: ${failed
                .slice(0, 3)
                .map((f) => `#${f.index + 2} (${f.message})`)
                .join('; ')}${failed.length > 3 ? ` and ${failed.length - 3} more` : ''}`,
          )
          await queryClient.invalidateQueries({ queryKey: ['tables'] })
          setSaving(false)
          return
        }
      }

      await queryClient.invalidateQueries({ queryKey: ['tables'] })
      navigate({ to: '/desk/$doctype', params: { doctype: name }, search: { filters: undefined } })
    } catch (err) {
      setProgress(null)
      setError(err instanceof ApiError ? err.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  const previewRows = imported ? imported.rows.slice(0, 8) : []
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
            <strong>{imported.fileName}</strong> — {imported.rows.length} rows,{' '}
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

      <label className="fc-label">Table name</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        data-testid="dt-name"
        placeholder="e.g. Project"
        className="fc-input mb-4 max-w-sm"
      />

      <label className="fc-label">Naming</label>
      <div className="mb-4">
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
            {columns.map((c, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="px-1 py-1">
                  <input
                    value={c.column_name}
                    onChange={(e) => setColumn(i, { column_name: e.target.value })}
                    data-rowfield="column_name"
                    className="w-full rounded border border-gray-200 px-1 py-0.5"
                  />
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
                    onClick={() => setColumns((cs) => cs.filter((_, j) => j !== i))}
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
          onClick={() => setColumns((cs) => [...cs, blank()])}
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
            {imported.rows.length > previewRows.length &&
              `(first ${previewRows.length} of ${imported.rows.length} rows)`}
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
          <Link to="/desk/import" search={{ table: undefined }} className="text-[var(--color-brand)] underline">
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
        <p className="mt-3 text-sm text-red-600" data-testid="dt-error">
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
            ? `Create Table & Import ${imported.rows.length} rows`
            : 'Create Table'}
      </button>
    </div>
  )
}

import { useRef, useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
// (search read non-strictly: the wizard route lives in router.tsx, which
// imports this file — a strict useSearch would need the route object back)
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  autoMapColumns,
  coerceRows,
  inferTableDef,
  scoreTableMatch,
  tableNameFromFile,
  type InferredTableDef,
} from 'shared'
import { ApiError, api, listResource } from '../lib/api'
import { COLUMN_TYPES, NO_COLUMN_TYPES, type TableMeta } from '../lib/meta'
import { isImportableFile, parseWorkbook, type ParsedSheet } from '../lib/parse-file'

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
  mode: 'new' | 'existing'
  // mode new: the Table name to create; mode existing: the target Table.
  table: string
  inferred: InferredTableDef
  // per file column: target column_name in the existing Table, or null (skip)
  mapping: (string | null)[]
  check: { valid: number; failed: { index: number; message: string }[] } | null
  result: { inserted: number; failed: { index: number; message: string }[] } | null
}

const IMPORT_CHUNK = 500

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
      setPlans(
        parsed.map((sheet) => {
          const newName =
            (parsed.length === 1 ? tableNameFromFile(file.name) : tableNameFromFile(sheet.sheetName)) ||
            'Imported Table'
          const inferred = inferTableDef(newName, sheet.headers, sheet.rows)
          // Rename-tolerant suggestion: pick the existing Table whose columns
          // the sheet's headers cover best; ?table=X wins when it fits at all.
          let best: { name: string; score: number } | null = null
          for (const t of tables) {
            const score = scoreTableMatch(sheet.headers, t.columns)
            if (!best || score > best.score) best = { name: t.name, score }
          }
          const pinned = search.table
            ? tables.find((t) => t.name === search.table)
            : undefined
          const pinnedScore = pinned ? scoreTableMatch(sheet.headers, pinned.columns) : 0
          const target =
            pinned && pinnedScore >= 0.3
              ? pinned.name
              : best && best.score >= 0.6
                ? best.name
                : null
          const targetCols = tables.find((t) => t.name === target)?.columns ?? []
          return {
            mode: target ? 'existing' : 'new',
            table: target ?? newName,
            inferred,
            mapping: target ? autoMapColumns(sheet.headers, targetCols) : [],
            check: null,
            result: null,
          } satisfies SheetPlan
        }),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the file')
    }
  }

  function retarget(i: number, value: string) {
    const sheet = sheets[i]
    if (value === '__new__') {
      const fallback =
        (sheets.length === 1 ? tableNameFromFile(fileName ?? '') : tableNameFromFile(sheet.sheetName)) ||
        'Imported Table'
      setPlan(i, { mode: 'new', table: fallback, mapping: [] })
      return
    }
    const cols = targets.data?.find((t) => t.name === value)?.columns ?? []
    setPlan(i, { mode: 'existing', table: value, mapping: autoMapColumns(sheet.headers, cols) })
  }

  // Rows for an existing-Table plan: project the mapped file columns and
  // coerce cells to the target column types.
  function mappedRows(sheet: ParsedSheet, plan: SheetPlan) {
    const cols = targets.data?.find((t) => t.name === plan.table)?.columns ?? []
    const typeOf = new Map(cols.map((c) => [c.column_name, c.column_type]))
    const picks = plan.mapping
      .map((target, idx) => (target ? { idx, target } : null))
      .filter((p): p is { idx: number; target: string } => p !== null)
    return coerceRows(
      picks.map((p) => ({ column_name: p.target, column_type: typeOf.get(p.target) ?? 'Data' })),
      sheet.rows.map((r) => picks.map((p) => r[p.idx])),
    )
  }

  // Rows for a new-Table plan: 1:1 with the inferred (possibly renamed)
  // columns; blank-named columns are dropped.
  function newTableRows(sheet: ParsedSheet, plan: SheetPlan) {
    const picks = plan.inferred.columns
      .map((c, idx) => (c.column_name.trim() ? { idx, c } : null))
      .filter((p): p is { idx: number; c: (typeof plan.inferred.columns)[number] } => p !== null)
    return coerceRows(
      picks.map((p) => ({ column_name: p.c.column_name.trim(), column_type: p.c.column_type })),
      sheet.rows.map((r) => picks.map((p) => r[p.idx])),
    )
  }

  async function runCheck() {
    setError(null)
    setBusy('Checking…')
    try {
      for (const [i, plan] of plans.entries()) {
        if (plan.mode !== 'existing') continue
        const rows = mappedRows(sheets[i], plan)
        if (!rows.length) {
          setPlan(i, { check: { valid: 0, failed: [] } })
          continue
        }
        const failed: { index: number; message: string }[] = []
        let valid = 0
        for (let at = 0; at < rows.length; at += IMPORT_CHUNK) {
          const chunk = rows.slice(at, at + IMPORT_CHUNK)
          const res = await api.post<{
            valid: number
            failed: { index: number; message: string }[]
          }>(`/api/table/${encodeURIComponent(plan.table)}:import`, {
            rows: chunk,
            dry_run: true,
          })
          valid += res.valid
          failed.push(...res.failed.map((f) => ({ ...f, index: f.index + at })))
        }
        setPlans((ps) => ps.map((p, j) => (j === i ? { ...p, check: { valid, failed } } : p)))
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
        const sheet = sheets[i]
        let rows: Record<string, unknown>[]
        if (plan.mode === 'new') {
          await api.post('/api/doctype', {
            name: plan.table,
            columns: plan.inferred.columns
              .filter((c) => c.column_name.trim())
              .map((c) => ({
                column_name: c.column_name.trim(),
                label: c.label,
                column_type: c.column_type,
                choices: c.column_type === 'Choice' ? c.choices : undefined,
                in_list_view: c.in_list_view,
              })),
          })
          rows = newTableRows(sheet, plan)
        } else {
          rows = mappedRows(sheet, plan)
        }
        let inserted = 0
        const failed: { index: number; message: string }[] = []
        for (let at = 0; at < rows.length; at += IMPORT_CHUNK) {
          const chunk = rows.slice(at, at + IMPORT_CHUNK)
          setBusy(`${plan.table}: importing rows ${at + 1}–${at + chunk.length} of ${rows.length}…`)
          const res = await api.post<{
            inserted: number
            failed: { index: number; message: string }[]
          }>(`/api/table/${encodeURIComponent(plan.table)}:import`, { rows: chunk })
          inserted += res.inserted
          failed.push(...res.failed.map((f) => ({ ...f, index: f.index + at })))
        }
        setPlans((ps) => ps.map((p, j) => (j === i ? { ...p, result: { inserted, failed } } : p)))
      }
      await queryClient.invalidateQueries({ queryKey: ['tables'] })
      await queryClient.invalidateQueries({ queryKey: ['import-targets'] })
      setDone(true)
      if (plans.length === 1) {
        navigate({
          to: '/desk/$doctype',
          params: { doctype: plans[0].table },
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
        const mappedCount = plan.mapping.filter(Boolean).length
        return (
          <div key={sheet.sheetName + i} className="fc-card mb-4 p-3" data-testid={`iw-sheet-${i}`}>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold text-[var(--color-ink)]">
                {sheet.sheetName}{' '}
                <span className="font-normal text-gray-500">
                  — {sheet.rows.length} rows, {sheet.headers.length} columns
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="fc-label m-0">Import into</span>
                <select
                  value={plan.mode === 'new' ? '__new__' : plan.table}
                  onChange={(e) => retarget(i, e.target.value)}
                  data-testid={`iw-target-${i}`}
                  className="fc-input w-auto py-1"
                >
                  <option value="__new__">New Table…</option>
                  {(targets.data ?? []).map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {plan.mode === 'new' ? (
              <>
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
                      <th className="px-2 py-1">File column</th>
                      <th className="px-2 py-1">Column name</th>
                      <th className="px-2 py-1">Type</th>
                      <th className="px-2 py-1">Choices</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.inferred.columns.map((c, ci) => (
                      <tr key={ci} className="border-t border-gray-100">
                        <td className="px-2 py-1 text-gray-500">{sheet.headers[ci]}</td>
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
                <div className="mb-1 text-xs text-gray-500" data-testid={`iw-mapped-count-${i}`}>
                  {mappedCount} of {sheet.headers.length} file columns mapped
                </div>
                <table className="w-full text-sm" data-testid={`iw-mapping-${i}`}>
                  <thead className="bg-gray-50 text-left text-xs text-gray-600">
                    <tr>
                      <th className="px-2 py-1">File column</th>
                      <th className="px-2 py-1">→ {plan.table} column</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.headers.map((h, hi) => (
                      <tr key={hi} className="border-t border-gray-100">
                        <td className="px-2 py-1 text-gray-700">{h || <em>(blank)</em>}</td>
                        <td className="px-1 py-1">
                          <select
                            value={plan.mapping[hi] ?? ''}
                            onChange={(e) =>
                              setPlan(i, {
                                mapping: plan.mapping.map((m, j) =>
                                  j === hi ? e.target.value || null : m,
                                ),
                              })
                            }
                            data-testid={`iw-map-${i}-${hi}`}
                            className="rounded border border-gray-200 px-1 py-0.5"
                          >
                            <option value="">— skip —</option>
                            {targetCols.map((c) => (
                              <option key={c.column_name} value={c.column_name}>
                                {c.label || c.column_name} ({c.column_type})
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {plan.check && (
              <div className="mt-2 text-sm" data-testid={`iw-check-${i}`}>
                {plan.check.failed.length === 0 ? (
                  <span className="text-green-700">
                    ✓ All {plan.check.valid} rows are ready to import
                  </span>
                ) : (
                  <span className="text-red-600">
                    {plan.check.valid} rows ready, {plan.check.failed.length} with problems:{' '}
                    {plan.check.failed
                      .slice(0, 5)
                      .map((f) => `row ${f.index + 2}: ${f.message}`)
                      .join('; ')}
                    {plan.check.failed.length > 5 && ` … and ${plan.check.failed.length - 5} more`}
                  </span>
                )}
              </div>
            )}
            {plan.result && (
              <div className="mt-2 text-sm" data-testid={`iw-result-${i}`}>
                <span className={plan.result.failed.length ? 'text-red-600' : 'text-green-700'}>
                  Imported {plan.result.inserted} rows into{' '}
                  <Link
                    to="/desk/$doctype"
                    params={{ doctype: plan.table }}
                    search={{ filters: undefined }}
                    className="underline"
                  >
                    {plan.table}
                  </Link>
                  {plan.result.failed.length > 0 &&
                    `; ${plan.result.failed.length} failed (first: row ${
                      plan.result.failed[0].index + 2
                    }: ${plan.result.failed[0].message})`}
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
          Import complete.
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
            disabled={!!busy}
            data-testid="iw-import"
            className="fc-btn-primary disabled:opacity-40"
          >
            {anyChecked && blockingProblems > 0
              ? `Import anyway (skip ${blockingProblems} bad rows)`
              : `Import ${sheets.reduce((n, s) => n + s.rows.length, 0)} rows`}
          </button>
        </div>
      )}
    </div>
  )
}

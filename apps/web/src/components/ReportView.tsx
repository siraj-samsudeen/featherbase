import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link as RouterLink } from '@tanstack/react-router'
import { ApiError, api, listResource } from '../lib/api'
import { NO_COLUMN_TYPES, useMeta } from '../lib/meta'
import { FilterBar, type Filter } from './ListView'

type Row = Record<string, unknown>

const NUMERIC = new Set(['Int', 'Float', 'Currency'])
const GROUPABLE = new Set(['Select', 'Link', 'Data', 'Check'])

// RPT-002: the persisted shape of a report configuration.
interface ReportConfig {
  columns?: string[]
  group_by?: string
  filters?: Filter[]
}

// RPT-001: report view — column picker and group-by with counts and sums,
// generic over every DocType (metadata-driven like the rest of the Desk).
// RPT-002: the configuration can be saved as a named Report document and
// restored via ?report=<name>.
export function ReportView({
  doctype,
  report,
  onReportChange,
}: {
  doctype: string
  report?: string
  onReportChange?: (name: string | undefined) => void
}) {
  const meta = useMeta(doctype)
  const queryClient = useQueryClient()

  const available = useMemo(
    () =>
      (meta.data?.fields ?? []).filter(
        (f) => !NO_COLUMN_TYPES.has(f.fieldtype) && f.fieldtype !== 'Table' && !f.hidden,
      ),
    [meta.data],
  )

  const [selected, setSelected] = useState<string[] | null>(null)
  const [groupBy, setGroupBy] = useState('')
  const [filters, setFilters] = useState<Filter[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)

  // RPT-002: saved reports for this DocType.
  const savedReports = useQuery({
    queryKey: ['saved-reports', doctype],
    queryFn: () =>
      listResource<{ name: string }>('Report', {
        filters: [['ref_doctype', '=', doctype]],
        fields: ['name'],
        order_by: 'name asc',
        limit_page_length: 100,
      }),
  })

  // RPT-002: opening ?report=<name> loads and applies the saved config.
  const savedDoc = useQuery({
    queryKey: ['report-doc', report],
    enabled: Boolean(report),
    queryFn: () => api.get<{ config?: ReportConfig }>(`/api/resource/Report/${encodeURIComponent(report!)}`),
  })
  useEffect(() => {
    const cfg = savedDoc.data?.config
    if (!cfg) return
    if (Array.isArray(cfg.columns)) setSelected(cfg.columns)
    setGroupBy(typeof cfg.group_by === 'string' ? cfg.group_by : '')
    setFilters(Array.isArray(cfg.filters) ? cfg.filters : [])
  }, [savedDoc.data])

  // Default columns: list-view fields (or the first three).
  const columns = useMemo(() => {
    if (selected) return selected
    const defaults = available.filter((f) => f.in_list_view).map((f) => f.fieldname)
    return defaults.length ? defaults : available.slice(0, 3).map((f) => f.fieldname)
  }, [selected, available])

  const fetchFields = useMemo(() => {
    const set = new Set(['name', ...columns])
    if (groupBy) set.add(groupBy)
    return [...set]
  }, [columns, groupBy])

  const rows = useQuery({
    queryKey: ['report', doctype, fetchFields, groupBy, filters],
    enabled: Boolean(meta.data),
    queryFn: () =>
      listResource<Row>(doctype, {
        fields: fetchFields,
        filters: filters.length ? filters : undefined,
        order_by: groupBy ? `${groupBy} asc` : 'modified desc',
        limit_page_length: 500,
      }),
  })

  async function saveReport() {
    setSaveError(null)
    try {
      const config: ReportConfig = { columns, group_by: groupBy, filters }
      await api.post('/api/save_doc', {
        doctype: 'Report',
        doc: { name: saveName, ref_doctype: doctype, config },
      })
      await queryClient.invalidateQueries({ queryKey: ['saved-reports', doctype] })
      setSaveOpen(false)
      onReportChange?.(saveName)
      setSaveName('')
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Save failed')
    }
  }

  if (meta.isLoading) return <p className="text-sm text-gray-400">Loading…</p>
  if (meta.isError) return <p className="text-sm text-red-600">Cannot load {doctype}</p>

  const numericCols = columns.filter((c) =>
    NUMERIC.has(available.find((f) => f.fieldname === c)?.fieldtype ?? ''),
  )

  const data = rows.data?.data ?? []
  const groups = new Map<string, Row[]>()
  if (groupBy) {
    for (const row of data) {
      const key = String(row[groupBy] ?? '(empty)')
      groups.set(key, [...(groups.get(key) ?? []), row])
    }
  }

  const sum = (list: Row[], col: string) =>
    list.reduce((acc, r) => acc + (Number(r[col]) || 0), 0)

  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2))

  const label = (fieldname: string) =>
    available.find((f) => f.fieldname === fieldname)?.label ?? fieldname

  const cell = (row: Row, col: string) => {
    const v = row[col]
    if (v == null || v === '') return '—'
    if (typeof v === 'boolean') return v ? '✓' : ''
    return String(v)
  }

  // RPT-003: export exactly what is on screen, in display order — group
  // header rows (value, count, sums) interleaved with member rows, then the
  // grand total.
  const exportCell = (row: Row, col: string) => {
    const v = row[col]
    if (v == null) return ''
    if (typeof v === 'boolean') return v ? 'true' : 'false'
    return String(v)
  }

  function exportRows(): (string | number)[][] {
    const header = ['Name', ...columns.map(label)]
    const out: (string | number)[][] = [header]
    const member = (row: Row) => [String(row.name), ...columns.map((c) => exportCell(row, c))]
    if (groupBy) {
      for (const [key, list] of groups.entries()) {
        out.push([
          `${key} (${list.length})`,
          ...columns.map((c) => (numericCols.includes(c) ? sum(list, c) : '')),
        ])
        for (const row of list) out.push(member(row))
      }
    } else {
      for (const row of data) out.push(member(row))
    }
    if (data.length && numericCols.length)
      out.push([
        `Total (${data.length})`,
        ...columns.map((c) => (numericCols.includes(c) ? sum(data, c) : '')),
      ])
    return out
  }

  function download(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  // PLAT-007: record the export in the Access Log (fire-and-forget).
  function logExport(method: string) {
    void api.post('/api/access_log', { doctype, method }).catch(() => {})
  }

  function exportCsv() {
    const quote = (v: string | number) => {
      const s = String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = exportRows()
      .map((r) => r.map(quote).join(','))
      .join('\n')
    download(new Blob([csv], { type: 'text/csv' }), `${doctype.toLowerCase().replace(/\s+/g, '-')}-report.csv`)
    logExport('csv')
  }

  async function exportXlsx() {
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.aoa_to_sheet(exportRows())
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Report')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    download(
      new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      `${doctype.toLowerCase().replace(/\s+/g, '-')}-report.xlsx`,
    )
    logExport('xlsx')
  }

  const bodyRow = (row: Row) => (
    <tr key={String(row.name)} className="border-t border-[var(--color-border)]" data-testid="report-row">
      <td className="px-3 py-1.5">
        <RouterLink
          to="/desk/$doctype/$name"
          params={{ doctype, name: String(row.name) }}
          className="text-[var(--color-brand)] hover:underline"
        >
          {String(row.name)}
        </RouterLink>
      </td>
      {columns.map((c) => (
        <td key={c} className="px-3 py-1.5">
          {cell(row, c)}
        </td>
      ))}
    </tr>
  )

  return (
    <div data-testid="report-view">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-ink)]">{doctype} — Report</h1>
          <span className="text-xs text-[var(--color-ink-muted)]" data-testid="report-total">
            {rows.data?.total ?? 0} rows
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCsv} className="fc-btn" data-testid="export-csv">
            CSV
          </button>
          <button onClick={exportXlsx} className="fc-btn" data-testid="export-xlsx">
            XLSX
          </button>
          <RouterLink
            to="/desk/$doctype"
            params={{ doctype }}
            search={{ filters: undefined }}
            className="fc-btn"
            data-testid="report-to-list"
          >
            List view
          </RouterLink>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-3">
        <div className="relative">
          <button
            onClick={() => setPickerOpen((o) => !o)}
            className="fc-btn"
            data-testid="report-columns"
          >
            Columns ({columns.length})
          </button>
          {pickerOpen && (
            <div className="fc-card absolute z-10 mt-1 max-h-72 w-56 overflow-y-auto p-2">
              {available.map((f) => (
                <label
                  key={f.fieldname}
                  className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-[var(--color-subtle)]"
                >
                  <input
                    type="checkbox"
                    checked={columns.includes(f.fieldname)}
                    data-testid={`report-col-${f.fieldname}`}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...columns, f.fieldname]
                          : columns.filter((c) => c !== f.fieldname),
                      )
                    }
                  />
                  {f.label ?? f.fieldname}
                </label>
              ))}
            </div>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
          Group by
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            className="fc-input w-44"
            data-testid="report-groupby"
          >
            <option value="">None</option>
            {available
              .filter((f) => GROUPABLE.has(f.fieldtype))
              .map((f) => (
                <option key={f.fieldname} value={f.fieldname}>
                  {f.label ?? f.fieldname}
                </option>
              ))}
          </select>
        </label>

        {/* RPT-002: saved report picker + save */}
        <select
          value={report ?? ''}
          onChange={(e) => onReportChange?.(e.target.value || undefined)}
          className="fc-input w-48"
          data-testid="saved-report-picker"
        >
          <option value="">Saved reports…</option>
          {savedReports.data?.data.map((r) => (
            <option key={r.name} value={r.name}>
              {r.name}
            </option>
          ))}
        </select>
        <div className="relative">
          <button
            onClick={() => setSaveOpen((o) => !o)}
            className="fc-btn"
            data-testid="report-save"
          >
            Save report
          </button>
          {saveOpen && (
            <div className="fc-card absolute right-0 z-10 mt-1 w-64 p-3">
              <label className="fc-label">Report name</label>
              <input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                className="fc-input mb-2"
                data-testid="report-save-name"
                placeholder="e.g. Open tickets by status"
              />
              {saveError && (
                <p className="mb-2 text-xs text-[var(--color-danger)]" data-testid="report-save-error">
                  {saveError}
                </p>
              )}
              <button
                onClick={saveReport}
                disabled={!saveName.trim()}
                className="fc-btn-primary w-full justify-center"
                data-testid="report-save-confirm"
              >
                Save
              </button>
            </div>
          )}
        </div>
      </div>

      {meta.data && <FilterBar meta={meta.data} filters={filters} onChange={setFilters} />}

      <div className="fc-card overflow-x-auto">
        <table className="w-full text-sm" data-testid="report-table">
          <thead className="bg-[var(--color-subtle)] text-left text-xs text-[var(--color-ink-muted)]">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              {columns.map((c) => (
                <th key={c} className="px-3 py-2 font-medium" data-testid={`report-head-${c}`}>
                  {label(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!groupBy && data.map(bodyRow)}
            {groupBy &&
              [...groups.entries()].map(([key, list]) => (
                <ReportGroup
                  key={key}
                  groupKey={key}
                  list={list}
                  columns={columns}
                  numericCols={numericCols}
                  sum={sum}
                  fmt={fmt}
                  bodyRow={bodyRow}
                />
              ))}
            {data.length > 0 && numericCols.length > 0 && (
              <tr
                className="border-t-2 border-[var(--color-border-strong)] bg-[var(--color-subtle)] font-medium"
                data-testid="report-grand-total"
              >
                <td className="px-3 py-1.5">Total ({data.length})</td>
                {columns.map((c) => (
                  <td key={c} className="px-3 py-1.5" data-testid={`grand-sum-${c}`}>
                    {numericCols.includes(c) ? fmt(sum(data, c)) : ''}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
        {data.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-[var(--color-ink-faint)]">No rows</p>
        )}
      </div>
    </div>
  )
}

function ReportGroup({
  groupKey,
  list,
  columns,
  numericCols,
  sum,
  fmt,
  bodyRow,
}: {
  groupKey: string
  list: Row[]
  columns: string[]
  numericCols: string[]
  sum: (list: Row[], col: string) => number
  fmt: (v: number) => string
  bodyRow: (row: Row) => React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <tr
        className="cursor-pointer border-t border-[var(--color-border)] bg-[var(--color-brand-tint)]/60"
        data-testid="group-header"
        data-group={groupKey}
        onClick={() => setOpen((o) => !o)}
      >
        <td className="px-3 py-1.5 font-medium text-[var(--color-ink)]">
          <span className="mr-1 inline-block w-3 text-[var(--color-ink-faint)]">
            {open ? '▾' : '▸'}
          </span>
          {groupKey} <span data-testid="group-count">({list.length})</span>
        </td>
        {columns.map((c) => (
          <td key={c} className="px-3 py-1.5 font-medium" data-testid={`group-sum-${c}`}>
            {numericCols.includes(c) ? fmt(sum(list, c)) : ''}
          </td>
        ))}
      </tr>
      {open && list.map(bodyRow)}
    </>
  )
}

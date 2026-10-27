import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link as RouterLink } from '@tanstack/react-router'
import { ApiError, api, listResource } from '../lib/api'
import { NO_COLUMN_TYPES, useMeta } from '../lib/meta'
import { FilterBar, type Filter } from './ListView'
import { Notice, buttonClasses, cardClasses, inputClasses, labelClasses } from './ui'
import { fmtCount, fmtNumber } from '../lib/inr'

type Row = Record<string, unknown>

// #330: the server's totals over every matching row (GET :summary).
interface Summary {
  count: number
  sums: Record<string, string>
  groups: { value: string | null; count: number; sums: Record<string, string> }[]
}

// The list path returns at most this many rows a page.
const PAGE = 500
const EMPTY_GROUP = '(empty)'
// A blank and a missing value are one group, on the server's side and the browser's.
const groupKey = (v: unknown) => (v == null || v === '' ? EMPTY_GROUP : String(v))

interface GroupTotals {
  key: string
  list: Row[]
  count: number
  sums: Record<string, number>
}

const NUMERIC = new Set(['Int', 'Float', 'Currency'])
const GROUPABLE = new Set(['Choice', 'Reference', 'Data', 'Check'])

// RPT-002: the persisted shape of a summary view configuration.
interface ReportConfig {
  columns?: string[]
  group_by?: string
  filters?: Filter[]
}

// RPT-001: summary view — column picker and group-by with counts and sums,
// generic over every Table (metadata-driven like the rest of the Admin UI).
// RPT-002: the configuration can be saved as a named Report row and
// restored via ?report=<name>.
export function ReportView({
  table,
  report,
  onReportChange,
}: {
  table: string
  report?: string
  onReportChange?: (name: string | undefined) => void
}) {
  const meta = useMeta(table)
  const queryClient = useQueryClient()

  const available = useMemo(
    () =>
      (meta.data?.columns ?? []).filter(
        (f) => !NO_COLUMN_TYPES.has(f.column_type) && f.column_type !== 'Sub-table' && !f.hidden,
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
  // RPT-006: chart preview + pin-to-dashboard.
  const [chartValue, setChartValue] = useState('')
  const [pinDashboard, setPinDashboard] = useState('')
  const [pinMsg, setPinMsg] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  // RPT-002: saved reports for this Table.
  const savedReports = useQuery({
    queryKey: ['saved-reports', table],
    queryFn: () =>
      listResource<{ row_id: string }>('Report', {
        filters: [['ref_table', '=', table]],
        fields: ['row_id'],
        order_by: 'row_id asc',
        limit_page_length: 100,
      }),
  })

  // RPT-006: dashboards available to pin a chart onto.
  const dashboards = useQuery({
    queryKey: ['dashboards-for-pin'],
    queryFn: () =>
      listResource<{ row_id: string }>('Dashboard', {
        fields: ['row_id'],
        order_by: 'row_id asc',
        limit_page_length: 100,
      }),
  })

  // RPT-002: opening ?report=<name> loads and applies the saved config.
  const savedDoc = useQuery({
    queryKey: ['report-doc', report],
    enabled: Boolean(report),
    queryFn: () => api.get<{ config?: ReportConfig }>(`/api/table/Report/${encodeURIComponent(report!)}`),
  })
  useEffect(() => {
    const cfg = savedDoc.data?.config
    if (!cfg) return
    if (Array.isArray(cfg.columns)) setSelected(cfg.columns)
    setGroupBy(typeof cfg.group_by === 'string' ? cfg.group_by : '')
    setFilters(Array.isArray(cfg.filters) ? cfg.filters : [])
  }, [savedDoc.data])

  // Default columns: list-view columns (or the first three).
  const columns = useMemo(() => {
    if (selected) return selected
    const defaults = available.filter((f) => f.in_list_view).map((f) => f.column_name)
    return defaults.length ? defaults : available.slice(0, 3).map((f) => f.column_name)
  }, [selected, available])

  const fetchFields = useMemo(() => {
    const set = new Set(['row_id', ...columns])
    if (groupBy) set.add(groupBy)
    return [...set]
  }, [columns, groupBy])

  const listArgs = useMemo(
    () => ({
      fields: fetchFields,
      filters: filters.length ? filters : undefined,
      order_by: groupBy ? `${groupBy} asc` : 'updated_at desc',
    }),
    [fetchFields, filters, groupBy],
  )
  const rows = useQuery({
    queryKey: ['report', table, listArgs],
    enabled: Boolean(meta.data),
    queryFn: () => listResource<Row>(table, { ...listArgs, limit_page_length: PAGE }),
  })

  const numericCols = useMemo(
    () => columns.filter((c) => NUMERIC.has(available.find((f) => f.column_name === c)?.column_type ?? '')),
    [columns, available],
  )

  // #330: counts and sums over every matching row, not just the page shown.
  // If the server can't total this Table (a connected one with sums), the
  // view falls back to totals over the rows it shows, and says so.
  const summary = useQuery({
    queryKey: ['report-summary', table, groupBy, numericCols, filters],
    enabled: Boolean(meta.data),
    retry: false,
    queryFn: () => {
      const qs = new URLSearchParams()
      if (filters.length) qs.set('filters', JSON.stringify(filters))
      if (groupBy) qs.set('group_by', groupBy)
      if (numericCols.length) qs.set('sums', JSON.stringify(numericCols))
      return api.get<Summary>(`/api/table/${encodeURIComponent(table)}:summary?${qs}`)
    },
  })

  async function saveReport() {
    setSaveError(null)
    try {
      const config: ReportConfig = { columns, group_by: groupBy, filters }
      await api.post('/api/save_row', {
        table: 'Report',
        row: { row_id: saveName, ref_table: table, config },
      })
      await queryClient.invalidateQueries({ queryKey: ['saved-reports', table] })
      setSaveOpen(false)
      onReportChange?.(saveName)
      setSaveName('')
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Save failed')
    }
  }

  // RPT-006: pin the current report chart onto a dashboard. The pinned chart
  // references the saved Report by name and carries the same label/value/group
  // choice, so the dashboard reproduces exactly this chart from live data.
  async function pinChart() {
    setPinMsg(null)
    if (!report || !pinDashboard) return
    const chart = groupBy
      ? { label: report, report, group_by: groupBy }
      : { label: report, report, label_field: chartLabelField, value_field: effectiveChartValue }
    try {
      await api.post('/api/pin_chart_to_dashboard', { dashboard: pinDashboard, chart })
      setPinMsg(`Pinned to ${pinDashboard}`)
    } catch (err) {
      setPinMsg(err instanceof ApiError ? err.message : 'Pin failed')
    }
  }

  if (meta.isLoading) return <p className="text-sm text-ink-subtle">Loading…</p>
  if (meta.isError) return <p className="text-sm text-negative">Cannot load {table}</p>

  // RPT-006: the value field driving the chart (numeric column). Falls back to
  // the first numeric column; if there are none, bars use per-group counts.
  const effectiveChartValue = chartValue || numericCols[0] || ''
  const chartLabelField = groupBy || columns.find((c) => !numericCols.includes(c)) || columns[0]

  const data = rows.data?.data ?? []
  const matching = rows.data?.total ?? 0
  const totals = summary.data ?? null
  // Until the server's totals answer, none are shown, so a short page's sums never flash up as the total.
  const totalsPending = !totals && !summary.isError
  const groupRows = (list: Row[]) => {
    const groups = new Map<string, Row[]>()
    if (groupBy)
      for (const row of list) {
        const key = groupKey(row[groupBy])
        groups.set(key, [...(groups.get(key) ?? []), row])
      }
    return groups
  }
  const groups = groupRows(data)

  // Rounded to the stored scale (Currency keeps 9 places), so float noise never shows.
  const sum = (list: Row[], col: string) =>
    Number(list.reduce((acc, r) => acc + (Number(r[col]) || 0), 0).toFixed(9))
  const sumsOf = (list: Row[]) => Object.fromEntries(numericCols.map((c) => [c, sum(list, c)]))
  const numbersOf = (sums: Record<string, string>) =>
    Object.fromEntries(numericCols.map((c) => [c, Number(sums[c] ?? 0)]))

  // What the table shows: each group with its rows on this page and its
  // count and sums — the server's, over every matching row, when it has them.
  // Server groups in their order, merged where two land on one key; a group
  // only the browser has (a source that names it differently) is kept, so no
  // row is ever dropped from the table or the file.
  const orderedGroups = (byKey: Map<string, Row[]>) => {
    const out = new Map<string, { count: number; sums: Record<string, number> }>()
    if (totals)
      for (const g of totals.groups) {
        const key = groupKey(g.value)
        const prev = out.get(key)
        const sums = numbersOf(g.sums)
        out.set(
          key,
          prev
            ? { count: prev.count + g.count, sums: Object.fromEntries(numericCols.map((c) => [c, prev.sums[c] + sums[c]])) }
            : { count: g.count, sums },
        )
      }
    for (const [key, list] of byKey) if (!out.has(key)) out.set(key, { count: list.length, sums: sumsOf(list) })
    return [...out.entries()].map(([key, t]) => ({ key, list: byKey.get(key) ?? [], ...t }))
  }
  const shownGroups: GroupTotals[] = orderedGroups(groups)
  const grand = totals
    ? { count: totals.count, sums: numbersOf(totals.sums) }
    : { count: data.length, sums: sumsOf(data) }

  // RPT-006: chart points derived from the on-screen rows — grouped → per-group
  // counts (matches the grouped table); ungrouped → each row's value field. This
  // mirrors the server's /api/report_chart derivation so the pinned dashboard
  // chart reproduces this preview.
  const chartData: { label: string; value: number }[] = groupBy && totals
    ? totals.groups.map((g) => ({ label: g.value ?? '', value: g.count }))
    : groupBy
    ? [...(() => {
        const m = new Map<string, number>()
        for (const r of data) {
          const k = r[groupBy] == null ? '' : String(r[groupBy])
          m.set(k, (m.get(k) ?? 0) + 1)
        }
        return m.entries()
      })()].map(([label, value]) => ({ label, value }))
    : data.map((r) => ({
        label: r[chartLabelField] == null ? '' : String(r[chartLabelField]),
        value: effectiveChartValue && r[effectiveChartValue] != null ? Number(r[effectiveChartValue]) || 0 : 0,
      }))
  const chartMax = chartData.reduce((m, r) => Math.max(m, r.value), 0) || 1

  const fmt = (v: number) => (totalsPending ? '…' : Number.isInteger(v) ? fmtCount(v) : fmtNumber(v, 2))

  const label = (columnName: string) =>
    available.find((f) => f.column_name === columnName)?.label ?? columnName

  const cell = (row: Row, col: string) => {
    const v = row[col]
    if (v == null || v === '') return '—'
    if (typeof v === 'boolean') return v ? '✓' : ''
    return String(v)
  }

  // RPT-003: export what is on screen, in display order — group header rows
  // (value, count, sums) interleaved with member rows, then the grand total —
  // with every matching row, not only the first page shown (#330).
  const exportCell = (row: Row, col: string) => {
    const v = row[col]
    if (v == null) return ''
    if (typeof v === 'boolean') return v ? 'true' : 'false'
    return String(v)
  }

  async function allRows(): Promise<Row[]> {
    if (data.length >= matching) return data
    const all: Row[] = []
    for (let start = 0; ; start += PAGE) {
      const page = await listResource<Row>(table, { ...listArgs, limit_start: start, limit_page_length: PAGE })
      all.push(...page.data)
      if (page.data.length < PAGE || all.length >= page.total) return all
    }
  }

  async function exportRows(): Promise<(string | number)[][]> {
    const list = await allRows()
    const header = ['Name', ...columns.map(label)]
    const out: (string | number)[][] = [header]
    const member = (row: Row) => [String(row.row_id), ...columns.map((c) => exportCell(row, c))]
    // The file carries the same totals as the screen: the server's exact sums
    // when it has them, otherwise sums over every exported row.
    const totalCells = (t: { count: number; sums: Record<string, number> }, name: string) => [
      `${name} (${fmtCount(t.count)})`,
      ...columns.map((c) => (numericCols.includes(c) ? t.sums[c] : '')),
    ]
    const own = (rows: Row[]) => ({ count: rows.length, sums: sumsOf(rows) })
    if (groupBy) {
      for (const g of orderedGroups(groupRows(list))) {
        out.push(totalCells(g, g.key))
        for (const row of g.list) out.push(member(row))
      }
    } else {
      for (const row of list) out.push(member(row))
    }
    if (list.length && numericCols.length)
      out.push(totalCells(totals ? { count: totals.count, sums: numbersOf(totals.sums) } : own(list), 'Total'))
    return out
  }

  // One export at a time: a large Table takes several pages to read.
  async function runExport(write: (rows: (string | number)[][]) => Promise<void> | void) {
    setExporting(true)
    try {
      await write(await exportRows())
    } catch (err) {
      setExportError(err instanceof ApiError ? `Export failed: ${err.message}` : 'Export failed')
    } finally {
      setExporting(false)
    }
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
    void api.post('/api/access_log', { table, method }).catch(() => {})
  }

  function exportCsv(rows: (string | number)[][]) {
    const quote = (v: string | number) => {
      const s = String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = rows
      .map((r) => r.map(quote).join(','))
      .join('\n')
    download(new Blob([csv], { type: 'text/csv' }), `${table.toLowerCase().replace(/\s+/g, '-')}-report.csv`)
    logExport('csv')
  }

  async function exportXlsx(rows: (string | number)[][]) {
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.aoa_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Report')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    download(
      new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      `${table.toLowerCase().replace(/\s+/g, '-')}-report.xlsx`,
    )
    logExport('xlsx')
  }

  const bodyRow = (row: Row) => (
    <tr key={String(row.row_id)} className="border-t border-border" data-testid="report-row">
      <td className="px-3 py-1.5">
        <RouterLink
          to="/featherbase/admin/$table/$name"
          search={{ prefill: undefined }}
          params={{ table, name: String(row.row_id) }}
          className="text-action hover:underline"
        >
          {String(row.row_id)}
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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-ink">{table} — Summary</h1>
          <span className="text-xs text-ink-muted" data-testid="report-total">
            {fmtCount(matching)} rows
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => runExport(exportCsv)}
            disabled={exporting}
            className={buttonClasses()}
            data-testid="export-csv"
          >
            CSV
          </button>
          <button
            onClick={() => runExport(exportXlsx)}
            disabled={exporting}
            className={buttonClasses()}
            data-testid="export-xlsx"
          >
            XLSX
          </button>
          <RouterLink
            to="/featherbase/admin/$table"
            params={{ table }}
            search={{ filters: undefined }}
            className={buttonClasses()}
            data-testid="report-to-list"
          >
            List view
          </RouterLink>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative">
          <button
            onClick={() => setPickerOpen((o) => !o)}
            className={buttonClasses()}
            data-testid="report-columns"
          >
            Columns ({columns.length})
          </button>
          {pickerOpen && (
            <div className={cardClasses('absolute z-10 mt-1 max-h-72 w-56 overflow-y-auto p-2')}>
              {available.map((f) => (
                <label
                  key={f.column_name}
                  className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-subtle"
                >
                  <input
                    type="checkbox"
                    checked={columns.includes(f.column_name)}
                    data-testid={`report-col-${f.column_name}`}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...columns, f.column_name]
                          : columns.filter((c) => c !== f.column_name),
                      )
                    }
                  />
                  {f.label ?? f.column_name}
                </label>
              ))}
            </div>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm text-ink-muted">
          Group by
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            className={inputClasses('w-44')}
            data-testid="report-groupby"
          >
            <option value="">None</option>
            {available
              .filter((f) => GROUPABLE.has(f.column_type))
              .map((f) => (
                <option key={f.column_name} value={f.column_name}>
                  {f.label ?? f.column_name}
                </option>
              ))}
          </select>
        </label>

        {/* RPT-002: saved report picker + save */}
        <select
          value={report ?? ''}
          onChange={(e) => onReportChange?.(e.target.value || undefined)}
          className={inputClasses('w-48')}
          data-testid="saved-report-picker"
        >
          <option value="">Saved reports…</option>
          {savedReports.data?.data.map((r) => (
            <option key={r.row_id} value={r.row_id}>
              {r.row_id}
            </option>
          ))}
        </select>
        <div className="relative">
          <button
            onClick={() => setSaveOpen((o) => !o)}
            className={buttonClasses()}
            data-testid="report-save"
          >
            Save report
          </button>
          {saveOpen && (
            <div className={cardClasses('absolute right-0 z-10 mt-1 w-64 p-3')}>
              <label className={labelClasses()}>Report name</label>
              <input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                className={inputClasses('mb-2')}
                data-testid="report-save-name"
                placeholder="e.g. Open tickets by status"
              />
              {saveError && (
                <p className="mb-2 text-xs text-negative" data-testid="report-save-error">
                  {saveError}
                </p>
              )}
              <button
                onClick={saveReport}
                disabled={!saveName.trim()}
                className={buttonClasses({ variant: 'primary', className: 'w-full justify-center' })}
                data-testid="report-save-confirm"
              >
                Save
              </button>
            </div>
          )}
        </div>
      </div>

      {meta.data && <FilterBar meta={meta.data} filters={filters} onChange={setFilters} />}

      {exportError && (
        <Notice tone="negative" className="mb-3">
          {exportError}
        </Notice>
      )}
      {/* #330: say when the table lists only part of the matching rows, and what the totals cover. */}
      {matching > data.length && !totalsPending && (
        <div className="mb-3" data-testid="report-shown-note">
          <Notice>
            Showing the first {fmtCount(data.length)} of {fmtCount(matching)} rows.{' '}
            {totals
              ? `The counts, totals, chart and export cover all ${fmtCount(matching)}.`
              : `The counts and totals cover only these ${fmtCount(data.length)}; the export has all ${fmtCount(matching)}.`}
          </Notice>
        </div>
      )}

      <div className={cardClasses('overflow-x-auto')}>
        <table className="w-full text-sm" data-testid="report-table">
          <thead className="bg-subtle text-left text-xs text-ink-muted">
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
              shownGroups.map((g) => (
                <ReportGroup
                  key={g.key}
                  group={g}
                  columns={columns}
                  numericCols={numericCols}
                  fmt={fmt}
                  bodyRow={bodyRow}
                />
              ))}
            {data.length > 0 && numericCols.length > 0 && (
              <tr
                className="border-t-2 border-border-control bg-subtle font-medium"
                data-testid="report-grand-total"
              >
                <td className="px-3 py-1.5">Total ({fmt(grand.count)})</td>
                {columns.map((c) => (
                  <td key={c} className="px-3 py-1.5" data-testid={`grand-sum-${c}`}>
                    {numericCols.includes(c) ? fmt(grand.sums[c]) : ''}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
        {data.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-ink-subtle">No rows</p>
        )}
      </div>

      {/* RPT-006: chart of the report data + pin to a dashboard */}
      <div className={cardClasses('mt-4 p-4')} data-testid="report-chart">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-medium text-ink">Chart</div>
          <div className="flex flex-wrap items-center gap-2">
            {!groupBy && numericCols.length > 0 && (
              <label className="flex items-center gap-1 text-xs text-ink-muted">
                Value
                <select
                  value={effectiveChartValue}
                  onChange={(e) => setChartValue(e.target.value)}
                  className={inputClasses('w-32')}
                  data-testid="chart-value"
                >
                  {numericCols.map((c) => (
                    <option key={c} value={c}>
                      {label(c)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <select
              value={pinDashboard}
              onChange={(e) => setPinDashboard(e.target.value)}
              className={inputClasses('w-40')}
              data-testid="pin-dashboard"
            >
              <option value="">Dashboard…</option>
              {dashboards.data?.data.map((d) => (
                <option key={d.row_id} value={d.row_id}>
                  {d.row_id}
                </option>
              ))}
            </select>
            <button
              onClick={pinChart}
              disabled={!report || !pinDashboard}
              className={buttonClasses()}
              data-testid="pin-chart"
              title={report ? 'Pin this chart to the selected dashboard' : 'Save the report first'}
            >
              Pin to dashboard
            </button>
          </div>
        </div>
        {pinMsg && (
          <p className="mb-2 text-xs text-ink-muted" data-testid="pin-msg">
            {pinMsg}
          </p>
        )}
        <div className="space-y-2">
          {chartData.map((r, i) => (
            <div key={`${r.label}-${i}`} className="flex items-center gap-2" data-testid={`chart-bar-${r.label}`}>
              <div className="w-24 shrink-0 truncate text-xs text-ink-muted">{r.label || '—'}</div>
              <div className="h-5 flex-1 rounded bg-subtle">
                <div
                  className="h-5 rounded bg-action"
                  style={{ width: `${Math.round((r.value / chartMax) * 100)}%`, minWidth: r.value ? '2px' : 0 }}
                />
              </div>
              <div className="w-10 shrink-0 text-right text-xs tabular-nums text-ink" data-testid={`chart-bar-value-${r.label}`}>
                {r.value}
              </div>
            </div>
          ))}
          {chartData.length === 0 && (
            <div className="text-sm text-ink-subtle">No data</div>
          )}
        </div>
      </div>
    </div>
  )
}

function ReportGroup({
  group,
  columns,
  numericCols,
  fmt,
  bodyRow,
}: {
  group: GroupTotals
  columns: string[]
  numericCols: string[]
  fmt: (v: number) => string
  bodyRow: (row: Row) => React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <tr
        className="cursor-pointer border-t border-border bg-action-tint/60"
        data-testid="group-header"
        data-group={group.key}
        onClick={() => setOpen((o) => !o)}
      >
        <td className="px-3 py-1.5 font-medium text-ink">
          <span className="mr-1 inline-block w-3 text-ink-subtle">
            {open ? '▾' : '▸'}
          </span>
          {group.key} <span data-testid="group-count">({fmt(group.count)})</span>
        </td>
        {columns.map((c) => (
          <td key={c} className="px-3 py-1.5 font-medium" data-testid={`group-sum-${c}`}>
            {numericCols.includes(c) ? fmt(group.sums[c]) : ''}
          </td>
        ))}
      </tr>
      {open && group.list.map(bodyRow)}
    </>
  )
}

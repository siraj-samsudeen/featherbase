import { useEffect, useState } from 'react'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ApiError, api, listResource } from '../lib/api'
import { NO_COLUMN_TYPES, listColumns, useMeta } from '../lib/meta'
import { useRealtime } from '../lib/realtime'
import { formatValue, useSettings, type Settings } from '../lib/settings'
import { useIsSystemManager } from '../lib/session'

export type Filter = [string, string, unknown]

const OPS = ['=', '!=', 'like', '>', '<', '>=', '<='] as const

const PAGE = 20

// SET-004: cells render through the global display settings (date format,
// currency/float precision). Non-typed columns fall back to a plain string.
function cell(value: unknown, columnType: string, settings: Settings): string {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? '✓' : '✗'
  return formatValue(columnType, value, settings) || '—'
}

// Frappe's "indicator" idiom (adopted from the PR-2 Desk): status-like Select
// values render as a colored dot + label. Known lifecycle words get their
// conventional color; anything else picks a stable palette color by hash.
const INDICATOR_GREEN = /\b(closed|resolved|done|complete|completed|active|approved|paid|sent|success|finished|enabled|on track)\b/
const INDICATOR_ORANGE = /\b(in progress|pending|working|review|reviewing|on hold|partially|queued|medium)\b/
const INDICATOR_RED = /\b(open|urgent|high|critical|overdue|error|failed|rejected|blocked|disabled|cancelled)\b/
const INDICATOR_GRAY = /\b(draft|low|inactive|none|not set)\b/
const INDICATOR_PALETTE = ['#2490ef', '#8b5cf6', '#0d9488', '#db2777', '#ca8a04']

export function indicatorColor(value: string): string {
  const v = value.toLowerCase()
  if (INDICATOR_GREEN.test(v)) return '#16a34a'
  if (INDICATOR_ORANGE.test(v)) return '#ea580c'
  if (INDICATOR_RED.test(v)) return '#dc2626'
  if (INDICATOR_GRAY.test(v)) return '#9ca3af'
  let h = 0
  for (const ch of value) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return INDICATOR_PALETTE[h % INDICATOR_PALETTE.length]
}

export function Indicator({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: indicatorColor(value) }}
      />
      {value}
    </span>
  )
}

// UI-002/UI-003: ONE list component renders every Table from its metadata.
export function ListView({
  doctype,
  filters = [],
  onFiltersChange,
}: {
  doctype: string
  filters?: Filter[]
  onFiltersChange?: (filters: Filter[]) => void
}) {
  const meta = useMeta(doctype)
  const settings = useSettings()
  const isSystemManager = useIsSystemManager()
  const queryClient = useQueryClient()
  const [sort, setSort] = useState<{ field: string; dir: 'asc' | 'desc' } | null>(null)
  const [start, setStart] = useState(0)
  // UI-013: per-user saved settings (sort, hidden columns, filters).
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set())
  const [colPickerOpen, setColPickerOpen] = useState(false)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  // UI-012: bulk selection state.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkField, setBulkField] = useState('')
  const [bulkValue, setBulkValue] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const filterKey = JSON.stringify(filters)
  useEffect(() => setStart(0), [filterKey])
  useEffect(() => setSelected(new Set()), [filterKey, start, doctype])

  // RT-001: another session creating/updating/deleting a doc of this type
  // refreshes the list without a reload.
  useRealtime([`list:${doctype}`], () => {
    void queryClient.invalidateQueries({ queryKey: ['list', doctype] })
  })

  // UI-013: load this user's saved view settings (sort + hidden columns)
  // once per DocType. Filters stay URL-driven (UI-003), so they're not
  // persisted here — this covers the durable "customize a list" bits.
  useEffect(() => {
    let cancelled = false
    setSettingsLoaded(false)
    api
      .get<{ settings: { sort?: typeof sort; hiddenCols?: string[] } | null }>(
        `/api/user_settings/${encodeURIComponent(doctype)}`,
      )
      .then((res) => {
        if (cancelled) return
        const s = res.settings
        if (s) {
          if (s.sort) setSort(s.sort)
          if (Array.isArray(s.hiddenCols)) setHiddenCols(new Set(s.hiddenCols))
        }
        setSettingsLoaded(true)
      })
      .catch(() => setSettingsLoaded(true))
    return () => {
      cancelled = true
    }
    // Only re-run when the DocType changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctype])

  // Persist settings whenever the user changes them (after the initial load).
  function persist(next: { sort?: typeof sort; hiddenCols?: Set<string> }) {
    if (!settingsLoaded) return
    void api.put(`/api/user_settings/${encodeURIComponent(doctype)}`, {
      sort: next.sort !== undefined ? next.sort : sort,
      hiddenCols: [...(next.hiddenCols ?? hiddenCols)],
    })
  }

  const allColumns = meta.data ? listColumns(meta.data) : []
  const columns = allColumns.filter((c) => !hiddenCols.has(c.column_name))
  const orderBy = sort
    ? `${sort.field} ${sort.dir}`
    : meta.data
      ? `${meta.data.sort_column || 'updated_at'} ${meta.data.sort_order || 'desc'}`
      : undefined

  const list = useQuery({
    queryKey: ['list', doctype, columns.map((c) => c.column_name), orderBy, start, filterKey],
    enabled: Boolean(meta.data),
    placeholderData: keepPreviousData,
    queryFn: () =>
      listResource(doctype, {
        filters,
        fields: columns.map((c) => c.column_name),
        order_by: orderBy,
        limit_start: start,
        limit_page_length: PAGE,
      }),
  })

  if (meta.isLoading) return <p className="text-sm text-gray-400">Loading…</p>
  if (meta.isError) return <p className="text-sm text-red-600">Cannot load {doctype}</p>

  const total = list.data?.total ?? 0
  const rows = list.data?.data ?? []

  function toggleSort(field: string) {
    setStart(0)
    const next: { field: string; dir: 'asc' | 'desc' } =
      sort?.field === field
        ? { field, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'asc' }
    setSort(next)
    persist({ sort: next })
  }

  // UI-013: hide/show a column (persisted per user).
  function toggleColumn(columnName: string) {
    setHiddenCols((prev) => {
      const nextSet = new Set(prev)
      if (nextSet.has(columnName)) nextSet.delete(columnName)
      else nextSet.add(columnName)
      persist({ hiddenCols: nextSet })
      return nextSet
    })
  }

  // UI-012: bulk actions over the selected rows. Each row goes through the
  // normal row lifecycle (delete_doc / save_doc) — no side-channel.
  const editableColumns = (meta.data?.columns ?? []).filter(
    (f) =>
      !NO_COLUMN_TYPES.has(f.column_type) &&
      !['Sub-table', 'Attach', 'Attach Image', 'JSON'].includes(f.column_type) &&
      !f.read_only &&
      !f.hidden,
  )

  function toggleRow(name: string) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['list', doctype] })
    setSelected(new Set())
    setBulkError(null)
  }

  async function bulkDelete() {
    setBulkBusy(true)
    setBulkError(null)
    try {
      for (const name of selected)
        await api.delete(`/api/table/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`)
      await refresh()
    } catch (err) {
      setBulkError(err instanceof ApiError ? err.message : 'Bulk delete failed')
    } finally {
      setBulkBusy(false)
    }
  }

  async function bulkEdit() {
    if (!bulkField) return
    setBulkBusy(true)
    setBulkError(null)
    const columnType = editableColumns.find((f) => f.column_name === bulkField)?.column_type
    const value: unknown =
      columnType === 'Check'
        ? ['1', 'true', 'yes'].includes(bulkValue.trim().toLowerCase())
        : bulkValue === ''
          ? null
          : bulkValue
    try {
      for (const name of selected) {
        const doc = await api.get<Record<string, unknown>>(
          `/api/table/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
        )
        await api.patch(`/api/table/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`, {
          [bulkField]: value,
          updated_at: doc.updated_at,
        })
      }
      await refresh()
    } catch (err) {
      setBulkError(err instanceof ApiError ? err.message : 'Bulk edit failed')
    } finally {
      setBulkBusy(false)
    }
  }

  return (
    <div data-testid="list-view">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-xs text-[var(--color-ink-faint)]">
            <Link to="/admin" className="hover:text-[var(--color-ink)]">
              Home
            </Link>
            {' / '}
            {doctype}
          </div>
          <h1 className="text-xl font-semibold text-[var(--color-ink)]">{doctype}</h1>
          <span className="text-xs text-[var(--color-ink-muted)]" data-testid="list-total">
            {total} total
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setColPickerOpen((o) => !o)}
              className="fc-btn"
              data-testid="list-columns"
            >
              Columns
            </button>
            {colPickerOpen && (
              <div className="fc-card absolute right-0 z-10 mt-1 max-h-72 w-52 overflow-y-auto p-2">
                {allColumns.map((col) => (
                  <label
                    key={col.column_name}
                    className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-[var(--color-subtle)]"
                  >
                    <input
                      type="checkbox"
                      checked={!hiddenCols.has(col.column_name)}
                      data-testid={`list-col-toggle-${col.column_name}`}
                      onChange={() => toggleColumn(col.column_name)}
                    />
                    {col.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <Link
            to="/admin/$doctype/view/report"
            params={{ doctype }}
            search={{ report: undefined }}
            className="fc-btn"
            data-testid="open-report"
          >
            Report
          </Link>
          {/* IMP-010: append rows to this Table from a CSV/Excel file. */}
          <Link
            to="/admin/import"
            search={{ table: doctype }}
            className="fc-btn"
            data-testid="open-import"
          >
            Import
          </Link>
          {(meta.data?.columns ?? []).some((f) => f.column_type === 'Choice') && (
            <Link
              to="/admin/$doctype/view/kanban"
              params={{ doctype }}
              search={{ group_by: undefined }}
              className="fc-btn"
              data-testid="open-kanban"
            >
              Kanban
            </Link>
          )}
          {(meta.data?.columns ?? []).some((f) => f.column_type === 'Date') && (
            <Link
              to="/admin/$doctype/view/calendar"
              params={{ doctype }}
              className="fc-btn"
              data-testid="open-calendar"
            >
              Calendar
            </Link>
          )}
          {/* UI-022: Gantt needs two Date columns (start + end). */}
          {(meta.data?.columns ?? []).filter((f) => f.column_type === 'Date').length >= 2 && (
            <Link
              to="/admin/$doctype/view/gantt"
              params={{ doctype }}
              className="fc-btn"
              data-testid="open-gantt"
            >
              Gantt
            </Link>
          )}
          {isSystemManager && (
            <Link
              to="/admin/permissions/$doctype"
              params={{ doctype }}
              className="fc-btn"
              data-testid="open-permissions"
            >
              Permissions
            </Link>
          )}
        </div>
      </div>
      {onFiltersChange && meta.data && (
        <>
          <StandardFilters meta={meta.data} filters={filters} onChange={onFiltersChange} />
          <FilterBar meta={meta.data} filters={filters} onChange={onFiltersChange} />
        </>
      )}
      {selected.size > 0 && (
        <div
          className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-[var(--color-brand)]/30 bg-[var(--color-brand-tint)] px-3 py-2 text-sm"
          data-testid="bulk-bar"
        >
          <span className="font-medium text-[var(--color-ink)]" data-testid="bulk-count">
            {selected.size} selected
          </span>
          <button
            onClick={bulkDelete}
            disabled={bulkBusy}
            className="fc-btn border-[var(--color-danger)] text-[var(--color-danger)] hover:bg-[var(--color-danger-tint)]"
            data-testid="bulk-delete"
          >
            Delete
          </button>
          <span className="flex items-center gap-2">
            <select
              value={bulkField}
              onChange={(e) => setBulkField(e.target.value)}
              className="fc-input w-40"
              data-testid="bulk-edit-field"
            >
              <option value="">Edit field…</option>
              {editableColumns.map((f) => (
                <option key={f.column_name} value={f.column_name}>
                  {f.label ?? f.column_name}
                </option>
              ))}
            </select>
            {bulkField && (
              <>
                <input
                  value={bulkValue}
                  onChange={(e) => setBulkValue(e.target.value)}
                  placeholder="New value"
                  className="fc-input w-40"
                  data-testid="bulk-edit-value"
                />
                <button
                  onClick={bulkEdit}
                  disabled={bulkBusy}
                  className="fc-btn-primary"
                  data-testid="bulk-edit-apply"
                >
                  Apply
                </button>
              </>
            )}
          </span>
          {bulkError && (
            <span className="text-xs text-[var(--color-danger)]" data-testid="bulk-error">
              {bulkError}
            </span>
          )}
        </div>
      )}
      <div className="fc-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-subtle)] text-left">
            <tr>
              <th className="w-8 border-b border-[var(--color-border)] px-3 py-2">
                <input
                  type="checkbox"
                  data-testid="select-all"
                  checked={rows.length > 0 && rows.every((r) => selected.has(String(r.name)))}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? new Set(rows.map((r) => String(r.name))) : new Set(),
                    )
                  }
                />
              </th>
              {columns.map((col) => (
                <th key={col.column_name} className="border-b border-[var(--color-border)]">
                  <button
                    className="w-full px-3 py-2 text-left font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                    data-testid={`col-${col.column_name}`}
                    onClick={() => toggleSort(col.column_name)}
                  >
                    {col.label}
                    {sort?.field === col.column_name && (sort.dir === 'asc' ? ' ↑' : ' ↓')}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody data-testid="list-rows">
            {rows.map((row) => (
              <tr key={String(row.name)} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-subtle)]">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    data-testid="row-check"
                    checked={selected.has(String(row.name))}
                    onChange={() => toggleRow(String(row.name))}
                  />
                </td>
                {columns.map((col, i) => (
                  <td key={col.column_name} className="px-3 py-2">
                    {i === 0 ? (
                      <Link
                        to="/admin/$doctype/$name"
                        params={{ doctype, name: String(row.name) }}
                        className={`font-medium text-[var(--color-brand)] hover:underline ${
                          col.column_name === 'name' ? 'font-mono text-[13px]' : ''
                        }`}
                      >
                        {cell(row[col.column_name], col.column_type, settings)}
                      </Link>
                    ) : col.column_type === 'Choice' &&
                      row[col.column_name] != null &&
                      row[col.column_name] !== '' ? (
                      <span className="text-[var(--color-ink)]" data-testid={`cell-${col.column_name}`}>
                        <Indicator value={String(row[col.column_name])} />
                      </span>
                    ) : (
                      <span className="text-[var(--color-ink)]" data-testid={`cell-${col.column_name}`}>
                        {cell(row[col.column_name], col.column_type, settings)}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-8 text-center text-[var(--color-ink-faint)]">
                  No rows
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-3 text-sm">
        <button
          disabled={start === 0}
          onClick={() => setStart((s) => Math.max(0, s - PAGE))}
          data-testid="prev-page"
          className="fc-btn disabled:opacity-40"
        >
          Prev
        </button>
        <span className="text-xs text-[var(--color-ink-muted)]" data-testid="page-info">
          {total === 0 ? 0 : start + 1}–{Math.min(start + PAGE, total)} of {total}
        </span>
        <button
          disabled={start + PAGE >= total}
          onClick={() => setStart((s) => s + PAGE)}
          data-testid="next-page"
          className="fc-btn disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  )
}


// Frappe's standard filters (adopted from the PR-2 Desk): typed per-column
// inputs for the list's visible columns — Choices become dropdowns, text-ish
// columns match with contains. They read and write the same URL-driven filter
// list the advanced FilterBar manages, so chips stay in sync.
const STANDARD_TEXT_TYPES = new Set(['Data', 'Reference', 'Email', 'Small Text'])

export function StandardFilters({
  meta,
  filters,
  onChange,
}: {
  meta: import('../lib/meta').TableMeta
  filters: Filter[]
  onChange: (filters: Filter[]) => void
}) {
  const columns = meta.columns
    .filter(
      (f) =>
        f.in_list_view &&
        !f.hidden &&
        (f.column_type === 'Choice' || STANDARD_TEXT_TYPES.has(f.column_type)),
    )
    .slice(0, 4)
  // Drafts for the text inputs (applied on Enter/blur); choices apply at once.
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  if (!columns.length) return null

  function current(columnName: string, op: string): string {
    const hit = filters.find((f) => f[0] === columnName && f[1] === op)
    if (!hit) return ''
    const v = String(hit[2] ?? '')
    return op === 'like' ? v.replace(/^%|%$/g, '') : v
  }

  function apply(columnName: string, op: string, value: string) {
    const rest = filters.filter((f) => f[0] !== columnName)
    onChange(value ? [...rest, [columnName, op, op === 'like' ? `%${value}%` : value]] : rest)
  }

  return (
    <div className="mb-3 flex flex-wrap items-end gap-2" data-testid="standard-filters">
      {columns.map((f) =>
        f.column_type === 'Choice' ? (
          <label key={f.column_name} className="flex flex-col gap-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
              {f.label ?? f.column_name}
            </span>
            <select
              value={current(f.column_name, '=')}
              onChange={(e) => apply(f.column_name, '=', e.target.value)}
              data-testid={`std-filter-${f.column_name}`}
              className="fc-input max-w-[10rem]"
            >
              <option value="">All</option>
              {(f.choices ?? '')
                .split('\n')
                .filter(Boolean)
                .map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
            </select>
          </label>
        ) : (
          <label key={f.column_name} className="flex flex-col gap-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
              {f.label ?? f.column_name}
            </span>
            <input
              value={drafts[f.column_name] ?? current(f.column_name, 'like')}
              onChange={(e) => setDrafts((d) => ({ ...d, [f.column_name]: e.target.value }))}
              onBlur={(e) => apply(f.column_name, 'like', e.target.value.trim())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  apply(f.column_name, 'like', (e.target as HTMLInputElement).value.trim())
                }
              }}
              placeholder={`Filter ${f.label ?? f.column_name}…`}
              data-testid={`std-filter-${f.column_name}`}
              className="fc-input max-w-[10rem]"
            />
          </label>
        ),
      )}
    </div>
  )
}

export function FilterBar({
  meta,
  filters,
  onChange,
}: {
  meta: import('../lib/meta').TableMeta
  filters: Filter[]
  onChange: (filters: Filter[]) => void
}) {
  const fields = [
    { fieldname: 'name', label: 'Name' },
    ...meta.columns
      .filter((f) => !NO_COLUMN_TYPES.has(f.column_type) && !f.hidden)
      .map((f) => ({ fieldname: f.column_name, label: f.label ?? f.column_name })),
  ]
  const [field, setField] = useState('name')
  const [op, setOp] = useState<string>('=')
  const [value, setValue] = useState('')

  function add() {
    if (!value.trim()) return
    const v = op === 'like' ? `%${value.trim()}%` : value.trim()
    onChange([...filters, [field, op, v]])
    setValue('')
  }

  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={field}
          onChange={(e) => setField(e.target.value)}
          data-testid="filter-field"
          className="fc-input max-w-[10rem]"
        >
          {fields.map((f) => (
            <option key={f.fieldname} value={f.fieldname}>
              {f.label}
            </option>
          ))}
        </select>
        <select
          value={op}
          onChange={(e) => setOp(e.target.value)}
          data-testid="filter-op"
          className="fc-input max-w-[10rem]"
        >
          {OPS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Value"
          data-testid="filter-value"
          className="fc-input max-w-[10rem]"
        />
        <button
          onClick={add}
          data-testid="filter-add"
          className="fc-btn"
        >
          Add filter
        </button>
      </div>
      {filters.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2" data-testid="filter-chips">
          {filters.map((f, i) => (
            <span
              key={i}
              className="fc-pill bg-[var(--color-subtle)] text-[var(--color-ink)] gap-1 border border-[var(--color-border)]"
              data-testid="filter-chip"
            >
              {f[0]} {f[1]} {String(f[2])}
              <button
                aria-label="Remove filter"
                onClick={() => onChange(filters.filter((_, j) => j !== i))}
                className="text-gray-400 hover:text-gray-900"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

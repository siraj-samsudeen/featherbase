import { useEffect, useState } from 'react'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ApiError, api, getSessionUser, listResource } from '../lib/api'
import { recentActions, type RecentEntry } from '../lib/recents'
import { NO_COLUMN_TYPES, isSourceReadOnly, listColumns, useMeta } from '../lib/meta'
import { useRealtime } from '../lib/realtime'
import { formatValue, useSettings, type Settings } from '../lib/settings'
import { useIsSystemManager } from '../lib/session'
import { ChecklistSwitch } from './ChecklistView'

export type Filter = [string, string, unknown]

// Deliberately WITHOUT 'related' (NAV-002): the FilterBar's free-text value
// input cannot author a relationship spec, so offering the operator here
// could only produce malformed filters. Related filters arrive via links
// (Connections, Explore) and render as chips like any other filter.
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
  // #100 pattern 5 (Access subdatasheets): rows of tables with Sub-table
  // columns expand their child rows inline via a chevron.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  useEffect(() => setExpanded(new Set()), [filterKey, start, doctype])

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
  const childFields = (meta.data?.columns ?? []).filter(
    (f) => f.column_type === 'Sub-table' && !f.hidden,
  )
  const expandable = childFields.length > 0

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
    // Source-bound rows carry a revision (mapped modified column / file
    // mtime); echo it so a row that changed since it was listed conflicts
    // instead of deleting whatever now sits at that position (csv rows are
    // positional).
    const bound = Boolean(meta.data?.data_source && meta.data?.external_modified)
    try {
      for (const name of selected) {
        let query = ''
        if (bound) {
          const doc = await api.get<Record<string, unknown>>(
            `/api/table/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
          )
          if (doc.updated_at != null)
            query = `?updated_at=${encodeURIComponent(String(doc.updated_at))}`
        }
        await api.delete(
          `/api/table/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}${query}`,
        )
      }
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
          {meta.data?.data_source && (
            <span
              className="fc-pill ml-2 align-middle text-[10px]"
              data-testid="source-badge"
              title={`Rows live on data source ${meta.data.data_source}`}
            >
              {meta.data.data_source} · {meta.data.source_writable ? 'read-write' : 'read-only'}
            </span>
          )}
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
          {/* IMP-010: append rows to this Table from a CSV/Excel file —
              absent on read-only sources (EDS-13). */}
          {!isSourceReadOnly(meta.data) && (
            <Link
              to="/admin/import"
              search={{ table: doctype }}
              className="fc-btn"
              data-testid="open-import"
            >
              Import
            </Link>
          )}
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
          {/* Checklist needs a Sub-table whose row table has a Check column —
              the component renders nothing when the shape is absent. */}
          <ChecklistSwitch doctype={doctype} meta={meta.data} />
          {isSystemManager && (
            <>
              {/* NAM-001: change how new rows in this Table are named. */}
              <Link
                to="/admin/naming/$doctype"
                params={{ doctype }}
                className="fc-btn"
                data-testid="open-naming"
              >
                Naming
              </Link>
              <Link
                to="/admin/permissions/$doctype"
                params={{ doctype }}
                className="fc-btn"
                data-testid="open-permissions"
              >
                Permissions
              </Link>
            </>
          )}
        </div>
      </div>
      {onFiltersChange && <SavedViewsBar doctype={doctype} filters={filters} onApply={onFiltersChange} />}
      {onFiltersChange && <RecentStrip doctype={doctype} onApply={onFiltersChange} />}
      {onFiltersChange && meta.data && (
        <>
          <StandardFilters meta={meta.data} filters={filters} onChange={onFiltersChange} />
          <FilterBar meta={meta.data} filters={filters} onChange={onFiltersChange} />
        </>
      )}
      {selected.size > 0 && !isSourceReadOnly(meta.data) && (
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
              {/* Selection exists only to feed the bulk bar — a read-only
                  source has neither (EDS-13: absent, not disabled). */}
              {!isSourceReadOnly(meta.data) && (
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
              )}
              {expandable && <th className="w-7 border-b border-[var(--color-border)]" />}
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
              <ListRow
                key={String(row.name)}
                row={row}
                doctype={doctype}
                columns={columns}
                settings={settings}
                selected={selected.has(String(row.name))}
                onToggleSelect={() => toggleRow(String(row.name))}
                selectable={!isSourceReadOnly(meta.data)}
                expandable={expandable}
                childFields={childFields}
                expanded={expanded.has(String(row.name))}
                onToggleExpand={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev)
                    if (next.has(String(row.name))) next.delete(String(row.name))
                    else next.add(String(row.name))
                    return next
                  })
                }
              />
            ))}
            {!rows.length && (
              <tr>
                <td
                  colSpan={
                    columns.length +
                    (expandable ? 1 : 0) +
                    (isSourceReadOnly(meta.data) ? 0 : 1)
                  }
                  className="px-3 py-8 text-center text-[var(--color-ink-faint)]"
                >
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

// One list row (+ its optional expanded child-rows row). Extracted so the
// chevron and the inline subgrid don't clutter the main table loop.
function ListRow({
  row,
  doctype,
  columns,
  settings,
  selected,
  onToggleSelect,
  selectable,
  expandable,
  childFields,
  expanded,
  onToggleExpand,
}: {
  row: Record<string, unknown>
  doctype: string
  columns: { column_name: string; label: string; column_type: string }[]
  settings: Settings
  selected: boolean
  onToggleSelect: () => void
  // Read-only sources have no bulk bar, so no selection either (EDS-13).
  selectable: boolean
  expandable: boolean
  childFields: import('../lib/meta').ColumnDef[]
  expanded: boolean
  onToggleExpand: () => void
}) {
  return (
    <>
      <tr className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-subtle)]">
        {expandable && (
          <td className="pl-2">
            <button
              onClick={onToggleExpand}
              aria-label={expanded ? 'Collapse child rows' : 'Expand child rows'}
              aria-expanded={expanded}
              data-testid="row-expand"
              className={`rounded px-1 text-xs text-[var(--color-ink-faint)] transition-transform hover:text-[var(--color-brand)] ${
                expanded ? 'rotate-90 text-[var(--color-brand)]' : ''
              }`}
            >
              ▶
            </button>
          </td>
        )}
        {selectable && (
          <td className="px-3 py-2">
            <input
              type="checkbox"
              data-testid="row-check"
              checked={selected}
              onChange={onToggleSelect}
            />
          </td>
        )}
        {columns.map((col, i) => (
          <td key={col.column_name} className="px-3 py-2">
            {i === 0 ? (
              <Link
                to="/admin/$doctype/$name"
                search={{ prefill: undefined }}
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
      {expanded && (
        <tr data-testid="expanded-row">
          <td
            colSpan={columns.length + 1 + (selectable ? 1 : 0)}
            className="border-b border-[var(--color-border)] bg-[var(--color-subtle)] py-3 pl-10 pr-4"
          >
            <InlineChildren doctype={doctype} name={String(row.name)} childFields={childFields} />
          </td>
        </tr>
      )}
    </>
  )
}

// The expanded row's content: every Sub-table column's rows, read-only,
// fetched through the ordinary row GET (children arrive embedded).
function InlineChildren({
  doctype,
  name,
  childFields,
}: {
  doctype: string
  name: string
  childFields: import('../lib/meta').ColumnDef[]
}) {
  const settings = useSettings()
  const doc = useQuery({
    queryKey: ['doc', doctype, name],
    queryFn: () =>
      api.get<Record<string, unknown>>(
        `/api/table/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
      ),
  })
  if (doc.isLoading) return <p className="text-xs text-[var(--color-ink-faint)]">Loading…</p>
  if (doc.isError) return <p className="text-xs text-[var(--color-danger)]">Cannot load {name}</p>
  return (
    <div className="flex flex-col gap-3">
      {childFields.map((f) => (
        <InlineChildGrid
          key={f.column_name}
          field={f}
          rows={(doc.data?.[f.column_name] as Record<string, unknown>[]) ?? []}
          settings={settings}
        />
      ))}
    </div>
  )
}

function InlineChildGrid({
  field,
  rows,
  settings,
}: {
  field: import('../lib/meta').ColumnDef
  rows: Record<string, unknown>[]
  settings: Settings
}) {
  const childMeta = useMeta(field.row_table ?? '')
  if (!childMeta.data) return null
  const cols = childMeta.data.columns.filter(
    (f) => !NO_COLUMN_TYPES.has(f.column_type) && !f.hidden,
  )
  const currencyCols = cols.filter((c) => c.column_type === 'Currency')
  return (
    <div className="overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)]" data-testid={`inline-children-${field.column_name}`}>
      <div className="border-b border-[var(--color-border)] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
        {field.label ?? field.column_name} ({rows.length})
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.column_name} className="border-b border-[var(--color-border)] px-3 py-1 text-left font-medium text-[var(--color-ink-muted)]">
                {c.label ?? c.column_name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={String(r.name ?? i)} className="border-b border-[var(--color-border)] last:border-0">
              {cols.map((c) => (
                <td key={c.column_name} className="px-3 py-1 text-[var(--color-ink)]">
                  {c.column_type === 'Reference' && c.reference_table && r[c.column_name] ? (
                    <Link
                      to="/admin/$doctype/$name"
                      search={{ prefill: undefined }}
                        params={{ doctype: c.reference_table, name: String(r[c.column_name]) }}
                      className="text-[var(--color-brand)] hover:underline"
                    >
                      {String(r[c.column_name])}
                    </Link>
                  ) : (
                    cell(r[c.column_name], c.column_type, settings)
                  )}
                </td>
              ))}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={cols.length} className="px-3 py-3 text-center text-[var(--color-ink-faint)]">
                No rows
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {currencyCols.length > 0 && rows.length > 0 && (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-subtle)] px-3 py-1 text-[11px] text-[var(--color-ink-muted)]">
          {currencyCols
            .map(
              (c) =>
                `Σ ${c.label ?? c.column_name}: ${
                  formatValue(
                    'Currency',
                    rows.reduce((s, r) => s + (Number(r[c.column_name]) || 0), 0),
                    settings,
                  )
                }`,
            )
            .join(' · ')}
        </div>
      )}
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

// Chips must stay readable for non-scalar filter values: a 'related'
// relationship filter (NAV-002) names its target, long in-lists truncate.
export function filterValueLabel(op: string, value: unknown): string {
  if (op === 'related' && value && typeof value === 'object' && !Array.isArray(value)) {
    const spec = value as { table?: string; via?: string }
    return spec.via ? `${spec.table ?? ''} via ${spec.via}` : String(spec.table ?? '')
  }
  if (Array.isArray(value))
    return value.length > 3
      ? `${value.slice(0, 3).map(String).join(', ')} +${value.length - 3}`
      : value.map(String).join(', ')
  return String(value)
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
              {f[0]} {f[1]} {filterValueLabel(f[1], f[2])}
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

// #101 Phase 2: recall placed where the repeat work happens — this user's
// recent rows and recent filter sets for THIS table, from the same
// localStorage buffer the command bar reads. A view chip re-applies its
// whole filter set through the normal onFiltersChange pipeline (the filters
// live in the URL, so this is just replaying a remembered list state).
function RecentStrip({
  doctype,
  onApply,
}: {
  doctype: string
  onApply: (filters: Filter[]) => void
}) {
  const user = getSessionUser()
  const entries = user ? recentActions(user.name, 60) : []
  const rows = entries.filter((e) => e.kind === 'row' && e.key.startsWith(`row:${doctype}/`)).slice(0, 4)
  const views = entries
    .map((e) => {
      if (e.kind !== 'list' || !e.key.startsWith(`list:${doctype}?`)) return null
      try {
        const parsed = JSON.parse(e.key.slice(`list:${doctype}?`.length)) as Filter[]
        return Array.isArray(parsed) && parsed.length > 0 ? { entry: e, parsed } : null
      } catch {
        return null
      }
    })
    .filter((v): v is { entry: RecentEntry; parsed: Filter[] } => v !== null)
    .slice(0, 3)
  if (rows.length === 0 && views.length === 0) return null
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="recent-strip">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
        Recent
      </span>
      {rows.map((r) => (
        <Link
          key={r.key}
          to="/admin/$doctype/$name"
          params={{ doctype, name: r.label }}
          search={{ prefill: undefined }}
          data-testid="recent-strip-row"
          className="rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2.5 py-0.5 text-xs text-[var(--color-ink-muted)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
        >
          {r.label}
        </Link>
      ))}
      {views.map(({ entry, parsed }) => (
        <button
          key={entry.key}
          type="button"
          onClick={() => onApply(parsed)}
          data-testid="recent-strip-view"
          title={entry.sub}
          className="max-w-72 truncate rounded-full bg-[var(--color-brand-tint)] px-2.5 py-0.5 text-xs font-medium text-[var(--color-brand)] hover:opacity-80"
        >
          {entry.sub}
        </button>
      ))}
    </div>
  )
}

// #101 Phase 6: saved views + the proactive nudge. A saved view is a named,
// shareable filter set (server-owned rows); the nudge notices the same
// filter set applied 3+ times inside a week and offers to name it — the
// habit becomes an artifact instead of a memory.
const NUDGE_THRESHOLD = 3
const NUDGE_WINDOW_MS = 7 * 86_400_000

interface SavedViewRow {
  name: string
  label: string
  filters: Filter[]
  shared: boolean
  mine: boolean
}

function SavedViewsBar({
  doctype,
  filters,
  onApply,
}: {
  doctype: string
  filters: Filter[]
  onApply: (filters: Filter[]) => void
}) {
  const user = getSessionUser()
  const queryClient = useQueryClient()
  const [nudgeGone, setNudgeGone] = useState(false)
  const [applyCount, setApplyCount] = useState(0)
  const [nudgeName, setNudgeName] = useState('')

  const views = useQuery({
    queryKey: ['saved-views', doctype],
    enabled: Boolean(user),
    queryFn: () => api.get<{ views: SavedViewRow[] }>(`/api/saved_views?table=${encodeURIComponent(doctype)}`),
  })

  const sig = filters.length > 0 ? JSON.stringify(filters) : ''
  const countKey = user ? `fc-filter-count:${user.name}` : ''
  const dismissKey = user ? `fc-nudge-dismissed:${user.name}` : ''

  // Every arrival at a non-empty filter state counts as one application.
  useEffect(() => {
    setNudgeGone(false)
    if (!user || !sig) {
      setApplyCount(0)
      return
    }
    try {
      const store = JSON.parse(localStorage.getItem(countKey) ?? '{}') as Record<
        string,
        { n: number; t: number }
      >
      const k = `${doctype}|${sig}`
      const rec = store[k] ?? { n: 0, t: 0 }
      const now = Date.now()
      if (now - rec.t > NUDGE_WINDOW_MS) rec.n = 0
      // A re-mount within half a second is the same arrival (StrictMode
      // double-invokes effects in dev), not a second application.
      if (now - rec.t > 500) rec.n += 1
      rec.t = now
      store[k] = rec
      const keys = Object.keys(store)
      if (keys.length > 50) {
        keys.sort((a, b) => store[a].t - store[b].t)
        for (const stale of keys.slice(0, keys.length - 50)) delete store[stale]
      }
      localStorage.setItem(countKey, JSON.stringify(store))
      setApplyCount(rec.n)
    } catch {
      setApplyCount(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctype, sig, user?.name])

  if (!user) return null
  const list = views.data?.views ?? []

  const matching = list.find((v) => JSON.stringify(v.filters) === sig)
  let dismissed = false
  try {
    dismissed = Boolean(
      (JSON.parse(localStorage.getItem(dismissKey) ?? '{}') as Record<string, boolean>)[
        `${doctype}|${sig}`
      ],
    )
  } catch {
    /* ignore */
  }
  const showNudge = Boolean(sig && applyCount >= NUDGE_THRESHOLD && !matching && !dismissed && !nudgeGone)

  async function saveView() {
    const label = nudgeName.trim() || `${doctype} view`
    await api.post('/api/saved_views', { table: doctype, label, filters })
    try {
      const store = JSON.parse(localStorage.getItem(countKey) ?? '{}') as Record<string, unknown>
      delete store[`${doctype}|${sig}`]
      localStorage.setItem(countKey, JSON.stringify(store))
    } catch {
      /* ignore */
    }
    setNudgeGone(true)
    void queryClient.invalidateQueries({ queryKey: ['saved-views', doctype] })
  }

  function dismissNudge() {
    try {
      const store = JSON.parse(localStorage.getItem(dismissKey) ?? '{}') as Record<string, boolean>
      store[`${doctype}|${sig}`] = true
      localStorage.setItem(dismissKey, JSON.stringify(store))
    } catch {
      /* ignore */
    }
    setNudgeGone(true)
  }

  if (list.length === 0 && !showNudge) return null

  return (
    <div className="mb-3" data-testid="saved-views-bar">
      {list.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
            Views
          </span>
          {list.map((v) => {
            const active = JSON.stringify(v.filters) === sig
            return (
              <span
                key={v.name}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  active
                    ? 'bg-[var(--color-brand)] text-white'
                    : 'bg-[var(--color-brand-tint)] text-[var(--color-brand)]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onApply(v.filters)}
                  data-testid="saved-view-chip"
                  title={v.mine ? undefined : `shared by its owner`}
                >
                  ★ {v.label}
                  {v.shared && <span className="ml-1 opacity-70">{v.mine ? '· shared' : '· 👥'}</span>}
                </button>
                {v.mine && active && (
                  <button
                    type="button"
                    data-testid="saved-view-share"
                    title={v.shared ? 'Make private' : 'Share with everyone'}
                    onClick={async () => {
                      await api.post(`/api/saved_views/${encodeURIComponent(v.name)}/share`, {
                        shared: !v.shared,
                      })
                      void queryClient.invalidateQueries({ queryKey: ['saved-views', doctype] })
                    }}
                    className="rounded-full px-1 hover:bg-white/20"
                  >
                    {v.shared ? '🔒' : '👥'}
                  </button>
                )}
                {v.mine && (
                  <button
                    type="button"
                    aria-label={`Delete view ${v.label}`}
                    data-testid="saved-view-delete"
                    onClick={async () => {
                      await api.delete(`/api/saved_views/${encodeURIComponent(v.name)}`)
                      void queryClient.invalidateQueries({ queryKey: ['saved-views', doctype] })
                    }}
                    className="rounded-full px-1 hover:bg-white/20"
                  >
                    ✕
                  </button>
                )}
              </span>
            )
          })}
        </div>
      )}
      {showNudge && (
        <div
          className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-[var(--color-brand)]/40 bg-[var(--color-brand-tint)] px-3 py-2 text-sm"
          data-testid="filter-nudge"
        >
          <span className="text-[var(--color-ink)]">
            That's <b>{applyCount}×</b> for this filter in a week — save it as a view?
          </span>
          <input
            value={nudgeName}
            onChange={(e) => setNudgeName(e.target.value)}
            placeholder={`${doctype} view`}
            data-testid="nudge-name"
            className="fc-input !w-44 !py-0.5 text-xs"
          />
          <button type="button" onClick={() => void saveView()} data-testid="nudge-save" className="fc-btn-primary !py-0.5 text-xs">
            Save view
          </button>
          <button type="button" onClick={dismissNudge} data-testid="nudge-dismiss" className="fc-btn !py-0.5 text-xs">
            Not now
          </button>
        </div>
      )}
    </div>
  )
}

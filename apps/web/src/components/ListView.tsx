import { useEffect, useState } from 'react'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ApiError, api, getSessionUser, listResource } from '../lib/api'
import { recentActions, type RecentEntry } from '../lib/recents'
import { NO_COLUMN_TYPES, isSourceReadOnly, listColumns, useMeta } from '../lib/meta'
import { useRealtime } from '../lib/realtime'
import { formatValue, useSettings, type Settings } from '../lib/settings'
import { useIsSystemManager } from '../lib/session'
import { useStepOptions, type Step } from '../lib/explore-steps'
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
  table,
  filters = [],
  onFiltersChange,
}: {
  table: string
  filters?: Filter[]
  onFiltersChange?: (filters: Filter[]) => void
}) {
  const meta = useMeta(table)
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
  useEffect(() => setSelected(new Set()), [filterKey, start, table])
  // DEL-J1 (docs/specs/0003-table-deletion.md): deleting the whole Table.
  // The confirmation must carry the LIVE row count, never a bare "sure?".
  const navigate = useNavigate()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const deleteCount = useQuery({
    queryKey: ['delete-count', table],
    enabled: confirmingDelete,
    queryFn: () => api.post<{ count: number }>('/api/dashboard/count', { table }),
  })
  async function deleteTable() {
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await api.delete(`/api/table_def/${encodeURIComponent(table)}`)
      // Drop this table's queries (refetching them would 404), then let the
      // rest of the app refetch what the sweep touched (nav, home pages).
      for (const key of ['meta', 'list', 'doc', 'delete-count'])
        queryClient.removeQueries({ queryKey: [key, table] })
      await navigate({ to: '/admin/all-tables' })
      void queryClient.invalidateQueries()
    } catch (e) {
      setDeleteError(e instanceof ApiError ? e.message : String(e))
      setDeleteBusy(false)
    }
  }
  // #100 pattern 5 (Access subdatasheets): rows of tables with Sub-table
  // columns expand their child rows inline via a chevron.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  useEffect(() => setExpanded(new Set()), [filterKey, start, table])

  // RT-001: another session creating/updating/deleting a doc of this type
  // refreshes the list without a reload.
  useRealtime([`list:${table}`], () => {
    void queryClient.invalidateQueries({ queryKey: ['list', table] })
  })

  // UI-013: load this user's saved view settings (sort + hidden columns)
  // once per Table. Filters stay URL-driven (UI-003), so they're not
  // persisted here — this covers the durable "customize a list" bits.
  useEffect(() => {
    let cancelled = false
    setSettingsLoaded(false)
    api
      .get<{ settings: { sort?: typeof sort; hiddenCols?: string[] } | null }>(
        `/api/user_settings/${encodeURIComponent(table)}`,
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
    // Only re-run when the Table changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table])

  // Persist settings whenever the user changes them (after the initial load).
  function persist(next: { sort?: typeof sort; hiddenCols?: Set<string> }) {
    if (!settingsLoaded) return
    void api.put(`/api/user_settings/${encodeURIComponent(table)}`, {
      sort: next.sort !== undefined ? next.sort : sort,
      hiddenCols: [...(next.hiddenCols ?? hiddenCols)],
    })
  }

  const allColumns = meta.data ? listColumns(meta.data) : []
  const columns = allColumns.filter((c) => !hiddenCols.has(c.column_name))
  // A bound table only has updated_at when the source table has a modified
  // column to map (external_modified) — sending it as the explicit order
  // makes the server refuse EVERY list load (a caller-supplied order_by must
  // resolve; only server-side defaults fall back to the pk). That covers both
  // the hardcoded fallback AND a stale stored sort_column ('updated_at' is
  // the table_def DB default; migration 0075 repairs it, this guards the
  // window). #176
  const boundNoRevision = Boolean(meta.data?.data_source && !meta.data.external_modified)
  const metaSortColumn =
    boundNoRevision && meta.data?.sort_column === 'updated_at' ? '' : (meta.data?.sort_column ?? '')
  const orderBy = sort
    ? `${sort.field} ${sort.dir}`
    : meta.data
      ? `${metaSortColumn || (boundNoRevision ? 'name' : 'updated_at')} ${meta.data.sort_order || 'desc'}`
      : undefined

  const list = useQuery({
    queryKey: ['list', table, columns.map((c) => c.column_name), orderBy, start, filterKey],
    enabled: Boolean(meta.data),
    placeholderData: keepPreviousData,
    queryFn: () =>
      listResource(table, {
        filters,
        fields: columns.map((c) => c.column_name),
        order_by: orderBy,
        limit_start: start,
        limit_page_length: PAGE,
      }),
  })

  if (meta.isLoading) return <p className="text-sm text-gray-400">Loading…</p>
  // DEL-R9: the server's not-found can carry a tombstone ("X was deleted by
  // … on …") — show its words, not a generic shrug.
  if (meta.isError)
    return (
      <p className="text-sm text-red-600" data-testid="list-error">
        {meta.error instanceof ApiError ? meta.error.message : `Cannot load ${table}`}
      </p>
    )

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
  // normal row lifecycle (delete_doc / save_row) — no side-channel.
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
    await queryClient.invalidateQueries({ queryKey: ['list', table] })
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
            `/api/table/${encodeURIComponent(table)}/${encodeURIComponent(name)}`,
          )
          if (doc.updated_at != null)
            query = `?updated_at=${encodeURIComponent(String(doc.updated_at))}`
        }
        await api.delete(
          `/api/table/${encodeURIComponent(table)}/${encodeURIComponent(name)}${query}`,
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
          `/api/table/${encodeURIComponent(table)}/${encodeURIComponent(name)}`,
        )
        await api.patch(`/api/table/${encodeURIComponent(table)}/${encodeURIComponent(name)}`, {
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
            {table}
          </div>
          <h1 className="text-xl font-semibold text-[var(--color-ink)]">{table}</h1>
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
          {/* TLC-R1 (docs/specs/0007-table-lifecycle.md): the create
              affordance is metadata-gated and lives HERE, in the toolbar of
              the list the user is already looking at. It used to exist only
              as an awesomebar suggestion, which meant a table you had just
              built could not be filled unless you knew to search for its own
              name (#247). Absent, not disabled, where rows cannot be made:
              a read-only source owns its rows (EDS-13), a settings table
              has one row and no list at all, and a sub-table's rows exist only
              inside a parent — `saveDoc` refuses a direct child insert, so
              offering New on a directly-reached child list could only ever
              produce an error. */}
          {!isSourceReadOnly(meta.data) &&
            meta.data?.kind !== 'settings' &&
            meta.data?.kind !== 'sub_table' && (
            <Link
              to="/admin/$table/$name"
              params={{ table, name: 'new' }}
              search={{ prefill: undefined }}
              className="fc-btn-primary"
              data-testid="list-new"
            >
              New
            </Link>
          )}
          <Link
            to="/admin/$table/view/report"
            params={{ table }}
            search={{ report: undefined }}
            className="fc-btn"
            data-testid="open-report"
          >
            Report
          </Link>
          <ExploreSplitButton table={table} />
          {/* IMP-010: append rows to this Table from a CSV/Excel file —
              absent on read-only sources (EDS-13). */}
          {!isSourceReadOnly(meta.data) && (
            <Link
              to="/admin/import"
              search={{ table: table }}
              className="fc-btn"
              data-testid="open-import"
            >
              Import
            </Link>
          )}
          {/* #209: add a column, or fix a misspelled one, without rebuilding
              the Table. Absent on system Tables (their columns are the
              platform's) and on bound ones (their storage is the source's). */}
          {!meta.data?.system && !meta.data?.data_source && (
            <Link
              to="/admin/$table/columns"
              params={{ table }}
              className="fc-btn"
              data-testid="open-columns"
            >
              Columns
            </Link>
          )}
          {/* #208: two Tables that turned out to be the same thing. */}
          {!meta.data?.system && !meta.data?.data_source && (
            <Link
              to="/admin/$table/merge"
              params={{ table }}
              className="fc-btn"
              data-testid="open-merge"
            >
              Merge into…
            </Link>
          )}
          {(meta.data?.columns ?? []).some((f) => f.column_type === 'Choice') && (
            <Link
              to="/admin/$table/view/kanban"
              params={{ table }}
              search={{ group_by: undefined }}
              className="fc-btn"
              data-testid="open-kanban"
            >
              Kanban
            </Link>
          )}
          {(meta.data?.columns ?? []).some((f) => f.column_type === 'Date') && (
            <Link
              to="/admin/$table/view/calendar"
              params={{ table }}
              className="fc-btn"
              data-testid="open-calendar"
            >
              Calendar
            </Link>
          )}
          {/* UI-022: Gantt needs two Date columns (start + end). */}
          {(meta.data?.columns ?? []).filter((f) => f.column_type === 'Date').length >= 2 && (
            <Link
              to="/admin/$table/view/gantt"
              params={{ table }}
              className="fc-btn"
              data-testid="open-gantt"
            >
              Gantt
            </Link>
          )}
          {/* Checklist needs a Sub-table whose row table has a Check column —
              the component renders nothing when the shape is absent. */}
          <ChecklistSwitch table={table} meta={meta.data} />
          {isSystemManager && (
            <>
              {/* NAM-001: change how new rows in this Table are named. */}
              <Link
                to="/admin/naming/$table"
                params={{ table }}
                className="fc-btn"
                data-testid="open-naming"
              >
                Naming
              </Link>
              <Link
                to="/admin/permissions/$table"
                params={{ table }}
                className="fc-btn"
                data-testid="open-permissions"
              >
                Permissions
              </Link>
              {/* DEL-J1/DEL-R1 (docs/specs/0003-table-deletion.md): the
                  affordance is generic and metadata-gated — never rendered
                  for system tables, never per-table code. */}
              {!meta.data?.system && (
                <button
                  onClick={() => setConfirmingDelete(true)}
                  className="fc-btn border-[var(--color-danger)] text-[var(--color-danger)] hover:bg-[var(--color-danger-tint)]"
                  data-testid="delete-table"
                >
                  Delete Table
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {/* DEL-J1.2: a real dialog — labelled, Escape-dismissable — that names
          the Table and its live row count before anything irreversible. */}
      {confirmingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => !deleteBusy && setConfirmingDelete(false)}
          onKeyDown={(e) => e.key === 'Escape' && !deleteBusy && setConfirmingDelete(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-table-title"
            className="fc-card w-full max-w-md p-4"
            data-testid="delete-table-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-table-title" className="mb-2 text-base font-semibold text-[var(--color-ink)]">
              Delete {table}?
            </h2>
            <p className="mb-3 text-sm text-[var(--color-ink-muted)]" data-testid="delete-table-count">
              {deleteCount.data
                ? `${deleteCount.data.count} row${deleteCount.data.count === 1 ? '' : 's'} will be permanently deleted.`
                : 'Counting rows…'}{' '}
              This cannot be undone.
            </p>
            {deleteError && (
              <p className="mb-3 text-sm text-[var(--color-danger)]" data-testid="delete-table-error">
                {deleteError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                autoFocus
                onClick={() => setConfirmingDelete(false)}
                disabled={deleteBusy}
                className="fc-btn"
                data-testid="delete-table-cancel"
              >
                Cancel
              </button>
              <button
                onClick={deleteTable}
                disabled={deleteBusy || !deleteCount.data}
                className="fc-btn border-[var(--color-danger)] text-[var(--color-danger)] hover:bg-[var(--color-danger-tint)] disabled:opacity-40"
                data-testid="delete-table-confirm"
              >
                {deleteBusy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
      {onFiltersChange && <SavedViewsBar table={table} filters={filters} onApply={onFiltersChange} />}
      {onFiltersChange && <RecentStrip table={table} onApply={onFiltersChange} />}
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
                    checked={rows.length > 0 && rows.every((r) => selected.has(String(r.row_id)))}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? new Set(rows.map((r) => String(r.row_id))) : new Set(),
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
                key={String(row.row_id)}
                row={row}
                table={table}
                columns={columns}
                settings={settings}
                selected={selected.has(String(row.row_id))}
                onToggleSelect={() => toggleRow(String(row.row_id))}
                selectable={!isSourceReadOnly(meta.data)}
                expandable={expandable}
                childFields={childFields}
                expanded={expanded.has(String(row.row_id))}
                onToggleExpand={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev)
                    if (next.has(String(row.row_id))) next.delete(String(row.row_id))
                    else next.add(String(row.row_id))
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
                  className={`px-3 py-8 text-center ${list.isError ? 'text-[var(--color-danger)]' : 'text-[var(--color-ink-faint)]'}`}
                  data-testid={list.isError ? 'list-rows-error' : undefined}
                >
                  {/* A refused list query is an error, not an empty table —
                      rendering it as "No rows" hides real data (#176). */}
                  {list.isError ? (
                    list.error instanceof ApiError ? (
                      list.error.message
                    ) : (
                      `Cannot load rows for ${table}`
                    )
                  ) : (
                    <>
                      No rows
                      {/* TLC-J1.2: an empty table is the moment the user most
                          needs the way forward, so the empty state carries it
                          too — the toolbar action is not the only door. */}
                      {!isSourceReadOnly(meta.data) &&
                        meta.data?.kind !== 'settings' &&
                        meta.data?.kind !== 'sub_table' && (
                        <>
                          {' — '}
                          <Link
                            to="/admin/$table/$name"
                            params={{ table, name: 'new' }}
                            search={{ prefill: undefined }}
                            className="text-[var(--color-brand)] underline"
                            data-testid="list-empty-new"
                          >
                            add the first one
                          </Link>
                        </>
                      )}
                    </>
                  )}
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
  table,
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
  table: string
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
                to="/admin/$table/$name"
                search={{ prefill: undefined }}
                params={{ table, name: String(row.row_id) }}
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
            <InlineChildren table={table} name={String(row.row_id)} childFields={childFields} />
          </td>
        </tr>
      )}
    </>
  )
}

// The expanded row's content: every Sub-table column's rows, read-only,
// fetched through the ordinary row GET (children arrive embedded).
function InlineChildren({
  table,
  name,
  childFields,
}: {
  table: string
  name: string
  childFields: import('../lib/meta').ColumnDef[]
}) {
  const settings = useSettings()
  const doc = useQuery({
    queryKey: ['doc', table, name],
    queryFn: () =>
      api.get<Record<string, unknown>>(
        `/api/table/${encodeURIComponent(table)}/${encodeURIComponent(name)}`,
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
            <tr key={String(r.row_id ?? i)} className="border-b border-[var(--color-border)] last:border-0">
              {cols.map((c) => (
                <td key={c.column_name} className="px-3 py-1 text-[var(--color-ink)]">
                  {c.column_type === 'Reference' && c.reference_table && r[c.column_name] ? (
                    <Link
                      to="/admin/$table/$name"
                      search={{ prefill: undefined }}
                        params={{ table: c.reference_table, name: String(r[c.column_name]) }}
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
    { fieldname: 'row_id', label: 'Row ID' },
    ...meta.columns
      .filter((f) => !NO_COLUMN_TYPES.has(f.column_type) && !f.hidden)
      .map((f) => ({ fieldname: f.column_name, label: f.label ?? f.column_name })),
  ]
  const [field, setField] = useState('row_id')
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
  table,
  onApply,
}: {
  table: string
  onApply: (filters: Filter[]) => void
}) {
  const user = getSessionUser()
  const entries = user ? recentActions(user.row_id, 60) : []
  const rows = entries.filter((e) => e.kind === 'row' && e.key.startsWith(`row:${table}/`)).slice(0, 4)
  const views = entries
    .map((e) => {
      if (e.kind !== 'list' || !e.key.startsWith(`list:${table}?`)) return null
      try {
        const parsed = JSON.parse(e.key.slice(`list:${table}?`.length)) as Filter[]
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
          to="/admin/$table/$name"
          params={{ table, name: r.label }}
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
  row_id: string
  label: string
  filters: Filter[]
  shared: boolean
  mine: boolean
}

function SavedViewsBar({
  table,
  filters,
  onApply,
}: {
  table: string
  filters: Filter[]
  onApply: (filters: Filter[]) => void
}) {
  const user = getSessionUser()
  const queryClient = useQueryClient()
  const [nudgeGone, setNudgeGone] = useState(false)
  const [applyCount, setApplyCount] = useState(0)
  const [nudgeName, setNudgeName] = useState('')

  const views = useQuery({
    queryKey: ['saved-views', table],
    enabled: Boolean(user),
    queryFn: () => api.get<{ views: SavedViewRow[] }>(`/api/saved_views?table=${encodeURIComponent(table)}`),
  })

  const sig = filters.length > 0 ? JSON.stringify(filters) : ''
  const countKey = user ? `fc-filter-count:${user.row_id}` : ''
  const dismissKey = user ? `fc-nudge-dismissed:${user.row_id}` : ''

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
      const k = `${table}|${sig}`
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
  }, [table, sig, user?.row_id])

  if (!user) return null
  const list = views.data?.views ?? []

  const matching = list.find((v) => JSON.stringify(v.filters) === sig)
  let dismissed = false
  try {
    dismissed = Boolean(
      (JSON.parse(localStorage.getItem(dismissKey) ?? '{}') as Record<string, boolean>)[
        `${table}|${sig}`
      ],
    )
  } catch {
    /* ignore */
  }
  const showNudge = Boolean(sig && applyCount >= NUDGE_THRESHOLD && !matching && !dismissed && !nudgeGone)

  async function saveView() {
    const label = nudgeName.trim() || `${table} view`
    await api.post('/api/saved_views', { table: table, label, filters })
    try {
      const store = JSON.parse(localStorage.getItem(countKey) ?? '{}') as Record<string, unknown>
      delete store[`${table}|${sig}`]
      localStorage.setItem(countKey, JSON.stringify(store))
    } catch {
      /* ignore */
    }
    setNudgeGone(true)
    void queryClient.invalidateQueries({ queryKey: ['saved-views', table] })
  }

  function dismissNudge() {
    try {
      const store = JSON.parse(localStorage.getItem(dismissKey) ?? '{}') as Record<string, boolean>
      store[`${table}|${sig}`] = true
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
                key={v.row_id}
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
                      await api.post(`/api/saved_views/${encodeURIComponent(v.row_id)}/share`, {
                        shared: !v.shared,
                      })
                      void queryClient.invalidateQueries({ queryKey: ['saved-views', table] })
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
                      await api.delete(`/api/saved_views/${encodeURIComponent(v.row_id)}`)
                      void queryClient.invalidateQueries({ queryKey: ['saved-views', table] })
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
            placeholder={`${table} view`}
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

// Option B of the Explore entry-point exploration: a split button on the
// list header. The main face opens the cross-filter Explore rooted at this
// table; the chevron reveals this table's chainable dependents — the SAME
// options Explore's own step pickers offer (the shared explore-steps seam)
// — to deep-link a pre-built chain. Selection is capped at two, the pane
// limit, and kept in CHECK order because chain order is pane order. No
// per-option row counts on purpose: each would cost a query.
function ExploreSplitButton({ table }: { table: string }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const { options } = useStepOptions(open ? table : undefined)
  const [picked, setPicked] = useState<string[]>([])
  const togglePick = (key: string) =>
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key].slice(0, 2)))
  const openExplore = (chain: Step[]) =>
    navigate({
      to: '/admin/explore',
      search: {
        root: table,
        chain: chain.length ? JSON.stringify(chain) : undefined,
        select: undefined,
      },
    })
  return (
    <div className="relative">
      <div className="flex">
        <button
          type="button"
          onClick={() => void openExplore([])}
          className="fc-btn rounded-r-none"
          data-testid="open-explore"
        >
          Explore
        </button>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="Explore with a chain"
          aria-expanded={open}
          className="fc-btn rounded-l-none border-l-0 !px-1.5"
          data-testid="explore-split-toggle"
        >
          ▾
        </button>
      </div>
      {open && (
        <div className="fc-card absolute right-0 z-10 mt-1 w-64 p-2" data-testid="explore-split-panel">
          <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
            Chain into
          </div>
          {options.map((o) => {
            const checked = picked.includes(o.key)
            return (
              <label
                key={o.key}
                className={`flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-[var(--color-subtle)] ${
                  !checked && picked.length >= 2 ? 'opacity-40' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && picked.length >= 2}
                  data-testid="explore-split-option"
                  onChange={() => togglePick(o.key)}
                />
                {o.label}
              </label>
            )
          })}
          {!options.length && (
            <p className="px-2 py-1 text-sm text-[var(--color-ink-faint)]">No dependents</p>
          )}
          <div className="mt-1 border-t border-[var(--color-border)] px-2 pt-2">
            <button
              type="button"
              disabled={!picked.length}
              onClick={() =>
                void openExplore(
                  picked
                    .map((k) => options.find((o) => o.key === k)?.step)
                    .filter((s): s is Step => Boolean(s)),
                )
              }
              className="fc-btn-primary w-full !py-1 text-xs"
              data-testid="explore-split-open"
            >
              Open
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

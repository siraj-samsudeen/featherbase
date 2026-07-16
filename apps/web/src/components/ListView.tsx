import { useEffect, useState } from 'react'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ApiError, api, listResource } from '../lib/api'
import { NO_COLUMN_TYPES, listColumns, useMeta } from '../lib/meta'

export type Filter = [string, string, unknown]

const OPS = ['=', '!=', 'like', '>', '<', '>=', '<='] as const

const PAGE = 20

function cell(value: unknown): string {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? '✓' : '✗'
  return String(value)
}

// UI-002/UI-003: ONE list component renders every DocType from its metadata.
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
  const queryClient = useQueryClient()
  const [sort, setSort] = useState<{ field: string; dir: 'asc' | 'desc' } | null>(null)
  const [start, setStart] = useState(0)
  // UI-012: bulk selection state.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkField, setBulkField] = useState('')
  const [bulkValue, setBulkValue] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const filterKey = JSON.stringify(filters)
  useEffect(() => setStart(0), [filterKey])
  useEffect(() => setSelected(new Set()), [filterKey, start, doctype])

  const columns = meta.data ? listColumns(meta.data) : []
  const orderBy = sort
    ? `${sort.field} ${sort.dir}`
    : meta.data
      ? `${meta.data.sort_field || 'modified'} ${meta.data.sort_order || 'desc'}`
      : undefined

  const list = useQuery({
    queryKey: ['list', doctype, columns.map((c) => c.fieldname), orderBy, start, filterKey],
    enabled: Boolean(meta.data),
    placeholderData: keepPreviousData,
    queryFn: () =>
      listResource(doctype, {
        filters,
        fields: columns.map((c) => c.fieldname),
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
    setSort((s) =>
      s?.field === field
        ? { field, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'asc' },
    )
  }

  // UI-012: bulk actions over the selected rows. Each doc goes through the
  // normal document lifecycle (delete_doc / save_doc) — no side-channel.
  const editableFields = (meta.data?.fields ?? []).filter(
    (f) =>
      !NO_COLUMN_TYPES.has(f.fieldtype) &&
      !['Table', 'Attach', 'Attach Image', 'JSON'].includes(f.fieldtype) &&
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
        await api.delete(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`)
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
    const fieldtype = editableFields.find((f) => f.fieldname === bulkField)?.fieldtype
    const value: unknown =
      fieldtype === 'Check'
        ? ['1', 'true', 'yes'].includes(bulkValue.trim().toLowerCase())
        : bulkValue === ''
          ? null
          : bulkValue
    try {
      for (const name of selected) {
        const doc = await api.get<Record<string, unknown>>(
          `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
        )
        await api.put(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`, {
          [bulkField]: value,
          modified: doc.modified,
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
          <h1 className="text-xl font-semibold text-[var(--color-ink)]">{doctype}</h1>
          <span className="text-xs text-[var(--color-ink-muted)]" data-testid="list-total">
            {total} total
          </span>
        </div>
        <Link
          to="/desk/$doctype/view/report"
          params={{ doctype }}
          search={{ report: undefined }}
          className="fc-btn"
          data-testid="open-report"
        >
          Report
        </Link>
      </div>
      {onFiltersChange && meta.data && (
        <FilterBar meta={meta.data} filters={filters} onChange={onFiltersChange} />
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
              {editableFields.map((f) => (
                <option key={f.fieldname} value={f.fieldname}>
                  {f.label ?? f.fieldname}
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
                <th key={col.fieldname} className="border-b border-[var(--color-border)]">
                  <button
                    className="w-full px-3 py-2 text-left font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                    data-testid={`col-${col.fieldname}`}
                    onClick={() => toggleSort(col.fieldname)}
                  >
                    {col.label}
                    {sort?.field === col.fieldname && (sort.dir === 'asc' ? ' ↑' : ' ↓')}
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
                  <td key={col.fieldname} className="px-3 py-2">
                    {i === 0 ? (
                      <Link
                        to="/desk/$doctype/$name"
                        params={{ doctype, name: String(row.name) }}
                        className="font-medium text-[var(--color-brand)] hover:underline"
                      >
                        {cell(row[col.fieldname])}
                      </Link>
                    ) : (
                      <span className="text-[var(--color-ink)]">{cell(row[col.fieldname])}</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-8 text-center text-[var(--color-ink-faint)]">
                  No documents
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


export function FilterBar({
  meta,
  filters,
  onChange,
}: {
  meta: import('../lib/meta').DocTypeMeta
  filters: Filter[]
  onChange: (filters: Filter[]) => void
}) {
  const fields = [
    { fieldname: 'name', label: 'Name' },
    ...meta.fields
      .filter((f) => !NO_COLUMN_TYPES.has(f.fieldtype) && !f.hidden)
      .map((f) => ({ fieldname: f.fieldname, label: f.label ?? f.fieldname })),
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

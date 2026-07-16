import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link as RouterLink } from '@tanstack/react-router'
import { listResource } from '../lib/api'
import { NO_COLUMN_TYPES, useMeta } from '../lib/meta'

type Row = Record<string, unknown>

const NUMERIC = new Set(['Int', 'Float', 'Currency'])
const GROUPABLE = new Set(['Select', 'Link', 'Data', 'Check'])

// RPT-001: report view — column picker and group-by with counts and sums,
// generic over every DocType (metadata-driven like the rest of the Desk).
export function ReportView({ doctype }: { doctype: string }) {
  const meta = useMeta(doctype)

  const available = useMemo(
    () =>
      (meta.data?.fields ?? []).filter(
        (f) => !NO_COLUMN_TYPES.has(f.fieldtype) && f.fieldtype !== 'Table' && !f.hidden,
      ),
    [meta.data],
  )

  const [selected, setSelected] = useState<string[] | null>(null)
  const [groupBy, setGroupBy] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)

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
    queryKey: ['report', doctype, fetchFields, groupBy],
    enabled: Boolean(meta.data),
    queryFn: () =>
      listResource<Row>(doctype, {
        fields: fetchFields,
        order_by: groupBy ? `${groupBy} asc` : 'modified desc',
        limit_page_length: 500,
      }),
  })

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
      </div>

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
